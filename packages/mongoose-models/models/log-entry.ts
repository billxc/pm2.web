import { ILogEntryModel } from "@pm2.web/typings";
import mongoose, { Model } from "mongoose";

const logEntrySchema = new mongoose.Schema(
  {
    source: {
      server: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Server",
        required: true,
      },
      process: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Process",
        required: true,
      },
    },
    type: { type: String, enum: ["stdout", "error", "event"], required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, required: true },
  },
  { collection: "logentries", versionKey: false },
);

// TTL cleanup is asynchronous; queries also enforce the retention window.
logEntrySchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);
logEntrySchema.index({ timestamp: -1, _id: -1 });
logEntrySchema.index({ "source.server": 1, timestamp: -1, _id: -1 });
logEntrySchema.index({ "source.process": 1, timestamp: -1, _id: -1 });

export const logEntryModel =
  (mongoose.models.LogEntry as Model<ILogEntryModel>) ??
  mongoose.model<ILogEntryModel>("LogEntry", logEntrySchema);
