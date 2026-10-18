import { access, copyFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IOperationModel, ProcessConfigPatch } from "@pm2.web/typings";

import type { Pm2ProcessDescription } from "../types/pm2.js";

type Callback = (error?: Error | null, result?: unknown) => void;
export interface OperationPm2 {
  list: (
    callback: (error: Error | null, processes: Pm2ProcessDescription[]) => void,
  ) => void;
  start: (
    options: Record<string, unknown> | number,
    callback: Callback,
  ) => void;
  stop: (id: number, callback: Callback) => void;
  restart: (
    id: number,
    options: Record<string, unknown>,
    callback: Callback,
  ) => void;
  reload: (id: number, callback: Callback) => void;
  updateConfig: (
    id: number,
    config: Record<string, unknown>,
    callback: Callback,
  ) => void;
  delete: (id: number, callback: Callback) => void;
}
export class OperationError extends Error {}
const invoke = (run: (callback: Callback) => void) =>
  new Promise<unknown>((resolve, reject) =>
    run((error, result) => (error ? reject(error) : resolve(result))),
  );
export const listProcesses = (pm2: OperationPm2) =>
  new Promise<Pm2ProcessDescription[]>((resolve, reject) =>
    pm2.list((error, list) => (error ? reject(error) : resolve(list))),
  );

/** Never accepts a filesystem path from a web request. Entire local PM2 list only. */
export async function saveStartupList(
  list: Pm2ProcessDescription[],
  pm2Home: string,
) {
  const apps = list
    .filter((item) => item.pm2_env && !item.pm2_env.pmx_module)
    .map((item) => {
      const env = { ...item.pm2_env } as Record<string, unknown>;
      delete env.instances;
      delete env.pm_id;
      delete env.prev_restart_delay;
      if (env.status !== "online") env.autostart = false;
      return env;
    });
  const target = path.join(pm2Home, "dump.pm2");
  const temporary = path.join(
    pm2Home,
    `dump.pm2.operations-${process.pid}.tmp`,
  );
  await writeFile(temporary, JSON.stringify(apps, null, 2), { mode: 0o600 });
  try {
    await copyFile(target, path.join(pm2Home, "dump.pm2.bak"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(temporary, target);
}

async function validatePaths(config: ProcessConfigPatch) {
  for (const candidatePath of [config.script, config.cwd]) {
    if (candidatePath === undefined) continue;
    if (!path.isAbsolute(candidatePath))
      throw new OperationError(
        "Script and cwd must be absolute local paths. Remote URLs are not supported.",
      );
    try {
      await access(candidatePath);
    } catch {
      throw new OperationError(
        "Script or working directory does not exist or is inaccessible on this server.",
      );
    }
  }
}

/** PM2 7 daemon restart current_conf patch; verified against Utility.extendExtraConfig.
 * No delete/recreate, no process.env updateEnv import, no configuration returned.
 */
export async function executeOperation(
  operation: IOperationModel,
  pm2: OperationPm2,
  save: (list: Pm2ProcessDescription[]) => Promise<void>,
) {
  const before = await listProcesses(pm2);
  const config = operation.payload || {};
  let target = before.find((item) => item.pm_id === operation.pm_id);
  if (
    !["create", "save"].includes(operation.action) &&
    (!target ||
      target.name !== operation.targetName ||
      (operation.targetScript &&
        target.pm2_env?.pm_exec_path !== operation.targetScript))
  ) {
    throw new OperationError(
      "Target process no longer matches the queued operation. Refresh and try again.",
    );
  }
  if (["create", "update"].includes(operation.action))
    await validatePaths(config);
  let createdId: number | undefined;
  switch (operation.action) {
    case "create": {
      if (!config.name || !config.script)
        throw new OperationError("Name and script are required.");
      if (before.some((item) => item.name === config.name))
        throw new OperationError(
          "A process with that name already exists on this server.",
        );
      const result = await invoke((callback) =>
        pm2.start(
          {
            name: config.name,
            script: config.script,
            args: config.args,
            cwd: config.cwd,
            interpreter: config.interpreter,
            interpreter_args: config.interpreterArgs,
            env: config.env,
            autostart: config.autostart ?? true,
          },
          callback,
        ),
      );
      createdId = (
        Array.isArray(result)
          ? (result[0]?.pm_id ?? result[0]?.pm2_env?.pm_id)
          : undefined
      ) as number | undefined;
      break;
    }
    case "update": {
      if (target?.pm2_env?.status !== "online")
        throw new OperationError(
          "Configuration updates require an online process. PM2 cannot apply this restart-based patch to a stopped process without starting it; start it explicitly first.",
        );
      if (config.autostart !== undefined)
        throw new OperationError(
          "Autostart updates are unsupported; use start/stop then save the list explicitly.",
        );
      if (
        config.name &&
        before.some(
          (item) => item.pm_id !== target?.pm_id && item.name === config.name,
        )
      )
        throw new OperationError("A process with that name already exists.");
      const current: Record<string, unknown> = {
        // Supply a new merged env object: PM2's current_conf merge must not replace unpatched environment.
        env: { ...target.pm2_env.env, ...config.env },
      };
      const configFields = Object.entries({
        name: "name",
        script: "pm_exec_path",
        args: "args",
        cwd: "pm_cwd",
        interpreter: "exec_interpreter",
        interpreterArgs: "node_args",
      });
      for (const [input, output] of configFields) {
        const value = config[input as keyof ProcessConfigPatch];
        if (value !== undefined) current[output] = value;
      }
      // Daemon RPC avoids the public restart wrapper's CLI defaults and environment import.
      await invoke((callback) =>
        pm2.updateConfig(operation.pm_id!, current, callback),
      );
      break;
    }
    case "start":
    case "restart": {
      await invoke((callback) => pm2.restart(operation.pm_id!, {}, callback));
      break;
    }
    case "stop": {
      await invoke((callback) => pm2.stop(operation.pm_id!, callback));
      break;
    }
    case "reload": {
      await invoke((callback) => pm2.reload(operation.pm_id!, callback));
      break;
    }
    case "delete": {
      await invoke((callback) => pm2.delete(operation.pm_id!, callback));
      break;
    }
    case "save": {
      break;
    }
    default: {
      throw new OperationError("Unsupported operation.");
    }
  }
  const after = await listProcesses(pm2);
  target = after.find((item) => item.pm_id === (operation.pm_id ?? createdId));
  const result = {
    message:
      operation.action === "reload"
        ? "PM2 reload completed. Fork mode does not guarantee zero downtime."
        : "PM2 operation completed.",
    pm_id: target?.pm_id ?? operation.pm_id ?? createdId,
    status: target?.pm2_env?.status,
    saved: false,
  };
  if (operation.action === "save" || operation.saveStartup) {
    try {
      await save(after);
      result.saved = true;
    } catch {
      throw new OperationError(
        "PM2 action completed but saving the startup list failed. Runtime changes may already be applied; do not blindly repeat the action. Retry save separately.",
      );
    }
  }
  return result;
}
