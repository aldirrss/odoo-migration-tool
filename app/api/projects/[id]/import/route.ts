import { NextResponse } from "next/server";
import { runImport } from "@/lib/migration/importer";
import { getProfile } from "@/lib/db/profiles";
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
    const summary = await runImport(projectId, jobId, target);
    return NextResponse.json(summary);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
