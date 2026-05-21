import { NextResponse } from "next/server";
import {
  updateStagedRecord,
  softDeleteStagedRecord,
} from "@/lib/migration/cleaner";
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
    return NextResponse.json({ record });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    await assertStagedRecordBelongsToProject(Number(recordId), projectId);
    const { stagedData } = await req.json();
    const updated = await updateStagedRecord(Number(recordId), stagedData);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ record: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    await assertStagedRecordBelongsToProject(Number(recordId), projectId);
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const result = await softDeleteStagedRecord(Number(recordId), force);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
