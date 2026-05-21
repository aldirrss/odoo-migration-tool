/**
 * Purchase module: purchase-specific relations.
 *
 * Note: `purchase_order` and `purchase_order_line` are already defined in the
 * accounting module. We do not redefine them here. `purchase_requisition`
 * is intentionally omitted from the curated set because it belongs to the
 * optional `purchase_requisition` addon and is not present in a stock Odoo 16
 * install. The auto-discovery feature (Phase 2) will pick it up if present.
 */

import type { OdooModule } from "../types";

export const purchaseModule: OdooModule = {
  name: "purchase",
  label: "Purchase",
  description: "Purchase orders and vendor management (relations only)",
  tables: [],
  relations: [
    {
      fromTable: "purchase_order",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Purchase representative",
    },
    {
      fromTable: "purchase_order",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Purchase order company",
    },
    {
      fromTable: "purchase_order",
      fromColumn: "currency_id",
      toTable: "res_currency",
      toColumn: "id",
      onDelete: "block",
      label: "Purchase order currency",
    },
    {
      fromTable: "purchase_order_line",
      fromColumn: "product_uom",
      toTable: "uom_uom",
      toColumn: "id",
      onDelete: "block",
      label: "PO line unit of measure",
    },
  ],
};
