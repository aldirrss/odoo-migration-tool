import { NextResponse } from "next/server";
import { computeDependencyImpact } from "@/lib/migration/cleaner";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertStagedRecordBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const record = await assertStagedRecordBelongsToProject(Number(recordId), projectId);
    const impacts = await computeDependencyImpact(
      record.extractionJobId,
      record.tableName,
      record.sourceId,
    );
    return NextResponse.json({ impacts });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
