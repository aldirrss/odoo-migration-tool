/**
 * Cleaner: CRUD operations on staged records.
 *
 * The cleaning layer reads/writes to the `staged_data` JSONB column,
 * leaving `source_data` immutable as a reference copy.
 */

import { and, eq, sql, asc, desc, like } from "drizzle-orm";
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
  search?: string;
  filterDirty?: boolean;
  filterDeleted?: boolean;
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
    filterDirty,
    filterDeleted,
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

  if (search) {
    // Search inside the staged_data JSONB as text
    filters.push(
      like(sql`${schema.stagedRecords.stagedData}::text`, `%${search}%`),
    );
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

  const [updated] = await stagingDb
    .update(schema.stagedRecords)
    .set({
      stagedData: newStagedData,
      isDirty,
      updatedAt: new Date(),
      validationStatus: "pending",
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

  const impacts = await computeDependencyImpact(
    record.extractionJobId,
    record.tableName,
    record.sourceId,
  );

  const blocking = impacts.filter((i) => i.action === "block" && i.dependentCount > 0);
  if (blocking.length > 0 && !force) {
    return {
      ok: false,
      message: "Deletion blocked: active dependencies exist",
      blocking,
    };
  }

  await stagingDb
    .update(schema.stagedRecords)
    .set({ isDeleted: true, isDirty: true, updatedAt: new Date() })
    .where(eq(schema.stagedRecords.id, id));

  return { ok: true };
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
      SUM(CASE WHEN validation_status = 'warning' THEN 1 ELSE 0 END)::int AS validation_warning
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
