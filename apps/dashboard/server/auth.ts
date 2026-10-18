import { IAcl, IOauth2 } from "@pm2.web/typings";
import { GetServerSidePropsContext } from "next";
import { DefaultSession, getServerSession } from "next-auth";

import { authOptions } from "@/pages/api/auth/[...nextauth]";

import { getAnonymousOwnerSession } from "./anonymous-session";

declare module "next-auth" {
  interface Session {
    authDisabled?: boolean;
    user?: {
      id: string;
      acl?: IAcl;
      oauth2?: IOauth2;
    } & DefaultSession["user"];
  }
}

export const getServerAuthSession = async (ctx: {
  req: GetServerSidePropsContext["req"];
  res: GetServerSidePropsContext["res"];
}) => {
  return (await getAnonymousOwnerSession()) ?? getServerSession(ctx.req, ctx.res, authOptions);
};
