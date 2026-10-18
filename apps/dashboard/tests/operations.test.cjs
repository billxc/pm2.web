/* Synthetic API tests: no database, real environment or PM2 connection. */
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createRequire } = require("node:module");
const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
function load(relative, mocks = {}) {
  const file = path.resolve(__dirname, "..", relative);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => (name in mocks ? mocks[name] : localRequire(name)),
    module,
    module.exports,
  );
  return module.exports;
}
const operationTypes = load("../../packages/typings/src/operation.ts");
const permission = load("utils/permission.ts");
const access = load("utils/access.ts", { "./permission": permission });
const id = (n) => n.toString(16).padStart(24, "0");
const owner = { _id: id(1), name: "Synthetic owner", acl: { owner: true, admin: false, servers: [] } };
const denied = { _id: id(2), name: "Unprivileged", acl: { owner: false, admin: false, servers: [] } };
function api(user, override = {}) {
  const created = [];
  const cleanups = [];
  const trpc = load("server/trpc.ts", { "@pm2.web/mongoose-models": { userModel: { findById: async () => user } } });
  const models = {
    serverModel: { exists: async () => true },
    processModel: {
      findOne: async () => ({
        _id: id(4),
        pm_id: 5,
        name: "fixture",
        server: id(3),
        runtime: { script: "/synthetic/fixture.js" },
      }),
    },
    operationModel: {
      create: async (doc) => {
        created.push(doc);
        return { ...doc, _id: id(5), createdAt: new Date(), updatedAt: new Date() };
      },
    },
    ...override,
  };
  models.operationModel = {
    updateMany: async (...args) => {
      cleanups.push(args);
    },
    ...models.operationModel,
  };
  const { operationsRouter } = load("server/routers/operations.ts", {
    "@pm2.web/mongoose-models": models,
    "@pm2.web/typings": operationTypes,
    "@/utils/access": access,
    "@/utils/permission": permission,
    "../trpc": trpc,
  });
  return {
    caller: operationsRouter.createCaller({ session: user ? { user: { id: user._id } } : null }),
    created,
    cleanups,
  };
}
const target = { serverId: id(3), processId: id(4) };
test("default authentication cannot be bypassed", async () => {
  const { caller, created, cleanups } = api(null);
  await assert.rejects(caller.enqueue({ ...target, action: "restart" }), (error) => error.code === "UNAUTHORIZED");
  assert.equal(created.length, 0);
  assert.equal(cleanups.length, 0, "unauthenticated calls cannot run system cleanup");
});
test("existing controls enforce original ACL and start/reload require restart permission", async () => {
  const { caller, created } = api(denied);
  for (const action of ["start", "stop", "restart", "reload", "delete"])
    await assert.rejects(caller.enqueue({ ...target, action }), (error) => error.code === "FORBIDDEN");
  assert.equal(created.length, 0);
  const user = {
    ...denied,
    acl: { ...denied.acl, servers: [{ server: id(3), perms: 1 << permission.PERMISSIONS.RESTART, processes: [] }] },
  };
  const allowed = api(user);
  await allowed.caller.enqueue({ ...target, action: "reload" });
  await allowed.caller.enqueue({ ...target, action: "start" });
  await assert.rejects(allowed.caller.enqueue({ ...target, action: "stop" }), (error) => error.code === "FORBIDDEN");
  assert.equal(allowed.created.length, 2);
});
test("configuration and startup saving are strictly admin/owner", async () => {
  const { caller } = api(denied);
  for (const input of [
    { serverId: id(3), action: "create", config: { name: "new", script: "/fixture.js" } },
    { ...target, action: "update", config: { name: "new" } },
    { serverId: id(3), action: "save" },
    { ...target, action: "restart", saveStartup: true },
  ])
    await assert.rejects(caller.enqueue(input), (error) => error.code === "FORBIDDEN");
});
test("enqueue returns a durable queued id but never returns payload or target config", async () => {
  const { caller, created } = api(owner);
  const operation = await caller.enqueue({
    ...target,
    action: "update",
    config: { env: { SECRET: "private-value" }, args: ["--token=private-value"] },
  });
  assert.equal(operation.status, "queued");
  assert.equal(operation._id, id(5));
  assert.equal(created[0].payload.env.SECRET, "private-value");
  assert.equal(created[0].targetScript, "/synthetic/fixture.js");
  assert.equal(created[0].saveStartup, false);
  assert.equal(JSON.stringify(operation).includes("private-value"), false);
  assert.equal("payload" in operation, false);
  assert.equal("targetScript" in operation, false);
});
test("reject unknown options, invalid ids and unsupported update autostart", async () => {
  const { caller } = api(owner);
  for (const input of [
    { ...target, serverId: "invalid", action: "restart" },
    { ...target, action: "update", config: { exec_mode: "cluster" } },
    { ...target, action: "update", config: { autostart: false } },
    { ...target, action: "restart", config: { name: "no" } },
    { serverId: id(3), action: "create", config: { name: "no-script" } },
  ])
    await assert.rejects(caller.enqueue(input), (error) => error.code === "BAD_REQUEST");
});
test("get/list strip payload even if storage accidentally includes private fields", async () => {
  const row = {
    _id: id(5),
    server: id(3),
    process: id(4),
    actor: { id: owner._id, name: owner.name },
    action: "update",
    status: "succeeded",
    payload: { env: { SECRET: "private-value" } },
    targetScript: "private-path",
    result: { message: "Done", pm_id: 5, pm2_env: { PRIVATE: "private-value" } },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const operationModel = {
    findById: () => ({ lean: async () => row }),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) }),
  };
  const { caller } = api(owner, { operationModel });
  for (const result of [await caller.get({ id: row._id }), await caller.list({})]) {
    assert.equal(JSON.stringify(result).includes("private-value"), false);
    assert.equal(JSON.stringify(result).includes("private-path"), false);
  }
  await assert.rejects(
    api(denied, { operationModel }).caller.get({ id: row._id }),
    (error) => error.code === "NOT_FOUND",
  );
});

test("get/list/enqueue expire offline queued tasks before reading or enqueueing, without exposing payload", async () => {
  const row = {
    _id: id(5),
    server: id(3),
    process: id(4),
    actor: { id: owner._id, name: owner.name },
    action: "restart",
    status: "queued",
    payload: { env: { SECRET: "private-value" } },
    createdAt: new Date(Date.now() - operationTypes.OPERATION_QUEUE_MAX_AGE_MS - 1000),
    updatedAt: new Date(),
  };
  const cleanups = [];
  const operationModel = {
    updateMany: async (filter, update) => {
      cleanups.push([filter, update]);
      assert.equal(filter.status, "queued");
      assert.equal("server" in filter, false, "system expiry also covers offline servers");
      assert.equal(update.$set.finishedAt.getTime() - filter.createdAt.$lte.getTime(), 10 * 60 * 1000);
      if (row.status === filter.status && row.createdAt <= filter.createdAt.$lte) {
        Object.assign(row, update.$set);
        for (const key of Object.keys(update.$unset)) delete row[key];
      }
    },
    findById: () => ({ lean: async () => row }),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) }),
    create: async (doc) => ({ ...doc, _id: id(6), createdAt: new Date(), updatedAt: new Date() }),
  };
  const { caller } = api(owner, { operationModel });
  const expired = await caller.get({ id: row._id });
  assert.equal(expired.status, "failed");
  assert.equal(expired.error, operationTypes.OPERATION_EXPIRED_ERROR);
  assert.equal("payload" in row, false);
  assert.equal(JSON.stringify(expired).includes("private-value"), false);
  assert.equal((await caller.list({}))[0].status, "failed");
  await caller.enqueue({ ...target, action: "restart" });
  assert.equal(cleanups.length, 3);
  assert.ok(cleanups.every(([, update]) => update.$unset.payload === 1));
});

test("unknown remains a readable terminal audit status", async () => {
  const row = {
    _id: id(5),
    server: id(3),
    action: "save",
    status: "unknown",
    actor: { id: owner._id, name: owner.name },
    error: operationTypes.OPERATION_UNKNOWN_ERROR,
    finishedAt: new Date(),
  };
  const { caller } = api(owner, { operationModel: { findById: () => ({ lean: async () => row }) } });
  const result = await caller.get({ id: row._id });
  assert.equal(result.status, "unknown");
  assert.equal(result.error, operationTypes.OPERATION_UNKNOWN_ERROR);
});

test("unknown stops task polling and terminal-only history uses slow discovery polling", () => {
  let taskOptions;
  let historyOptions;
  const components = load("components/process/OperationHistory.tsx", {
    "@mantine/core": {
      Alert: "div",
      Badge: "span",
      Card: "div",
      Group: "div",
      Loader: "span",
      Stack: "div",
      Text: "span",
    },
    "@/utils/trpc": {
      trpc: {
        operations: {
          get: {
            useQuery: (_input, options) => {
              taskOptions = options;
              return {};
            },
          },
          list: {
            useQuery: (_input, options) => {
              historyOptions = options;
              return {};
            },
          },
        },
      },
    },
  });
  components.OperationStatus({ id: id(5) });
  for (const status of ["unknown", "succeeded", "failed"]) {
    assert.equal(taskOptions.refetchInterval({ state: { data: { status } } }), false);
  }
  assert.equal(taskOptions.refetchInterval({ state: { data: { status: "running" } } }), 1500);
  components.default({});
  assert.equal(historyOptions.refetchInterval({ state: { data: [{ status: "unknown" }] } }), 30_000);
  assert.equal(historyOptions.refetchInterval({ state: { data: [{ status: "queued" }] } }), 3000);
});
