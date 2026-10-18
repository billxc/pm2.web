/** Next invokes register per runtime process, including standalone server.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // Dynamic import prevents Mongoose/Node-only modules from entering Edge instrumentation.
  const { startAlertsScanner } = await import("./server/alerts/scanner");
  startAlertsScanner();
}
