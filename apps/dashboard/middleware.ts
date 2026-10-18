import { NextFetchEvent, NextResponse } from "next/server";
import middleware, { NextRequestWithAuth } from "next-auth/middleware";

export default function authMiddleware(req: NextRequestWithAuth, event: NextFetchEvent) {
  if (process.env.PM2_WEB_AUTH_DISABLED === "true") return NextResponse.next();
  return middleware(req, event);
}

export const config = { matcher: ["/process", "/settings", "/", "/user"] };
