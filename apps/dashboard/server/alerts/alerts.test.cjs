/* eslint-disable @typescript-eslint/no-require-imports -- CJS harness transpiles isolated TS with injected dependencies. */
/* eslint-disable unicorn/consistent-function-scoping -- Keep the in-memory DB helpers together. */
/* eslint-disable unicorn/prefer-https -- Explicitly exercise permitted HTTP destinations using mock fetch only. */
// Synthetic-only tests. No environment loading, Mongo connection, socket or external delivery.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function load(name, imports = {}, extra = "", clock = Date) {
  const source = readFileSync(path.join(__dirname, name + ".ts"), "utf8") + extra;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const compiledModule = { exports: {} };
  const resolve = (id) => {
    if (Object.hasOwn(imports, id)) return imports[id];
    if (id === "node:crypto") return require(id);
    throw new Error("Unexpected dependency in local-only test: " + id);
  };
  new Function("require", "module", "exports", "Date", compiled)(
    resolve,
    compiledModule,
    compiledModule.exports,
    clock,
  );
  return compiledModule.exports;
}

const engine = load("engine");
const hooks = load("webhook");
const permissions = load("permissions");

test("offline uses central heartbeat, creation grace, and strict threshold", () => {
  assert.equal(engine.isHostOffline(1000, 0, 61000, 60000), false);
  assert.equal(engine.isHostOffline(1000, 0, 61001, 60000), true);
  assert.equal(engine.isHostOffline(undefined, 1000, 61000, 60000), false);
  assert.equal(engine.isHostOffline(undefined, undefined, 1000, 60000), true);
});

test("restart baseline, rolling deltas, recovery, counter rollback and observation gaps", () => {
  const w = new engine.RestartWindow();
  assert.equal(w.observe("p", 500, 0, 60000, 5).firing, false);
  assert.equal(w.observe("p", 503, 10000, 60000, 5).count, 3);
  assert.equal(w.observe("p", 505, 20000, 60000, 5).firing, true);
  assert.equal(w.observe("p", 505, 30000, 60000, 5).firing, true);
  assert.equal(w.observe("p", 505, 80000, 60000, 5).canRecover, true);
  assert.equal(w.observe("p", 0, 90000, 60000, 5).canRecover, false);
  assert.equal(w.observe("p", 4, 100000, 60000, 5).firing, false);
  assert.equal(w.observe("p", 5, 110000, 60000, 5).firing, true);
  assert.equal(w.observe("p", 500, 200000, 60000, 5).firing, false);
  assert.equal(w.observe("p", undefined, 201000, 60000, 5).canRecover, false);
  w.clear();
  assert.equal(w.observe("p", 9000, 202000, 60000, 5).count, 0);
});

const sid = "111111111111111111111111";
const pid = "222222222222222222222222";
const other = "333333333333333333333333";
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((part) => matches(doc, part));
    if (key === "$and") return value.every((part) => matches(doc, part));
    const actual = doc[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([op, expected]) => {
        if (op === "$in") return expected.includes(actual);
        if (op === "$nin") return !expected.includes(actual);
        if (op === "$exists") return expected ? actual !== undefined : actual === undefined;
        if (op === "$gt") return actual > expected;
        if (op === "$lte") return actual <= expected;
        throw new Error("Unsupported mock operator " + op);
      });
    }
    return actual === value;
  });
}

test("ACL filters deny other targets and honor process overrides before pagination", () => {
  const user = {
    acl: { owner: false, admin: false, servers: [{ server: sid, perms: 2, processes: [{ process: pid, perms: 0 }] }] },
  };
  let filter = permissions.alertVisibilityFilter(user);
  assert.equal(matches({ kind: "host_offline", server: sid }, filter), true);
  assert.equal(matches({ kind: "restart_storm", server: sid, process: pid }, filter), false);
  assert.equal(matches({ kind: "restart_storm", server: sid, process: other }, filter), true);
  assert.equal(matches({ kind: "host_offline", server: other }, filter), false);
  user.acl.servers[0].perms = 0;
  user.acl.servers[0].processes[0].perms = 2;
  filter = permissions.alertVisibilityFilter(user);
  assert.equal(matches({ kind: "restart_storm", server: sid, process: pid }, filter), true);
  assert.equal(matches({ kind: "host_offline", server: sid }, filter), false);
  assert.equal(matches({ kind: "restart_storm", server: sid, process: other }, filter), false);
  assert.equal(matches({ _id: sid }, permissions.alertVisibilityFilter({ acl: { servers: [] } })), false);
  assert.deepEqual(permissions.alertVisibilityFilter({ acl: { owner: true } }), {});
});

test("webhook validation, safe failures, bounded timeout, no redirects or response body reads", async () => {
  assert.equal(hooks.validateWebhookUrl("https://example.invalid/notify?key=synthetic"), true);
  assert.equal(hooks.validateWebhookUrl("file:///secret"), false);
  assert.equal(hooks.validateWebhookUrl("https://user:pass@example.invalid"), false);
  assert.equal(hooks.validateWebhookUrl("https://example.invalid/#fragment"), false);
  const privateUrl = "http://example.invalid/secret-token";
  let calls = 0;
  const success = await hooks.sendWebhook(privateUrl, { edge: "open" }, async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "POST");
    return { ok: true, body: { cancel: async () => {} } };
  });
  assert.equal(success.status, "sent");
  assert.equal(calls, 1);
  const failure = await hooks.sendWebhook(privateUrl, {}, async () => {
    throw new Error(privateUrl);
  });
  assert.deepEqual(failure, { status: "failed", error: "network_failure" });
  const timeout = await hooks.sendWebhook(
    privateUrl,
    {},
    async (_url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error(privateUrl)), { once: true });
      }),
    5,
  );
  assert.deepEqual(timeout, { status: "failed", error: "timeout" });
  assert.deepEqual(await hooks.sendWebhook(privateUrl, {}, async () => ({ ok: false })), {
    status: "failed",
    error: "http_failure",
  });
  assert.equal(JSON.stringify([failure, timeout]).includes("secret-token"), false);
});

function mockDatabase() {
  let config;
  const events = [];
  const servers = [{ _id: sid, name: "Synthetic host", heartbeat: 1000000, createdAt: new Date(1000000) }];
  const processes = [{ _id: pid, server: sid, name: "Synthetic process", runtime: { restarts: 400 } }];
  const query = (value) => ({
    select() {
      return this;
    },
    maxTimeMS() {
      return this;
    },
    lean: async () => value,
  });
  function apply(doc, update) {
    Object.assign(doc, update.$set);
    const removedKeys = Object.keys(update.$unset ?? {});
    for (const key of removedKeys) delete doc[key];
  }
  const models = {
    alertRuleModel: {
      createIndexes: async () => {},
      updateOne: async (filter, update, options) => {
        if (!config && options?.upsert) config = { _id: "central", ...update.$setOnInsert };
        if (!config || !matches(config, filter)) return { matchedCount: 0, modifiedCount: 0 };
        apply(config, update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: (filter, update) => {
        if (!config || !matches(config, filter)) return query(null);
        apply(config, update);
        return query({ ...config });
      },
      findById: () => query(config ? { ...config } : null),
    },
    alertEventModel: {
      createIndexes: async () => {},
      find: (filter) => query(events.filter((event) => matches(event, filter)).map((event) => ({ ...event }))),
      create: async (value) => {
        if (events.some((event) => event.activeKey === value.activeKey))
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        const event = { _id: String(events.length + 1).padStart(24, "0"), ...value };
        events.push(event);
        return { toObject: () => ({ ...event }) };
      },
      findOneAndUpdate: (filter, update) => {
        const event = events.find((event) => matches(event, filter));
        if (!event) return query(null);
        apply(event, update);
        return query({ ...event });
      },
      updateOne: async (filter, update) => {
        const event = events.find((event) => matches(event, filter));
        if (!event) return { modifiedCount: 0 };
        apply(event, update);
        return { modifiedCount: 1 };
      },
    },
    serverModel: { find: () => query(servers) },
    processModel: { find: () => query(processes) },
  };
  return {
    models,
    events,
    servers,
    processes,
    get config() {
      return config;
    },
  };
}

test("central scanner: singleton lease, open/ack/recovery, default no delivery, meaningful edges only", async () => {
  let now = 1000000;
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length > 0 ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const db = mockDatabase();
  const deliveries = [];
  const { Scanner } = load(
    "scanner",
    {
      "@pm2.web/mongoose-models": db.models,
      "./engine": engine,
      "./webhook": {
        sendWebhook: async (url, payload) => {
          deliveries.push({ url, payload });
          return { status: "sent" };
        },
      },
      "@/middleware/mongodb": { __esModule: true, default: async () => {} },
    },
    "\nexport { Scanner };",
    Clock,
  );
  const scanner = new Scanner();
  const standby = new Scanner();
  await scanner.tick();
  assert.equal(db.config.webhookEnabled, false);
  assert.equal(db.events.length, 0); // cumulative restarts=400 did not trigger
  now += 61000;
  await scanner.tick();
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].kind, "host_offline");
  assert.equal(db.events[0].openDelivery, "disabled");
  await standby.tick();
  assert.equal(db.events.length, 1); // other worker does not scan
  db.events[0].status = "acknowledged";
  await scanner.tick();
  assert.equal(db.events.length, 1); // ack does not re-open
  db.servers[0].heartbeat = now;
  await scanner.tick();
  assert.equal(db.events[0].status, "resolved");
  assert.equal(deliveries.length, 0);

  db.config.webhookUrl = "http://example.invalid/synthetic-only";
  db.config.webhookEnabled = true;
  now += 10000;
  db.servers[0].heartbeat = now;
  db.processes[0].runtime.restarts += 3;
  await scanner.tick();
  now += 10000;
  db.servers[0].heartbeat = now;
  db.processes[0].runtime.restarts += 2;
  await scanner.tick();
  assert.equal(db.events[1].kind, "restart_storm");
  assert.equal(deliveries.length, 1);
  await scanner.tick();
  assert.equal(deliveries.length, 1);
  now += 50000;
  db.servers[0].heartbeat = now;
  await scanner.tick();
  now += 10000;
  db.servers[0].heartbeat = now;
  await scanner.tick();
  assert.equal(db.events[1].status, "resolved");
  assert.equal(deliveries.length, 2);
  assert.deepEqual(
    deliveries.map((d) => d.payload.edge),
    ["open", "recovery"],
  );

  // An expired lease lets a different Web worker take over, with a fresh baseline.
  now += 121000;
  db.servers[0].heartbeat = now;
  db.processes[0].runtime.restarts = 9000;
  await standby.tick();
  assert.equal(db.events.length, 2);
  await scanner.tick();
  assert.equal(db.events.length, 2);
  await scanner.stop();
  await standby.stop();
});

test("delivery budget is bounded and failures are not automatically retried", async () => {
  const db = mockDatabase();
  let calls = 0;
  const { Scanner } = load(
    "scanner",
    {
      "@pm2.web/mongoose-models": db.models,
      "./engine": engine,
      "./webhook": {
        sendWebhook: async () => {
          calls++;
          return { status: "failed", error: "network_failure" };
        },
      },
      "@/middleware/mongodb": { __esModule: true, default: async () => {} },
    },
    "\nexport { Scanner };",
  );
  const scanner = new Scanner();
  db.servers[0].heartbeat = Date.now();
  await scanner.tick();
  db.config.webhookEnabled = true;
  db.config.webhookUrl = "http://example.invalid/local-mock";
  for (let i = 0; i < 25; i++)
    await scanner.open({
      kind: "host_offline",
      server: sid,
      targetName: "Synthetic",
      activeKey: "mock:" + i,
      reason: "Synthetic",
    });
  assert.equal(calls, 20);
  assert.equal(db.events.filter((e) => e.openDelivery === "skipped").length, 5);
  assert.equal(db.events.filter((e) => e.openDeliveryError === "network_failure").length, 20);
  await scanner.notify(db.events[0], "open");
  assert.equal(calls, 20);
  await scanner.stop();
});
