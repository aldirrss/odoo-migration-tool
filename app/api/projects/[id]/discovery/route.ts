import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireProjectAccess, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const projectId = Number(id);
    await requireProjectAccess(req, projectId);

    const modules = await stagingDb
      .select()
      .from(schema.discoveredModules)
      .where(eq(schema.discoveredModules.projectId, projectId))
      .orderBy(asc(schema.discoveredModules.name));

    const tables = await stagingDb
      .select()
      .from(schema.discoveredTables)
      .where(eq(schema.discoveredTables.projectId, projectId))
      .orderBy(asc(schema.discoveredTables.tableName));

    const relations = await stagingDb
      .select()
      .from(schema.discoveredRelations)
      .where(eq(schema.discoveredRelations.projectId, projectId));

    // Allowed modules from project config (read-only)
    const cfg = await stagingDb
      .select()
      .from(schema.projectConfigs)
      .where(eq(schema.projectConfigs.projectId, projectId))
      .limit(1);
    const allowedModules: string[] = cfg[0]?.allowedModules ?? [];

    return NextResponse.json({ modules, tables, relations, allowedModules });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
