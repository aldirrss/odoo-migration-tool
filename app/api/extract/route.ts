import { NextResponse } from "next/server";
import { startExtraction } from "@/lib/migration/extractor";
import { getProfile } from "@/lib/db/profiles";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 minutes for long extractions

export async function POST(req: Request) {
  try {
    const { sourceProfileId, targetProfileId } = await req.json();
    if (!sourceProfileId || !targetProfileId) {
      return NextResponse.json(
        { error: "Both sourceProfileId and targetProfileId are required" },
        { status: 400 },
      );
    }
    const source = await getProfile(sourceProfileId);
    const target = await getProfile(targetProfileId);
    if (!source) return NextResponse.json({ error: "Source profile not found" }, { status: 404 });
    if (!target) return NextResponse.json({ error: "Target profile not found" }, { status: 404 });

    // Kick off extraction. We return the jobId immediately;
    // the client will poll /api/extract/status for updates.
    const { jobId } = await startExtraction(source, target);
    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
