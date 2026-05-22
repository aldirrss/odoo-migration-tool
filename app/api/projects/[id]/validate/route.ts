import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { runValidation } from "@/lib/migration/validator";
import { getProfile } from "@/lib/db/profiles";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
        validationRunning: true,
        validationError: null,
        validationCurrentTable: null,
        validationProcessedTables: 0,
        validationTotalTables: 0,
        validationProcessedRecords: 0,
        validationTotalRecords: 0,
        validationCancelRequested: false,
      })
      .where(eq(schema.extractionJobs.id, jobId));

    // Run the long work after the HTTP response is sent. This is how the
    // extractor handles its own long task; using after() instead of a raw
    // dangling promise keeps Next.js from killing the work.
    after(async () => {
      try {
        await runValidation(jobId, target, projectId);
      } catch (err) {
        console.error(`[validate] job ${jobId} failed:`, err);
      }
    });

    return NextResponse.json({ running: true, jobId });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
