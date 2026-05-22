import { NextResponse } from "next/server";
import { getImportState } from "@/lib/migration/importer";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);

    const url = new URL(req.url);
    const jobId = Number(url.searchParams.get("jobId"));
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const state = await getImportState(jobId);
    if (!state) {
      return NextResponse.json({ running: false });
    }

    return NextResponse.json(state);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
