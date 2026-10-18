import { router } from "../trpc";
import { alertRouter } from "./alerts";
import { historyRouter } from "./history";
import { logsRouter } from "./logs";
import { operationsRouter } from "./operations";
import { processRouter } from "./process";
import { serverRouter } from "./server";
import { settingRouter } from "./settings";
import { userRouter } from "./user";

export const appRouter = router({
  alerts: alertRouter,
  history: historyRouter,
  logs: logsRouter,
  operations: operationsRouter,
  setting: settingRouter,
  user: userRouter,
  process: processRouter,
  server: serverRouter,
});

export type AppRouter = typeof appRouter;
