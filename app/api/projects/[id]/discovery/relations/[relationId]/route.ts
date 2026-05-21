import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  onDelete: z.enum(["block", "nullify", "cascade"]),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; relationId: string }> },
) {
  try {
    const { id, relationId } = await ctx.params;
    const projectId = Number(id);
    const rId = Number(relationId);
    await requireProjectAccess(req, projectId);
    const body = patchSchema.parse(await req.json());

    const existing = await stagingDb
      .select()
      .from(schema.discoveredRelations)
      .where(
        and(
          eq(schema.discoveredRelations.id, rId),
          eq(schema.discoveredRelations.projectId, projectId),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      return NextResponse.json({ error: "Relation not found" }, { status: 404 });
    }

    const [updated] = await stagingDb
      .update(schema.discoveredRelations)
      .set({ onDelete: body.onDelete })
      .where(eq(schema.discoveredRelations.id, rId))
      .returning();

    return NextResponse.json({ relation: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
