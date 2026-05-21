/**
 * Quality scan orchestrator.
 *
 * Walks the staged_records for an extraction job, runs every enabled rule,
 * persists findings + severity. Chunked keyset pagination per table so
 * memory stays bounded; honors `extraction_jobs.cancel_requested` between
 * chunks.
 */

import { sql, eq, and, asc, gt } from "drizzle-orm";
import { stagingDb, schema } from "../../db/staging";
import { getTargetPool } from "../../db/target";
import { getProfile } from "../../db/profiles";
import { getAllTables, getAllRelations } from "../../odoo/modules/project-scope";
import type { RelationDefinition } from "../../odoo/types";
import { inferFkRelation } from "../../odoo/fk-heuristics";

import {
  DEFAULT_QUALITY_RULES,
  maxSeverity,
  type QualityFinding,
  type QualityRulesConfig,
  type Severity,
  type QualityScanResult,
} from "./types";

import { checkOrphanFk } from "./rules/orphan-fk";
import { checkMissingRequired } from "./rules/missing-required";
import { checkMalformedTranslation } from "./rules/malformed-translation";
import { checkFutureDate } from "./rules/future-date";
import { checkStaleDate } from "./rules/stale-date";
import { checkSuspiciousNegative } from "./rules/suspicious-negative";
import { checkEncodingIssue } from "./rules/encoding-issue";
import { checkDuplicateNaturalKey, NATURAL_KEYS } from "./rules/duplicate-natural-key";

const CHUNK_SIZE = 1000;

async function loadRulesConfig(projectId: number): Promise<QualityRulesConfig> {
  const rows = await stagingDb
    .select({ qualityRules: schema.projectConfigs.qualityRules })
    .from(schema.projectConfigs)
    .where(eq(schema.projectConfigs.projectId, projectId))
    .limit(1);
  const stored = rows[0]?.qualityRules as Partial<QualityRulesConfig> | null | undefined;
  if (!stored) return { ...DEFAULT_QUALITY_RULES };
  const merged: QualityRulesConfig = { ...DEFAULT_QUALITY_RULES };
  for (const key of Object.keys(DEFAULT_QUALITY_RULES) as Array<keyof QualityRulesConfig>) {
    const override = stored[key];
    if (override) merged[key] = { ...merged[key], ...override };
  }
  return merged;
}

async function loadCutoffDate(projectId: number): Promise<Date> {
  const rows = await stagingDb
    .select({ transactionDateFrom: schema.projectConfigs.transactionDateFrom })
    .from(schema.projectConfigs)
    .where(eq(schema.projectConfigs.projectId, projectId))
    .limit(1);
  const raw = rows[0]?.transactionDateFrom;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function isCancelRequested(jobId: number): Promise<boolean> {
  const rows = await stagingDb
    .select({ cancelRequested: schema.extractionJobs.cancelRequested })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.id, jobId))
    .limit(1);
  return rows[0]?.cancelRequested === true;
}

async function isSkipRequested(jobId: number): Promise<boolean> {
  const rows = await stagingDb
    .select({ skip: schema.extractionJobs.qualityScanSkipRequested })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.id, jobId))
    .limit(1);
  return rows[0]?.skip === true;
}

async function loadJobMeta(jobId: number) {
  const rows = await stagingDb
    .select({
      id: schema.extractionJobs.id,
      projectId: schema.extractionJobs.projectId,
      targetProfileId: schema.extractionJobs.targetProfileId,
    })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.id, jobId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadDistinctTableNames(jobId: number): Promise<string[]> {
  const rows = await stagingDb.execute(sql`
    SELECT DISTINCT table_name FROM staged_records WHERE extraction_job_id = ${jobId}
  `);
  return (rows.rows as Array<{ table_name: string }>).map((r) => r.table_name);
}

async function loadTargetRequiredColumns(
  pool: import("pg").Pool,
  tableName: string,
): Promise<Set<string>> {
  try {
    const r = await pool.query<{ attname: string }>(
      `SELECT a.attname
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE a.attnotnull = true
         AND a.attnum > 0
         AND c.relname = $1
         AND n.nspname = 'public'
         AND NOT a.attisdropped`,
      [tableName],
    );
    // Exclude system columns Odoo auto-fills.
    const out = new Set<string>();
    for (const row of r.rows) {
      if (row.attname === "id") continue;
      out.add(row.attname);
    }
    return out;
  } catch {
    return new Set();
  }
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

/**
 * Collect the set of target tables that FK relations point to from a given
 * source table. We must know these up-front to pre-load `existingIds`.
 */
function collectFkTargets(
  tableName: string,
  declaredRelations: RelationDefinition[],
  sampleRows: Array<Record<string, unknown>>,
): Set<string> {
  const targets = new Set<string>();
  for (const rel of declaredRelations) targets.add(rel.toTable);
  const declaredCols = new Set(declaredRelations.map((r) => r.fromColumn));
  // Walk a few sample rows to find inferred FK columns we haven't seen yet.
  const seenCols = new Set<string>();
  for (const row of sampleRows) {
    for (const col of Object.keys(row)) {
      if (!/_id$/.test(col)) continue;
      if (declaredCols.has(col)) continue;
      if (seenCols.has(col)) continue;
      seenCols.add(col);
      const inferred = inferFkRelation(tableName, col);
      if (inferred) targets.add(inferred.toTable);
    }
  }
  return targets;
}

export async function runQualityScan(
  jobId: number,
  opts: { tableName?: string; projectId?: number } = {},
): Promise<QualityScanResult> {
  const meta = await loadJobMeta(jobId);
  if (!meta) return { scanned: 0, flagged: 0 };
  const projectId = opts.projectId ?? meta.projectId;

  const rulesConfig = await loadRulesConfig(projectId);
  const cutoffDate = await loadCutoffDate(projectId);

  // Resolve target pool (best-effort: if target profile not loadable, skip
  // FK and required-column rules but still run text/date/numeric rules).
  let targetPool: import("pg").Pool | null = null;
  try {
    const profile = await getProfile(meta.targetProfileId);
    if (profile) targetPool = getTargetPool(profile);
  } catch (err) {
    console.error(`[quality-scan ${jobId}] target pool init failed`, err);
  }

  // Build the list of tables in scope.
  let tableNames: string[];
  if (opts.tableName) {
    tableNames = [opts.tableName];
  } else {
    tableNames = await loadDistinctTableNames(jobId);
  }

  // Registry tables (for date columns + declared relations on built-ins).
  const allTables = await getAllTables(projectId);
  const tableDefs = new Map(allTables.map((t) => [t.tableName, t]));
  const allRelations = await getAllRelations(projectId);

  let totalScanned = 0;
  let totalFlagged = 0;

  // Compute the total row count across all tables to drive a global progress
  // bar in the UI (so the "scanning quality" phase is not a black box).
  const totalCountRes = await stagingDb.execute(sql`
    SELECT COUNT(*)::bigint AS c FROM staged_records
    WHERE extraction_job_id = ${jobId} AND is_deleted = false
  `);
  const grandTotal = Number(
    (totalCountRes.rows as Array<{ c: string | number }>)[0]?.c ?? 0,
  );
  await stagingDb
    .update(schema.extractionJobs)
    .set({
      qualityScanTotal: grandTotal,
      qualityScanProgress: 0,
      qualityScanCurrentTable: null,
      qualityScanSkipRequested: false,
    })
    .where(eq(schema.extractionJobs.id, jobId));

  for (const tableName of tableNames) {
    if (await isCancelRequested(jobId)) break;
    if (await isSkipRequested(jobId)) break;
    void tableDefs.get(tableName);

    await stagingDb
      .update(schema.extractionJobs)
      .set({ qualityScanCurrentTable: tableName })
      .where(eq(schema.extractionJobs.id, jobId));

    const declaredRelations = allRelations.filter((r) => r.fromTable === tableName);

    // Pre-load required columns from target schema.
    const requiredColumns = targetPool
      ? await loadTargetRequiredColumns(targetPool, tableName)
      : new Set<string>();

    // Sample a small set of rows to detect inferred FK columns we need to
    // resolve. The full FK target set then drives existingIds preloading.
    const sample = await stagingDb
      .select({ stagedData: schema.stagedRecords.stagedData })
      .from(schema.stagedRecords)
      .where(
        and(
          eq(schema.stagedRecords.extractionJobId, jobId),
          eq(schema.stagedRecords.tableName, tableName),
          eq(schema.stagedRecords.isDeleted, false),
        ),
      )
      .limit(50);
    const sampleRows = sample.map(
      (r) => (r.stagedData ?? {}) as Record<string, unknown>,
    );
    const fkTargets = collectFkTargets(tableName, declaredRelations, sampleRows);

    const existingIds = new Map<string, Set<number>>();
    for (const target of fkTargets) {
      const targetIds = targetPool ? await loadTargetIds(targetPool, target) : new Set<number>();
      const stagedIds = await loadStagedIds(jobId, target);
      const merged = new Set<number>(targetIds);
      for (const id of stagedIds) merged.add(id);
      existingIds.set(target, merged);
    }

    // First pass: stream rows, compute single-row findings, also collect
    // entries for the duplicate-natural-key pass.
    const dupRows: Array<{ recordId: number; row: Record<string, unknown> }> = [];
    const findingsByRecord = new Map<number, QualityFinding[]>();

    let lastId = 0;
    let scannedThisTable = 0;
    // eslint-disable-next-line no-constant-condition
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
            eq(schema.stagedRecords.tableName, tableName),
            eq(schema.stagedRecords.isDeleted, false),
            gt(schema.stagedRecords.id, lastId),
          ),
        )
        .orderBy(asc(schema.stagedRecords.id))
        .limit(CHUNK_SIZE);

      if (chunk.length === 0) break;

      for (const rec of chunk) {
        const row = (rec.stagedData ?? {}) as Record<string, unknown>;
        const findings: QualityFinding[] = [];
        findings.push(
          ...checkOrphanFk({
            row,
            tableName,
            relations: declaredRelations,
            existingIds,
            config: rulesConfig.orphan_fk,
          }),
        );
        if (requiredColumns.size > 0) {
          findings.push(
            ...checkMissingRequired({
              row,
              requiredColumns,
              config: rulesConfig.missing_required,
            }),
          );
        }
        findings.push(
          ...checkMalformedTranslation({
            row,
            config: rulesConfig.malformed_translation,
          }),
        );
        findings.push(
          ...checkFutureDate({ row, config: rulesConfig.future_date }),
        );
        findings.push(
          ...checkStaleDate({
            row,
            cutoffDate,
            config: rulesConfig.stale_date,
          }),
        );
        findings.push(
          ...checkSuspiciousNegative({
            row,
            config: rulesConfig.suspicious_negative,
          }),
        );
        findings.push(
          ...checkEncodingIssue({ row, config: rulesConfig.encoding_issue }),
        );
        findingsByRecord.set(rec.id, findings);

        if (NATURAL_KEYS[tableName]) {
          dupRows.push({ recordId: rec.id, row });
        }
        scannedThisTable++;
      }

      lastId = chunk[chunk.length - 1]!.id;
      if (chunk.length < CHUNK_SIZE) break;
    }

    // Cross-row pass: duplicate natural keys.
    if (dupRows.length > 0) {
      const dupFindings = checkDuplicateNaturalKey({
        tableName,
        rows: dupRows,
        config: rulesConfig.duplicate_natural_key,
      });
      for (const [recordId, list] of dupFindings.entries()) {
        const existing = findingsByRecord.get(recordId) ?? [];
        existing.push(...list);
        findingsByRecord.set(recordId, existing);
      }
    }

    // Persist findings — batched per chunk via a single UPDATE ... FROM
    // (VALUES ...) instead of one UPDATE per row. For a 1M-row table this
    // turns ~1M roundtrips into ~1000.
    const scannedAt = new Date();
    const entries = Array.from(findingsByRecord.entries());
    let cumulativeScanned = totalScanned;
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      if (await isCancelRequested(jobId)) break;
      if (await isSkipRequested(jobId)) break;
      const slice = entries.slice(i, i + CHUNK_SIZE);
      if (slice.length === 0) continue;

      const tuples = slice.map(([recordId, findings]) => {
        const sev: Severity = findings.length
          ? maxSeverity(...findings.map((f) => f.severity))
          : "ok";
        if (sev !== "ok") totalFlagged++;
        return {
          id: recordId,
          flagsJson: findings.length ? JSON.stringify(findings) : null,
          sev,
        };
      });

      const valuesFragments = tuples.map(
        (t) =>
          sql`(${t.id}::int, ${t.flagsJson === null ? sql`NULL` : sql`${t.flagsJson}`}::jsonb, ${t.sev}::text)`,
      );

      await stagingDb.execute(sql`
        UPDATE staged_records sr SET
          quality_flags = c.flags,
          quality_severity = c.sev,
          quality_scanned_at = ${scannedAt}
        FROM (VALUES ${sql.join(valuesFragments, sql`, `)}) AS c(id, flags, sev)
        WHERE sr.id = c.id
      `);

      cumulativeScanned += slice.length;
      await stagingDb
        .update(schema.extractionJobs)
        .set({ qualityScanProgress: cumulativeScanned })
        .where(eq(schema.extractionJobs.id, jobId));
    }

    totalScanned += scannedThisTable;
  }

  // Clean up the live-progress marker so the UI knows scan is no longer
  // pinned to a specific table.
  await stagingDb
    .update(schema.extractionJobs)
    .set({ qualityScanCurrentTable: null })
    .where(eq(schema.extractionJobs.id, jobId));

  return { scanned: totalScanned, flagged: totalFlagged };
}

export async function getQualitySummary(jobId: number) {
  const rows = await stagingDb.execute(sql`
    SELECT
      table_name,
      SUM(CASE WHEN quality_severity = 'block' THEN 1 ELSE 0 END)::int AS block,
      SUM(CASE WHEN quality_severity = 'warn' THEN 1 ELSE 0 END)::int AS warn,
      SUM(CASE WHEN quality_severity = 'ok' THEN 1 ELSE 0 END)::int AS ok,
      SUM(CASE WHEN quality_severity IS NULL THEN 1 ELSE 0 END)::int AS unscanned
    FROM staged_records
    WHERE extraction_job_id = ${jobId}
      AND is_deleted = false
    GROUP BY table_name
    ORDER BY table_name
  `);
  return rows.rows as Array<{
    table_name: string;
    block: number;
    warn: number;
    ok: number;
    unscanned: number;
  }>;
}

export { DEFAULT_QUALITY_RULES } from "./types";
