import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { verifyPassword } from "@/lib/auth/crypto";
import { createSession, buildSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    const rows = await stagingDb
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email.toLowerCase()))
      .limit(1);
    const user = rows[0];
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const { token, expiresAt } = await createSession(user.id);
    const res = NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role },
    });
    res.headers.append("Set-Cookie", buildSessionCookie(token, expiresAt));
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
