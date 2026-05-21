import { NextResponse } from "next/server";
import { z } from "zod";
import { applyBulkOperation, type BulkOperation } from "@/lib/migration/cleaner";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_field"), column: z.string().min(1), value: z.unknown() }),
  z.object({
    kind: z.literal("find_replace"),
    column: z.string().min(1).nullable(),
    find: z.string(),
    replace: z.string(),
    useRegex: z.boolean(),
  }),
  z.object({ kind: z.literal("clear_field"), column: z.string().min(1) }),
  z.object({ kind: z.literal("revert_to_source") }),
  z.object({ kind: z.literal("soft_delete") }),
  z.object({ kind: z.literal("restore") }),
]);

const bodySchema = z.object({
  recordIds: z.array(z.number().int().positive()).min(1).max(10000),
  operation: operationSchema,
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; table: string }> },
) {
  try {
    const { id, table } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const result = await applyBulkOperation(
      projectId,
      table,
      parsed.data.recordIds,
      parsed.data.operation as BulkOperation,
    );
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
