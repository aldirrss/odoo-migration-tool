import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

/**
 * Look up a single staged record by (table, sourceId) within a project's
 * extraction job. Used by the FK-preview button in the staging table view so
 * the user can quickly peek at the parent record without leaving the page.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);

    const url = new URL(req.url);
    const tableName = url.searchParams.get("table");
    const sourceIdRaw = url.searchParams.get("sourceId");
    const jobIdRaw = url.searchParams.get("jobId");
    if (!tableName || !sourceIdRaw || !jobIdRaw) {
      return NextResponse.json(
        { error: "table, sourceId, and jobId are required" },
        { status: 400 },
      );
    }
    const sourceId = Number(sourceIdRaw);
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(sourceId) || !Number.isFinite(jobId)) {
      return NextResponse.json(
        { error: "sourceId and jobId must be numbers" },
        { status: 400 },
      );
    }
    await assertExtractionJobBelongsToProject(jobId, projectId);

    const rows = await stagingDb
      .select()
      .from(schema.stagedRecords)
      .where(
        and(
          eq(schema.stagedRecords.extractionJobId, jobId),
          eq(schema.stagedRecords.tableName, tableName),
          eq(schema.stagedRecords.sourceId, sourceId),
        ),
      )
      .limit(1);

    return NextResponse.json({ record: rows[0] ?? null });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
