import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; moduleId: string }> },
) {
  try {
    const { id, moduleId } = await ctx.params;
    const projectId = Number(id);
    const mId = Number(moduleId);
    await requireProjectAccess(req, projectId);
    const body = patchSchema.parse(await req.json());

    const existing = await stagingDb
      .select()
      .from(schema.discoveredModules)
      .where(
        and(
          eq(schema.discoveredModules.id, mId),
          eq(schema.discoveredModules.projectId, projectId),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    const [updated] = await stagingDb
      .update(schema.discoveredModules)
      .set({ enabled: body.enabled })
      .where(eq(schema.discoveredModules.id, mId))
      .returning();

    // Cascade enable to its tables (only flip those that are currently disabled and not user-disabled)
    if (body.enabled) {
      await stagingDb
        .update(schema.discoveredTables)
        .set({ enabled: true })
        .where(
          and(
            eq(schema.discoveredTables.moduleId, mId),
            eq(schema.discoveredTables.projectId, projectId),
            eq(schema.discoveredTables.enabled, false),
          ),
        );
    }

    return NextResponse.json({ module: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
