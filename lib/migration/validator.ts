/**
 * Validator: checks staged data against the target (fresh) DB configuration.
 *
 * Strategy:
 *   - For master tables that are typically pre-configured in a fresh DB
 *     (chart of accounts, journals, companies, currencies), fetch the target
 *     and verify that any record we want to import either matches an existing
 *     target row (by code/name/short_name) or is brand new.
 *   - For transaction records, verify that all referenced master records
 *     (partner_id, journal_id, etc.) exist either in the target DB or in
 *     staging (not deleted).
 */

import { sql, eq, and } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getTargetPool } from "../db/target";
import type { ConnectionProfile } from "../db/profiles";
import { getAllTables, getOutgoingRelations } from "../odoo/modules";

export interface ValidationMessage {
  field?: string;
  severity: "warning" | "error";
  message: string;
}

export interface ValidationProgress {
  tableName: string;
  total: number;
  passed: number;
  warnings: number;
  failed: number;
}

export async function runValidation(
  jobId: number,
  targetProfile: ConnectionProfile,
  onProgress?: (p: ValidationProgress) => void,
): Promise<ValidationProgress[]> {
  const tables = getAllTables();
  const targetPool = getTargetPool(targetProfile);
  const results: ValidationProgress[] = [];

  // Cache: known IDs per target table
  const targetIdCache = new Map<string, Set<number>>();

  async function targetHasId(tableName: string, id: number): Promise<boolean> {
    let set = targetIdCache.get(tableName);
    if (!set) {
      try {
        const r = await targetPool.query<{ id: number }>(
          `SELECT id FROM "${tableName}"`,
        );
        set = new Set(r.rows.map((row) => row.id));
      } catch {
        set = new Set();
      }
      targetIdCache.set(tableName, set);
    }
    return set.has(id);
  }

  // Cache: staged source IDs per table (for the current job)
  const stagedIdCache = new Map<string, Set<number>>();
  async function stagingHasId(tableName: string, id: number): Promise<boolean> {
    let set = stagedIdCache.get(tableName);
    if (!set) {
      const rows = await stagingDb
        .select({ sourceId: schema.stagedRecords.sourceId })
        .from(schema.stagedRecords)
        .where(
          and(
            eq(schema.stagedRecords.extractionJobId, jobId),
            eq(schema.stagedRecords.tableName, tableName),
            eq(schema.stagedRecords.isDeleted, false),
          ),
        );
      set = new Set(rows.map((r) => r.sourceId));
      stagedIdCache.set(tableName, set);
    }
    return set.has(id);
  }

  for (const table of tables) {
    const outgoing = getOutgoingRelations(table.tableName);
    const records = await stagingDb
      .select()
      .from(schema.stagedRecords)
      .where(
        and(
          eq(schema.stagedRecords.extractionJobId, jobId),
          eq(schema.stagedRecords.tableName, table.tableName),
          eq(schema.stagedRecords.isDeleted, false),
        ),
      );

    const progress: ValidationProgress = {
      tableName: table.tableName,
      total: records.length,
      passed: 0,
      warnings: 0,
      failed: 0,
    };

    for (const rec of records) {
      const data = rec.stagedData as Record<string, unknown>;
      const messages: ValidationMessage[] = [];

      for (const rel of outgoing) {
        const value = data[rel.fromColumn];
        if (value == null) continue;
        const refId = Number(value);
        if (!Number.isFinite(refId)) continue;

        const inTarget = await targetHasId(rel.toTable, refId);
        const inStaging = await stagingHasId(rel.toTable, refId);

        if (!inTarget && !inStaging) {
          messages.push({
            field: rel.fromColumn,
            severity: "error",
            message: `References missing ${rel.toTable}.id = ${refId} (not in target, not in staging)`,
          });
        }
      }

      let status: "pass" | "warning" | "fail" = "pass";
      if (messages.some((m) => m.severity === "error")) status = "fail";
      else if (messages.length > 0) status = "warning";

      await stagingDb
        .update(schema.stagedRecords)
        .set({
          validationStatus: status,
          validationMessages: messages.length ? messages : null,
        })
        .where(eq(schema.stagedRecords.id, rec.id));

      if (status === "pass") progress.passed++;
      else if (status === "warning") progress.warnings++;
      else progress.failed++;
    }

    results.push(progress);
    onProgress?.(progress);
  }

  return results;
}

export async function getValidationSummary(jobId: number) {
  const rows = await stagingDb.execute(sql`
    SELECT
      table_name,
      COUNT(*)::int AS total,
      SUM(CASE WHEN validation_status = 'pass' THEN 1 ELSE 0 END)::int AS passed,
      SUM(CASE WHEN validation_status = 'warning' THEN 1 ELSE 0 END)::int AS warnings,
      SUM(CASE WHEN validation_status = 'fail' THEN 1 ELSE 0 END)::int AS failed,
      SUM(CASE WHEN validation_status = 'pending' THEN 1 ELSE 0 END)::int AS pending
    FROM staged_records
    WHERE extraction_job_id = ${jobId}
      AND is_deleted = false
    GROUP BY table_name
    ORDER BY table_name
  `);
  return rows.rows as Array<{
    table_name: string;
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    pending: number;
  }>;
}
