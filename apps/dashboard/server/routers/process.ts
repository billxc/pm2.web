import { processModel, statModel } from "@pm2.web/mongoose-models";
import { IProcess, IUser } from "@pm2.web/typings";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import Access from "@/utils/access";
import { PERMISSIONS } from "@/utils/permission";

import { protectedProcedure, router } from "../trpc";

export const processRouter = router({
  getStat: protectedProcedure.input(z.object({ processId: z.string() })).query(async ({ ctx, input }) => {
    const process = await processModel.findById(input.processId);
    checkPermission(process, ctx.user, [PERMISSIONS.MONITORING]);

    return statModel
      .findOne({ "source.process": process?._id, "source.server": process?.server })
      .sort({ timestamp: -1 })
      .lean();
  }),
});

const checkPermission = (process: IProcess | null, user: IUser, requiredPerms: number[]) => {
  if (!process) throw new TRPCError({ code: "BAD_REQUEST", message: "Process not found" });
  if (user.acl.admin || user.acl.owner) return;
  const userPerms = new Access(user.acl.servers).getPerms(process.server.toString(), process._id.toString());
  if (!userPerms.has(...requiredPerms)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Insufficient Permissions" });
  }
};
