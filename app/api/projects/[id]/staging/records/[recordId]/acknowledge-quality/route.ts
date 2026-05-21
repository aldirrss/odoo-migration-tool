import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";
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
    const numericRecordId = Number(recordId);
    await assertStagedRecordBelongsToProject(numericRecordId, projectId);

    const [updated] = await stagingDb
      .update(schema.stagedRecords)
      .set({ qualityOverridden: true })
      .where(eq(schema.stagedRecords.id, numericRecordId))
      .returning();
    if (!updated) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ record: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
