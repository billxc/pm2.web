import * as dotenv from "dotenv";

import LogCapture from "./handlers/captureLogs.js";
import connectDb from "./handlers/connectDb.js";
import startOperationWorker from "./handlers/operations.js";
import updateData from "./handlers/updateData.js";
import { getCachedSettings } from "./utils/cachedSettings.js";

dotenv.config();

connectDb(process.env.DB_URI);
const logCapture = new LogCapture();

async function createInterval() {
  const { polling } = await getCachedSettings();
  const interval = setInterval(async () => {
    await updateData(logCapture.clear(), await getCachedSettings());
    const settings = await getCachedSettings();
    // if polling changed clear interval and create new one
    if (settings.polling.backend === polling.backend) {
      return;
    }

    clearInterval(interval);
    await createInterval();
  }, polling.backend);
}

async function main() {
  logCapture.capture();
  const initialData = await updateData([], await getCachedSettings());
  startOperationWorker(initialData.server._id.toString());
  await createInterval();
}

// CommonJS entrypoint; exit on startup failure so PM2 can restart the collector.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error("[STARTUP] Failed to initialize collector", error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
