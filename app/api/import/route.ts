import { NextResponse } from "next/server";
import { runImport } from "@/lib/migration/importer";
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
    const summary = await runImport(Number(jobId), target);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
