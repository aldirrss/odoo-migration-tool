import { NextResponse } from "next/server";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { getProfile } from "@/lib/db/profiles";
import { previewDiscovery } from "@/lib/migration/discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    const { project } = await requireProjectAccess(req, projectId);
    if (!project.sourceProfileId) {
      return NextResponse.json(
        { error: "Project has no source connection profile" },
        { status: 400 },
      );
    }
    const source = await getProfile(project.sourceProfileId);
    if (!source) {
      return NextResponse.json(
        { error: "Source profile not found" },
        { status: 404 },
      );
    }
    const summary = await previewDiscovery(source);
    return NextResponse.json(summary);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
