import { NextResponse } from "next/server";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { getProfile } from "@/lib/db/profiles";
import { runDiscovery } from "@/lib/migration/discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
      return NextResponse.json({ error: "Source profile not found" }, { status: 404 });
    }
    const result = await runDiscovery(projectId, source);
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
