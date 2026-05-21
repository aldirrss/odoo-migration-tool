import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

/**
 * Signal the running quality scan to skip the remaining tables/rows.
 * The orchestrator polls this flag between chunks; on next checkpoint it
 * exits the loop and the extractor proceeds to mark the job done.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);

    const url = new URL(req.url);
    const jobId = Number(url.searchParams.get("jobId"));
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }
    await assertExtractionJobBelongsToProject(jobId, projectId);

    await stagingDb
      .update(schema.extractionJobs)
      .set({ qualityScanSkipRequested: true })
      .where(eq(schema.extractionJobs.id, jobId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
