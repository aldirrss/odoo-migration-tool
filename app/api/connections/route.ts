import { NextResponse } from "next/server";
import { listProfiles, saveProfile, getProfile } from "@/lib/db/profiles";
import { requireSession, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const profiles = await listProfiles();
    const sanitized = profiles.map(({ password, ...rest }) => rest);
    return NextResponse.json({ profiles: sanitized });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    const body = await req.json();
    if (body.id && !body.password) {
      const existing = await getProfile(body.id);
      if (existing) body.password = existing.password;
    }
    const profile = await saveProfile(body);
    const { password: _pw, ...rest } = profile;
    return NextResponse.json(rest);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
