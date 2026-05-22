/**
 * Cleaner: CRUD operations on staged records.
 *
 * The cleaning layer reads/writes to the `staged_data` JSONB column,
 * leaving `source_data` immutable as a reference copy.
 */

import { and, eq, inArray, sql, asc, desc, like } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import {
  getIncomingRelations,
  getOutgoingRelations,
  findTable,
} from "../odoo/modules";
import type { RelationDefinition } from "../odoo/types";

export interface ListStagedRecordsOptions {
  jobId: number;
  tableName: string;
  page?: number;
  pageSize?: number;
  search?: string;              // legacy single search term (kept for backwards compat)
  searchTerms?: string[];       // multiple global AND terms
  colSearchTerms?: Array<{ col: string; val: string }>;  // column-specific AND terms
  filterDirty?: boolean;
  filterDeleted?: boolean;
  filterValidationStatus?: string;
  orderBy?: "source_id" | "updated_at";
  orderDir?: "asc" | "desc";
}

export interface ListStagedRecordsResult {
  records: typeof schema.stagedRecords.$inferSelect[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listStagedRecords(
  options: ListStagedRecordsOptions,
): Promise<ListStagedRecordsResult> {
  const {
    jobId,
    tableName,
    page = 1,
    pageSize = 50,
    search,
    searchTerms,
    colSearchTerms,
    filterDirty,
    filterDeleted,
    filterValidationStatus,
    orderBy = "source_id",
    orderDir = "asc",
  } = options;

  const filters = [
    eq(schema.stagedRecords.extractionJobId, jobId),
    eq(schema.stagedRecords.tableName, tableName),
  ];

  if (filterDirty) filters.push(eq(schema.stagedRecords.isDirty, true));
  if (filterDeleted !== undefined) {
    filters.push(eq(schema.stagedRecords.isDeleted, filterDeleted));
  }
  if (filterValidationStatus) {
    filters.push(eq(schema.stagedRecords.validationStatus, filterValidationStatus));
  }

  if (search) {
    // Legacy single search term — search inside the staged_data JSONB as text
    filters.push(
      like(sql`${schema.stagedRecords.stagedData}::text`, `%${search}%`),
    );
  }

  // Multiple global search terms — each as a separate AND condition
  if (searchTerms && searchTerms.length > 0) {
    for (const term of searchTerms) {
      if (term.trim()) {
        filters.push(
          like(sql`${schema.stagedRecords.stagedData}::text`, `%${term.trim()}%`),
        );
      }
    }
  }

  // Column-specific search terms — use JSONB ->> operator then ILIKE
  if (colSearchTerms && colSearchTerms.length > 0) {
    for (const { col, val } of colSearchTerms) {
      if (col && val.trim()) {
        filters.push(
          like(sql`${schema.stagedRecords.stagedData}->>${col}`, `%${val.trim()}%`),
        );
      }
    }
  }

  const whereClause = and(...filters);
  const orderColumn =
    orderBy === "updated_at" ? schema.stagedRecords.updatedAt : schema.stagedRecords.sourceId;
  const orderExpr = orderDir === "desc" ? desc(orderColumn) : asc(orderColumn);

  const totalResult = await stagingDb
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.stagedRecords)
    .where(whereClause);
  const total = totalResult[0]?.count ?? 0;

  const records = await stagingDb
    .select()
    .from(schema.stagedRecords)
    .where(whereClause)
    .orderBy(orderExpr)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { records, total, page, pageSize };
}

export async function getStagedRecord(id: number) {
  const rows = await stagingDb
    .select()
    .from(schema.stagedRecords)
    .where(eq(schema.stagedRecords.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateStagedRecord(
  id: number,
  newStagedData: Record<string, unknown>,
): Promise<typeof schema.stagedRecords.$inferSelect | null> {
  const existing = await getStagedRecord(id);
  if (!existing) return null;

  // Determine dirtiness by deep comparison vs source_data
  const isDirty = !shallowEqual(existing.sourceData as Record<string, unknown>, newStagedData);

  // Only reset validationStatus when staged data actually changed — preserves
  // the current pass/fail/warning badge on no-op saves (e.g. blur without edit).
  const stagedDataChanged =
    JSON.stringify(existing.stagedData) !== JSON.stringify(newStagedData);

  const [updated] = await stagingDb
    .update(schema.stagedRecords)
    .set({
      stagedData: newStagedData,
      isDirty,
      updatedAt: new Date(),
      ...(stagedDataChanged ? { validationStatus: "pending" } : {}),
    })
    .where(eq(schema.stagedRecords.id, id))
    .returning();
  return updated ?? null;
}

export async function resetStagedRecord(
  id: number,
): Promise<typeof schema.stagedRecords.$inferSelect | null> {
  const existing = await getStagedRecord(id);
  if (!existing) return null;

  const [updated] = await stagingDb
    .update(schema.stagedRecords)
    .set({
      stagedData: existing.sourceData,
      isDirty: false,
      isDeleted: false,
      validationStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(schema.stagedRecords.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Soft-delete: mark a record as deleted (it won't be imported).
 * Checks for active dependencies and blocks if needed.
 */
export async function softDeleteStagedRecord(
  id: number,
  force = false,
): Promise<{
  ok: boolean;
  message?: string;
  blocking?: RelationImpact[];
}> {
  const record = await getStagedRecord(id);
  if (!record) return { ok: false, message: "Record not found" };

  const check = await canSoftDelete(record);
  if (!check.ok && !force) {
    return {
      ok: false,
      message: check.message,
      blocking: check.blocking,
    };
  }

  await stagingDb
    .update(schema.stagedRecords)
    .set({ isDeleted: true, isDirty: true, updatedAt: new Date() })
    .where(eq(schema.stagedRecords.id, id));

  return { ok: true };
}

/**
 * Inspect a staged record's dependency graph and decide whether it can be
 * soft-deleted without violating an `onDelete: "block"` relation.
 */
export async function canSoftDelete(
  record: typeof schema.stagedRecords.$inferSelect,
): Promise<{ ok: true } | { ok: false; message: string; blocking: RelationImpact[] }> {
  const impacts = await computeDependencyImpact(
    record.extractionJobId,
    record.tableName,
    record.sourceId,
  );
  const blocking = impacts.filter((i) => i.action === "block" && i.dependentCount > 0);
  if (blocking.length === 0) return { ok: true };
  return {
    ok: false,
    message: "Deletion blocked: active dependencies exist",
    blocking,
  };
}

export interface RelationImpact {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  action: "block" | "nullify" | "cascade";
  label: string;
  dependentCount: number;
}

/**
 * Given a (table, sourceId), find all records in OTHER tables that reference it.
 */
export async function computeDependencyImpact(
  jobId: number,
  tableName: string,
  sourceId: number,
): Promise<RelationImpact[]> {
  const incoming = getIncomingRelations(tableName);
  const results: RelationImpact[] = [];

  for (const rel of incoming) {
    // Count records in fromTable where stagedData->>fromColumn = sourceId
    const countResult = await stagingDb.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM staged_records
      WHERE extraction_job_id = ${jobId}
        AND table_name = ${rel.fromTable}
        AND is_deleted = false
        AND (staged_data->>${rel.fromColumn})::int = ${sourceId}
    `);
    const row = (countResult.rows[0] as { count?: number } | undefined) ?? {};
    const dependentCount = row.count ?? 0;
    results.push({
      fromTable: rel.fromTable,
      fromColumn: rel.fromColumn,
      toTable: rel.toTable,
      action: rel.onDelete,
      label: rel.label ?? `${rel.fromTable}.${rel.fromColumn}`,
      dependentCount,
    });
  }

  return results;
}

/**
 * Get table-level statistics for the staging browser.
 */
export async function getTableStats(jobId: number) {
  const rows = await stagingDb.execute(sql`
    SELECT
      table_name,
      COUNT(*)::int AS total,
      SUM(CASE WHEN is_dirty THEN 1 ELSE 0 END)::int AS dirty,
      SUM(CASE WHEN is_deleted THEN 1 ELSE 0 END)::int AS deleted,
      SUM(CASE WHEN validation_status = 'fail' THEN 1 ELSE 0 END)::int AS validation_failed,
      SUM(CASE WHEN validation_status = 'warning' THEN 1 ELSE 0 END)::int AS validation_warning,
      SUM(CASE WHEN quality_severity = 'block' AND is_deleted = false THEN 1 ELSE 0 END)::int AS quality_block,
      SUM(CASE WHEN quality_severity = 'warn' AND is_deleted = false THEN 1 ELSE 0 END)::int AS quality_warn
    FROM staged_records
    WHERE extraction_job_id = ${jobId}
    GROUP BY table_name
    ORDER BY table_name
  `);
  return rows.rows as Array<{
    table_name: string;
    total: number;
    dirty: number;
    deleted: number;
    validation_failed: number;
    validation_warning: number;
    quality_block: number;
    quality_warn: number;
  }>;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

// Re-export helper for UI
export { findTable, getIncomingRelations, getOutgoingRelations };

export interface ListStagedRecordIdsOptions {
  jobId: number;
  tableName: string;
  search?: string;              // legacy single search term (kept for backwards compat)
  searchTerms?: string[];       // multiple global AND terms
  colSearchTerms?: Array<{ col: string; val: string }>;  // column-specific AND terms
  filterDirty?: boolean;
  filterDeleted?: boolean;
  filterValidationStatus?: string;
}

/** Lightweight: return just IDs matching a filter, used by "select all". */
export async function listStagedRecordIds(
  options: ListStagedRecordIdsOptions,
): Promise<number[]> {
  const filters = [
    eq(schema.stagedRecords.extractionJobId, options.jobId),
    eq(schema.stagedRecords.tableName, options.tableName),
  ];
  if (options.filterDirty) filters.push(eq(schema.stagedRecords.isDirty, true));
  if (options.filterDeleted !== undefined) {
    filters.push(eq(schema.stagedRecords.isDeleted, options.filterDeleted));
  }
  if (options.filterValidationStatus) {
    filters.push(eq(schema.stagedRecords.validationStatus, options.filterValidationStatus));
  }
  if (options.search) {
    filters.push(
      like(sql`${schema.stagedRecords.stagedData}::text`, `%${options.search}%`),
    );
  }

  // Multiple global search terms — each as a separate AND condition
  if (options.searchTerms && options.searchTerms.length > 0) {
    for (const term of options.searchTerms) {
      if (term.trim()) {
        filters.push(
          like(sql`${schema.stagedRecords.stagedData}::text`, `%${term.trim()}%`),
        );
      }
    }
  }

  // Column-specific search terms — use JSONB ->> operator then ILIKE
  if (options.colSearchTerms && options.colSearchTerms.length > 0) {
    for (const { col, val } of options.colSearchTerms) {
      if (col && val.trim()) {
        filters.push(
          like(sql`${schema.stagedRecords.stagedData}->>${col}`, `%${val.trim()}%`),
        );
      }
    }
  }

  const rows = await stagingDb
    .select({ id: schema.stagedRecords.id })
    .from(schema.stagedRecords)
    .where(and(...filters));
  return rows.map((r) => r.id);
}

// ---------- Bulk operations ----------

export type BulkOperation =
  | { kind: "set_field"; column: string; value: unknown }
  | {
      kind: "find_replace";
      column: string | null;
      find: string;
      replace: string;
      useRegex: boolean;
    }
  | { kind: "clear_field"; column: string }
  | { kind: "revert_to_source" }
  | { kind: "soft_delete" }
  | { kind: "restore" };

export interface BulkResult {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  failures: Array<{ recordId: number; sourceId: number; reason: string }>;
}

const BULK_CHUNK_SIZE = 500;

/**
 * Apply a bulk operation to many staged records for a single project+table.
 * Processes in chunks of 500 records per transaction.
 */
export async function applyBulkOperation(
  projectId: number,
  tableName: string,
  recordIds: number[],
  op: BulkOperation,
): Promise<BulkResult> {
  const result: BulkResult = {
    totalRequested: recordIds.length,
    successCount: 0,
    failedCount: 0,
    failures: [],
  };
  if (recordIds.length === 0) return result;

  // Load + scope-check all records up front
  const ownedRows = await stagingDb
    .select({
      record: schema.stagedRecords,
      jobProjectId: schema.extractionJobs.projectId,
    })
    .from(schema.stagedRecords)
    .innerJoin(
      schema.extractionJobs,
      eq(schema.extractionJobs.id, schema.stagedRecords.extractionJobId),
    )
    .where(inArray(schema.stagedRecords.id, recordIds));

  const ownedMap = new Map<number, typeof schema.stagedRecords.$inferSelect>();
  for (const row of ownedRows) {
    if (row.jobProjectId !== projectId) continue;
    if (row.record.tableName !== tableName) continue;
    ownedMap.set(row.record.id, row.record);
  }

  for (const id of recordIds) {
    if (!ownedMap.has(id)) {
      result.failures.push({
        recordId: id,
        sourceId: 0,
        reason: "Record not found or not in project/table scope",
      });
      result.failedCount++;
    }
  }

  const eligible = recordIds.filter((id) => ownedMap.has(id));

  // For soft_delete, pre-compute which records pass the dependency check
  const blockedDeletes = new Map<number, string>();
  if (op.kind === "soft_delete") {
    for (const id of eligible) {
      const rec = ownedMap.get(id)!;
      const check = await canSoftDelete(rec);
      if (!check.ok) {
        const labels = check.blocking
          .map((b) => `${b.fromTable}.${b.fromColumn} (${b.dependentCount})`)
          .join(", ");
        blockedDeletes.set(id, `Blocked by: ${labels}`);
      }
    }
  }

  // Build the applicable list, recording failures for blocked deletes
  const applicable: number[] = [];
  for (const id of eligible) {
    if (op.kind === "soft_delete" && blockedDeletes.has(id)) {
      const rec = ownedMap.get(id)!;
      result.failures.push({
        recordId: id,
        sourceId: rec.sourceId,
        reason: blockedDeletes.get(id)!,
      });
      result.failedCount++;
      continue;
    }
    applicable.push(id);
  }

  // Process applicable IDs in chunks
  for (let i = 0; i < applicable.length; i += BULK_CHUNK_SIZE) {
    const chunk = applicable.slice(i, i + BULK_CHUNK_SIZE);
    try {
      await stagingDb.transaction(async (tx) => {
        for (const id of chunk) {
          const rec = ownedMap.get(id)!;
          await applyOperationToRecord(tx, rec, op);
        }
      });
      for (const id of chunk) {
        result.successCount++;
        // keep cached ownedMap unchanged; per-record updates already committed
        void id;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const id of chunk) {
        const rec = ownedMap.get(id)!;
        result.failures.push({ recordId: id, sourceId: rec.sourceId, reason: message });
        result.failedCount++;
      }
    }
  }

  return result;
}

async function applyOperationToRecord(
  tx: Parameters<Parameters<typeof stagingDb.transaction>[0]>[0],
  record: typeof schema.stagedRecords.$inferSelect,
  op: BulkOperation,
): Promise<void> {
  const now = new Date();
  switch (op.kind) {
    case "set_field": {
      const next = { ...(record.stagedData as Record<string, unknown>), [op.column]: op.value };
      const isDirty = !recordsEqual(record.sourceData as Record<string, unknown>, next);
      await tx
        .update(schema.stagedRecords)
        .set({
          stagedData: next,
          isDirty,
          updatedAt: now,
          validationStatus: "pending",
        })
        .where(eq(schema.stagedRecords.id, record.id));
      return;
    }
    case "clear_field": {
      const next = { ...(record.stagedData as Record<string, unknown>), [op.column]: null };
      const isDirty = !recordsEqual(record.sourceData as Record<string, unknown>, next);
      await tx
        .update(schema.stagedRecords)
        .set({
          stagedData: next,
          isDirty,
          updatedAt: now,
          validationStatus: "pending",
        })
        .where(eq(schema.stagedRecords.id, record.id));
      return;
    }
    case "find_replace": {
      const staged = { ...(record.stagedData as Record<string, unknown>) };
      let anyChange = false;
      const columns = op.column ? [op.column] : Object.keys(staged);
      const matcher = op.useRegex ? new RegExp(op.find, "g") : null;
      for (const col of columns) {
        const v = staged[col];
        if (typeof v !== "string") continue;
        let nextStr: string;
        if (matcher) {
          nextStr = v.replace(matcher, op.replace);
        } else {
          nextStr = v.split(op.find).join(op.replace);
        }
        if (nextStr !== v) {
          staged[col] = nextStr;
          anyChange = true;
        }
      }
      if (!anyChange) return;
      const isDirty = !recordsEqual(record.sourceData as Record<string, unknown>, staged);
      await tx
        .update(schema.stagedRecords)
        .set({
          stagedData: staged,
          isDirty,
          updatedAt: now,
          validationStatus: "pending",
        })
        .where(eq(schema.stagedRecords.id, record.id));
      return;
    }
    case "revert_to_source": {
      await tx
        .update(schema.stagedRecords)
        .set({
          stagedData: record.sourceData,
          isDirty: false,
          isDeleted: false,
          validationStatus: "pending",
          updatedAt: now,
        })
        .where(eq(schema.stagedRecords.id, record.id));
      return;
    }
    case "soft_delete": {
      await tx
        .update(schema.stagedRecords)
        .set({ isDeleted: true, isDirty: true, updatedAt: now })
        .where(eq(schema.stagedRecords.id, record.id));
      return;
    }
    case "restore": {
      await tx
        .update(schema.stagedRecords)
        .set({ isDeleted: false, updatedAt: now })
        .where(eq(schema.stagedRecords.id, record.id));
      return;
    }
  }
}

function recordsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return shallowEqual(a, b);
}
