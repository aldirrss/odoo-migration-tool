import { NextResponse } from "next/server";
import { listStagedRecords, listStagedRecordIds } from "@/lib/migration/cleaner";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; table: string }> },
) {
  try {
    const { id, table } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const url = new URL(req.url);
    const jobId = Number(url.searchParams.get("jobId"));
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }
    await assertExtractionJobBelongsToProject(jobId, projectId);

    const legacySearch = url.searchParams.get("search") ?? undefined;
    const searchTerms = url.searchParams.getAll("q").filter(Boolean);
    const colSearchRaw = url.searchParams.getAll("qc").filter(Boolean);
    const colSearchTerms = colSearchRaw
      .map((raw) => {
        const eqIdx = raw.indexOf("=");
        if (eqIdx === -1) return null;
        return { col: raw.slice(0, eqIdx), val: raw.slice(eqIdx + 1) };
      })
      .filter((x): x is { col: string; val: string } => x !== null);
    const filterDirty = url.searchParams.get("dirty") === "1";
    const deletedParam = url.searchParams.get("deleted");
    const filterDeleted =
      deletedParam === "1" ? true : deletedParam === "0" ? false : undefined;
    const filterValidationStatus =
      url.searchParams.get("validationStatus") ?? undefined;
    const idsOnly = url.searchParams.get("idsOnly") === "1";

    if (idsOnly) {
      const ids = await listStagedRecordIds({
        jobId,
        tableName: table,
        search: legacySearch,
        searchTerms,
        colSearchTerms,
        filterDirty,
        filterDeleted,
        filterValidationStatus,
      });
      return NextResponse.json({ ids, total: ids.length });
    }

    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "50");
    const pageSize = Math.min(500, Math.max(1, Number.isFinite(pageSizeRaw) ? pageSizeRaw : 50));

    const result = await listStagedRecords({
      jobId,
      tableName: table,
      page,
      pageSize,
      search: legacySearch,
      searchTerms,
      colSearchTerms,
      filterDirty,
      filterDeleted: filterDeleted ?? false,
      filterValidationStatus,
    });
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
