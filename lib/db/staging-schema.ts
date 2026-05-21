/**
 * Staging database schema (Drizzle ORM).
 *
 * The staging DB holds three types of state:
 *   1. extraction_jobs       - audit log of extraction runs
 *   2. staged_records        - the actual extracted rows (one row per Odoo record)
 *   3. import_jobs           - audit log of import runs
 *
 * Each Odoo source table is stored row-by-row in `staged_records` using a JSONB
 * column for the raw data. This avoids having to generate hundreds of dynamic
 * schemas while still allowing query/edit by table name.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const extractionJobs = pgTable("extraction_jobs", {
  id: serial("id").primaryKey(),
  sourceProfileId: text("source_profile_id").notNull(),
  targetProfileId: text("target_profile_id").notNull(),
  status: text("status").notNull().default("running"), // running | done | failed
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  totalTables: integer("total_tables").default(0).notNull(),
  totalRecords: integer("total_records").default(0).notNull(),
  errorMessage: text("error_message"),
});

export const stagedRecords = pgTable(
  "staged_records",
  {
    id: serial("id").primaryKey(),
    extractionJobId: integer("extraction_job_id")
      .references(() => extractionJobs.id, { onDelete: "cascade" })
      .notNull(),
    tableName: text("table_name").notNull(), // e.g. "res_partner"
    sourceId: integer("source_id").notNull(), // original Odoo record id
    sourceData: jsonb("source_data").notNull(), // immutable copy of source row
    stagedData: jsonb("staged_data").notNull(), // editable copy
    isDirty: boolean("is_dirty").default(false).notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    validationStatus: text("validation_status").default("pending").notNull(), // pending | pass | warning | fail
    validationMessages: jsonb("validation_messages"), // array of {field, severity, message}
    importStatus: text("import_status").default("pending").notNull(), // pending | success | error | skipped
    importError: text("import_error"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueRecord: uniqueIndex("staged_records_job_table_source_uq").on(
      table.extractionJobId,
      table.tableName,
      table.sourceId,
    ),
    tableNameIdx: index("staged_records_table_name_idx").on(table.tableName),
    dirtyIdx: index("staged_records_dirty_idx").on(table.isDirty),
  }),
);

export const tableExtractionStatus = pgTable("table_extraction_status", {
  id: serial("id").primaryKey(),
  extractionJobId: integer("extraction_job_id")
    .references(() => extractionJobs.id, { onDelete: "cascade" })
    .notNull(),
  tableName: text("table_name").notNull(),
  status: text("status").notNull().default("pending"), // pending | running | done | failed
  recordCount: integer("record_count").default(0).notNull(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export const importJobs = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  extractionJobId: integer("extraction_job_id")
    .references(() => extractionJobs.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  totalRecords: integer("total_records").default(0).notNull(),
  successCount: integer("success_count").default(0).notNull(),
  errorCount: integer("error_count").default(0).notNull(),
  errorMessage: text("error_message"),
});

export type ExtractionJob = typeof extractionJobs.$inferSelect;
export type NewExtractionJob = typeof extractionJobs.$inferInsert;
export type StagedRecord = typeof stagedRecords.$inferSelect;
export type NewStagedRecord = typeof stagedRecords.$inferInsert;
export type TableExtractionStatus = typeof tableExtractionStatus.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
