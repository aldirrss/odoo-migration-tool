import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { forceFinalizeJob } from "@/lib/migration/extractor";

export const dynamic = "force-dynamic";

/**
 * First call: set cancel_requested=true. The extractor sees the flag at its
 *   next checkpoint (between keyset chunks or between batch inserts) and
 *   tears down all staged data itself.
 *
 * Second call (or any call where cancel_requested was already true):
 *   force-finalize the job immediately — cleanup data + flip status='cancelled'
 *   — even if the orphaned extractor request is stuck on a long-running query.
 *   This is the escape hatch for "stop is taking forever, just kill it now".
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);

    const running = await stagingDb
      .select({
        id: schema.extractionJobs.id,
        cancelRequested: schema.extractionJobs.cancelRequested,
      })
      .from(schema.extractionJobs)
      .where(
        and(
          eq(schema.extractionJobs.projectId, projectId),
          eq(schema.extractionJobs.status, "running"),
        ),
      )
      .limit(1);

    if (!running[0]) {
      return NextResponse.json(
        { error: "No running extraction to cancel" },
        { status: 404 },
      );
    }

    if (running[0].cancelRequested) {
      // Already requested — caller wants force cleanup now.
      await forceFinalizeJob(running[0].id);
      return NextResponse.json({
        jobId: running[0].id,
        forced: true,
        status: "cancelled",
      });
    }

    await stagingDb
      .update(schema.extractionJobs)
      .set({ cancelRequested: true })
      .where(eq(schema.extractionJobs.id, running[0].id));

    return NextResponse.json({
      jobId: running[0].id,
      cancelRequested: true,
      forced: false,
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
