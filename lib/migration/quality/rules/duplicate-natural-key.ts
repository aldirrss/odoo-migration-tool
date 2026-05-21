import type { QualityFinding, QualityRuleConfig } from "../types";

/**
 * Minimal default natural-key catalog. Cross-row rule — runs as a second pass
 * over the per-table row set rather than per-row in the main loop.
 *
 * tableName → ordered list of column names. The first present + non-empty
 * value wins (effectively: priority).
 */
export const NATURAL_KEYS: Record<string, string[]> = {
  res_partner: ["email"],
  res_users: ["login"],
  product_product: ["default_code"],
  product_template: ["default_code"],
};

interface RowRef {
  recordId: number;
  row: Record<string, unknown>;
}

/**
 * Returns a map of recordId → findings for the duplicate-natural-key rule on
 * the given staged-row set. Skips rows whose key column is null/empty.
 */
export function checkDuplicateNaturalKey(args: {
  tableName: string;
  rows: RowRef[];
  config: QualityRuleConfig;
}): Map<number, QualityFinding[]> {
  const { tableName, rows, config } = args;
  const out = new Map<number, QualityFinding[]>();
  if (!config.enabled) return out;
  const keys = NATURAL_KEYS[tableName];
  if (!keys || keys.length === 0) return out;

  for (const col of keys) {
    const buckets = new Map<string, RowRef[]>();
    for (const ref of rows) {
      const raw = ref.row[col];
      if (raw === null || raw === undefined) continue;
      const value = typeof raw === "string" ? raw.trim() : String(raw);
      if (value.length === 0) continue;
      const key = value.toLowerCase();
      const list = buckets.get(key) ?? [];
      list.push(ref);
      buckets.set(key, list);
    }
    for (const [key, list] of buckets.entries()) {
      if (list.length < 2) continue;
      for (const ref of list) {
        const existing = out.get(ref.recordId) ?? [];
        existing.push({
          rule: "duplicate_natural_key",
          severity: config.severity,
          column: col,
          message: `${col} = "${key}" is duplicated across ${list.length} staged rows`,
        });
        out.set(ref.recordId, existing);
      }
    }
  }
  return out;
}
