/**
 * Point of Sale module.
 * pos.config and pos.payment.method are master data (always extracted).
 * pos.session, pos.order, pos.order.line, pos.payment are transactions (date filtered).
 */

import type { OdooModule } from "../types";

export const posModule: OdooModule = {
  name: "pos",
  label: "Point of Sale",
  description: "POS configurations, sessions, orders, and payments",
  tables: [
    // ===== Master data =====
    {
      tableName: "pos_config",
      odooModel: "pos.config",
      label: "POS Configurations",
      type: "master",
      importOrder: 200,
    },
    {
      tableName: "pos_payment_method",
      odooModel: "pos.payment.method",
      label: "POS Payment Methods",
      type: "master",
      importOrder: 210,
    },
    // ===== Transactions (date filtered) =====
    {
      tableName: "pos_session",
      odooModel: "pos.session",
      label: "POS Sessions",
      type: "transaction",
      dateFilterColumn: "start_at",
      importOrder: 600,
    },
    {
      tableName: "pos_order",
      odooModel: "pos.order",
      label: "POS Orders",
      type: "transaction",
      dateFilterColumn: "date_order",
      importOrder: 610,
    },
    {
      tableName: "pos_order_line",
      odooModel: "pos.order.line",
      label: "POS Order Lines",
      type: "transaction",
      dateFilterColumn: "create_date",
      importOrder: 611,
    },
    {
      tableName: "pos_payment",
      odooModel: "pos.payment",
      label: "POS Payments",
      type: "transaction",
      dateFilterColumn: "payment_date",
      importOrder: 620,
    },
  ],
  relations: [
    {
      fromTable: "pos_config",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "POS config company",
    },
    {
      fromTable: "pos_session",
      fromColumn: "config_id",
      toTable: "pos_config",
      toColumn: "id",
      onDelete: "block",
      label: "POS session config",
    },
    {
      fromTable: "pos_session",
      fromColumn: "user_id",
      toTable: "res_users",
      toColumn: "id",
      onDelete: "block",
      label: "Session user",
    },
    {
      fromTable: "pos_order",
      fromColumn: "session_id",
      toTable: "pos_session",
      toColumn: "id",
      onDelete: "block",
      label: "POS order session",
    },
    {
      fromTable: "pos_order",
      fromColumn: "partner_id",
      toTable: "res_partner",
      toColumn: "id",
      onDelete: "nullify",
      label: "POS order customer",
    },
    {
      fromTable: "pos_order_line",
      fromColumn: "order_id",
      toTable: "pos_order",
      toColumn: "id",
      onDelete: "cascade",
      label: "Parent POS order",
    },
    {
      fromTable: "pos_order_line",
      fromColumn: "product_id",
      toTable: "product_product",
      toColumn: "id",
      onDelete: "block",
      label: "POS line product",
    },
    {
      fromTable: "pos_payment",
      fromColumn: "pos_order_id",
      toTable: "pos_order",
      toColumn: "id",
      onDelete: "cascade",
      label: "Payment order",
    },
    {
      fromTable: "pos_payment",
      fromColumn: "payment_method_id",
      toTable: "pos_payment_method",
      toColumn: "id",
      onDelete: "block",
      label: "Payment method",
    },
  ],
};
