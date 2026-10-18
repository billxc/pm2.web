import { processModel, serverModel } from "@pm2.web/mongoose-models";
import { IServer } from "@pm2.web/typings";
import { z } from "zod";

import Access from "@/utils/access";

import { fetchSettings } from "../helpers";
import { protectedProcedure, router } from "../trpc";

export const serverRouter = router({
  getDashBoardData: protectedProcedure.input(z.boolean().optional()).query(async ({ ctx, input: excludeDaemon }) => {
    const settings = await fetchSettings();
    const servers = (await serverModel.find({}, { createdAt: 0 }).lean()) as unknown as IServer[];
    const processes = await processModel
      .find({}, { logs: 0, stats: 0, createdAt: 0, restartCount: 0, deleteCount: 0, toggleCount: 0 })
      .lean();

    const isAdmin = ctx.user.acl.owner || ctx.user.acl.admin;
    const access = new Access(ctx.user.acl.servers);
    const visibleProcesses = isAdmin
      ? processes
      : processes.filter((process) => access.getPermsValue(process.server.toString(), process._id.toString()) > 0);
    const updateInterval = settings.polling.backend + 3000;
    for (const process of visibleProcesses) {
      if (process.status === "online" && new Date(process.updatedAt).getTime() < Date.now() - updateInterval) {
        process.status = "offline";
      }
    }
    for (const server of servers) {
      server.processes = visibleProcesses.filter(
        (process) =>
          process.server.toString() === server._id.toString() &&
          (!(settings.excludeDaemon || excludeDaemon) || process.name !== "pm2.web-daemon"),
      );
    }
    return {
      settings,
      servers: isAdmin
        ? servers
        : servers.filter(
            (server) => server.processes.length > 0 || access.getPermsValue(server._id.toString(), "") > 0,
          ),
    };
  }),
});
