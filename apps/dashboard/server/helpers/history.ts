import type { PipelineStage } from "mongoose";

/** Fixed server-owned resolution: clients cannot request unbounded raw samples. */
export const HISTORY_RANGES = {
  hour: { durationMs: 3_600_000, bucketMs: 30_000, label: "1 hour" },
  day: { durationMs: 86_400_000, bucketMs: 300_000, label: "24 hours" },
  week: { durationMs: 604_800_000, bucketMs: 3_600_000, label: "7 days" },
} as const;

export type HistoryRange = keyof typeof HISTORY_RANGES;

export function historyWindow(range: HistoryRange, now = Date.now()) {
  const { durationMs, bucketMs } = HISTORY_RANGES[range];
  // Include the current partial bucket, with a fixed number of UTC-aligned slots.
  const first = Math.floor(now / bucketMs) * bucketMs - durationMs + bucketMs;
  return { range, bucketMs, start: first, end: now, maxPoints: durationMs / bucketMs };
}

export interface HistoryAggregate {
  timestamp: Date | string | number;
  cpu: number | null;
  memory: number | null;
  heapUsed: number | null;
  uptime: number | null;
  sources: number;
  samples: number;
}

export function historyPipeline(
  sourceMatch: Record<string, unknown>,
  sourceField: "source.process" | "source.server",
  window: ReturnType<typeof historyWindow>,
): PipelineStage[] {
  return [
    { $match: { ...sourceMatch, timestamp: { $gte: new Date(window.start), $lte: new Date(window.end) } } },
    {
      $group: {
        _id: {
          source: `$${sourceField}`,
          bucket: { $subtract: [{ $toLong: "$timestamp" }, { $mod: [{ $toLong: "$timestamp" }, window.bucketMs] }] },
        },
        cpu: { $avg: "$cpu" },
        memory: { $avg: "$memory" },
        heapUsed: { $avg: "$heapUsed" },
        uptime: { $avg: "$uptime" },
        samples: { $sum: 1 },
      },
    },
    // Equal weight per reporting source, not per raw sample. These are NOT fleet totals.
    {
      $group: {
        _id: "$_id.bucket",
        cpu: { $avg: "$cpu" },
        memory: { $avg: "$memory" },
        heapUsed: { $avg: "$heapUsed" },
        uptime: { $avg: "$uptime" },
        sources: { $sum: 1 },
        samples: { $sum: "$samples" },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: window.maxPoints },
    {
      $project: {
        _id: 0,
        timestamp: { $toDate: "$_id" },
        cpu: 1,
        memory: 1,
        heapUsed: 1,
        uptime: 1,
        sources: 1,
        samples: 1,
      },
    },
  ];
}

/** Fresh latest-per-source metrics are separate from the selected historical window. */
export function latestPipeline(
  sourceMatch: Record<string, unknown>,
  sourceField: "source.process" | "source.server",
  now: number,
): PipelineStage[] {
  return [
    { $match: { ...sourceMatch, timestamp: { $gte: new Date(now - 300_000), $lte: new Date(now) } } },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: `$${sourceField}`,
        cpu: { $first: "$cpu" },
        memory: { $first: "$memory" },
        uptime: { $first: "$uptime" },
        timestamp: { $first: "$timestamp" },
      },
    },
    {
      $group: {
        _id: null,
        cpu: { $avg: "$cpu" },
        memory: { $avg: "$memory" },
        uptime: { $avg: "$uptime" },
        timestamp: { $max: "$timestamp" },
        sources: { $sum: 1 },
      },
    },
    { $project: { _id: 0, cpu: 1, memory: 1, uptime: 1, timestamp: 1, sources: 1 } },
  ];
}

export function historyPoints(window: ReturnType<typeof historyWindow>, rows: HistoryAggregate[]) {
  const byTime = new Map(rows.map((row) => [new Date(row.timestamp).getTime(), row]));
  return Array.from({ length: window.maxPoints }, (_, index) => {
    const timestamp = window.start + index * window.bucketMs;
    const row = byTime.get(timestamp);
    return {
      timestamp, // UTC epoch milliseconds everywhere; missing history remains null.
      cpu: row?.cpu ?? null,
      memory: row?.memory ?? null,
      heapUsed: row?.heapUsed ?? null,
      uptime: row?.uptime ?? null,
      sources: row?.sources ?? 0,
      samples: row?.samples ?? 0,
    };
  });
}
