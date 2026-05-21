import { eq } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import {
  getSession,
  readSessionTokenFromRequest,
  type SessionContext,
} from "./session";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireSession(req: Request): Promise<SessionContext> {
  const token = readSessionTokenFromRequest(req);
  const ctx = await getSession(token);
  if (!ctx) throw new HttpError(401, "Unauthorized");
  return ctx;
}

export async function requireProjectAccess(
  req: Request,
  projectId: number,
): Promise<{ session: SessionContext; project: typeof schema.projects.$inferSelect }> {
  const session = await requireSession(req);
  if (!Number.isFinite(projectId)) throw new HttpError(400, "Invalid project id");
  const rows = await stagingDb
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project) throw new HttpError(404, "Project not found");
  if (project.ownerId !== session.user.id && session.user.role !== "admin") {
    throw new HttpError(403, "Forbidden");
  }
  return { session, project };
}

export async function requireAdmin(req: Request): Promise<SessionContext> {
  const ctx = await requireSession(req);
  if (ctx.user.role !== "admin") throw new HttpError(403, "Forbidden");
  return ctx;
}

export function httpErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { "content-type": "application/json" },
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}
