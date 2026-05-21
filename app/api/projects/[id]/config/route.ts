import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  transactionDateFrom: process.env.TRANSACTION_DATE_FROM || "2026-01-01",
  dateFallbackEnabled: true,
  dateFallbackChain: ["date", "date_order", "create_date", "write_date"],
  allowedModules: ["base", "accounting", "pos"],
  onMissingDateColumn: "fallback" as const,
};

const bodySchema = z.object({
  transactionDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateFallbackEnabled: z.boolean(),
  dateFallbackChain: z.array(z.string().min(1)).min(1),
  allowedModules: z.array(z.string().min(1)),
  onMissingDateColumn: z.enum(["fallback", "skip_filter", "skip_table"]),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const rows = await stagingDb
      .select()
      .from(schema.projectConfigs)
      .where(eq(schema.projectConfigs.projectId, projectId))
      .limit(1);
    const config = rows[0] ?? { projectId, ...DEFAULTS };
    return NextResponse.json({ config });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);
    const body = bodySchema.parse(await req.json());

    const [updated] = await stagingDb
      .insert(schema.projectConfigs)
      .values({ projectId, ...body, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.projectConfigs.projectId,
        set: { ...body, updatedAt: new Date() },
      })
      .returning();
    return NextResponse.json({ config: updated });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
