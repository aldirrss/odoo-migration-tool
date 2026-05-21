/**
 * Staging database schema (Drizzle ORM).
 *
 * The staging DB holds:
 *   1. users / sessions                  - auth
 *   2. connection_profiles               - PostgreSQL connection profiles (encrypted password)
 *   3. projects / project_configs        - per-project workspace + configuration
 *   4. extraction_jobs / staged_records  - extraction state, scoped to a project
 *   5. import_jobs                       - import state, scoped to a project
 *
 * Each Odoo source table is stored row-by-row in `staged_records` using a JSONB
 * column for the raw data.
 */

import { sql } from "drizzle-orm";
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

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const connectionProfiles = pgTable("connection_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  database: text("database").notNull(),
  user: text("user").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  ssl: boolean("ssl").default(false).notNull(),
  odooVersion: text("odoo_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  sourceProfileId: text("source_profile_id").references(() => connectionProfiles.id, {
    onDelete: "set null",
  }),
  targetProfileId: text("target_profile_id").references(() => connectionProfiles.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectConfigs = pgTable("project_configs", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  transactionDateFrom: text("transaction_date_from").notNull().default("2026-01-01"),
  dateFallbackEnabled: boolean("date_fallback_enabled").default(true).notNull(),
  dateFallbackChain: jsonb("date_fallback_chain")
    .$type<string[]>()
    .default(["date", "date_order", "create_date", "write_date"])
    .notNull(),
  allowedModules: jsonb("allowed_modules")
    .$type<string[]>()
    .default(["base", "accounting", "pos"])
    .notNull(),
  onMissingDateColumn: text("on_missing_date_column").default("fallback").notNull(),
  qualityRules: jsonb("quality_rules"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const extractionJobs = pgTable("extraction_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  sourceProfileId: text("source_profile_id").notNull(),
  targetProfileId: text("target_profile_id").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  totalTables: integer("total_tables").default(0).notNull(),
  totalRecords: integer("total_records").default(0).notNull(),
  errorMessage: text("error_message"),
  cancelRequested: boolean("cancel_requested").default(false).notNull(),
  // Live progress for the post-extraction quality scan phase. UI reads these
  // to show "scanning <table> — X / Y rows" instead of a blank stuck modal.
  qualityScanCurrentTable: text("quality_scan_current_table"),
  qualityScanProgress: integer("quality_scan_progress").default(0).notNull(),
  qualityScanTotal: integer("quality_scan_total").default(0).notNull(),
  qualityScanSkipRequested: boolean("quality_scan_skip_requested").default(false).notNull(),
});

export const stagedRecords = pgTable(
  "staged_records",
  {
    id: serial("id").primaryKey(),
    extractionJobId: integer("extraction_job_id")
      .references(() => extractionJobs.id, { onDelete: "cascade" })
      .notNull(),
    tableName: text("table_name").notNull(),
    sourceId: integer("source_id").notNull(),
    sourceData: jsonb("source_data").notNull(),
    stagedData: jsonb("staged_data").notNull(),
    isDirty: boolean("is_dirty").default(false).notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    validationStatus: text("validation_status").default("pending").notNull(),
    validationMessages: jsonb("validation_messages"),
    importStatus: text("import_status").default("pending").notNull(),
    importError: text("import_error"),
    qualityFlags: jsonb("quality_flags"),
    qualitySeverity: text("quality_severity"),
    qualityScannedAt: timestamp("quality_scanned_at", { withTimezone: true }),
    qualityOverridden: boolean("quality_overridden").default(false).notNull(),
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
    qualitySeverityIdx: index("staged_records_quality_severity_idx")
      .on(table.extractionJobId, table.tableName, table.qualitySeverity)
      .where(sql`${table.qualitySeverity} IS NOT NULL`),
  }),
);

export const tableExtractionStatus = pgTable("table_extraction_status", {
  id: serial("id").primaryKey(),
  extractionJobId: integer("extraction_job_id")
    .references(() => extractionJobs.id, { onDelete: "cascade" })
    .notNull(),
  tableName: text("table_name").notNull(),
  status: text("status").notNull().default("pending"),
  recordCount: integer("record_count").default(0).notNull(),
  expectedRecordCount: integer("expected_record_count"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export const importJobs = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
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

export const discoveredModules = pgTable(
  "discovered_modules",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    label: text("label").notNull(),
    installed: boolean("installed").default(true).notNull(),
    discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
    enabled: boolean("enabled").default(false).notNull(),
  },
  (table) => ({
    uniqueModule: uniqueIndex("discovered_modules_project_name_uq").on(
      table.projectId,
      table.name,
    ),
  }),
);

export const discoveredTables = pgTable(
  "discovered_tables",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    moduleId: integer("module_id")
      .references(() => discoveredModules.id, { onDelete: "cascade" })
      .notNull(),
    tableName: text("table_name").notNull(),
    odooModel: text("odoo_model").notNull(),
    type: text("type").notNull(),
    dateFilterColumn: text("date_filter_column"),
    importOrder: integer("import_order").default(500).notNull(),
    columns: jsonb("columns")
      .$type<Array<{ name: string; label: string; type: string }>>()
      .notNull(),
    confidence: text("confidence").notNull(),
    userClassified: boolean("user_classified").default(false).notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    moduleSlug: text("module_slug"),
    tableType: text("table_type"),
  },
  (table) => ({
    uniqueTable: uniqueIndex("discovered_tables_project_table_uq").on(
      table.projectId,
      table.tableName,
    ),
  }),
);

export const discoveredRelations = pgTable("discovered_relations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  fromTable: text("from_table").notNull(),
  fromColumn: text("from_column").notNull(),
  toTable: text("to_table").notNull(),
  toColumn: text("to_column").notNull(),
  onDelete: text("on_delete").notNull().default("block"),
  source: text("source").notNull().default("introspect"),
});

export type DiscoveredModule = typeof discoveredModules.$inferSelect;
export type NewDiscoveredModule = typeof discoveredModules.$inferInsert;
export type DiscoveredTable = typeof discoveredTables.$inferSelect;
export type NewDiscoveredTable = typeof discoveredTables.$inferInsert;
export type DiscoveredRelation = typeof discoveredRelations.$inferSelect;
export type NewDiscoveredRelation = typeof discoveredRelations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ConnectionProfileRow = typeof connectionProfiles.$inferSelect;
export type NewConnectionProfileRow = typeof connectionProfiles.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectConfig = typeof projectConfigs.$inferSelect;
export type NewProjectConfig = typeof projectConfigs.$inferInsert;
export type ExtractionJob = typeof extractionJobs.$inferSelect;
export type NewExtractionJob = typeof extractionJobs.$inferInsert;
export type StagedRecord = typeof stagedRecords.$inferSelect;
export type NewStagedRecord = typeof stagedRecords.$inferInsert;
export type TableExtractionStatus = typeof tableExtractionStatus.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
