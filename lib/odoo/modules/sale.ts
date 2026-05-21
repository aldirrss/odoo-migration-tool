/**
 * Sales module: sale order templates (master) + sale orders (transactions).
 *
 * Note: `sale_order` and `sale_order_line` are already defined in the
 * accounting module (they live there for historical reasons because invoicing
 * depends on them). This module focuses on sale-specific master data
 * (templates) and the relations between sale orders and other master tables.
 */

import type { OdooModule } from "../types";

export const saleModule: OdooModule = {
  name: "sale",
  label: "Sales",
  description: "Sale order templates and sales-specific master data",
  tables: [
    // ===== Master data =====
    {
      tableName: "sale_order_template",
      odooModel: "sale.order.template",
      label: "Quotation Templates",
      type: "master",
      importOrder: 400,
    },
    {
      tableName: "sale_order_template_line",
      odooModel: "sale.order.template.line",
      label: "Quotation Template Lines",
      type: "master",
      importOrder: 401,
    },
  ],
  relations: [
    {
      fromTable: "sale_order_template_line",
      fromColumn: "sale_order_template_id",
      toTable: "sale_order_template",
      toColumn: "id",
      onDelete: "cascade",
      label: "Parent quotation template",
    },
    {
      fromTable: "sale_order_template_line",
      fromColumn: "product_id",
      toTable: "product_product",
      toColumn: "id",
      onDelete: "block",
      label: "Template line product",
    },
    {
      fromTable: "sale_order",
      fromColumn: "sale_order_template_id",
      toTable: "sale_order_template",
      toColumn: "id",
      onDelete: "nullify",
      label: "Sale order template",
    },
    {
      fromTable: "sale_order",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "nullify",
      label: "Salesperson",
    },
    {
      fromTable: "sale_order",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Sale order company",
    },
    {
      fromTable: "sale_order",
      fromColumn: "currency_id",
      toTable: "res_currency",
      toColumn: "id",
      onDelete: "block",
      label: "Sale order currency",
    },
    {
      fromTable: "sale_order",
      fromColumn: "pricelist_id",
      toTable: "product_pricelist",
      toColumn: "id",
      onDelete: "nullify",
      label: "Sale order pricelist",
    },
  ],
};
