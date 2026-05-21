/**
 * Importer: writes cleaned staging data into the target (fresh) Odoo PostgreSQL DB.
 *
 * Strategy:
 *   - Tables are processed in order of `importOrder` (master first, transactions last)
 *     so foreign-key dependencies are resolved in sequence.
 *   - For each record, we issue an INSERT ... ON CONFLICT (id) DO NOTHING
 *     to allow re-running the importer safely.
 *   - System columns that the target DB autogenerates (create_uid, create_date,
 *     write_uid, write_date) are still copied — Odoo's ORM normally fills these,
 *     but since we're bypassing ORM we preserve the originals.
 *   - Each row's import result is logged back to staged_records.import_status.
 */

import { sql, eq, and, asc } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getTargetPool } from "../db/target";
import type { ConnectionProfile } from "../db/profiles";
import { getAllTables } from "../odoo/modules/project-scope";
import type { TableDefinition } from "../odoo/types";

export interface ImportProgress {
  tableName: string;
  total: number;
  success: number;
  errors: number;
  skipped: number;
  blocked: number;
  current?: number;
}

export async function runImport(
  projectId: number,
  jobId: number,
  targetProfile: ConnectionProfile,
  options: { skipFailedValidation?: boolean } = {},
  onProgress?: (p: ImportProgress) => void,
): Promise<{
  importJobId: number;
  totalRecords: number;
  successCount: number;
  errorCount: number;
  blockedCount: number;
}> {
  const skipFailedValidation = options.skipFailedValidation ?? true;

  const [importJob] = await stagingDb
    .insert(schema.importJobs)
    .values({
      projectId,
      extractionJobId: jobId,
      status: "running",
    })
    .returning();
  if (!importJob) throw new Error("Failed to create import job");

  const tables = await getAllTables(projectId);
  const pool = getTargetPool(targetProfile);

  let totalRecords = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalBlocked = 0;

  try {
    for (const table of tables) {
      const summary = await importTable(
        jobId,
        table,
        pool,
        skipFailedValidation,
        onProgress,
      );
      totalRecords += summary.total;
      totalSuccess += summary.success;
      totalErrors += summary.errors;
      totalBlocked += summary.blocked;
    }

    await stagingDb
      .update(schema.importJobs)
      .set({
        status: totalErrors === 0 ? "done" : "done_with_errors",
        finishedAt: new Date(),
        totalRecords,
        successCount: totalSuccess,
        errorCount: totalErrors,
      })
      .where(eq(schema.importJobs.id, importJob.id));
  } catch (err) {
    await stagingDb
      .update(schema.importJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(schema.importJobs.id, importJob.id));
    throw err;
  }

  return {
    importJobId: importJob.id,
    totalRecords,
    successCount: totalSuccess,
    errorCount: totalErrors,
    blockedCount: totalBlocked,
  };
}

async function importTable(
  jobId: number,
  table: TableDefinition,
  pool: import("pg").Pool,
  skipFailedValidation: boolean,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const records = await stagingDb
    .select()
    .from(schema.stagedRecords)
    .where(
      and(
        eq(schema.stagedRecords.extractionJobId, jobId),
        eq(schema.stagedRecords.tableName, table.tableName),
        eq(schema.stagedRecords.isDeleted, false),
      ),
    )
    .orderBy(asc(schema.stagedRecords.sourceId));

  const progress: ImportProgress = {
    tableName: table.tableName,
    total: records.length,
    success: 0,
    errors: 0,
    skipped: 0,
    blocked: 0,
  };

  if (records.length === 0) {
    onProgress?.(progress);
    return progress;
  }

  // Discover target columns once per table
  let targetColumns: Set<string>;
  try {
    targetColumns = await getTableColumns(pool, table.tableName);
  } catch (err) {
    // Target table doesn't exist — skip
    progress.skipped = records.length;
    for (const r of records) {
      await stagingDb
        .update(schema.stagedRecords)
        .set({
          importStatus: "skipped",
          importError: `Target table missing: ${err instanceof Error ? err.message : String(err)}`,
        })
        .where(eq(schema.stagedRecords.id, r.id));
    }
    onProgress?.(progress);
    return progress;
  }

  const client = await pool.connect();
  try {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      progress.current = i + 1;

      if (skipFailedValidation && rec.validationStatus === "fail") {
        progress.skipped++;
        await stagingDb
          .update(schema.stagedRecords)
          .set({ importStatus: "skipped", importError: "Failed validation" })
          .where(eq(schema.stagedRecords.id, rec.id));
        continue;
      }

      if (rec.qualitySeverity === "block" && !rec.qualityOverridden) {
        progress.blocked++;
        await stagingDb
          .update(schema.stagedRecords)
          .set({
            importStatus: "skipped",
            importError: "Blocked by quality rule (not acknowledged)",
          })
          .where(eq(schema.stagedRecords.id, rec.id));
        continue;
      }

      const data = rec.stagedData as Record<string, unknown>;
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (targetColumns.has(k)) filtered[k] = v;
      }

      if (Object.keys(filtered).length === 0) {
        progress.skipped++;
        await stagingDb
          .update(schema.stagedRecords)
          .set({ importStatus: "skipped", importError: "No matching columns in target" })
          .where(eq(schema.stagedRecords.id, rec.id));
        continue;
      }

      const columns = Object.keys(filtered);
      const placeholders = columns.map((_, idx) => `$${idx + 1}`);
      const values = columns.map((c) => filtered[c]);

      const query = `INSERT INTO "${table.tableName}" (${columns
        .map((c) => `"${c}"`)
        .join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT (id) DO NOTHING`;

      try {
        await client.query(query, values);
        progress.success++;
        await stagingDb
          .update(schema.stagedRecords)
          .set({ importStatus: "success", importError: null })
          .where(eq(schema.stagedRecords.id, rec.id));
      } catch (err) {
        progress.errors++;
        const message = err instanceof Error ? err.message : String(err);
        await stagingDb
          .update(schema.stagedRecords)
          .set({ importStatus: "error", importError: message })
          .where(eq(schema.stagedRecords.id, rec.id));
      }
    }

    // Reset sequence to MAX(id) + 1 after import (so future inserts via Odoo work)
    if (progress.success > 0) {
      try {
        await client.query(`SELECT setval(
          pg_get_serial_sequence('"${table.tableName}"', 'id'),
          COALESCE((SELECT MAX(id) FROM "${table.tableName}"), 1),
          true
        )`);
      } catch {
        // Some tables may not have a serial column; ignore
      }
    }
  } finally {
    client.release();
  }

  onProgress?.(progress);
  return progress;
}

async function getTableColumns(
  pool: import("pg").Pool,
  tableName: string,
): Promise<Set<string>> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tableName],
  );
  if (result.rows.length === 0) {
    throw new Error(`Table "${tableName}" not found in target database`);
  }
  return new Set(result.rows.map((r) => r.column_name));
}

export async function getImportSummary(jobId: number) {
  const rows = await stagingDb.execute(sql`
    SELECT
      table_name,
      COUNT(*)::int AS total,
      SUM(CASE WHEN import_status = 'success' THEN 1 ELSE 0 END)::int AS success,
      SUM(CASE WHEN import_status = 'error' THEN 1 ELSE 0 END)::int AS errors,
      SUM(CASE WHEN import_status = 'skipped' THEN 1 ELSE 0 END)::int AS skipped,
      SUM(CASE WHEN import_status = 'pending' THEN 1 ELSE 0 END)::int AS pending
    FROM staged_records
    WHERE extraction_job_id = ${jobId}
      AND is_deleted = false
    GROUP BY table_name
    ORDER BY table_name
  `);
  return rows.rows as Array<{
    table_name: string;
    total: number;
    success: number;
    errors: number;
    skipped: number;
    pending: number;
  }>;
}

export async function getLatestImportJob(projectId?: number) {
  const query = stagingDb.select().from(schema.importJobs);
  const filtered = projectId != null
    ? query.where(eq(schema.importJobs.projectId, projectId))
    : query;
  const rows = await filtered
    .orderBy(sql`${schema.importJobs.startedAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}
