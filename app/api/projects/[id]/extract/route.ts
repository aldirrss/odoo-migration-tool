import { NextResponse } from "next/server";
import { startExtraction } from "@/lib/migration/extractor";
import { getProfile } from "@/lib/db/profiles";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    const { project } = await requireProjectAccess(req, projectId);
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
    const { jobId } = await startExtraction(projectId, source, target);
    return NextResponse.json({ jobId });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
