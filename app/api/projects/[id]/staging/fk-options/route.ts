import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

const NAME_FIELDS = ["display_name", "name", "complete_name", "code", "ref"];
const LIMIT = 30;

function extractLabel(data: Record<string, unknown>): string {
  for (const field of NAME_FIELDS) {
    const v = data[field];
    if (v && typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Return a list of {id, label} pairs for a FK target table so the inline FK
 * editor can show a searchable dropdown instead of a raw number input.
 *
 * GET /api/projects/:id/staging/fk-options
 *   ?table=<tableName>
 *   &jobId=<extractionJobId>
 *   &q=<optional search>
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
    const jobIdRaw = url.searchParams.get("jobId");
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

    if (!tableName || !jobIdRaw) {
      return NextResponse.json(
        { error: "table and jobId are required" },
        { status: 400 },
      );
    }
    const jobId = Number(jobIdRaw);
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "jobId must be a number" }, { status: 400 });
    }
    await assertExtractionJobBelongsToProject(jobId, projectId);

    const rows = await stagingDb
      .select({
        sourceId: schema.stagedRecords.sourceId,
        stagedData: schema.stagedRecords.stagedData,
      })
      .from(schema.stagedRecords)
      .where(
        and(
          eq(schema.stagedRecords.extractionJobId, jobId),
          eq(schema.stagedRecords.tableName, tableName),
          eq(schema.stagedRecords.isDeleted, false),
          // Cheap pre-filter: only pull rows where staged_data text contains q
          ...(q
            ? [sql`staged_data::text ILIKE ${"%" + q + "%"}`]
            : []),
        ),
      )
      .orderBy(schema.stagedRecords.sourceId)
      .limit(LIMIT);

    const options = rows.map((r) => ({
      id: r.sourceId,
      label: extractLabel((r.stagedData ?? {}) as Record<string, unknown>),
    }));

    return NextResponse.json({ options });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
