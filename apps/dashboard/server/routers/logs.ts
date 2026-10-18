import { logEntryModel } from "@pm2.web/mongoose-models";
import { IUser, LogEntryType } from "@pm2.web/typings";
import mongoose, { PipelineStage } from "mongoose";
import { z } from "zod";

import { protectedProcedure, router } from "../trpc";

const objectId = z.string().regex(/^[\da-f]{24}$/i);
const filters = z
  .object({
    serverId: objectId.optional(),
    processId: objectId.optional(),
    // An empty dashboard selection means no processes, not all processes.
    processIds: z.array(objectId).max(200).optional(),
    text: z.string().max(200).default(""),
    type: z.enum(["stdout", "error", "event"]).optional(),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
  })
  .refine((value) => !value.start || !value.end || value.start <= value.end, {
    message: "Start must not be after end",
  });
const cursorSchema = z.object({ timestamp: z.coerce.date(), id: objectId });
export const logQueryInput = z.object({
  filters,
  cursor: cursorSchema.optional(),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export const logDownloadInput = z.object({ filters });

export const LOG_DOWNLOAD_LIMIT = 5000;
const DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MESSAGE_CHARACTERS = 16384;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
type Filters = z.infer<typeof filters>;
type Cursor = z.infer<typeof cursorSchema>;
const id = (value: string) => new mongoose.Types.ObjectId(value.toString());

export const escapeLogSearch = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Build server/process pairs from the ACL, including explicit deny overrides.
 * Unlike looking up current processes, this also protects logs of deleted processes.
 */
export function logAclMatch(user: Pick<IUser, "acl">): Record<string, unknown> {
  if (user.acl.owner || user.acl.admin) return {};
  const scopes = user.acl.servers.map((server) => {
    const serverAllowsLogs = (server.perms & 1) !== 0;
    const overrides = server.processes.filter((process) => ((process.perms & 1) !== 0) !== serverAllowsLogs);
    return {
      "source.server": id(server.server),
      "source.process": serverAllowsLogs
        ? { $nin: overrides.map((process) => id(process.process)) }
        : { $in: overrides.map((process) => id(process.process)) },
    };
  });
  // Empty $or is invalid Mongo syntax; an empty $in is both valid and fail-closed.
  return scopes.length > 0 ? { $or: scopes } : { "source.process": { $in: [] } };
}

export function logMatch(user: Pick<IUser, "acl">, input: Filters, cursor?: Cursor, now = new Date()) {
  const timestamp: { $gte: Date; $lte?: Date } = {
    $gte: new Date(Math.max(now.getTime() - RETENTION_MS, input.start?.getTime() ?? 0)),
  };
  if (input.end) timestamp.$lte = input.end;
  const conditions: Record<string, unknown>[] = [logAclMatch(user), { timestamp }];
  if (input.serverId) conditions.push({ "source.server": id(input.serverId) });
  if (input.processId) conditions.push({ "source.process": id(input.processId) });
  if (input.processIds) conditions.push({ "source.process": { $in: input.processIds.map((value) => id(value)) } });
  if (input.type) conditions.push({ type: input.type });
  if (input.text) conditions.push({ message: { $regex: escapeLogSearch(input.text), $options: "i" } });
  if (cursor)
    conditions.push({
      $or: [{ timestamp: { $lt: cursor.timestamp } }, { timestamp: cursor.timestamp, _id: { $lt: id(cursor.id) } }],
    });
  return { $and: conditions };
}

interface LogRow {
  _id: mongoose.Types.ObjectId;
  source: { server: mongoose.Types.ObjectId; process: mongoose.Types.ObjectId };
  type: LogEntryType;
  message: string;
  timestamp: Date;
  messageTruncated: boolean;
}
const serialize = (row: LogRow) => ({
  id: row._id.toString(),
  serverId: row.source.server.toString(),
  processId: row.source.process.toString(),
  type: row.type,
  message: row.message,
  timestamp: row.timestamp,
  messageTruncated: row.messageTruncated,
});

function pipeline(match: Record<string, unknown>, limit: number): PipelineStage[] {
  return [
    { $match: match },
    { $sort: { timestamp: -1, _id: -1 } },
    { $limit: limit },
    {
      $project: {
        source: 1,
        type: 1,
        timestamp: 1,
        message: { $substrCP: ["$message", 0, MESSAGE_CHARACTERS] },
        messageTruncated: { $gt: [{ $strLenCP: "$message" }, MESSAGE_CHARACTERS] },
      },
    },
  ];
}

export const logsRouter = router({
  query: protectedProcedure.input(logQueryInput).query(async ({ ctx, input }) => {
    const rows = await logEntryModel
      .aggregate<LogRow>(pipeline(logMatch(ctx.user, input.filters, input.cursor), input.pageSize + 1))
      .option({ maxTimeMS: 10000 })
      .exec();
    const hasMore = rows.length > input.pageSize;
    const items = rows.slice(0, input.pageSize).map((row) => serialize(row));
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? { timestamp: last.timestamp, id: last.id } : null,
    };
  }),
  download: protectedProcedure.input(logDownloadInput).query(async ({ ctx, input }) => {
    const cursor = logEntryModel
      .aggregate<LogRow>(pipeline(logMatch(ctx.user, input.filters), LOG_DOWNLOAD_LIMIT + 1))
      .option({ maxTimeMS: 15000 })
      .cursor({ batchSize: 100 });
    const lines: string[] = [];
    let bytes = 0;
    let truncated = false;
    try {
      for await (const row of cursor) {
        const line = JSON.stringify(serialize(row)) + "\n";
        const size = Buffer.byteLength(line, "utf8");
        if (lines.length >= LOG_DOWNLOAD_LIMIT || bytes + size > DOWNLOAD_BYTES) {
          truncated = true;
          break;
        }
        lines.push(line);
        bytes += size;
      }
    } finally {
      await cursor.close();
    }
    return { content: lines.join(""), count: lines.length, truncated };
  }),
});
