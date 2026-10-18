import { operationModel } from "@pm2.web/mongoose-models";
import {
  type IOperationModel,
  OPERATION_EXPIRED_ERROR,
  OPERATION_QUEUE_MAX_AGE_MS,
  OPERATION_UNKNOWN_ERROR,
} from "@pm2.web/typings";
import pm2 from "pm2";

import {
  executeOperation,
  OperationError,
  type OperationPm2,
  saveStartupList,
} from "../utils/operationExecutor.js";

/** One serial worker per backend. No automatic replay of running tasks after a crash. */
export default function startOperationWorker(serverId: string) {
  const workerStartedAt = new Date();
  let isRecovered = false;
  let isStopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const client = pm2 as unknown as OperationPm2;
  // PM2 7 daemon API, covered by the isolated integration test. Only this fixed
  // RPC is exposed internally: callers cannot choose remote methods or hosts.
  client.updateConfig = (id, config, callback) => {
    const local = pm2 as unknown as {
      Client: {
        executeRemote: (
          method: string,
          options: unknown,
          done: typeof callback,
        ) => void;
      };
    };
    local.Client.executeRemote(
      "restartProcessId",
      { id, env: { current_conf: config } },
      callback,
    );
  };
  const home = (pm2 as unknown as { pm2_home: string }).pm2_home;
  async function tick() {
    try {
      if (!isRecovered) {
        await operationModel.updateMany(
          {
            server: serverId,
            status: "running",
            createdAt: { $lte: workerStartedAt },
          },
          {
            $set: {
              status: "unknown",
              finishedAt: new Date(),
              error: OPERATION_UNKNOWN_ERROR,
            },
            $unset: { payload: 1 },
          },
        );
        isRecovered = true;
      }
      const now = new Date();
      const cutoff = new Date(now.getTime() - OPERATION_QUEUE_MAX_AGE_MS);
      await operationModel.updateMany(
        { server: serverId, status: "queued", createdAt: { $lte: cutoff } },
        {
          $set: {
            status: "failed",
            finishedAt: now,
            error: OPERATION_EXPIRED_ERROR,
          },
          $unset: { payload: 1 },
        },
      );
      const operation = await operationModel
        .findOneAndUpdate(
          { server: serverId, status: "queued", createdAt: { $gt: cutoff } },
          { $set: { status: "running", startedAt: now } },
          { sort: { createdAt: 1, _id: 1 }, new: true },
        )
        .select("+payload +targetName +targetScript")
        .lean();
      if (operation) {
        try {
          const result = await executeOperation(
            operation as IOperationModel,
            client,
            (list) => saveStartupList(list, home),
          );
          await operationModel.updateOne(
            { _id: operation._id, status: "running" },
            {
              $set: { status: "succeeded", result, finishedAt: new Date() },
              $unset: { payload: 1 },
            },
          );
        } catch (error) {
          // PM2 errors can embed complete options, arguments and secrets. Never store or log them.
          await operationModel.updateOne(
            { _id: operation._id, status: "running" },
            {
              $set: {
                status: "failed",
                finishedAt: new Date(),
                error:
                  error instanceof OperationError
                    ? error.message
                    : "PM2 operation failed. Inspect local PM2 logs securely; runtime changes may be partially applied.",
              },
              $unset: { payload: 1 },
            },
          );
        }
      }
    } catch {
      console.error("[OPERATIONS] Queue unavailable; retrying shortly.");
    } finally {
      if (!isStopped) timer = setTimeout(() => void tick(), 1000);
    }
  }
  void tick();
  return () => {
    isStopped = true;
    if (timer) clearTimeout(timer);
  };
}
