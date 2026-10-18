import type { IAlertConfig, IAlertEvent } from "@pm2.web/typings";
import mongoose, { type Model } from "mongoose";

const delivery = [
  "disabled",
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
];
const alertEventSchema = new mongoose.Schema<IAlertEvent>(
  {
    kind: {
      type: String,
      enum: ["host_offline", "restart_storm"],
      required: true,
    },
    server: { type: String, required: true, index: true },
    process: String,
    targetName: { type: String, required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "acknowledged", "resolved"],
      required: true,
    },
    activeKey: String,
    openedAt: { type: Date, required: true },
    acknowledgedAt: Date,
    acknowledgedBy: String,
    resolvedAt: Date,
    recoveryReason: String,
    openDelivery: { type: String, enum: delivery, default: "disabled" },
    recoveryDelivery: { type: String, enum: delivery, default: "disabled" },
    openDeliveryError: String,
    recoveryDeliveryError: String,
  },
  { bufferCommands: false },
);
// Acknowledgement does not end an incident. Only recovery releases this key.
alertEventSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: "string" } } },
);
alertEventSchema.index({ openedAt: -1, _id: -1 });
alertEventSchema.index({ server: 1, process: 1, openedAt: -1 });

const alertRuleSchema = new mongoose.Schema<IAlertConfig>(
  {
    _id: { type: String, default: "central" },
    offlineThresholdSeconds: {
      type: Number,
      default: 60,
      min: 10,
      max: 86_400,
    },
    restartThreshold: { type: Number, default: 5, min: 1, max: 10_000 },
    restartWindowSeconds: { type: Number, default: 60, min: 10, max: 3600 },
    webhookEnabled: { type: Boolean, default: false },
    webhookUrl: { type: String, select: false },
    leaseOwner: { type: String, select: false },
    leaseUntil: { type: Date, select: false },
  },
  { bufferCommands: false },
);

export const alertEventModel =
  (mongoose.models.AlertEvent as Model<IAlertEvent>) ??
  mongoose.model<IAlertEvent>("AlertEvent", alertEventSchema);
export const alertRuleModel =
  (mongoose.models.AlertRule as Model<IAlertConfig>) ??
  mongoose.model<IAlertConfig>("AlertRule", alertRuleSchema);
