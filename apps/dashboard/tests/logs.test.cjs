/* Synthetic unit tests only: no database, env loading, PM2 or real logs. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
const localRequire = createRequire(path.join(root, "apps/dashboard/package.json"));
const mongoose = localRequire("mongoose");
const oid = (number) => number.toString(16).padStart(24, "0");
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(relative, mocks = {}) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, {
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
const procedure = {
  input() {
    return this;
  },
  query(handler) {
    return handler;
  },
};
function router(model = {}) {
  return load("apps/dashboard/server/routers/logs.ts", {
    "@pm2.web/mongoose-models": { logEntryModel: model },
    "../trpc": { protectedProcedure: procedure, router: (value) => value },
  });
}
const owner = { acl: { owner: true, admin: false, servers: [] } };
const now = new Date("2030-02-08T12:00:00Z");

test("literal search escapes all regex syntax and rejects unbounded inputs", () => {
  const api = router();
  const literal = "a.*[x](foo)?+$^|\\";
  const regex = new RegExp(api.escapeLogSearch(literal), "i");
  assert.ok(regex.test(literal));
  assert.ok(!regex.test("aaaaaxfoo"));
  assert.equal(api.logQueryInput.safeParse({ filters: { text: "x".repeat(201) } }).success, false);
  assert.equal(api.logQueryInput.safeParse({ filters: {}, pageSize: 101 }).success, false);
  assert.equal(api.logQueryInput.safeParse({ filters: { start: "2030-02-09", end: "2030-02-08" } }).success, false);
  assert.equal(api.logQueryInput.safeParse({ filters: { processId: "invalid" } }).success, false);
});

test("ACL uses paired server/process scopes, inherited permissions and explicit denies", () => {
  const { logAclMatch } = router();
  assert.deepEqual(logAclMatch(owner), {});
  assert.deepEqual(logAclMatch({ acl: { admin: true } }), {});
  assert.deepEqual(plain(logAclMatch({ acl: { servers: [] } })), { "source.process": { $in: [] } });
  const match = plain(
    logAclMatch({
      acl: {
        servers: [
          {
            server: oid(1),
            perms: 1,
            processes: [
              { process: oid(2), perms: 0 },
              { process: oid(3), perms: 1 },
            ],
          },
          { server: oid(4), perms: 0, processes: [{ process: oid(5), perms: 1 }] },
        ],
      },
    }),
  );
  assert.deepEqual(match, {
    $or: [
      { "source.server": oid(1), "source.process": { $nin: [oid(2)] } },
      { "source.server": oid(4), "source.process": { $in: [oid(5)] } },
    ],
  });
});

test("matching intersects ACL, selection, type, retention, dates and stable timestamp/id cursor", () => {
  const { logMatch } = router();
  const timestamp = new Date("2030-02-07T12:00:00Z");
  const match = plain(
    logMatch(
      { acl: { servers: [] } },
      {
        text: ".*",
        processIds: [],
        serverId: oid(1),
        processId: oid(2),
        type: "error",
        start: new Date("2020-01-01"),
        end: now,
      },
      { timestamp, id: oid(3) },
      now,
    ),
  );
  assert.deepEqual(match.$and[0], { "source.process": { $in: [] } });
  assert.equal(match.$and[1].timestamp.$gte, "2030-02-01T12:00:00.000Z");
  assert.equal(match.$and[1].timestamp.$lte, now.toISOString());
  assert.ok(match.$and.some((clause) => clause.type === "error"));
  assert.ok(match.$and.some((clause) => clause.message?.$regex === "\\.\\*"));
  assert.deepEqual(match.$and.at(-1), {
    $or: [
      { timestamp: { $lt: timestamp.toISOString() } },
      { timestamp: timestamp.toISOString(), _id: { $lt: oid(3) } },
    ],
  });
});

function row(number, message = "synthetic line") {
  return {
    _id: new mongoose.Types.ObjectId(oid(number)),
    source: {
      server: new mongoose.Types.ObjectId(oid(1)),
      process: new mongoose.Types.ObjectId(oid(2)),
    },
    type: "stdout",
    timestamp: now,
    message,
    messageTruncated: false,
  };
}

test("query applies ACL in database before limit, projects bounded messages and returns keyset page", async () => {
  let pipeline;
  const api = router({
    aggregate(value) {
      pipeline = value;
      return {
        option() {
          return this;
        },
        async exec() {
          return [row(9), row(8), row(7)];
        },
      };
    },
  });
  const result = await api.logsRouter.query({
    ctx: { user: { acl: { servers: [] } } },
    input: { filters: { text: "" }, pageSize: 2 },
  });
  assert.deepEqual(plain(pipeline[0].$match.$and[0]), { "source.process": { $in: [] } });
  assert.deepEqual(pipeline[1], { $sort: { timestamp: -1, _id: -1 } });
  assert.equal(pipeline[2].$limit, 3);
  assert.equal(pipeline[3].$project.message.$substrCP[2], 16384);
  assert.deepEqual(
    result.items.map((item) => item.id),
    [oid(9), oid(8)],
  );
  assert.equal(result.nextCursor.id, oid(8));
  const empty = router({
    aggregate() {
      return {
        option() {
          return this;
        },
        async exec() {
          return [];
        },
      };
    },
  });
  assert.deepEqual(
    await empty.logsRouter.query({ ctx: { user: owner }, input: { filters: { text: "" }, pageSize: 50 } }),
    { items: [], nextCursor: null },
  );
});

test("download uses same ACL and closes stream at 5000 rows or 5 MiB", async () => {
  for (const message of ["fixture", "x".repeat(16384)]) {
    let closed = false;
    let pipeline;
    const api = router({
      aggregate(value) {
        pipeline = value;
        return {
          option() {
            return this;
          },
          cursor() {
            return {
              async *[Symbol.asyncIterator]() {
                for (let i = 0; i < 5001; i++) yield row(i + 1, message);
              },
              async close() {
                closed = true;
              },
            };
          },
        };
      },
    });
    const result = await api.logsRouter.download({
      ctx: { user: { acl: { servers: [] } } },
      input: { filters: { text: "" } },
    });
    assert.deepEqual(plain(pipeline[0].$match.$and[0]), { "source.process": { $in: [] } });
    assert.equal(pipeline[2].$limit, 5001);
    assert.ok(result.count <= 5000);
    assert.ok(Buffer.byteLength(result.content) <= 5 * 1024 * 1024);
    assert.equal(result.truncated, true);
    assert.equal(closed, true);
  }
});

test("browser renders an empty result normally and uses the new polling query", () => {
  const React = localRequire("react");
  const { renderToStaticMarkup } = localRequire("react-dom/server");
  let request;
  let options;
  const control =
    (tag) =>
    ({ children, label }) =>
      React.createElement(tag, null, label, children);
  const Browser = load("apps/dashboard/components/LogBrowser.tsx", {
    "@mantine/core": Object.fromEntries(
      ["Alert", "Badge", "Button", "Card", "Group", "Select", "SimpleGrid", "Stack", "Text", "TextInput"].map(
        (name) => [name, control(name === "Button" ? "button" : "div")],
      ),
    ),
    "@/utils/trpc": {
      trpc: {
        useUtils: () => ({}),
        logs: {
          query: {
            useQuery: (input, config) => {
              request = input;
              options = config;
              return { data: { items: [], nextCursor: null }, isLoading: false };
            },
          },
        },
      },
    },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Browser, { processIds: [], refetchInterval: 2000 }));
  assert.ok(html.includes("No matching logs"));
  assert.ok(html.includes("Live · page 1"));
  assert.ok(html.includes("5,000 matches"));
  assert.deepEqual(request.filters.processIds, []);
  assert.equal(request.pageSize, 50);
  assert.equal(options.refetchInterval, 2000);
});

test("schema has seven-day TTL and global/server/process chronological indexes", () => {
  const { logEntryModel } = load("packages/mongoose-models/models/log-entry.ts");
  const indexes = logEntryModel.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.timestamp === 1 && options.expireAfterSeconds === 604800));
  for (const field of ["source.server", "source.process"]) {
    assert.ok(indexes.some(([keys]) => keys[field] === 1 && keys.timestamp === -1 && keys._id === -1));
  }
  assert.equal(logEntryModel.collection.name, "logentries");
});

test("new process logs and stats share its first ID; queue is untouched and only censored fields persist", async () => {
  const persisted = [];
  const stats = [];
  const processes = [];
  class Process {
    constructor(value) {
      Object.assign(this, value);
      this._id = oid(2);
      processes.push(this);
    }
    async save() {}
    static async findOne() {
      return null;
    }
    static async deleteMany() {
      return { deletedCount: 0 };
    }
  }
  const censor = load("apps/backend/utils/censorMessage.ts").default;
  const updateData = load("apps/backend/handlers/updateData.ts", {
    "@pm2.web/mongoose-models": {
      processModel: Process,
      serverModel: {
        async findOne() {
          return { _id: oid(1), save() {} };
        },
      },
      statModel: {
        async insertMany(value) {
          stats.push(...value);
        },
      },
      logEntryModel: {
        async insertMany(value) {
          persisted.push(...value);
        },
      },
    },
    "../utils/censorMessage.js": { default: censor, __esModule: true },
    "../utils/serverInfo.js": {
      default: async () => ({ uuid: "fixture", name: "fixture", stats: { memoryMax: 1024 } }),
      __esModule: true,
    },
    "../utils/processInfo.js": {
      default: async () => [{ pm_id: 0, name: "fixture", type: "node", status: "online", stats: {} }],
      __esModule: true,
    },
  }).default;
  const queued = ["success", "error", "info"].map((type) => ({
    id: 0,
    type,
    createdAt: now,
    message: String.raw`C:\Users\Fixture\file`,
  }));
  await updateData(queued, { logRotation: 2 });
  assert.deepEqual(
    queued.map((entry) => entry.id),
    [0, 0, 0],
  );
  assert.deepEqual(
    persisted.map((entry) => entry.type),
    ["stdout", "error", "event"],
  );
  assert.ok(persisted.every((entry) => entry.source.process === oid(2) && entry.source.server === oid(1)));
  assert.ok(persisted.every((entry) => entry.message.includes("C:\\Users\\Name")));
  assert.deepEqual(Object.keys(persisted[0]).sort(), ["_id", "message", "source", "timestamp", "type"]);
  assert.equal(stats.find((entry) => entry.source.process)?.source.process, oid(2));
  assert.equal(processes[0].logs.length, 2);
  assert.equal(processes[0].logs[0]._id.toString(), persisted[1]._id.toString());
});
