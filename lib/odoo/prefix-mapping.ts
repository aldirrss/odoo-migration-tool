/**
 * Prefix-based heuristics for auto-classifying discovered Odoo tables.
 *
 * Used during the discovery scan to seed `moduleSlug` (which logical Odoo
 * module a physical table belongs to) and `tableType` (master vs transaction)
 * without requiring per-table user input. Values can be overridden from the
 * Discovery UI.
 */

export const PREFIX_TO_MODULE: Array<[RegExp, string]> = [
  [/^sale_/, "sale"],
  [/^purchase_/, "purchase"],
  [/^pos_/, "pos"],
  [/^account_/, "accounting"],
  [/^stock_/, "stock"],
  [/^mrp_/, "mrp"],
  [/^hr_/, "hr"],
  [/^crm_/, "crm"],
  [/^project_/, "project"],
  [/^mail_/, "mail"],
  [/^res_/, "base"],
  [/^ir_/, "base"],
  [/^uom_/, "base"],
];

export function inferModuleSlug(tableName: string): string | null {
  for (const [re, slug] of PREFIX_TO_MODULE) {
    if (re.test(tableName)) return slug;
  }
  return null;
}

export type ColumnInfo = {
  name: string;
  dataType: string;
  isNullable: boolean;
};

export function inferTableType(
  columns: Array<{ name: string }>,
): "master" | "transaction" {
  const names = new Set(columns.map((c) => c.name));
  const hasStateOrDate =
    names.has("state") ||
    names.has("date_order") ||
    names.has("date_done") ||
    names.has("date_planned_start");
  const fkCount = columns.filter(
    (c) => /_id$/.test(c.name) && c.name !== "id",
  ).length;
  if (hasStateOrDate && fkCount >= 3) return "transaction";
  return "master";
}
