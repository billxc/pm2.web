export type AlertKind = "host_offline" | "restart_storm";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type AlertDeliveryStatus =
  "disabled" | "pending" | "sending" | "sent" | "failed" | "skipped";

export interface IAlertConfig {
  _id: string;
  offlineThresholdSeconds: number;
  restartThreshold: number;
  restartWindowSeconds: number;
  webhookEnabled: boolean;
  /** Private: never include in an API response. */
  webhookUrl?: string;
  leaseOwner?: string;
  leaseUntil?: Date;
}

export interface IAlertEvent {
  _id: string;
  kind: AlertKind;
  server: string;
  process?: string;
  targetName: string;
  reason: string;
  status: AlertStatus;
  /** Unique while active; removed on recovery. */
  activeKey?: string;
  openedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  recoveryReason?: string;
  openDelivery: AlertDeliveryStatus;
  recoveryDelivery: AlertDeliveryStatus;
  openDeliveryError?: string;
  recoveryDeliveryError?: string;
}

export type AlertConfigView = Omit<
  IAlertConfig,
  "webhookUrl" | "leaseOwner" | "leaseUntil"
> & {
  webhookConfigured: boolean;
};

export type AlertEventView = Omit<IAlertEvent, "activeKey" | "acknowledgedBy">;
