import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { hashPassword } from "@/lib/auth/crypto";
import {
  createSession,
  buildSessionCookie,
  getSession,
  readSessionTokenFromRequest,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  try {
    const body = registerSchema.parse(await req.json());
    const email = body.email.toLowerCase();

    const countRows = await stagingDb
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users);
    const userCount = countRows[0]?.count ?? 0;

    let role: "user" | "admin" = "user";
    if (userCount === 0) {
      role = "admin";
    } else {
      const token = readSessionTokenFromRequest(req);
      const ctx = await getSession(token);
      if (!ctx || ctx.user.role !== "admin") {
        return NextResponse.json(
          { error: "Registration is closed. Ask an admin to create your account." },
          { status: 403 },
        );
      }
    }

    const passwordHash = await hashPassword(body.password);
    const [user] = await stagingDb
      .insert(schema.users)
      .values({ email, passwordHash, role })
      .returning();
    if (!user) throw new Error("Failed to create user");

    if (userCount === 0) {
      const { token, expiresAt } = await createSession(user.id);
      const res = NextResponse.json({
        user: { id: user.id, email: user.email, role: user.role },
      });
      res.headers.append("Set-Cookie", buildSessionCookie(token, expiresAt));
      return res;
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
