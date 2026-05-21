/**
 * Auto-discovery of Odoo modules, tables, and relations from the source DB.
 * Persists results into discovered_modules/discovered_tables/discovered_relations.
 */

import { eq, and } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getSourcePool } from "../db/source";
import type { ConnectionProfile } from "../db/profiles";
import { findTable } from "../odoo/modules";

export interface DiscoveryResult {
  modulesDiscovered: number;
  tablesDiscovered: number;
  relationsDiscovered: number;
}

interface ColumnMeta {
  name: string;
  label: string;
  type: string;
}

const TRANSACTION_DATE_COLS_HIGH = [
  "date",
  "date_order",
  "invoice_date",
  "picking_date",
];

interface ClassifyResult {
  type: "master" | "transaction";
  confidence: "high" | "medium" | "low";
  dateFilterColumn: string | null;
}

function classify(columns: ColumnMeta[]): ClassifyResult {
  const colNames = columns.map((c) => c.name);
  const high = TRANSACTION_DATE_COLS_HIGH.find((c) => colNames.includes(c));
  if (high) {
    return { type: "transaction", confidence: "high", dateFilterColumn: high };
  }
  const medium = colNames.find((n) => /_date$/.test(n));
  if (medium) {
    return { type: "transaction", confidence: "medium", dateFilterColumn: medium };
  }
  return { type: "master", confidence: "high", dateFilterColumn: null };
}

export async function runDiscovery(
  projectId: number,
  sourceProfile: ConnectionProfile,
): Promise<DiscoveryResult> {
  const pool = getSourcePool(sourceProfile);

  const modulesResult = await pool.query<{
    name: string;
    shortdesc: string | null;
  }>(
    `SELECT name, shortdesc FROM ir_module_module WHERE state = 'installed' ORDER BY name`,
  );

  let modulesDiscovered = 0;
  let tablesDiscovered = 0;
  let relationsDiscovered = 0;

  for (const mod of modulesResult.rows) {
    const moduleName = mod.name;
    const moduleLabel = mod.shortdesc ?? moduleName;

    // Upsert discoveredModule, preserve enabled on update
    const existingModule = await stagingDb
      .select()
      .from(schema.discoveredModules)
      .where(
        and(
          eq(schema.discoveredModules.projectId, projectId),
          eq(schema.discoveredModules.name, moduleName),
        ),
      )
      .limit(1);

    let moduleId: number;
    if (existingModule[0]) {
      const [updated] = await stagingDb
        .update(schema.discoveredModules)
        .set({
          label: moduleLabel,
          installed: true,
          discoveredAt: new Date(),
        })
        .where(eq(schema.discoveredModules.id, existingModule[0].id))
        .returning();
      moduleId = updated!.id;
    } else {
      const [inserted] = await stagingDb
        .insert(schema.discoveredModules)
        .values({
          projectId,
          name: moduleName,
          label: moduleLabel,
          installed: true,
          enabled: false,
        })
        .returning();
      moduleId = inserted!.id;
      modulesDiscovered += 1;
    }

    // Find Odoo models attributed to this module
    const modelsResult = await pool.query<{ model: string; label: string }>(
      `SELECT im.model AS model, im.name AS label
         FROM ir_model im
         JOIN ir_model_data imd ON imd.res_id = im.id AND imd.model = 'ir.model'
        WHERE imd.module = $1`,
      [moduleName],
    );

    for (const m of modelsResult.rows) {
      const tableName = m.model.replace(/\./g, "_");

      // Skip if already in built-in registry
      if (findTable(tableName)) continue;

      // Verify table exists
      const existsRes = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
         ) AS exists`,
        [tableName],
      );
      if (!existsRes.rows[0]?.exists) continue;

      // Fetch columns
      const colsRes = await pool.query<{
        column_name: string;
        data_type: string;
      }>(
        `SELECT column_name, data_type
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [tableName],
      );
      const columns: ColumnMeta[] = colsRes.rows.map((r) => ({
        name: r.column_name,
        label: r.column_name,
        type: r.data_type,
      }));
      if (columns.length === 0) continue;

      const cls = classify(columns);
      const defaultImportOrder = cls.type === "master" ? 200 : 600;

      const existingTable = await stagingDb
        .select()
        .from(schema.discoveredTables)
        .where(
          and(
            eq(schema.discoveredTables.projectId, projectId),
            eq(schema.discoveredTables.tableName, tableName),
          ),
        )
        .limit(1);

      if (existingTable[0]) {
        // Preserve user edits when userClassified=true
        if (!existingTable[0].userClassified) {
          await stagingDb
            .update(schema.discoveredTables)
            .set({
              moduleId,
              odooModel: m.model,
              type: cls.type,
              dateFilterColumn: cls.dateFilterColumn,
              columns,
              confidence: cls.confidence,
            })
            .where(eq(schema.discoveredTables.id, existingTable[0].id));
        } else {
          // Only refresh columns + module link
          await stagingDb
            .update(schema.discoveredTables)
            .set({ moduleId, columns })
            .where(eq(schema.discoveredTables.id, existingTable[0].id));
        }
      } else {
        await stagingDb.insert(schema.discoveredTables).values({
          projectId,
          moduleId,
          tableName,
          odooModel: m.model,
          type: cls.type,
          dateFilterColumn: cls.dateFilterColumn,
          importOrder: defaultImportOrder,
          columns,
          confidence: cls.confidence,
          userClassified: false,
          enabled: false,
        });
        tablesDiscovered += 1;
      }

      // FK relations FROM this table
      const fkRes = await pool.query<{
        constraint_name: string;
        from_column: string;
        to_table: string;
        to_column: string;
      }>(
        `SELECT
           tc.constraint_name,
           kcu.column_name AS from_column,
           ccu.table_name  AS to_table,
           ccu.column_name AS to_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema    = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_name = $1`,
        [tableName],
      );

      for (const fk of fkRes.rows) {
        const existingRel = await stagingDb
          .select()
          .from(schema.discoveredRelations)
          .where(
            and(
              eq(schema.discoveredRelations.projectId, projectId),
              eq(schema.discoveredRelations.fromTable, tableName),
              eq(schema.discoveredRelations.fromColumn, fk.from_column),
              eq(schema.discoveredRelations.toTable, fk.to_table),
              eq(schema.discoveredRelations.toColumn, fk.to_column),
            ),
          )
          .limit(1);

        if (!existingRel[0]) {
          await stagingDb.insert(schema.discoveredRelations).values({
            projectId,
            fromTable: tableName,
            fromColumn: fk.from_column,
            toTable: fk.to_table,
            toColumn: fk.to_column,
            onDelete: "block",
            source: "introspect",
          });
          relationsDiscovered += 1;
        }
      }
    }
  }

  return { modulesDiscovered, tablesDiscovered, relationsDiscovered };
}
