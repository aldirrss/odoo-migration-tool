/**
 * Auto-discovery of Odoo modules, tables, and relations from the source DB.
 *
 * Strategy: bulk queries against pg_catalog (much faster than information_schema
 * on large Odoo DBs) and bulk upserts into the staging tables. Replaces the
 * previous per-table loop that issued ~5000 queries on a 1000-table source DB.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getSourcePool } from "../db/source";
import type { ConnectionProfile } from "../db/profiles";
import { findTable } from "../odoo/modules";
import { inferModuleSlug, inferTableType } from "../odoo/prefix-mapping";
import type { Pool } from "pg";

export interface DiscoveryResult {
  modulesDiscovered: number;
  tablesDiscovered: number;
  relationsDiscovered: number;
}

export interface DiscoveryPreview {
  installedModules: number;
  candidateModels: number;
}

interface ColumnMeta {
  name: string;
  label: string;
  type: string;
}

interface ClassifyResult {
  type: "master" | "transaction";
  confidence: "high" | "medium" | "low";
  dateFilterColumn: string | null;
}

const TRANSACTION_DATE_COLS_HIGH = [
  "date",
  "date_order",
  "invoice_date",
  "picking_date",
];

function classify(columns: ColumnMeta[]): ClassifyResult {
  const colNames = columns.map((c) => c.name);
  const high = TRANSACTION_DATE_COLS_HIGH.find((c) => colNames.includes(c));
  if (high) {
    return { type: "transaction", confidence: "high", dateFilterColumn: high };
  }
  const medium = colNames.find((n) => /_date$/.test(n));
  if (medium) {
    return {
      type: "transaction",
      confidence: "medium",
      dateFilterColumn: medium,
    };
  }
  return { type: "master", confidence: "high", dateFilterColumn: null };
}

/**
 * Lightweight pre-scan summary so the UI can show the user what they're about
 * to do before committing to a full scan.
 */
export async function previewDiscovery(
  sourceProfile: ConnectionProfile,
): Promise<DiscoveryPreview> {
  const pool = getSourcePool(sourceProfile);
  const result = await pool.query<{
    installed_modules: string;
    candidate_models: string;
  }>(
    `SELECT
       (SELECT count(*) FROM ir_module_module WHERE state = 'installed') AS installed_modules,
       (SELECT count(*)
          FROM ir_model im
          JOIN ir_model_data imd
            ON imd.res_id = im.id AND imd.model = 'ir.model'
          JOIN ir_module_module mm ON mm.name = imd.module
         WHERE mm.state = 'installed') AS candidate_models`,
  );
  const row = result.rows[0];
  return {
    installedModules: Number(row?.installed_modules ?? 0),
    candidateModels: Number(row?.candidate_models ?? 0),
  };
}

export async function runDiscovery(
  projectId: number,
  sourceProfile: ConnectionProfile,
): Promise<DiscoveryResult> {
  const pool = getSourcePool(sourceProfile);

  const modulesRows = await fetchInstalledModules(pool);
  if (modulesRows.length === 0) {
    return { modulesDiscovered: 0, tablesDiscovered: 0, relationsDiscovered: 0 };
  }

  const moduleNames = modulesRows.map((m) => m.name);
  const modelRows = await fetchModelsForModules(pool, moduleNames);

  // Build candidate set: map physical table name -> { model, moduleName }.
  // Skip tables already provided by the built-in registry.
  const candidates = new Map<string, { model: string; moduleName: string }>();
  for (const m of modelRows) {
    const tableName = m.model.replace(/\./g, "_");
    if (findTable(tableName)) continue;
    if (candidates.has(tableName)) continue;
    candidates.set(tableName, { model: m.model, moduleName: m.module });
  }
  const candidateTableNames = Array.from(candidates.keys());

  // Bulk-fetch columns for all candidates. Implicitly drops tables that don't
  // physically exist in public schema (abstract models, transient models).
  const columnsByTable = await fetchColumnsBulk(pool, candidateTableNames);

  // Build the final per-table set: must have columns AND have an `id` column
  // (skip many2many relation tables and abstract bases that lack a PK).
  type ResolvedTable = {
    tableName: string;
    odooModel: string;
    moduleName: string;
    columns: ColumnMeta[];
    classification: ClassifyResult;
  };
  const resolvedTables: ResolvedTable[] = [];
  for (const tableName of candidateTableNames) {
    const cols = columnsByTable.get(tableName);
    if (!cols || cols.length === 0) continue;
    if (!cols.some((c) => c.name === "id")) continue;
    const meta = candidates.get(tableName)!;
    resolvedTables.push({
      tableName,
      odooModel: meta.model,
      moduleName: meta.moduleName,
      columns: cols,
      classification: classify(cols),
    });
  }

  const resolvedTableNames = resolvedTables.map((t) => t.tableName);
  const fkRows = await fetchForeignKeysBulk(pool, resolvedTableNames);

  // ------- Persist into staging within a single transaction with LOCK -------
  return stagingDb.transaction(async (tx) => {
    // Serialize concurrent scans for the same project (and across projects;
    // the lock is short-lived because all work below is bulk).
    await tx.execute(sql`LOCK TABLE discovered_modules IN EXCLUSIVE MODE`);

    // 1. Upsert all installed modules.
    const beforeModuleRows = await tx
      .select({ name: schema.discoveredModules.name })
      .from(schema.discoveredModules)
      .where(eq(schema.discoveredModules.projectId, projectId));
    const beforeModuleNames = new Set(beforeModuleRows.map((r) => r.name));

    await tx
      .insert(schema.discoveredModules)
      .values(
        modulesRows.map((m) => ({
          projectId,
          name: m.name,
          label: m.shortdesc ?? m.name,
          installed: true,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.discoveredModules.projectId,
          schema.discoveredModules.name,
        ],
        set: {
          label: sql`excluded.label`,
          installed: sql`excluded.installed`,
          discoveredAt: sql`now()`,
        },
      });

    const modulesDiscovered = modulesRows.filter(
      (m) => !beforeModuleNames.has(m.name),
    ).length;

    // 2. Fetch resulting module IDs so we can wire moduleId on tables.
    const moduleIdRows = await tx
      .select({
        id: schema.discoveredModules.id,
        name: schema.discoveredModules.name,
      })
      .from(schema.discoveredModules)
      .where(eq(schema.discoveredModules.projectId, projectId));
    const moduleIdByName = new Map<string, number>();
    for (const r of moduleIdRows) moduleIdByName.set(r.name, r.id);

    // 3. Bulk upsert tables. Preserve user-classified rows' classification.
    let tablesDiscovered = 0;
    if (resolvedTables.length > 0) {
      const beforeTableRows = await tx
        .select({ tableName: schema.discoveredTables.tableName })
        .from(schema.discoveredTables)
        .where(eq(schema.discoveredTables.projectId, projectId));
      const beforeTableNames = new Set(beforeTableRows.map((r) => r.tableName));

      const tableValues = resolvedTables
        .map((t) => {
          const moduleId = moduleIdByName.get(t.moduleName);
          if (moduleId == null) return null;
          return {
            projectId,
            moduleId,
            tableName: t.tableName,
            odooModel: t.odooModel,
            type: t.classification.type,
            dateFilterColumn: t.classification.dateFilterColumn,
            importOrder: t.classification.type === "master" ? 200 : 600,
            columns: t.columns,
            confidence: t.classification.confidence,
            moduleSlug: inferModuleSlug(t.tableName),
            tableType: inferTableType(t.columns),
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      const userClassifiedCol = schema.discoveredTables.userClassified;
      for (const chunk of chunked(tableValues, 500)) {
        await tx
          .insert(schema.discoveredTables)
          .values(chunk)
          .onConflictDoUpdate({
            target: [
              schema.discoveredTables.projectId,
              schema.discoveredTables.tableName,
            ],
            set: {
              moduleId: sql`excluded.module_id`,
              odooModel: sql`excluded.odoo_model`,
              type: sql`CASE WHEN ${userClassifiedCol} THEN ${schema.discoveredTables.type} ELSE excluded.type END`,
              dateFilterColumn: sql`CASE WHEN ${userClassifiedCol} THEN ${schema.discoveredTables.dateFilterColumn} ELSE excluded.date_filter_column END`,
              columns: sql`excluded.columns`,
              confidence: sql`CASE WHEN ${userClassifiedCol} THEN ${schema.discoveredTables.confidence} ELSE excluded.confidence END`,
              moduleSlug: sql`CASE WHEN ${userClassifiedCol} THEN ${schema.discoveredTables.moduleSlug} ELSE excluded.module_slug END`,
              tableType: sql`CASE WHEN ${userClassifiedCol} THEN ${schema.discoveredTables.tableType} ELSE excluded.table_type END`,
            },
          });
      }

      tablesDiscovered = resolvedTables.filter(
        (t) => !beforeTableNames.has(t.tableName),
      ).length;
    }

    // 4. Insert NEW relations only (never overwrite user-edited onDelete).
    let relationsDiscovered = 0;
    if (fkRows.length > 0) {
      const existingRels = await tx
        .select({
          fromTable: schema.discoveredRelations.fromTable,
          fromColumn: schema.discoveredRelations.fromColumn,
          toTable: schema.discoveredRelations.toTable,
          toColumn: schema.discoveredRelations.toColumn,
        })
        .from(schema.discoveredRelations)
        .where(eq(schema.discoveredRelations.projectId, projectId));
      const existingKey = new Set(
        existingRels.map(
          (r) => `${r.fromTable}|${r.fromColumn}|${r.toTable}|${r.toColumn}`,
        ),
      );

      const newRelations = fkRows.filter(
        (fk) =>
          !existingKey.has(
            `${fk.from_table}|${fk.from_column}|${fk.to_table}|${fk.to_column}`,
          ),
      );
      const seen = new Set<string>();
      const dedupedNewRelations = newRelations.filter((fk) => {
        const k = `${fk.from_table}|${fk.from_column}|${fk.to_table}|${fk.to_column}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (dedupedNewRelations.length > 0) {
        for (const chunk of chunked(dedupedNewRelations, 500)) {
          await tx.insert(schema.discoveredRelations).values(
            chunk.map((fk) => ({
              projectId,
              fromTable: fk.from_table,
              fromColumn: fk.from_column,
              toTable: fk.to_table,
              toColumn: fk.to_column,
              onDelete: "block" as const,
              source: "introspect" as const,
            })),
          );
        }
        relationsDiscovered = dedupedNewRelations.length;
      }
    }

    return { modulesDiscovered, tablesDiscovered, relationsDiscovered };
  });
}

// -------------------------- source-DB queries --------------------------

async function fetchInstalledModules(
  pool: Pool,
): Promise<Array<{ name: string; shortdesc: string | null }>> {
  const result = await pool.query<{ name: string; shortdesc: string | null }>(
    `SELECT name, shortdesc
       FROM ir_module_module
      WHERE state = 'installed'
      ORDER BY name`,
  );
  return result.rows;
}

async function fetchModelsForModules(
  pool: Pool,
  moduleNames: string[],
): Promise<Array<{ module: string; model: string; label: string }>> {
  if (moduleNames.length === 0) return [];
  const result = await pool.query<{
    module: string;
    model: string;
    label: string;
  }>(
    `SELECT imd.module, im.model, im.name AS label
       FROM ir_model im
       JOIN ir_model_data imd
         ON imd.res_id = im.id AND imd.model = 'ir.model'
      WHERE imd.module = ANY($1::text[])`,
    [moduleNames],
  );
  return result.rows;
}

/**
 * Bulk-fetch column metadata from pg_catalog for all candidate tables in one
 * round-trip. Returns Map<tableName, ColumnMeta[]>. Tables that don't exist in
 * public schema simply won't appear in the map.
 */
async function fetchColumnsBulk(
  pool: Pool,
  tableNames: string[],
): Promise<Map<string, ColumnMeta[]>> {
  const out = new Map<string, ColumnMeta[]>();
  if (tableNames.length === 0) return out;
  const result = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    ordinal: number;
  }>(
    `SELECT
       c.relname  AS table_name,
       a.attname  AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnum   AS ordinal
     FROM pg_attribute a
     JOIN pg_class c     ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY($1::text[])
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`,
    [tableNames],
  );
  for (const row of result.rows) {
    const existing = out.get(row.table_name);
    const entry: ColumnMeta = {
      name: row.column_name,
      label: row.column_name,
      type: row.data_type,
    };
    if (existing) existing.push(entry);
    else out.set(row.table_name, [entry]);
  }
  return out;
}

/**
 * Bulk-fetch foreign-key constraints from pg_catalog for all candidate tables
 * in one round-trip.
 */
async function fetchForeignKeysBulk(
  pool: Pool,
  tableNames: string[],
): Promise<
  Array<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
  }>
> {
  if (tableNames.length === 0) return [];
  const result = await pool.query<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
  }>(
    `SELECT
       c.relname  AS from_table,
       a.attname  AS from_column,
       cf.relname AS to_table,
       af.attname AS to_column
     FROM pg_constraint pc
     JOIN pg_class c       ON c.oid  = pc.conrelid
     JOIN pg_class cf      ON cf.oid = pc.confrelid
     JOIN pg_namespace n   ON n.oid  = c.relnamespace
     JOIN unnest(pc.conkey)  WITH ORDINALITY AS k(attnum, ord)  ON true
     JOIN unnest(pc.confkey) WITH ORDINALITY AS kf(attnum, ord) ON kf.ord = k.ord
     JOIN pg_attribute a   ON a.attrelid  = pc.conrelid  AND a.attnum  = k.attnum
     JOIN pg_attribute af  ON af.attrelid = pc.confrelid AND af.attnum = kf.attnum
     WHERE pc.contype = 'f'
       AND n.nspname  = 'public'
       AND c.relname  = ANY($1::text[])`,
    [tableNames],
  );
  return result.rows;
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size);
  }
}
