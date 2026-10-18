const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const fs = require("node:fs");
const filename = path.resolve(__dirname, "../utils/operationExecutor.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const helper = new Module(filename, module);
helper.filename = filename;
helper.paths = module.paths;
helper._compile(compiled, filename);
const { executeOperation, saveStartupList } = helper.exports;
const op = (action, extra = {}) => ({
  action,
  pm_id: 3,
  targetName: "fixture",
  targetScript: "/fixture.js",
  saveStartup: false,
  ...extra,
});
function mock(status = "online") {
  const calls = [];
  const list = [
    {
      name: "fixture",
      pm_id: 3,
      pm2_env: {
        pm_exec_path: "/fixture.js",
        status,
        env: { KEEP: "yes", SECRET: "private" },
        watch: true,
        autorestart: false,
      },
    },
  ];
  const pm2 = { list: (cb) => cb(null, list) };
  for (const method of [
    "start",
    "stop",
    "restart",
    "reload",
    "delete",
    "updateConfig",
  ])
    pm2[method] = (...args) => {
      calls.push([method, ...args.slice(0, -1)]);
      args.at(-1)(null, []);
    };
  return { pm2, calls, list };
}
test("reload calls genuine reload and never saves implicitly", async () => {
  const { pm2, calls } = mock();
  const result = await executeOperation(op("reload"), pm2, () =>
    assert.fail("implicit save"),
  );
  assert.equal(calls[0][0], "reload");
  assert.match(result.message, /Fork mode/);
  assert.equal(result.saved, false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("update passes only patched config, merges private env, preserves unknown PM2 fields", async () => {
  const { pm2, calls, list } = mock();
  await executeOperation(
    op("update", {
      payload: { args: [], env: { NEW: "value" }, name: "renamed" },
    }),
    pm2,
    () => assert.fail(),
  );
  const options = calls[0][2];
  assert.equal(calls[0][0], "updateConfig");
  assert.deepEqual(options.env, {
    KEEP: "yes",
    SECRET: "private",
    NEW: "value",
  });
  assert.equal(options.watch, undefined);
  assert.equal(list[0].pm2_env.watch, true);
  assert.equal(options.updateEnv, undefined);
  assert.deepEqual(options.args, []);
});
test("stopped update is rejected before any mutation", async () => {
  const { pm2, calls } = mock("stopped");
  await assert.rejects(
    executeOperation(op("update", { payload: { name: "changed" } }), pm2, () =>
      assert.fail(),
    ),
    /online process/,
  );
  assert.equal(calls.length, 0);
});
test("numeric id reuse cannot operate on a new target", async () => {
  const { pm2, calls } = mock();
  await assert.rejects(
    executeOperation(op("delete", { targetName: "different" }), pm2, () =>
      assert.fail(),
    ),
    /no longer matches/,
  );
  assert.equal(calls.length, 0);
});
test("explicit startup save retains every app, stopped/autostart=false and private env locally", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "operations-save-test-"));
  try {
    const list = [
      {
        pm_id: 1,
        pm2_env: {
          name: "online",
          status: "online",
          autostart: true,
          env: { PRIVATE: "local-only" },
          pm_id: 1,
        },
      },
      {
        pm_id: 2,
        pm2_env: {
          name: "stopped",
          status: "stopped",
          autostart: true,
          pm_id: 2,
        },
      },
      {
        pm_id: 3,
        pm2_env: { name: "disabled", status: "online", autostart: false },
      },
    ];
    await saveStartupList(list, dir);
    const saved = JSON.parse(
      await readFile(path.join(dir, "dump.pm2"), "utf8"),
    );
    assert.equal(saved.length, 3);
    assert.equal(saved[1].autostart, false);
    assert.equal(saved[2].autostart, false);
    assert.equal(saved[0].env.PRIVATE, "local-only");
    assert.equal(saved[0].pm_id, undefined);
    assert.equal(list[1].pm2_env.autostart, true);
    await saveStartupList([], dir);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(dir, "dump.pm2"), "utf8")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  "PM2 7 integration: ONLY a newly-created isolated PM2_HOME",
  {
    timeout: 30000,
    skip:
      process.platform === "win32"
        ? "PM2 uses fixed Windows IPC; isolated real-daemon tests are Linux-only"
        : false,
  },
  async () => {
    const home = await mkdtemp(path.join(tmpdir(), "operations-pm2-test-"));
    // Set before requiring PM2: even the default object's paths point into this fresh directory.
    const oldHome = process.env.PM2_HOME;
    process.env.PM2_HOME = home;
    const PM2 = require("pm2").custom;
    const pm2 = new PM2({ pm2_home: home });
    pm2.updateConfig = (id, config, callback) =>
      pm2.Client.executeRemote(
        "restartProcessId",
        { id, env: { current_conf: config } },
        callback,
      );
    const call = (method, ...args) =>
      new Promise((resolve, reject) =>
        pm2[method](...args, (err, result) =>
          err ? reject(err) : resolve(result),
        ),
      );
    try {
      await writeFile(
        path.join(home, "fixture.cjs"),
        "setInterval(() => {}, 1000);\n",
      );
      await writeFile(
        path.join(home, "fixture2.cjs"),
        "setInterval(() => {}, 1000);\n",
      );
      await call("connect");
      const started = await call("start", {
        name: "operations-fixture",
        script: path.join(home, "fixture.cjs"),
        args: ["old"],
        env: { KEEP_ME: "original" },
        autorestart: false,
        kill_timeout: 4321,
      });
      const pm_id = started[0].pm_id ?? started[0].pm2_env.pm_id;
      const original = (await call("list")).find(
        (item) => item.pm_id === pm_id,
      );
      await executeOperation(
        op("update", {
          pm_id,
          targetName: "operations-fixture",
          targetScript: path.join(home, "fixture.cjs"),
          payload: {
            script: path.join(home, "fixture2.cjs"),
            name: "operations-renamed",
            cwd: home,
            interpreter: process.execPath,
            args: ["new"],
            interpreterArgs: ["--no-warnings"],
            env: { PATCH_ONLY: "new-value" },
          },
        }),
        pm2,
        () => assert.fail("not explicit"),
      );
      const item = (await call("list")).find((p) => p.pm_id === pm_id);
      assert.equal(item.name, "operations-renamed");
      assert.equal(item.pm2_env.pm_exec_path, path.join(home, "fixture2.cjs"));
      assert.deepEqual(item.pm2_env.args, ["new"]);
      assert.deepEqual(item.pm2_env.node_args, ["--no-warnings"]);
      assert.equal(item.pm2_env.env.KEEP_ME, "original");
      assert.equal(item.pm2_env.env.PATCH_ONLY, "new-value");
      assert.equal(item.pm2_env.autorestart, false);
      assert.equal(item.pm2_env.kill_timeout, original.pm2_env.kill_timeout);
      assert.equal(item.pm2_env.pm_cwd, home);
      assert.equal(item.pm2_env.exec_interpreter, process.execPath);
      const created = await executeOperation(
        {
          action: "create",
          payload: {
            name: "operations-stopped",
            script: path.join(home, "fixture.cjs"),
            autostart: false,
          },
        },
        pm2,
        () => assert.fail("implicit save"),
      );
      assert.equal(typeof created.pm_id, "number");
      assert.equal(created.status, "stopped");
      await call("stop", pm_id);
      await executeOperation({ action: "save" }, pm2, (list) =>
        saveStartupList(list, home),
      );
      const dump = JSON.parse(
        await readFile(path.join(home, "dump.pm2"), "utf8"),
      );
      assert.equal(dump.length, 2, "saving must retain other apps");
      assert.ok(dump.every((item) => item.autostart === false));
      // Verify actual PM2 resurrection honors stopped configuration, without transient launch.
      await call("delete", "all");
      await call("resurrect");
      const restored = await call("list");
      assert.equal(restored.length, 2);
      assert.ok(restored.every((item) => item.pm2_env.status === "stopped"));
      assert.ok(
        restored.every((item) => !item.pid),
        "stopped resurrection must not create a live PID",
      );
    } finally {
      // killDaemon closes the client after the daemon exits. PM2 7's
      // disconnectRPC skips socket.close() when connected === false, leaving
      // Axon's reconnect timer alive. Keep the socket objects before PM2
      // clears its client references, and close them even if disconnected.
      const sockets = [pm2.Client.client_sock, pm2.Client.sub_sock];
      try {
        await call("killDaemon");
      } finally {
        try {
          for (const socket of sockets) socket?.close();
          await call("disconnect").catch((error) => {
            // killDaemon already disconnected these; only those idempotent
            // close errors are expected. Unexpected teardown failures fail.
            if (
              !/^(RPC already being closed|SUB connection to PM2 is not launched|SUB connection is already being closed)$/.test(
                error.message,
              )
            )
              throw error;
          });
        } finally {
          if (oldHome === undefined) delete process.env.PM2_HOME;
          else process.env.PM2_HOME = oldHome;
          await rm(home, { recursive: true, force: true });
        }
      }
    }
  },
);
