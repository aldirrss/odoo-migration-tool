/**
 * Validator: checks staged data against the target (fresh) DB configuration.
 *
 * Strategy:
 *   - For every non-deleted staged record, walk its outgoing relations
 *     (registry + heuristics) and verify each FK target exists in either the
 *     target DB or the staging DB (not soft-deleted).
 *   - Records with missing FK references are marked `fail`; records with no
 *     issues are marked `pass`.
 *
 * Persistence:
 *   - All progress is written to `extraction_jobs` so the UI can poll status
 *     even after a dev hot-reload (no in-process Map).
 *   - Per-chunk batched UPDATE via `UPDATE ... FROM (VALUES ...)` to avoid
 *     one roundtrip per row on million-row tables.
 *   - Keyset pagination so memory stays bounded and the cancel flag is
 *     checked between chunks.
 */

import { sql, eq, and, asc, gt } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getTargetPool } from "../db/target";
import type { ConnectionProfile } from "../db/profiles";
import { getAllTables, getAllRelations } from "../odoo/modules/project-scope";
import { inferFkRelation } from "../odoo/fk-heuristics";
import type { RelationDefinition } from "../odoo/types";

export interface ValidationMessage {
  field?: string;
  severity: "warning" | "error";
  message: string;
}

const CHUNK_SIZE = 1000;

async function isCancelRequested(jobId: number): Promise<boolean> {
  const rows = await stagingDb
    .select({ flag: schema.extractionJobs.validationCancelRequested })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.id, jobId))
    .limit(1);
  return rows[0]?.flag === true;
}

async function loadTargetIds(
  pool: import("pg").Pool,
  tableName: string,
): Promise<Set<number>> {
  try {
    const r = await pool.query<{ id: number }>(`SELECT id FROM "${tableName}"`);
    return new Set(r.rows.map((row) => row.id));
  } catch {
    return new Set();
  }
}

async function loadStagedIds(
  jobId: number,
  tableName: string,
): Promise<Set<number>> {
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
  return new Set(rows.map((r) => r.sourceId));
}

function collectFkTargets(
  tableName: string,
  declaredRelations: RelationDefinition[],
  sampleRows: Array<Record<string, unknown>>,
): RelationDefinition[] {
  const map = new Map<string, RelationDefinition>();
  for (const rel of declaredRelations) {
    map.set(`${rel.fromColumn}->${rel.toTable}`, rel);
  }
  const seenCols = new Set(declaredRelations.map((r) => r.fromColumn));
  for (const row of sampleRows) {
    for (const col of Object.keys(row)) {
      if (!/_id$/.test(col)) continue;
      if (seenCols.has(col)) continue;
      seenCols.add(col);
      const inferred = inferFkRelation(tableName, col);
      if (inferred) map.set(`${inferred.fromColumn}->${inferred.toTable}`, inferred);
    }
  }
  return Array.from(map.values());
}

export async function runValidation(
  jobId: number,
  targetProfile: ConnectionProfile,
  projectId: number,
): Promise<void> {
  const allTables = await getAllTables(projectId);

  // Only count and process records that are still pending — skip already
  // validated records so a re-run only handles new or unprocessed ones.
  const totalRecordsRes = await stagingDb.execute(sql`
    SELECT COUNT(*)::int AS total FROM staged_records
    WHERE extraction_job_id = ${jobId}
      AND is_deleted = false
      AND validation_status = 'pending'
  `);
  const totalRecords =
    (totalRecordsRes.rows[0] as { total: number } | undefined)?.total ?? 0;

  // Identify which tables actually have pending records so we can give an
  // accurate table count in the progress UI.
  const pendingTablesRes = await stagingDb.execute(sql`
    SELECT DISTINCT table_name FROM staged_records
    WHERE extraction_job_id = ${jobId}
      AND is_deleted = false
      AND validation_status = 'pending'
  `);
  const pendingTableNames = new Set(
    (pendingTablesRes.rows as Array<{ table_name: string }>).map((r) => r.table_name),
  );
  const tables = allTables.filter((t) => pendingTableNames.has(t.tableName));

  // Write accurate totals into the job row so the UI shows the right numbers.
  await stagingDb
    .update(schema.extractionJobs)
    .set({
      validationTotalTables: tables.length,
      validationTotalRecords: totalRecords,
      validationError: null,
    })
    .where(eq(schema.extractionJobs.id, jobId));

  const targetPool = getTargetPool(targetProfile);
  const allRelations = await getAllRelations(projectId);

  let cumulativeRecords = 0;

  try {
    for (const table of tables) {
      if (await isCancelRequested(jobId)) break;

      await stagingDb
        .update(schema.extractionJobs)
        .set({ validationCurrentTable: table.tableName })
        .where(eq(schema.extractionJobs.id, jobId));

      const declaredRelations = allRelations.filter(
        (r) => r.fromTable === table.tableName,
      );

      // Sample a few rows to discover inferred FK columns we should also check.
      const sample = await stagingDb
        .select({ stagedData: schema.stagedRecords.stagedData })
        .from(schema.stagedRecords)
        .where(
          and(
            eq(schema.stagedRecords.extractionJobId, jobId),
            eq(schema.stagedRecords.tableName, table.tableName),
            eq(schema.stagedRecords.isDeleted, false),
            eq(schema.stagedRecords.validationStatus, "pending"),
          ),
        )
        .limit(50);
      const sampleRows = sample.map(
        (r) => (r.stagedData ?? {}) as Record<string, unknown>,
      );

      const relations = collectFkTargets(
        table.tableName,
        declaredRelations,
        sampleRows,
      );

      // Pre-load the id pool for every distinct FK target table.
      const targets = new Set(relations.map((r) => r.toTable));
      const existingIds = new Map<string, Set<number>>();
      for (const target of targets) {
        const targetIds = await loadTargetIds(targetPool, target);
        const stagedIds = await loadStagedIds(jobId, target);
        const merged = new Set<number>(targetIds);
        for (const id of stagedIds) merged.add(id);
        existingIds.set(target, merged);
      }

      // Stream the table's records in keyset chunks. For each chunk, evaluate
      // findings in memory and persist with one batched UPDATE per chunk.
      let lastId = 0;
      while (true) {
        if (await isCancelRequested(jobId)) break;

        const chunk = await stagingDb
          .select({
            id: schema.stagedRecords.id,
            stagedData: schema.stagedRecords.stagedData,
          })
          .from(schema.stagedRecords)
          .where(
            and(
              eq(schema.stagedRecords.extractionJobId, jobId),
              eq(schema.stagedRecords.tableName, table.tableName),
              eq(schema.stagedRecords.isDeleted, false),
              eq(schema.stagedRecords.validationStatus, "pending"),
              gt(schema.stagedRecords.id, lastId),
            ),
          )
          .orderBy(asc(schema.stagedRecords.id))
          .limit(CHUNK_SIZE);

        if (chunk.length === 0) break;

        const tuples = chunk.map((rec) => {
          const data = (rec.stagedData ?? {}) as Record<string, unknown>;
          const messages: ValidationMessage[] = [];
          for (const rel of relations) {
            const value = data[rel.fromColumn];
            if (value == null) continue;
            const refId = Number(value);
            if (!Number.isFinite(refId) || refId <= 0) continue;
            const pool = existingIds.get(rel.toTable);
            if (!pool || !pool.has(refId)) {
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
          return {
            id: rec.id,
            status,
            messagesJson: messages.length ? JSON.stringify(messages) : null,
          };
        });

        const fragments = tuples.map(
          (t) =>
            sql`(${t.id}::int, ${t.status}::text, ${t.messagesJson === null ? sql`NULL` : sql`${t.messagesJson}`}::jsonb)`,
        );
        await stagingDb.execute(sql`
          UPDATE staged_records sr SET
            validation_status = c.status,
            validation_messages = c.messages
          FROM (VALUES ${sql.join(fragments, sql`, `)}) AS c(id, status, messages)
          WHERE sr.id = c.id
        `);

        cumulativeRecords += chunk.length;
        await stagingDb
          .update(schema.extractionJobs)
          .set({ validationProcessedRecords: cumulativeRecords })
          .where(eq(schema.extractionJobs.id, jobId));

        lastId = chunk[chunk.length - 1]!.id;
        if (chunk.length < CHUNK_SIZE) break;
      }

      await stagingDb
        .update(schema.extractionJobs)
        .set({
          validationProcessedTables: sql`${schema.extractionJobs.validationProcessedTables} + 1`,
        })
        .where(eq(schema.extractionJobs.id, jobId));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stagingDb
      .update(schema.extractionJobs)
      .set({ validationError: message })
      .where(eq(schema.extractionJobs.id, jobId));
    throw err;
  } finally {
    await stagingDb
      .update(schema.extractionJobs)
      .set({
        validationRunning: false,
        validationCurrentTable: null,
      })
      .where(eq(schema.extractionJobs.id, jobId));
  }
}

export interface ValidationRunState {
  jobId: number;
  running: boolean;
  currentTable: string | null;
  processedTables: number;
  totalTables: number;
  processedRecords: number;
  totalRecords: number;
  cancelRequested: boolean;
  error: string | null;
}

export async function getValidationState(
  jobId: number,
): Promise<ValidationRunState | null> {
  const rows = await stagingDb
    .select({
      id: schema.extractionJobs.id,
      running: schema.extractionJobs.validationRunning,
      currentTable: schema.extractionJobs.validationCurrentTable,
      processedTables: schema.extractionJobs.validationProcessedTables,
      totalTables: schema.extractionJobs.validationTotalTables,
      processedRecords: schema.extractionJobs.validationProcessedRecords,
      totalRecords: schema.extractionJobs.validationTotalRecords,
      cancelRequested: schema.extractionJobs.validationCancelRequested,
      error: schema.extractionJobs.validationError,
    })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.id, jobId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    jobId: row.id,
    running: row.running,
    currentTable: row.currentTable,
    processedTables: row.processedTables,
    totalTables: row.totalTables,
    processedRecords: row.processedRecords,
    totalRecords: row.totalRecords,
    cancelRequested: row.cancelRequested,
    error: row.error,
  };
}

export async function requestValidationCancel(jobId: number): Promise<void> {
  await stagingDb
    .update(schema.extractionJobs)
    .set({ validationCancelRequested: true })
    .where(eq(schema.extractionJobs.id, jobId));
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
