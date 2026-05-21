import { NextResponse } from "next/server";
import { computeDependencyImpact, getStagedRecord } from "@/lib/migration/cleaner";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    const record = await getStagedRecord(id);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const impacts = await computeDependencyImpact(
      record.extractionJobId,
      record.tableName,
      record.sourceId,
    );
    return NextResponse.json({ impacts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
