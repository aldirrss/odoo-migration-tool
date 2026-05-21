import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  sourceProfileId: z.string().nullable().optional(),
  targetProfileId: z.string().nullable().optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { project } = await requireProjectAccess(req, Number(id));
    return NextResponse.json({ project });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const body = updateSchema.parse(await req.json());
    const [updated] = await stagingDb
      .update(schema.projects)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId))
      .returning();
    return NextResponse.json({ project: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    await stagingDb.delete(schema.projects).where(eq(schema.projects.id, projectId));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
