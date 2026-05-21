/**
 * Module Registry.
 *
 * Central index of all Odoo modules supported by this migration tool.
 * To add a new custom module:
 *   1. Create a new file in this directory (e.g. mrp.ts)
 *   2. Define and export an OdooModule
 *   3. Import and push it to the `moduleRegistry` array below
 *
 * No changes to core extract/clean/import logic are needed.
 *
 * Helpers in this file are SYNCHRONOUS and have no DB dependency, so they are
 * safe to import in client components. Project-scoped async helpers that
 * consult `project_configs.allowed_modules` live in `./project-scope.ts`.
 */

import type {
  OdooModule,
  TableDefinition,
  RelationDefinition,
} from "../types";
import { baseModule } from "./base";
import { accountingModule } from "./accounting";
import { posModule } from "./pos";

export const moduleRegistry: OdooModule[] = [
  baseModule,
  accountingModule,
  posModule,
  // Add custom modules here
];

/** Synchronous: every built-in table, no project filter. */
export function getAllTablesSync(): TableDefinition[] {
  const tables = moduleRegistry.flatMap((m) => m.tables);
  return tables.sort((a, b) => (a.importOrder ?? 100) - (b.importOrder ?? 100));
}

/** Synchronous: every built-in relation, no project filter. */
export function getAllRelationsSync(): RelationDefinition[] {
  return moduleRegistry.flatMap((m) => m.relations);
}

/** Find a table definition by its PostgreSQL table name (built-in registry only). */
export function findTable(tableName: string): TableDefinition | undefined {
  return getAllTablesSync().find((t) => t.tableName === tableName);
}

/** Find a module by its name. */
export function findModule(name: string): OdooModule | undefined {
  return moduleRegistry.find((m) => m.name === name);
}

/** Get all relations that reference a given table as the PARENT (toTable). */
export function getIncomingRelations(tableName: string): RelationDefinition[] {
  return getAllRelationsSync().filter((r) => r.toTable === tableName);
}

/** Get all relations where a given table is the CHILD (fromTable). */
export function getOutgoingRelations(tableName: string): RelationDefinition[] {
  return getAllRelationsSync().filter((r) => r.fromTable === tableName);
}

