export const DEFAULT_ALERT_CONFIG = {
  offlineThresholdSeconds: 60,
  restartThreshold: 5,
  restartWindowSeconds: 60,
  webhookEnabled: false,
} as const;

/** Heartbeats are epoch milliseconds. New hosts without a heartbeat get a creation-time grace period. */
export function isHostOffline(
  heartbeat: number | undefined,
  createdAt: number | undefined,
  now: number,
  thresholdMs: number,
) {
  const lastSeen = Number.isFinite(heartbeat) && heartbeat! > 0 ? heartbeat : createdAt;
  return !Number.isFinite(lastSeen) || now - lastSeen! > thresholdMs;
}

type RestartState = { counter: number; lastAt: number; baselineAt: number; deltas: { at: number; count: number }[] };

/** In-memory observation window: never treat a cumulative counter as recent restarts. */
export class RestartWindow {
  private states = new Map<string, RestartState>();

  observe(id: string, counter: number | undefined, now: number, windowMs: number, threshold: number) {
    if (!Number.isSafeInteger(counter) || counter! < 0) {
      this.states.delete(id);
      return { firing: false, canRecover: false, count: 0 };
    }
    let state = this.states.get(id);
    if (!state || counter! < state.counter || now < state.lastAt || now - state.lastAt > windowMs) {
      state = { counter: counter!, lastAt: now, baselineAt: now, deltas: [] };
      this.states.set(id, state);
      return { firing: false, canRecover: false, count: 0 };
    }
    if (counter! > state.counter) state.deltas.push({ at: now, count: counter! - state.counter });
    state.counter = counter!;
    state.lastAt = now;
    state.deltas = state.deltas.filter((delta) => delta.at > now - windowMs);
    const count = state.deltas.reduce((sum, delta) => sum + delta.count, 0);
    return { firing: count >= threshold, canRecover: now - state.baselineAt >= windowMs && count < threshold, count };
  }

  forget(id: string) {
    this.states.delete(id);
  }
  retain(ids: Set<string>) {
    for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id);
  }
  clear() {
    this.states.clear();
  }
}
