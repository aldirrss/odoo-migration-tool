import { NextResponse } from "next/server";
import { resetStagedRecord } from "@/lib/migration/cleaner";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertStagedRecordBelongsToProject } from "@/lib/auth/project-scope";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    await assertStagedRecordBelongsToProject(Number(recordId), projectId);
    const updated = await resetStagedRecord(Number(recordId));
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ record: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
