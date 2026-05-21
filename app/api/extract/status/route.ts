import { NextResponse } from "next/server";
import {
  getExtractionJob,
  getTableExtractionStatuses,
} from "@/lib/migration/extractor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const jobId = Number(url.searchParams.get("jobId"));
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }
    const job = await getExtractionJob(jobId);
    const tables = await getTableExtractionStatuses(jobId);
    return NextResponse.json({ job, tables });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
