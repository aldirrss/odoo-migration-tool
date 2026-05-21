import { NextResponse } from "next/server";
import { getLatestExtractionJob } from "@/lib/migration/extractor";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const job = await getLatestExtractionJob(projectId);
    return NextResponse.json({ job });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
