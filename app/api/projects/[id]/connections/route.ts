import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { listProfiles } from "@/lib/db/profiles";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  sourceProfileId: z.string().nullable().optional(),
  targetProfileId: z.string().nullable().optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    const { project } = await requireProjectAccess(req, projectId);
    const profiles = await listProfiles();
    const sanitized = profiles.map(({ password, ...rest }) => rest);
    return NextResponse.json({
      profiles: sanitized,
      sourceProfileId: project.sourceProfileId,
      targetProfileId: project.targetProfileId,
    });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const body = assignSchema.parse(await req.json());
    const [project] = await stagingDb
      .update(schema.projects)
      .set({
        sourceProfileId: body.sourceProfileId ?? null,
        targetProfileId: body.targetProfileId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId))
      .returning();
    return NextResponse.json({ project });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
