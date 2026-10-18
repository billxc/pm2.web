export const OPERATION_ACTIONS = [
  "start",
  "stop",
  "restart",
  "reload",
  "delete",
  "create",
  "update",
  "save",
] as const;
export type OperationAction = (typeof OPERATION_ACTIONS)[number];
export type OperationStatus =
  "queued" | "running" | "succeeded" | "failed" | "unknown";

export const OPERATION_QUEUE_MAX_AGE_MS = 10 * 60 * 1000;
export const OPERATION_EXPIRED_ERROR =
  "Operation expired after waiting 10 minutes. It was not executed; review the current state before submitting a new operation.";
export const OPERATION_UNKNOWN_ERROR =
  "Backend restarted before the operation result was confirmed. Outcome unknown; inspect PM2 and manually decide what to do. This operation will not be replayed.";

/** Write-only input. Never include this object in an operation API response. */
export interface ProcessConfigPatch {
  name?: string;
  script?: string;
  args?: string[];
  cwd?: string;
  interpreter?: string;
  interpreterArgs?: string[];
  env?: Record<string, string>;
  autostart?: boolean;
}

export interface IOperation {
  _id: string;
  server: string;
  process?: string;
  pm_id?: number;
  action: OperationAction;
  status: OperationStatus;
  actor: { id: string; name: string };
  saveStartup: boolean;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  result?: {
    message: string;
    pm_id?: number;
    status?: string;
    saved?: boolean;
  };
}

export interface IOperationModel extends IOperation {
  payload?: ProcessConfigPatch;
  /** Expected identity to guard against PM2 numeric id reuse. Not returned by API. */
  targetName?: string;
  targetScript?: string;
}
