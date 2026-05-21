import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";
import { assertExtractionJobBelongsToProject } from "@/lib/auth/project-scope";
import { runQualityScan } from "@/lib/migration/quality";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bodySchema = z.object({
  jobId: z.number().int().positive(),
  tableName: z.string().min(1).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const body = bodySchema.parse(await req.json());
    await assertExtractionJobBelongsToProject(body.jobId, projectId);

    const result = await runQualityScan(body.jobId, {
      projectId,
      tableName: body.tableName,
    });
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
