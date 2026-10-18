import { randomUUID } from "node:crypto";

import { alertEventModel, alertRuleModel, processModel, serverModel } from "@pm2.web/mongoose-models";
import type { AlertKind, IAlertConfig, IAlertEvent } from "@pm2.web/typings";

import { DEFAULT_ALERT_CONFIG, isHostOffline, RestartWindow } from "./engine";
import { sendWebhook } from "./webhook";

const LEASE_MS = 120_000;
const QUERY_MS = 5000;
const MAX_DELIVERIES_PER_SCAN = 20;
const globalScanner = globalThis as typeof globalThis & { __pm2AlertScanner?: Scanner };

class Scanner {
  private readonly owner = randomUUID();
  private readonly restarts = new RestartWindow();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopping = false;
  private indexesReady = false;
  private configSignature = "";
  private deliveries = 0;
  private lastWarning = 0;
  private readonly interval = 10_000;

  start() {
    this.schedule(0);
    process.once("SIGTERM", this.onSignal);
    process.once("SIGINT", this.onSignal);
  }

  private onSignal = () => {
    void this.stop();
  };

  private schedule(delay: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .catch(() => {
          this.restarts.clear();
          // Constant message only: DB exceptions can contain connection strings.
          if (Date.now() - this.lastWarning <= 60_000) return;

          console.warn("[alerts] Scan unavailable; will retry automatically");
          this.lastWarning = Date.now();
        })
        .finally(() => {
          this.running = undefined;
          this.schedule(this.interval);
        });
    }, delay);
    this.timer.unref();
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    process.removeListener("SIGTERM", this.onSignal);
    process.removeListener("SIGINT", this.onSignal);
    await this.running;
    try {
      await alertRuleModel.updateOne(
        { _id: "central", leaseOwner: this.owner },
        {
          $unset: { leaseOwner: 1, leaseUntil: 1 },
        },
        { maxTimeMS: QUERY_MS },
      );
    } catch {
      /* Lease expires even if DB is unavailable. Never close the shared DB connection. */
    }
    this.restarts.clear();
    if (globalScanner.__pm2AlertScanner === this) delete globalScanner.__pm2AlertScanner;
  }

  private async renewLease() {
    if (this.stopping) throw new Error("scanner_stopped");
    const now = new Date();
    const result = await alertRuleModel.updateOne(
      {
        _id: "central",
        leaseOwner: this.owner,
        leaseUntil: { $gt: now },
      },
      { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } },
      { maxTimeMS: QUERY_MS },
    );
    if (!result.matchedCount) throw new Error("lease_lost");
  }

  private async tick() {
    // Lazy import keeps missing/unavailable DB configuration inside the retry boundary.
    const { default: connectDB } = await import("@/middleware/mongodb");
    await connectDB();
    if (this.stopping) return;
    if (!this.indexesReady) {
      await Promise.all([alertEventModel.createIndexes(), alertRuleModel.createIndexes()]);
      this.indexesReady = true;
    }
    try {
      await alertRuleModel.updateOne(
        { _id: "central" },
        { $setOnInsert: DEFAULT_ALERT_CONFIG },
        {
          upsert: true,
          maxTimeMS: QUERY_MS,
        },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const now = new Date();
    const config = await alertRuleModel
      .findOneAndUpdate(
        {
          _id: "central",
          $or: [{ leaseOwner: this.owner }, { leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
        },
        { $set: { leaseOwner: this.owner, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
        {
          new: true,
          maxTimeMS: QUERY_MS,
        },
      )
      .select("+webhookUrl")
      .lean();
    if (!config) {
      this.restarts.clear();
      return;
    }
    const signature = `${config.restartThreshold}:${config.restartWindowSeconds}`;
    if (signature !== this.configSignature) this.restarts.clear();
    this.configSignature = signature;
    this.deliveries = 0;

    const [servers, processes, active] = await Promise.all([
      serverModel.find().select("_id name heartbeat createdAt").maxTimeMS(QUERY_MS).lean(),
      processModel.find().select("_id server name runtime.restarts").maxTimeMS(QUERY_MS).lean(),
      alertEventModel
        .find({ activeKey: { $exists: true } })
        .maxTimeMS(QUERY_MS)
        .lean(),
    ]);
    await this.renewLease();
    const observedAt = Date.now();
    const activeByKey = new Map(active.map((event) => [event.activeKey!, event]));
    const seenKeys = new Set<string>();
    const offline = new Set<string>();
    const serverNames = new Map<string, string>();

    for (const server of servers) {
      const id = String(server._id);
      const key = `host_offline:${id}`;
      seenKeys.add(key);
      serverNames.set(id, server.name);
      const firing = isHostOffline(
        server.heartbeat,
        server.createdAt ? new Date(server.createdAt).getTime() : undefined,
        observedAt,
        config.offlineThresholdSeconds * 1000,
      );
      if (firing) {
        offline.add(id);
        if (!activeByKey.has(key))
          await this.open({
            kind: "host_offline",
            server: id,
            targetName: server.name,
            activeKey: key,
            reason: `No heartbeat for more than ${config.offlineThresholdSeconds}s`,
          });
      } else if (activeByKey.has(key)) {
        await this.resolve(activeByKey.get(key)!, "Host heartbeat restored");
      }
    }

    const processIds = new Set<string>();
    for (const proc of processes) {
      const id = String(proc._id);
      const server = String(proc.server);
      const key = `restart_storm:${id}`;
      // An orphan process is a removed target, not a restart-recovery observation.
      if (!serverNames.has(server)) {
        this.restarts.forget(id);
        continue;
      }
      seenKeys.add(key);
      processIds.add(id);
      // Offline hosts cannot provide fresh counters. Preserve existing incident until fresh observations return.
      if (offline.has(server)) {
        this.restarts.forget(id);
        continue;
      }
      const result = this.restarts.observe(
        id,
        proc.runtime?.restarts,
        observedAt,
        config.restartWindowSeconds * 1000,
        config.restartThreshold,
      );
      if (result.firing && !activeByKey.has(key))
        await this.open({
          kind: "restart_storm",
          server,
          process: id,
          activeKey: key,
          targetName: `${serverNames.get(server)} / ${proc.name}`,
          reason: `${result.count} observed restarts within ${config.restartWindowSeconds}s (threshold ${config.restartThreshold})`,
        });
      else if (result.canRecover && activeByKey.has(key))
        await this.resolve(activeByKey.get(key)!, "Restart rate returned below threshold");
    }
    this.restarts.retain(processIds);
    for (const event of active) {
      if (!seenKeys.has(event.activeKey!)) await this.resolve(event, "Target removed from inventory");
    }
    await this.renewLease();
  }

  private async open(target: {
    kind: AlertKind;
    server: string;
    process?: string;
    activeKey: string;
    targetName: string;
    reason: string;
  }) {
    await this.renewLease();
    try {
      const event = await alertEventModel.create({
        ...target,
        status: "open",
        openedAt: new Date(),
        openDelivery: "pending",
        recoveryDelivery: "disabled",
      });
      await this.notify(event.toObject(), "open");
    } catch (error) {
      // The unique active key is the final duplicate guard even if a lease holder changes.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }

  private async resolve(event: IAlertEvent, reason: string) {
    await this.renewLease();
    const updated = await alertEventModel
      .findOneAndUpdate(
        { _id: event._id, activeKey: event.activeKey },
        {
          $set: { status: "resolved", resolvedAt: new Date(), recoveryReason: reason, recoveryDelivery: "pending" },
          $unset: { activeKey: 1 },
        },
        { new: true, maxTimeMS: QUERY_MS },
      )
      .lean();
    if (updated) await this.notify(updated, "recovery");
  }

  private async notify(event: IAlertEvent, edge: "open" | "recovery") {
    await this.renewLease();
    const field = edge === "open" ? "openDelivery" : "recoveryDelivery";
    // Re-read the opt-in immediately before sending, rather than using the scan snapshot.
    const config: IAlertConfig | null = await alertRuleModel
      .findById("central")
      .select("+webhookUrl")
      .maxTimeMS(QUERY_MS)
      .lean();
    const enabled = config?.webhookEnabled && config.webhookUrl;
    const status = enabled ? (this.deliveries >= MAX_DELIVERIES_PER_SCAN ? "skipped" : "sending") : "disabled";
    const claimed = await alertEventModel.updateOne(
      { _id: event._id, [field]: "pending" },
      {
        $set: { [field]: status },
      },
      { maxTimeMS: QUERY_MS },
    );
    if (!claimed.modifiedCount || status !== "sending") return;
    this.deliveries++;
    const result = await sendWebhook(config!.webhookUrl!, {
      source: "pm2.web",
      edge,
      event: {
        id: String(event._id),
        kind: event.kind,
        status: event.status,
        server: event.server,
        process: event.process,
        targetName: event.targetName,
        reason: event.reason,
        openedAt: event.openedAt,
        resolvedAt: event.resolvedAt,
        recoveryReason: event.recoveryReason,
      },
    });
    await alertEventModel.updateOne(
      { _id: event._id, [field]: "sending" },
      {
        $set: {
          [field]: result.status,
          ...(result.status === "failed" && { [`${field}Error`]: result.error }),
        },
      },
      { maxTimeMS: QUERY_MS },
    );
    // No queue/retries: uncertain delivery after a crash is never resent automatically.
  }
}

export function startAlertsScanner() {
  if (process.env.ALERTS_SCANNER_ENABLED === "false" || globalScanner.__pm2AlertScanner) {
    return;
  }

  globalScanner.__pm2AlertScanner = new Scanner();
  globalScanner.__pm2AlertScanner.start();
}

/** For graceful shutdown/tests. Does not disconnect the Web's shared Mongoose connection. */
export async function stopAlertsScanner() {
  await globalScanner.__pm2AlertScanner?.stop();
}
