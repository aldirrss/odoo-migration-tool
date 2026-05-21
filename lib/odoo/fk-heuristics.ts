/**
 * Best-effort foreign-key inference from Odoo column-naming conventions.
 *
 * Used by the staging UI to render a "preview parent record" button on FK
 * cells even when the module registry hasn't declared the relation. The
 * registry remains authoritative for cleaning/validation/import semantics —
 * this file only powers UI affordances.
 */

import type { RelationDefinition } from "./types";

/**
 * Well-known Odoo column → table mappings. High confidence; these names map
 * to the same target table in virtually every Odoo install.
 */
const KNOWN_FK_TARGETS: Record<string, string> = {
  // Users
  create_uid: "res_users",
  write_uid: "res_users",
  user_id: "res_users",

  // Partners & contacts
  partner_id: "res_partner",
  partner_invoice_id: "res_partner",
  partner_shipping_id: "res_partner",

  // Company / currency / country / state
  company_id: "res_company",
  currency_id: "res_currency",
  country_id: "res_country",
  state_id: "res_country_state",

  // Products
  product_id: "product_product",
  product_tmpl_id: "product_template",
  categ_id: "product_category",
  uom_id: "uom_uom",
  uom_po_id: "uom_uom",

  // Accounting
  journal_id: "account_journal",
  account_id: "account_account",
  move_id: "account_move",
  tax_group_id: "account_tax_group",
  fiscal_position_id: "account_fiscal_position",
  payment_term_id: "account_payment_term",
  invoice_payment_term_id: "account_payment_term",

  // Stock
  location_id: "stock_location",
  location_dest_id: "stock_location",
  warehouse_id: "stock_warehouse",
  picking_id: "stock_picking",

  // POS
  payment_method_id: "pos_payment_method",
  session_id: "pos_session",

  // HR
  employee_id: "hr_employee",
};

/**
 * Columns that are self-referential by Odoo convention.
 * The target table is the same as the row's own table.
 */
const SELF_FK_COLUMNS = new Set<string>(["parent_id"]);

/**
 * Try to infer a FK target for a given column on a given table.
 * Returns a synthetic RelationDefinition if we can guess with high confidence,
 * or null otherwise.
 *
 * `onDelete: "nullify"` is the safest default for an inferred relation; the
 * user should adjust via the module registry if the real semantics differ.
 */
export function inferFkRelation(
  fromTable: string,
  fromColumn: string,
): RelationDefinition | null {
  if (SELF_FK_COLUMNS.has(fromColumn)) {
    return {
      fromTable,
      fromColumn,
      toTable: fromTable,
      toColumn: "id",
      onDelete: "nullify",
      label: `${fromColumn} (self)`,
    };
  }

  const target = KNOWN_FK_TARGETS[fromColumn];
  if (target) {
    return {
      fromTable,
      fromColumn,
      toTable: target,
      toColumn: "id",
      onDelete: "nullify",
      label: `${fromColumn} → ${target}`,
    };
  }

  return null;
}
