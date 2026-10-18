/* Synthetic queue tests: no MongoDB connection and no real PM2 import. */
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const file = path.resolve(__dirname, "../handlers/operations.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const typesModule = { exports: {} };
new Function(
  "exports",
  ts.transpileModule(
    fs.readFileSync(
      path.resolve(__dirname, "../../../packages/typings/src/operation.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
)(typesModule.exports);
const operationTypes = typesModule.exports;
class OperationError extends Error {}
async function runWorker(outcome, ticks = 1) {
  let claim;
  let selection;
  let write;
  let scheduled;
  const cleanups = [];
  let resolve;
  const finished = new Promise((done) => {
    resolve = done;
  });
  const module = { exports: {} };
  const models = {
    operationModel: {
      updateMany: async (...args) => {
        cleanups.push(args);
      },
      findOneAndUpdate: (...args) => {
        claim = args;
        return {
          select: (value) => {
            selection = value;
            return {
              lean: async () => ({
                _id: "task",
                server: "own-server",
                action: "restart",
              }),
            };
          },
        };
      },
      updateOne: async (...args) => {
        write = args;
        resolve();
      },
    },
  };
  const executor = {
    OperationError,
    executeOperation: async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    saveStartupList: async () => {},
  };
  new Function("require", "module", "exports", "setTimeout", compiled)(
    (name) => {
      if (name === "@pm2.web/mongoose-models") return models;
      if (name === "@pm2.web/typings") return operationTypes;
      if (name === "pm2") return { pm2_home: "synthetic-home" };
      if (name === "../utils/operationExecutor.js") return executor;
      throw new Error(`Unexpected dependency ${name}`);
    },
    module,
    module.exports,
    (callback) => {
      scheduled = callback;
      return 0;
    },
  );
  const stop = module.exports.default("own-server");
  await finished;
  await new Promise(setImmediate);
  for (let i = 1; i < ticks; i++) {
    const next = new Promise((done) => {
      resolve = done;
    });
    scheduled();
    await next;
    await new Promise(setImmediate);
  }
  stop();
  return { claim, write, selection, cleanups };
}
test("worker atomically claims only its own queued tasks and persists terminal result", async () => {
  const { claim, write, selection } = await runWorker({
    message: "Completed",
    saved: false,
  });
  assert.equal(claim[0].server, "own-server");
  assert.equal(claim[0].status, "queued");
  assert.ok(claim[0].createdAt.$gt instanceof Date);
  assert.equal(
    claim[1].$set.startedAt.getTime() - claim[0].createdAt.$gt.getTime(),
    operationTypes.OPERATION_QUEUE_MAX_AGE_MS,
  );
  assert.equal(claim[1].$set.status, "running");
  assert.ok(claim[1].$set.startedAt instanceof Date);
  assert.equal(claim[2].new, true);
  assert.deepEqual(claim[2].sort, { createdAt: 1, _id: 1 });
  assert.equal(selection, "+payload +targetName +targetScript");
  assert.deepEqual(write[0], { _id: "task", status: "running" });
  assert.equal(write[1].$set.status, "succeeded");
  assert.equal(write[1].$set.result.message, "Completed");
  assert.ok(write[1].$set.finishedAt instanceof Date);
  assert.equal(write[1].$unset.payload, 1);
});
test("raw PM2 errors cannot leak credentials into audit history", async () => {
  const { write } = await runWorker(
    new Error("environment SECRET=private-value"),
  );
  assert.equal(write[1].$set.status, "failed");
  assert.equal(JSON.stringify(write).includes("private-value"), false);
  assert.equal(write[1].$unset.payload, 1);
});
test("controlled safe errors are auditable", async () => {
  const { write } = await runWorker(
    new OperationError("Target no longer matches"),
  );
  assert.equal(write[1].$set.error, "Target no longer matches");
});

test("restart recovery marks only this server old running unknown once, with no replay and payload removal", async () => {
  const { cleanups } = await runWorker({ message: "Done" }, 2);
  assert.equal(cleanups.length, 3, "one recovery plus two expiry passes");
  const [filter, update] = cleanups[0];
  assert.equal(filter.server, "own-server");
  assert.equal(filter.status, "running");
  assert.ok(filter.createdAt.$lte instanceof Date);
  assert.equal(update.$set.status, "unknown");
  assert.equal(update.$set.error, operationTypes.OPERATION_UNKNOWN_ERROR);
  assert.ok(update.$set.finishedAt instanceof Date);
  assert.equal(update.$unset.payload, 1);
  assert.equal(
    cleanups.filter(([match]) => match.status === "running").length,
    1,
  );
});
test("expired queued tasks fail and erase payload using the complementary atomic claim cutoff", async () => {
  const { cleanups, claim } = await runWorker({ message: "Done" });
  const [filter, update] = cleanups[1];
  assert.equal(filter.server, "own-server");
  assert.equal(filter.status, "queued");
  assert.equal(
    filter.createdAt.$lte.getTime(),
    claim[0].createdAt.$gt.getTime(),
  );
  assert.equal(update.$set.status, "failed");
  assert.equal(update.$set.error, operationTypes.OPERATION_EXPIRED_ERROR);
  assert.equal(update.$unset.payload, 1);
  assert.equal(
    update.$set.finishedAt.getTime() - filter.createdAt.$lte.getTime(),
    10 * 60 * 1000,
  );
});
