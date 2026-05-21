import { NextResponse } from "next/server";
import { listProfiles, saveProfile } from "@/lib/db/profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profiles = await listProfiles();
    // Strip passwords before returning to client
    const sanitized = profiles.map(({ password, ...rest }) => rest);
    return NextResponse.json({ profiles: sanitized });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.id && !body.password) {
      // Editing without password change: load existing password
      const { getProfile } = await import("@/lib/db/profiles");
      const existing = await getProfile(body.id);
      if (existing) body.password = existing.password;
    }
    const profile = await saveProfile(body);
    const { password, ...rest } = profile;
    return NextResponse.json(rest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
