/**
 * Stock / Inventory module.
 *
 * Note: `stock_warehouse` and `stock_location` are already defined in the base
 * module. `stock_picking`, `stock_move`, and `stock_move_line` are defined in
 * the accounting module. Here we add the remaining standard Odoo 16 stock
 * master tables (picking types, routes, rules, quants, lots) and supporting
 * relations.
 *
 * In Odoo 16 the lot table was renamed from `stock_production_lot` to
 * `stock_lot`. We use `stock_lot`.
 */

import type { OdooModule } from "../types";

export const stockModule: OdooModule = {
  name: "stock",
  label: "Inventory",
  description: "Warehouses, locations, routes, rules, quants and lots",
  tables: [
    // ===== Master data =====
    {
      tableName: "stock_picking_type",
      odooModel: "stock.picking.type",
      label: "Operation Types",
      type: "master",
      importOrder: 250,
    },
    {
      tableName: "stock_route",
      odooModel: "stock.route",
      label: "Routes",
      type: "master",
      importOrder: 260,
    },
    {
      tableName: "stock_rule",
      odooModel: "stock.rule",
      label: "Stock Rules",
      type: "master",
      importOrder: 270,
    },
    {
      tableName: "stock_lot",
      odooModel: "stock.lot",
      label: "Lots / Serial Numbers",
      type: "master",
      importOrder: 280,
    },
    {
      tableName: "stock_quant",
      odooModel: "stock.quant",
      label: "Stock Quants",
      type: "master",
      importOrder: 290,
    },
  ],
  relations: [
    {
      fromTable: "stock_picking_type",
      fromColumn: "warehouse_id",
      toTable: "stock_warehouse",
      toColumn: "id",
      onDelete: "block",
      label: "Picking type warehouse",
    },
    {
      fromTable: "stock_picking_type",
      fromColumn: "default_location_src_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "nullify",
      label: "Default source location",
    },
    {
      fromTable: "stock_picking_type",
      fromColumn: "default_location_dest_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "nullify",
      label: "Default destination location",
    },
    {
      fromTable: "stock_location",
      fromColumn: "location_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "nullify",
      label: "Parent location",
    },
    {
      fromTable: "stock_rule",
      fromColumn: "route_id",
      toTable: "stock_route",
      toColumn: "id",
      onDelete: "cascade",
      label: "Rule route",
    },
    {
      fromTable: "stock_rule",
      fromColumn: "location_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "block",
      label: "Rule destination location",
    },
    {
      fromTable: "stock_rule",
      fromColumn: "location_src_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "nullify",
      label: "Rule source location",
    },
    {
      fromTable: "stock_rule",
      fromColumn: "picking_type_id",
      toTable: "stock_picking_type",
      toColumn: "id",
      onDelete: "block",
      label: "Rule picking type",
    },
    {
      fromTable: "stock_lot",
      fromColumn: "product_id",
      toTable: "product_product",
      toColumn: "id",
      onDelete: "block",
      label: "Lot product",
    },
    {
      fromTable: "stock_lot",
      fromColumn: "company_id",
      toTable: "res_company",
      toColumn: "id",
      onDelete: "block",
      label: "Lot company",
    },
    {
      fromTable: "stock_quant",
      fromColumn: "product_id",
      toTable: "product_product",
      toColumn: "id",
      onDelete: "block",
      label: "Quant product",
    },
    {
      fromTable: "stock_quant",
      fromColumn: "location_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "block",
      label: "Quant location",
    },
    {
      fromTable: "stock_quant",
      fromColumn: "lot_id",
      toTable: "stock_lot",
      toColumn: "id",
      onDelete: "nullify",
      label: "Quant lot",
    },
    {
      fromTable: "stock_picking",
      fromColumn: "picking_type_id",
      toTable: "stock_picking_type",
      toColumn: "id",
      onDelete: "block",
      label: "Picking operation type",
    },
    {
      fromTable: "stock_picking",
      fromColumn: "location_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "block",
      label: "Picking source location",
    },
    {
      fromTable: "stock_picking",
      fromColumn: "location_dest_id",
      toTable: "stock_location",
      toColumn: "id",
      onDelete: "block",
      label: "Picking destination location",
    },
    {
      fromTable: "stock_move_line",
      fromColumn: "lot_id",
      toTable: "stock_lot",
      toColumn: "id",
      onDelete: "nullify",
      label: "Move line lot",
    },
    {
      fromTable: "stock_move_line",
      fromColumn: "move_id",
      toTable: "stock_move",
      toColumn: "id",
      onDelete: "cascade",
      label: "Parent stock move",
    },
  ],
};
