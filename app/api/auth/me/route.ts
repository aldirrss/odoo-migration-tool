import { NextResponse } from "next/server";
import { getSession, readSessionTokenFromRequest } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = readSessionTokenFromRequest(req);
  const ctx = await getSession(token);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ user: ctx.user });
}
