/**
 * Extractor: copies data from source PostgreSQL into staging.
 *
 * Workflow:
 *   1. Create an extraction_job row.
 *   2. For each table in moduleRegistry (filtered by project config):
 *      - Resolve the effective date-filter column (built-in or fallback chain).
 *      - Create a table_extraction_status row.
 *      - SELECT * from source.<table> with optional date filter.
 *      - Insert one row per source record into staged_records.
 *      - Update status (done / failed / skipped).
 *   3. Mark the extraction_job as done.
 */

import { sql, eq } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { getSourcePool } from "../db/source";
import type { ConnectionProfile } from "../db/profiles";
import { getAllTables } from "../odoo/modules/project-scope";
import type { TableDefinition } from "../odoo/types";

const ENV_TRANSACTION_DATE_FROM = process.env.TRANSACTION_DATE_FROM || "2026-01-01";

type OnMissingDateColumn = "fallback" | "skip_filter" | "skip_table";

interface ProjectExtractionConfig {
  transactionDateFrom: string;
  dateFallbackEnabled: boolean;
  dateFallbackChain: string[];
  onMissingDateColumn: OnMissingDateColumn;
}

async function resolveProjectConfig(projectId: number): Promise<ProjectExtractionConfig> {
  const rows = await stagingDb
    .select({
      transactionDateFrom: schema.projectConfigs.transactionDateFrom,
      dateFallbackEnabled: schema.projectConfigs.dateFallbackEnabled,
      dateFallbackChain: schema.projectConfigs.dateFallbackChain,
      onMissingDateColumn: schema.projectConfigs.onMissingDateColumn,
    })
    .from(schema.projectConfigs)
    .where(eq(schema.projectConfigs.projectId, projectId))
    .limit(1);
  const row = rows[0];
  return {
    transactionDateFrom: row?.transactionDateFrom ?? ENV_TRANSACTION_DATE_FROM,
    dateFallbackEnabled: row?.dateFallbackEnabled ?? true,
    dateFallbackChain: row?.dateFallbackChain ?? [
      "date",
      "date_order",
      "create_date",
      "write_date",
    ],
    onMissingDateColumn: (row?.onMissingDateColumn as OnMissingDateColumn) ?? "fallback",
  };
}

export interface ExtractionProgress {
  jobId: number;
  tableName: string;
  status: "running" | "done" | "failed" | "skipped";
  recordCount: number;
  error?: string;
  dateColumnUsed?: string;
  skipped?: boolean;
}

export async function startExtraction(
  projectId: number,
  sourceProfile: ConnectionProfile,
  targetProfile: ConnectionProfile,
  onProgress?: (p: ExtractionProgress) => void,
): Promise<{ jobId: number; totalRecords: number; failedTables: string[] }> {
  const config = await resolveProjectConfig(projectId);
  const [job] = await stagingDb
    .insert(schema.extractionJobs)
    .values({
      projectId,
      sourceProfileId: sourceProfile.id,
      targetProfileId: targetProfile.id,
      status: "running",
    })
    .returning();
  if (!job) throw new Error("Failed to create extraction job");

  const tables = await getAllTables(projectId);
  const failedTables: string[] = [];
  let totalRecords = 0;
  const pool = getSourcePool(sourceProfile);
  // Per-table column existence cache keyed by table name.
  const columnsCache = new Map<string, Set<string>>();

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
      const result = await extractTable(job.id, table, pool, config, columnsCache);
      totalRecords += result.count;

      if (result.skipped) {
        await stagingDb
          .update(schema.tableExtractionStatus)
          .set({
            status: "skipped",
            recordCount: 0,
            errorMessage: result.note ?? null,
            finishedAt: new Date(),
          })
          .where(sql`id = ${status.id}`);
        onProgress?.({
          jobId: job.id,
          tableName: table.tableName,
          status: "skipped",
          recordCount: 0,
          skipped: true,
          dateColumnUsed: result.dateColumnUsed,
        });
      } else {
        await stagingDb
          .update(schema.tableExtractionStatus)
          .set({
            status: "done",
            recordCount: result.count,
            errorMessage: result.note ?? null,
            finishedAt: new Date(),
          })
          .where(sql`id = ${status.id}`);
        onProgress?.({
          jobId: job.id,
          tableName: table.tableName,
          status: "done",
          recordCount: result.count,
          dateColumnUsed: result.dateColumnUsed,
        });
      }
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

async function getSourceTableColumns(
  pool: import("pg").Pool,
  tableName: string,
  cache: Map<string, Set<string>>,
): Promise<Set<string>> {
  const cached = cache.get(tableName);
  if (cached) return cached;
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  const set = new Set(result.rows.map((r) => r.column_name));
  cache.set(tableName, set);
  return set;
}

interface ExtractTableResult {
  count: number;
  skipped: boolean;
  dateColumnUsed?: string;
  note?: string;
}

async function extractTable(
  jobId: number,
  table: TableDefinition,
  pool: import("pg").Pool,
  config: ProjectExtractionConfig,
  columnsCache: Map<string, Set<string>>,
): Promise<ExtractTableResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let dateColumnUsed: string | undefined;
  let note: string | undefined;

  if (table.type === "transaction") {
    const columns = await getSourceTableColumns(pool, table.tableName, columnsCache);
    const declared = table.dateFilterColumn;
    let effective: string | undefined;

    if (declared && columns.has(declared)) {
      effective = declared;
    } else if (config.dateFallbackEnabled && config.onMissingDateColumn === "fallback") {
      effective = config.dateFallbackChain.find((c) => columns.has(c));
      if (effective) {
        note = `Declared date column "${declared ?? "(none)"}" missing; using fallback "${effective}".`;
      }
    }

    if (!effective) {
      if (config.onMissingDateColumn === "skip_table") {
        return {
          count: 0,
          skipped: true,
          note: `Skipped: no usable date column on "${table.tableName}".`,
        };
      }
      // skip_filter, or fallback exhausted: extract everything without a date filter.
      note = `No date column matched; extracting without date filter.`;
    } else {
      dateColumnUsed = effective;
      params.push(config.transactionDateFrom);
      conditions.push(`"${effective}" >= $${params.length}`);
    }
  }

  // Note: we DO NOT filter on `active` — we want archived records too.
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT * FROM "${table.tableName}" ${whereClause} ORDER BY id`;

  const client = await pool.connect();
  let count = 0;
  try {
    const result = await client.query(query, params);

    if (result.rows.length === 0) {
      return { count: 0, skipped: false, dateColumnUsed, note };
    }

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

  return { count, skipped: false, dateColumnUsed, note };
}

export async function getExtractionJob(jobId: number) {
  const result = await stagingDb.query.extractionJobs.findFirst({
    where: (j, { eq }) => eq(j.id, jobId),
  });
  return result;
}

export async function getLatestExtractionJob(projectId?: number) {
  const query = stagingDb.select().from(schema.extractionJobs);
  const filtered = projectId != null
    ? query.where(eq(schema.extractionJobs.projectId, projectId))
    : query;
  const rows = await filtered
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
