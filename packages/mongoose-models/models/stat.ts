import { IStatModel } from "@pm2.web/typings";
import mongoose, { Model } from "mongoose";

type StatModel = Model<IStatModel>;

const statSchema = new mongoose.Schema(
  {
    timestamp: Date,
    cpu: Number,
    memory: Number,
    heapUsed: Number,
    memoryMax: Number,
    uptime: Number,
    source: {
      process: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Process",
      },
      server: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Server",
        required: true,
      },
    },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "source",
      granularity: "seconds",
    },
    expireAfterSeconds: 604_800, // 7 days; existing collections require an explicit admin collMod.
  },
);

statSchema.index({ "source.process": 1, timestamp: -1 });
statSchema.index({ "source.server": 1, timestamp: -1 });

export const statModel =
  (mongoose.models.Stat as StatModel) ??
  mongoose.model<IStatModel>("Stat", statSchema);
