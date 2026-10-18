import { userModel } from "@pm2.web/mongoose-models";
import type { Session } from "next-auth";

import connectDB from "@/middleware/mongodb";

// Explicit opt-in for deployments whose network boundary replaces login.
export async function getAnonymousOwnerSession(): Promise<Session | null> {
  if (process.env.PM2_WEB_AUTH_DISABLED !== "true") return null;

  await connectDB();
  const owner = await userModel.findOne({ "acl.owner": true }).select("name email acl").orFail().lean();

  return {
    authDisabled: true,
    user: {
      id: owner._id.toString(),
      name: owner.name,
      email: owner.email,
      acl: owner.acl,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
