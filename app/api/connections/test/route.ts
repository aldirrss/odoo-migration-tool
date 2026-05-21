import { NextResponse } from "next/server";
import { testSourceConnection } from "@/lib/db/source";
import { getProfile } from "@/lib/db/profiles";
import type { ConnectionProfile } from "@/lib/db/profiles";
import { requireSession, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireSession(req);
    const body = await req.json();
    // If editing an existing profile without password, reuse stored one
    let password: string = body.password;
    if (body.id && !password) {
      const existing = await getProfile(body.id);
      if (existing) password = existing.password;
    }
    const profile: ConnectionProfile = {
      id: body.id ?? "test",
      name: body.name ?? "test",
      role: body.role ?? "source",
      host: body.host,
      port: Number(body.port) || 5432,
      database: body.database,
      user: body.user,
      password,
      ssl: !!body.ssl,
      odooVersion: body.odooVersion,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await testSourceConnection(profile);
    return NextResponse.json(result);
  } catch (err) {
    if ((err as { status?: number }).status === 401) return httpErrorResponse(err);
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
