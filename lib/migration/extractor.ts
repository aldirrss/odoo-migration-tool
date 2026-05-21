/**
 * Extractor: copies data from source PostgreSQL into staging.
 *
 * Workflow:
 *   1. Create an extraction_job row.
 *   2. For each table in moduleRegistry:
 *      - Create a table_extraction_status row.
 *      - SELECT * from source.<table> with optional date filter.
 *      - Insert one row per source record into staged_records.
 *      - Update status (done / failed).
 *   3. Mark the extraction_job as done.
 */

import { sql } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getSourcePool } from "../db/source";
import type { ConnectionProfile } from "../db/profiles";
import { getAllTables } from "../odoo/modules";
import type { TableDefinition } from "../odoo/types";

const TRANSACTION_DATE_FROM = process.env.TRANSACTION_DATE_FROM || "2026-01-01";

export interface ExtractionProgress {
  jobId: number;
  tableName: string;
  status: "running" | "done" | "failed";
  recordCount: number;
  error?: string;
}

export async function startExtraction(
  sourceProfile: ConnectionProfile,
  targetProfile: ConnectionProfile,
  onProgress?: (p: ExtractionProgress) => void,
): Promise<{ jobId: number; totalRecords: number; failedTables: string[] }> {
  // 1. Create job
  const [job] = await stagingDb
    .insert(schema.extractionJobs)
    .values({
      sourceProfileId: sourceProfile.id,
      targetProfileId: targetProfile.id,
      status: "running",
    })
    .returning();
  if (!job) throw new Error("Failed to create extraction job");

  const tables = getAllTables();
  const failedTables: string[] = [];
  let totalRecords = 0;
  const pool = getSourcePool(sourceProfile);

  await stagingDb
    .update(schema.extractionJobs)
    .set({ totalTables: tables.length })
    .where(sql`id = ${job.id}`);

  for (const table of tables) {
    const [status] = await stagingDb
      .insert(schema.tableExtractionStatus)
      .values({
        extractionJobId: job.id,
        tableName: table.tableName,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    if (!status) continue;

    onProgress?.({
      jobId: job.id,
      tableName: table.tableName,
      status: "running",
      recordCount: 0,
    });

    try {
      const count = await extractTable(job.id, table, pool);
      totalRecords += count;
      await stagingDb
        .update(schema.tableExtractionStatus)
        .set({
          status: "done",
          recordCount: count,
          finishedAt: new Date(),
        })
        .where(sql`id = ${status.id}`);
      onProgress?.({
        jobId: job.id,
        tableName: table.tableName,
        status: "done",
        recordCount: count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedTables.push(table.tableName);
      await stagingDb
        .update(schema.tableExtractionStatus)
        .set({
          status: "failed",
          errorMessage: message,
          finishedAt: new Date(),
        })
        .where(sql`id = ${status.id}`);
      onProgress?.({
        jobId: job.id,
        tableName: table.tableName,
        status: "failed",
        recordCount: 0,
        error: message,
      });
    }
  }

  await stagingDb
    .update(schema.extractionJobs)
    .set({
      status: failedTables.length === tables.length ? "failed" : "done",
      finishedAt: new Date(),
      totalRecords,
    })
    .where(sql`id = ${job.id}`);

  return { jobId: job.id, totalRecords, failedTables };
}

async function extractTable(
  jobId: number,
  table: TableDefinition,
  pool: import("pg").Pool,
): Promise<number> {
  // Build query
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (table.type === "transaction" && table.dateFilterColumn) {
    params.push(TRANSACTION_DATE_FROM);
    conditions.push(`"${table.dateFilterColumn}" >= $${params.length}`);
  }

  // Note: we DO NOT filter on `active` — we want archived records too.
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT * FROM "${table.tableName}" ${whereClause} ORDER BY id`;

  const client = await pool.connect();
  let count = 0;
  try {
    const result = await client.query(query, params);

    if (result.rows.length === 0) return 0;

    // Batch insert in chunks of 500 to avoid huge transactions
    const BATCH_SIZE = 500;
    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);
      const values = batch
        .filter((row) => row.id != null)
        .map((row) => ({
          extractionJobId: jobId,
          tableName: table.tableName,
          sourceId: row.id as number,
          sourceData: row,
          stagedData: row,
          isDirty: false,
          isDeleted: false,
        }));
      if (values.length > 0) {
        await stagingDb.insert(schema.stagedRecords).values(values).onConflictDoNothing();
        count += values.length;
      }
    }
  } finally {
    client.release();
  }

  return count;
}

export async function getExtractionJob(jobId: number) {
  const result = await stagingDb.query.extractionJobs.findFirst({
    where: (j, { eq }) => eq(j.id, jobId),
  });
  return result;
}

export async function getLatestExtractionJob() {
  const rows = await stagingDb
    .select()
    .from(schema.extractionJobs)
    .orderBy(sql`${schema.extractionJobs.startedAt} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

export async function getTableExtractionStatuses(jobId: number) {
  return stagingDb
    .select()
    .from(schema.tableExtractionStatus)
    .where(sql`extraction_job_id = ${jobId}`);
}
