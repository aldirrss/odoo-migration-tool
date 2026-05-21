import { NextResponse } from "next/server";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";
import { getQualitySummary } from "@/lib/migration/quality";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const url = new URL(req.url);
    const jobIdRaw = url.searchParams.get("jobId");
    if (!jobIdRaw) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }
    await assertExtractionJobBelongsToProject(jobId, projectId);
    const rows = await getQualitySummary(jobId);
    return NextResponse.json({
      byTable: rows.map((r) => ({
        tableName: r.table_name,
        block: r.block,
        warn: r.warn,
        ok: r.ok,
        unscanned: r.unscanned,
      })),
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
