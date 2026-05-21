/**
 * Core type definitions for Odoo module registry.
 * Defines the contract for adding new modules (custom or built-in) to the migration tool.
 */

export type TableType = "master" | "transaction";

export type OnDeleteAction = "block" | "nullify" | "cascade";

export interface ColumnDefinition {
  /** PostgreSQL column name */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Whether this column is the primary key */
  isPrimaryKey?: boolean;
  /** Whether this column should be editable in the cleaning UI */
  editable?: boolean;
  /** Whether to hide this column from the table view by default */
  hidden?: boolean;
}

export interface TableDefinition {
  /** PostgreSQL table name (e.g. "res_partner") */
  tableName: string;
  /** Odoo model name (e.g. "res.partner") */
  odooModel: string;
  /** Human-readable label for UI */
  label: string;
  /** master = no date filter, transaction = date filter applied */
  type: TableType;
  /**
   * For transaction tables: the column used to filter records by date.
   * Records with this column >= TRANSACTION_DATE_FROM will be extracted.
   */
  dateFilterColumn?: string;
  /** Order in which to extract/import (lower = earlier). Defaults to 100. */
  importOrder?: number;
  /** Column definitions (optional; tool auto-detects if not provided) */
  columns?: ColumnDefinition[];
  /** Whether to include archived records (active=false). Default true. */
  includeArchived?: boolean;
}

export interface RelationDefinition {
  /** Source table (child) */
  fromTable: string;
  /** FK column on the source table */
  fromColumn: string;
  /** Target table (parent) */
  toTable: string;
  /** PK column on the target table (usually "id") */
  toColumn: string;
  /**
   * What happens when the target record is deleted in the cleaning UI:
   * - block: prevent deletion if any FK reference exists
   * - nullify: warn user, set FK to null on import
   * - cascade: warn user, will cascade delete
   */
  onDelete: OnDeleteAction;
  /** Human-readable label for the warning UI */
  label?: string;
}

export interface OdooModule {
  /** Unique module identifier */
  name: string;
  /** Display label */
  label: string;
  /** Module description */
  description?: string;
  /** Tables provided by this module */
  tables: TableDefinition[];
  /** Inter-table relations within or across modules */
  relations: RelationDefinition[];
}
