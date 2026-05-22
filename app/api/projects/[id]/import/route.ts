import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { runImport } from "@/lib/migration/importer";
import { getProfile } from "@/lib/db/profiles";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    const { project } = await requireProjectAccess(req, projectId);
    const body = await req.json();
    const jobId = Number(body.jobId);
    const targetProfileId = body.targetProfileId ?? project.targetProfileId;
    if (!Number.isFinite(jobId) || !targetProfileId) {
      return NextResponse.json(
        { error: "jobId and targetProfileId are required" },
        { status: 400 },
      );
    }
    await assertExtractionJobBelongsToProject(jobId, projectId);
    const target = await getProfile(targetProfileId);
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });

    // Flip the running flag and reset all counters NOW so the polling endpoint
    // immediately reflects "in progress" with fresh zeroed state — prevents the
    // UI from showing stale counter values from a previous run.
    await stagingDb
      .update(schema.extractionJobs)
      .set({
        importRunning: true,
        importError: null,
        importCurrentTable: null,
        importProcessedTables: 0,
        importTotalTables: 0,
        importProcessedRecords: 0,
        importTotalRecords: 0,
        importCancelRequested: false,
      })
      .where(eq(schema.extractionJobs.id, jobId));

    // Run the long work after the HTTP response is sent. Using after() instead
    // of a raw dangling promise keeps Next.js from killing the work early.
    after(async () => {
      try {
        await runImport(projectId, jobId, target);
      } catch (err) {
        console.error(`[import] job ${jobId} failed:`, err);
      }
    });

    return NextResponse.json({ running: true, jobId });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
