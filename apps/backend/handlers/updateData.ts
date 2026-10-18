import {
  logEntryModel,
  processModel,
  serverModel,
  statModel,
} from "@pm2.web/mongoose-models";
import { ISettingModel } from "@pm2.web/typings";
import mongoose from "mongoose";

import { QueuedLog, UpdateDataResponse } from "../types/handler.js";
import censorMessage from "../utils/censorMessage.js";
import processInfo from "../utils/processInfo.js";
import serverInfo from "../utils/serverInfo.js";

export default async function updateData(
  queuedLogs: QueuedLog[],
  settings: ISettingModel,
): Promise<UpdateDataResponse> {
  const server = await serverInfo();
  const processes = await processInfo();
  const timestamp = new Date();
  // check if server exists
  let currentServer = await serverModel.findOne({ uuid: server.uuid });
  if (currentServer) {
    currentServer.name = server.name;
    currentServer.heartbeat = Date.now();
    currentServer.save();
  } else {
    // create server
    const newServer = new serverModel({
      name: server.name,
      uuid: server.uuid,
    });
    await newServer.save().catch((err: Error) => {
      console.log(err);
    });
    currentServer = newServer;
  }

  const processStats = [];

  for (const process of processes) {
    if (!process) continue;
    const logs = queuedLogs
      .filter((log) => log.id === process.pm_id)
      .map((log) => ({
        _id: new mongoose.Types.ObjectId(),
        type: log.type,
        message: censorMessage(log.message),
        createdAt: log.createdAt,
      }));
    const processQuery = { pm_id: process.pm_id, server: currentServer._id };
    let processExists = await processModel.findOne(processQuery, { _id: 1 });
    if (processExists) {
      await processModel.updateOne(processQuery, {
        name: process.name,
        status: process.status,
        versioning: process.versioning,
        runtime: process.runtime,
        $push: {
          logs: {
            $each: logs,
            $slice: -settings.logRotation,
          },
        },
      });
    } else {
      // create process
      const newProcess = new processModel({
        pm_id: process.pm_id,
        server: currentServer._id,
        name: process.name,
        type: process.type,
        logs: logs.slice(-settings.logRotation),
        status: process.status,
        versioning: process.versioning,
        runtime: process.runtime,
      });
      await newProcess.save();
      processExists = newProcess;
    }

    // Persist only censored log fields, never process runtime/env or PM2 packets.
    // Reuse the embedded _id so the one-time compatibility backfill is idempotent.
    if (logs.length > 0) {
      await logEntryModel.insertMany(
        logs.map((log) => ({
          _id: log._id,
          source: { server: currentServer._id, process: processExists._id },
          type:
            log.type === "success"
              ? "stdout"
              : log.type === "error"
                ? "error"
                : "event",
          message: log.message,
          timestamp: log.createdAt,
        })),
      );
    }

    processStats.push({
      source: {
        server: currentServer._id,
        process: processExists?._id,
      },
      cpu: process.stats.cpu,
      memory: process.stats.memory,
      heapUsed: process.stats.heapUsed,
      memoryMax: process.stats.memoryMax || server.stats.memoryMax,
      uptime: process.stats.uptime,
      timestamp: timestamp,
    });
  }

  // insert stats
  const stats = [
    {
      source: {
        server: currentServer._id,
      },
      cpu: server.stats.cpu,
      memory: server.stats.memory,
      heapUsed: 0,
      memoryMax: server.stats.memoryMax,
      uptime: server.stats.uptime,
      timestamp: timestamp,
    },
    ...processStats,
  ];

  await statModel.insertMany(stats);

  // delete not existing processes
  const deletedProcess = await processModel
    .deleteMany({
      server: currentServer._id,
      pm_id: { $nin: processes.map((p) => p.pm_id) },
    })
    .catch((err: Error) => {
      console.log(err);
    });
  if (deletedProcess?.deletedCount)
    console.log(`Deleted ${deletedProcess.deletedCount} processes`);

  return {
    server: currentServer,
    processes,
  };
}
