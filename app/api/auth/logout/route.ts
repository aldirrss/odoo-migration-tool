import { NextResponse } from "next/server";
import {
  buildClearedSessionCookie,
  destroySession,
  readSessionTokenFromRequest,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = readSessionTokenFromRequest(req);
  if (token) {
    try {
      await destroySession(token);
    } catch {
      // ignore
    }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildClearedSessionCookie());
  return res;
}
