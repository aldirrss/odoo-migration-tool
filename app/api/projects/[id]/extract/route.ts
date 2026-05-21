import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { createExtractionJob, runExtractionWork } from "@/lib/migration/extractor";
import { getProfile } from "@/lib/db/profiles";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { stagingDb, schema } from "@/lib/db/staging";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    const { project } = await requireProjectAccess(req, projectId);

    // Reject if there's already a running extraction for this project.
    const inflight = await stagingDb
      .select({ id: schema.extractionJobs.id })
      .from(schema.extractionJobs)
      .where(
        and(
          eq(schema.extractionJobs.projectId, projectId),
          eq(schema.extractionJobs.status, "running"),
        ),
      )
      .limit(1);
    if (inflight[0]) {
      return NextResponse.json(
        {
          error: "An extraction is already running for this project.",
          jobId: inflight[0].id,
        },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const sourceProfileId = body.sourceProfileId ?? project.sourceProfileId;
    const targetProfileId = body.targetProfileId ?? project.targetProfileId;
    if (!sourceProfileId || !targetProfileId) {
      return NextResponse.json(
        { error: "Both sourceProfileId and targetProfileId are required" },
        { status: 400 },
      );
    }
    const source = await getProfile(sourceProfileId);
    const target = await getProfile(targetProfileId);
    if (!source) return NextResponse.json({ error: "Source profile not found" }, { status: 404 });
    if (!target) return NextResponse.json({ error: "Target profile not found" }, { status: 404 });

    // 1) Create job row (fast) so we can return jobId immediately to the UI.
    const jobId = await createExtractionJob(projectId, source, target);

    // 2) Run the long table-walking work AFTER the response is sent so the
    //    HTTP request doesn't block on the full extraction.
    after(async () => {
      try {
        await runExtractionWork(jobId, projectId, source);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[extract job ${jobId}] background work failed`, err);
        await stagingDb
          .update(schema.extractionJobs)
          .set({
            status: "failed",
            errorMessage: message,
            finishedAt: new Date(),
          })
          .where(eq(schema.extractionJobs.id, jobId));
      }
    });

    return NextResponse.json({ jobId });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
