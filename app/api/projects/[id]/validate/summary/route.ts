import { NextResponse } from "next/server";
import { getValidationSummary } from "@/lib/migration/validator";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    const summary = await getValidationSummary(jobId);
    return NextResponse.json({ summary });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
