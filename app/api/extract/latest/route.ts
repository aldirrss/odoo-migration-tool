import { NextResponse } from "next/server";
import { getLatestExtractionJob } from "@/lib/migration/extractor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const job = await getLatestExtractionJob();
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
