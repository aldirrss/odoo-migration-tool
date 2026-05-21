import { NextResponse } from "next/server";
import { runValidation } from "@/lib/migration/validator";
import { getProfile } from "@/lib/db/profiles";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const { jobId, targetProfileId } = await req.json();
    if (!jobId || !targetProfileId) {
      return NextResponse.json(
        { error: "jobId and targetProfileId are required" },
        { status: 400 },
      );
    }
    const target = await getProfile(targetProfileId);
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    const results = await runValidation(Number(jobId), target);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
