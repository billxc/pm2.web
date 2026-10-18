import type { HistoryRange } from "../server/helpers/history";

export type { HistoryRange };

export const HISTORY_OPTIONS: { label: string; value: HistoryRange }[] = [
  { label: "1 hour", value: "hour" },
  { label: "24 hours", value: "day" },
  { label: "7 days", value: "week" },
];

/** Same UTC display in every browser, including windows crossing midnight/DST. */
export function historyTime(timestamp: number) {
  return new Date(timestamp).toISOString().slice(5, 19).replace("T", " ") + " UTC";
}

export function historyCoverage(populated: number, total: number) {
  if (!populated) return "No history available in this range. Retention may be insufficient.";
  return `${populated}/${total} buckets have data. Missing history is left blank; retained history may not cover this range.`;
}
