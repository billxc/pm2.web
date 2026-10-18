/** Historical logs are independent of the compatibility Process.logs tail. */
export type LogEntryType = "stdout" | "error" | "event";

export interface ILogEntry {
  _id: string;
  source: { server: string; process: string };
  type: LogEntryType;
  message: string;
  timestamp: Date;
}

export type ILogEntryModel = ILogEntry;
