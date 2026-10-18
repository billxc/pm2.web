import { alertEventModel, alertRuleModel } from "@pm2.web/mongoose-models";
import type { AlertConfigView, AlertEventView } from "@pm2.web/typings";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { DEFAULT_ALERT_CONFIG } from "../alerts/engine";
import { alertVisibilityFilter } from "../alerts/permissions";
import { validateWebhookUrl } from "../alerts/webhook";
import { adminProcedure, protectedProcedure, router } from "../trpc";

const id = z.string().regex(/^[a-f\d]{24}$/i);

/** Mount on _appRouter as `alerts: alertRouter`. No private destination is returned. */
export const alertRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["open", "acknowledged", "resolved"]).optional(),
          limit: z.number().int().min(1).max(100).default(30),
          cursor: z.object({ openedAt: z.string().datetime(), id }).optional(),
        })
        .default({ limit: 30 }),
    )
    .query(async ({ ctx, input }) => {
      const filters: Record<string, unknown>[] = [alertVisibilityFilter(ctx.user)];
      if (input.status) filters.push({ status: input.status });
      if (input.cursor)
        filters.push({
          $or: [
            { openedAt: { $lt: new Date(input.cursor.openedAt) } },
            { openedAt: new Date(input.cursor.openedAt), _id: { $lt: input.cursor.id } },
          ],
        });
      const docs = await alertEventModel
        .find({ $and: filters })
        .select("-activeKey -acknowledgedBy")
        .sort({ openedAt: -1, _id: -1 })
        .limit(input.limit + 1)
        .lean();
      const more = docs.length > input.limit;
      const items: AlertEventView[] = docs.slice(0, input.limit).map((doc) => ({
        _id: String(doc._id),
        kind: doc.kind,
        server: String(doc.server),
        process: doc.process,
        targetName: doc.targetName,
        reason: doc.reason,
        status: doc.status,
        openedAt: doc.openedAt,
        acknowledgedAt: doc.acknowledgedAt,
        resolvedAt: doc.resolvedAt,
        recoveryReason: doc.recoveryReason,
        openDelivery: doc.openDelivery,
        recoveryDelivery: doc.recoveryDelivery,
        openDeliveryError: doc.openDeliveryError,
        recoveryDeliveryError: doc.recoveryDeliveryError,
      }));
      const last = items.at(-1);
      return { items, nextCursor: more && last ? { openedAt: last.openedAt.toISOString(), id: last._id } : undefined };
    }),

  acknowledge: adminProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const event = await alertEventModel
      .findOneAndUpdate(
        { _id: input.id, status: "open" },
        { $set: { status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: String(ctx.user._id) } },
        { new: true },
      )
      .select("_id");
    if (!event && !(await alertEventModel.exists({ _id: input.id }))) throw new TRPCError({ code: "NOT_FOUND" });
    return { ok: true };
  }),

  getConfig: adminProcedure.query(async (): Promise<AlertConfigView> => {
    const config = await alertRuleModel.findById("central").select("+webhookUrl").lean();
    return {
      _id: "central",
      offlineThresholdSeconds: config?.offlineThresholdSeconds ?? DEFAULT_ALERT_CONFIG.offlineThresholdSeconds,
      restartThreshold: config?.restartThreshold ?? DEFAULT_ALERT_CONFIG.restartThreshold,
      restartWindowSeconds: config?.restartWindowSeconds ?? DEFAULT_ALERT_CONFIG.restartWindowSeconds,
      webhookEnabled: config?.webhookEnabled ?? false,
      webhookConfigured: !!config?.webhookUrl,
    };
  }),

  updateConfig: adminProcedure
    .input(
      z.object({
        offlineThresholdSeconds: z.number().int().min(10).max(86400),
        restartThreshold: z.number().int().min(1).max(10000),
        restartWindowSeconds: z.number().int().min(10).max(3600),
        webhookEnabled: z.boolean(),
        // Omitted means unchanged; null removes; never echo back the submitted destination.
        webhookUrl: z
          .string()
          .max(2048)
          .refine(validateWebhookUrl, "Use an HTTP(S) URL without userinfo or fragment")
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const current = await alertRuleModel.findById("central").select("+webhookUrl").lean();
        const url = input.webhookUrl === undefined ? current?.webhookUrl : input.webhookUrl;
        if (input.webhookEnabled && !url)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Configure a webhook before enabling it" });
        const { webhookUrl, ...settings } = input;
        await alertRuleModel.updateOne(
          { _id: "central" },
          {
            $set: { ...settings, ...(webhookUrl && { webhookUrl }) },
            ...(webhookUrl === null && { $unset: { webhookUrl: 1 } }),
          },
          { upsert: true, runValidators: true },
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to save alert configuration" });
      }
    }),
});
