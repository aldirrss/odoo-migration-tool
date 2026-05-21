import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  type: z.enum(["master", "transaction"]).optional(),
  dateFilterColumn: z.string().nullable().optional(),
  importOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  userClassified: z.literal(true).optional(),
  moduleSlug: z.string().nullable().optional(),
  tableType: z.enum(["master", "transaction"]).nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; tableId: string }> },
) {
  try {
    const { id, tableId } = await ctx.params;
    const projectId = Number(id);
    const tId = Number(tableId);
    await requireProjectAccess(req, projectId);
    const body = patchSchema.parse(await req.json());

    const existing = await stagingDb
      .select()
      .from(schema.discoveredTables)
      .where(
        and(
          eq(schema.discoveredTables.id, tId),
          eq(schema.discoveredTables.projectId, projectId),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    const [updated] = await stagingDb
      .update(schema.discoveredTables)
      .set({
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.dateFilterColumn !== undefined
          ? { dateFilterColumn: body.dateFilterColumn }
          : {}),
        ...(body.importOrder !== undefined ? { importOrder: body.importOrder } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.userClassified !== undefined
          ? { userClassified: body.userClassified }
          : {}),
        ...(body.moduleSlug !== undefined ? { moduleSlug: body.moduleSlug } : {}),
        ...(body.tableType !== undefined ? { tableType: body.tableType } : {}),
      })
      .where(eq(schema.discoveredTables.id, tId))
      .returning();

    return NextResponse.json({ table: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
