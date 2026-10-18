import { processModel, serverModel, statModel } from "@pm2.web/mongoose-models";
import type { IUser } from "@pm2.web/typings";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import Access from "@/utils/access";
import { PERMISSIONS } from "@/utils/permission";

import {
  type HistoryAggregate,
  historyPipeline,
  historyPoints,
  historyWindow,
  latestPipeline,
} from "../helpers/history";
import { protectedProcedure, router } from "../trpc";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
const range = z.enum(["hour", "day", "week"]);
const selection = z.object({ processIds: z.array(objectId).max(2000), serverIds: z.array(objectId).max(2000) });
const canMonitor = (user: IUser, serverId: string, processId = "") =>
  user.acl.admin ||
  user.acl.owner ||
  new Access(user.acl.servers || []).getPerms(serverId, processId).has(PERMISSIONS.MONITORING);

interface LatestAggregate {
  cpu: number | null;
  memory: number | null;
  uptime: number | null;
  timestamp: Date;
  sources: number;
}

async function authorizedSources(user: IUser, input: z.infer<typeof selection>) {
  // Client selection is not an ACL check. Resolve both the source and its parent server.
  const [processes, servers] = await Promise.all([
    processModel
      .find({ _id: { $in: input.processIds } })
      .select({ _id: 1, server: 1 })
      .lean(),
    serverModel
      .find({ _id: { $in: input.serverIds } })
      .select({ _id: 1 })
      .lean(),
  ]);
  const allowedProcesses = processes.filter((p) => canMonitor(user, p.server.toString(), p._id.toString()));
  // A process override must not grant host resource access.
  const allowedServers = servers.filter((s) => canMonitor(user, s._id.toString()));
  return {
    processCount: allowedProcesses.length,
    serverCount: allowedServers.length,
    processMatch: { $or: allowedProcesses.map((p) => ({ "source.process": p._id, "source.server": p.server })) },
    serverMatch: { "source.server": { $in: allowedServers.map((s) => s._id) }, "source.process": { $exists: false } },
  };
}

export const historyRouter = router({
  latest: protectedProcedure.input(selection).query(async ({ ctx, input }) => {
    const { processCount, serverCount, processMatch, serverMatch } = await authorizedSources(ctx.user, input);
    const now = Date.now();
    const query = (match: Record<string, unknown>, field: "source.process" | "source.server") =>
      statModel
        .aggregate<LatestAggregate>(latestPipeline(match, field, now))
        .option({ maxTimeMS: 15_000, allowDiskUse: true });
    const [process, server] = await Promise.all([
      processCount ? query(processMatch, "source.process") : [],
      serverCount ? query(serverMatch, "source.server") : [],
    ]);
    return { process: process[0] ?? null, server: server[0] ?? null };
  }),
  process: protectedProcedure.input(z.object({ processId: objectId, range })).query(async ({ ctx, input }) => {
    const process = await processModel.findById(input.processId).select({ _id: 1, server: 1 }).lean();
    if (!process) throw new TRPCError({ code: "BAD_REQUEST", message: "Process not found" });
    if (!canMonitor(ctx.user, process.server.toString(), process._id.toString())) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Insufficient Permissions" });
    }
    const window = historyWindow(input.range);
    const rows = await statModel
      .aggregate<HistoryAggregate>(
        historyPipeline({ "source.process": process._id, "source.server": process.server }, "source.process", window),
      )
      .option({ maxTimeMS: 15_000, allowDiskUse: true });
    return { ...window, semantics: "bucket mean for this process" as const, points: historyPoints(window, rows) };
  }),

  overview: protectedProcedure.input(selection.extend({ range })).query(async ({ ctx, input }) => {
    const { processCount, serverCount, processMatch, serverMatch } = await authorizedSources(ctx.user, input);
    const window = historyWindow(input.range);
    const aggregateHistory = (match: Record<string, unknown>, field: "source.process" | "source.server") =>
      statModel
        .aggregate<HistoryAggregate>(historyPipeline(match, field, window))
        .option({ maxTimeMS: 15_000, allowDiskUse: true });
    const [processRows, serverRows] = await Promise.all([
      processCount ? aggregateHistory(processMatch, "source.process") : [],
      serverCount ? aggregateHistory(serverMatch, "source.server") : [],
    ]);
    const serverPoints = historyPoints(window, serverRows);
    return {
      ...window,
      semantics: "mean per reporting source; not fleet totals" as const,
      authorized: { processes: processCount, servers: serverCount },
      points: historyPoints(window, processRows).map((point, index) => {
        const server = serverPoints[index];
        return {
          timestamp: point.timestamp,
          processCpu: point.cpu,
          processRam: point.memory,
          serverCpu: server.cpu,
          serverRam: server.memory,
          processSources: point.sources,
          serverSources: server.sources,
        };
      }),
    };
  }),
});
