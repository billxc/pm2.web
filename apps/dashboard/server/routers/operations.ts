import { operationModel, processModel, serverModel } from "@pm2.web/mongoose-models";
import {
  IOperation,
  IOperationModel,
  IUser,
  OPERATION_ACTIONS,
  OPERATION_EXPIRED_ERROR,
  OPERATION_QUEUE_MAX_AGE_MS,
  OperationAction,
} from "@pm2.web/typings";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import Access from "@/utils/access";
import { PERMISSIONS } from "@/utils/permission";

import { protectedProcedure, router } from "../trpc";

const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const text = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"), "NUL is not allowed");
const configSchema = z
  .object({
    name: text.max(200).optional(),
    script: text.optional(),
    args: z
      .array(
        z
          .string()
          .max(8192)
          .refine((value) => !value.includes("\0")),
      )
      .max(100)
      .optional(),
    cwd: text.optional(),
    interpreter: text.optional(),
    interpreterArgs: z.array(text).max(100).optional(),
    env: z
      .record(
        z
          .string()
          .regex(/^[A-Za-z_][A-Za-z\d_]*$/)
          .refine((key) => !["__proto__", "prototype", "constructor"].includes(key)),
        z
          .string()
          .max(32768)
          .refine((value) => !value.includes("\0")),
      )
      .refine((env) => Object.keys(env).length <= 100, "Too many environment entries")
      .optional(),
    autostart: z.boolean().optional(),
  })
  .strict();

const isAdmin = (user: IUser) => user.acl.admin || user.acl.owner;
const requiredPermission = (action: OperationAction) => {
  switch (action) {
    case "stop": {
      return PERMISSIONS.STOP;
    }
    case "delete": {
      return PERMISSIONS.DELETE;
    }
    default: {
      return PERMISSIONS.RESTART;
    }
  }
};
function canAccess(user: IUser, operation: Pick<IOperation, "server" | "process" | "action">) {
  if (isAdmin(user)) return true;
  if (!operation.process || ["create", "update", "save"].includes(operation.action)) return false;
  return new Access(user.acl.servers || [])
    .getPerms(operation.server.toString(), operation.process.toString())
    .has(requiredPermission(operation.action));
}
function publicOperation(doc: IOperationModel): IOperation {
  return {
    _id: doc._id.toString(),
    server: doc.server.toString(),
    process: doc.process?.toString(),
    pm_id: doc.pm_id,
    action: doc.action,
    status: doc.status,
    actor: doc.actor,
    saveStartup: doc.saveStartup,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt,
    error: doc.error,
    result: doc.result
      ? { message: doc.result.message, pm_id: doc.result.pm_id, status: doc.result.status, saved: doc.result.saved }
      : undefined,
  };
}

/** System-only expiry transition: never executes PM2 or returns private payloads. */
async function expireQueuedOperations() {
  const now = new Date();
  await operationModel.updateMany(
    { status: "queued", createdAt: { $lte: new Date(now.getTime() - OPERATION_QUEUE_MAX_AGE_MS) } },
    {
      $set: { status: "failed", finishedAt: now, error: OPERATION_EXPIRED_ERROR },
      $unset: { payload: 1 },
    },
  );
}

export const operationsRouter = router({
  enqueue: protectedProcedure
    .input(
      z
        .object({
          serverId: id,
          processId: id.optional(),
          action: z.enum(OPERATION_ACTIONS),
          config: configSchema.optional(),
          saveStartup: z.boolean().default(false),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      await expireQueuedOperations();
      const { action, config } = input;
      if ((["create", "update", "save"].includes(action) || input.saveStartup) && !isAdmin(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner/Admin permission required" });
      }
      if (!(await serverModel.exists({ _id: input.serverId })))
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      const needsProcess = !["create", "save"].includes(action);
      if (needsProcess !== Boolean(input.processId) || ["create", "update"].includes(action) !== Boolean(config)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid process/config for action" });
      }
      if (action === "create" && (!config?.name || !config.script))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Name and local script path are required" });
      if (action === "update" && (Object.keys(config || {}).length === 0 || config?.autostart !== undefined)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Provide a configuration patch. Autostart can only be set during create; use start/stop and explicitly save the list.",
        });
      }
      const target = input.processId
        ? await processModel.findOne({ _id: input.processId, server: input.serverId })
        : null;
      if (needsProcess && !target) throw new TRPCError({ code: "NOT_FOUND", message: "Process not found on server" });
      if (!canAccess(ctx.user, { server: input.serverId, process: input.processId, action }))
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      const operation = await operationModel.create({
        server: input.serverId,
        process: input.processId,
        pm_id: target?.pm_id,
        targetName: target?.name,
        targetScript: target?.runtime?.script,
        action,
        payload: config,
        saveStartup: input.saveStartup,
        actor: { id: ctx.user._id.toString(), name: ctx.user.name || "User" },
        status: "queued",
      });
      return publicOperation(operation);
    }),
  get: protectedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    await expireQueuedOperations();
    const operation = await operationModel.findById(input.id).lean();
    if (
      !operation ||
      (!isAdmin(ctx.user) && operation.actor.id !== ctx.user._id.toString()) ||
      !canAccess(ctx.user, operation)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Operation not found" });
    }
    return publicOperation(operation);
  }),
  list: protectedProcedure
    .input(
      z
        .object({
          serverId: id.optional(),
          processId: id.optional(),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .default({ limit: 30 }),
    )
    .query(async ({ ctx, input }) => {
      await expireQueuedOperations();
      const operations = await operationModel
        .find({
          ...(input.serverId && { server: input.serverId }),
          ...(input.processId && { process: input.processId }),
          ...(!isAdmin(ctx.user) && { "actor.id": ctx.user._id.toString() }),
        })
        .sort({ createdAt: -1 })
        .limit(input.limit)
        .lean();
      return operations
        .filter((operation) => canAccess(ctx.user, operation))
        .map((operation) => publicOperation(operation));
    }),
});
