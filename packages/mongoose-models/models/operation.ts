import { IOperationModel, OPERATION_ACTIONS } from "@pm2.web/typings";
import mongoose, { Model } from "mongoose";

const operationSchema = new mongoose.Schema(
  {
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process" },
    pm_id: Number,
    action: { type: String, enum: OPERATION_ACTIONS, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "succeeded", "failed", "unknown"],
      default: "queued",
      required: true,
    },
    actor: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
    saveStartup: { type: Boolean, default: false },
    payload: { type: mongoose.Schema.Types.Mixed, select: false },
    targetName: { type: String, select: false },
    targetScript: { type: String, select: false },
    startedAt: Date,
    finishedAt: Date,
    error: String,
    result: { message: String, pm_id: Number, status: String, saved: Boolean },
  },
  { timestamps: true },
);
operationSchema.index({ server: 1, status: 1, createdAt: 1 });
operationSchema.index({ status: 1, createdAt: 1 });
operationSchema.index({ server: 1, process: 1, createdAt: -1 });

export const operationModel =
  (mongoose.models.Operation as Model<IOperationModel>) ??
  mongoose.model<IOperationModel>("Operation", operationSchema);
