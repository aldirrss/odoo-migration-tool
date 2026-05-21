import { NextResponse } from "next/server";
import { listStagedRecords } from "@/lib/migration/cleaner";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ table: string }> },
) {
  try {
    const { table } = await context.params;
    const url = new URL(req.url);
    const jobId = Number(url.searchParams.get("jobId"));
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
    const search = url.searchParams.get("search") ?? undefined;
    const filterDirty = url.searchParams.get("dirty") === "1";

    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }

    const result = await listStagedRecords({
      jobId,
      tableName: table,
      page,
      pageSize,
      search,
      filterDirty,
      filterDeleted: false,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
