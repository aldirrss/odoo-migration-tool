/**
 * Project-scoped helpers exposing user-confirmed discovered tables/relations
 * in the shape of the built-in registry. NOT yet wired into the extractor.
 */

import { and, eq, asc } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import type { TableDefinition, RelationDefinition, OnDeleteAction } from "./types";

export async function getDiscoveredTables(
  projectId: number,
): Promise<TableDefinition[]> {
  const rows = await stagingDb
    .select()
    .from(schema.discoveredTables)
    .where(
      and(
        eq(schema.discoveredTables.projectId, projectId),
        eq(schema.discoveredTables.enabled, true),
      ),
    )
    .orderBy(asc(schema.discoveredTables.importOrder));

  return rows.map((row) => ({
    tableName: row.tableName,
    odooModel: row.odooModel,
    label: row.odooModel,
    type: row.type as "master" | "transaction",
    dateFilterColumn: row.dateFilterColumn ?? undefined,
    importOrder: row.importOrder,
    columns: (row.columns as Array<{ name: string; label: string }>).map((c) => ({
      name: c.name,
      label: c.label,
    })),
  }));
}

export async function getDiscoveredRelations(
  projectId: number,
): Promise<RelationDefinition[]> {
  const rows = await stagingDb
    .select()
    .from(schema.discoveredRelations)
    .where(eq(schema.discoveredRelations.projectId, projectId));

  return rows.map((row) => ({
    fromTable: row.fromTable,
    fromColumn: row.fromColumn,
    toTable: row.toTable,
    toColumn: row.toColumn,
    onDelete: row.onDelete as OnDeleteAction,
  }));
}
