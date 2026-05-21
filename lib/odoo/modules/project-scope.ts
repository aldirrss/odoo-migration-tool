/**
 * Project-scoped helpers for the module registry.
 *
 * SERVER-ONLY: this file imports the staging DB. Do not import it from client
 * components. Client code should use the synchronous helpers from `./index.ts`
 * (which operate on the unfiltered built-in registry).
 */

import { eq } from "drizzle-orm";
import { stagingDb, schema } from "../../db/staging";
import type {
  OdooModule,
  TableDefinition,
  RelationDefinition,
} from "../types";
import { moduleRegistry } from "./index";

async function getAllowedModuleNames(projectId: number): Promise<Set<string> | null> {
  const rows = await stagingDb
    .select({ allowedModules: schema.projectConfigs.allowedModules })
    .from(schema.projectConfigs)
    .where(eq(schema.projectConfigs.projectId, projectId))
    .limit(1);
  const allowed = rows[0]?.allowedModules;
  if (!allowed) return null;
  return new Set(allowed);
}

function filterModules(allowed: Set<string> | null): OdooModule[] {
  if (!allowed) return moduleRegistry;
  return moduleRegistry.filter((m) => allowed.has(m.name));
}

/** Get all tables, optionally filtered by a project's allowed modules. */
export async function getAllTables(projectId?: number): Promise<TableDefinition[]> {
  const allowed = projectId != null ? await getAllowedModuleNames(projectId) : null;
  const tables = filterModules(allowed).flatMap((m) => m.tables);
  return tables.sort((a, b) => (a.importOrder ?? 100) - (b.importOrder ?? 100));
}

/** Get all relations, optionally filtered by a project's allowed modules. */
export async function getAllRelations(projectId?: number): Promise<RelationDefinition[]> {
  const allowed = projectId != null ? await getAllowedModuleNames(projectId) : null;
  return filterModules(allowed).flatMap((m) => m.relations);
}
