import { eq, and, gt } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { generateSessionToken, sha256 } from "./crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "omt_session";

export interface SessionUser {
  id: number;
  email: string;
  role: string;
}

export interface SessionContext {
  user: SessionUser;
  session: typeof schema.sessions.$inferSelect;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await stagingDb.insert(schema.sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });
  await stagingDb
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, userId));
  return { token, expiresAt };
}

export async function getSession(token: string | null | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const tokenHash = sha256(token);
  const rows = await stagingDb
    .select({
      session: schema.sessions,
      user: schema.users,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    session: row.session,
    user: { id: row.user.id, email: row.user.email, role: row.user.role },
  };
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = sha256(token);
  await stagingDb.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
}

export function buildSessionCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function buildClearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readSessionTokenFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const c of cookies) {
    const [name, ...rest] = c.split("=");
    if (name === SESSION_COOKIE_NAME) return rest.join("=");
  }
  return null;
}
