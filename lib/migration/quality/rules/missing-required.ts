import type { QualityFinding, QualityRuleConfig } from "../types";

/**
 * Flags rows where a target NOT-NULL column has a null/empty value in stagedData.
 * The set of required columns is resolved from the target DB's pg_catalog
 * (see orchestrator).
 */
export function checkMissingRequired(args: {
  row: Record<string, unknown>;
  requiredColumns: Set<string>;
  config: QualityRuleConfig;
}): QualityFinding[] {
  const { row, requiredColumns, config } = args;
  if (!config.enabled) return [];
  const findings: QualityFinding[] = [];
  for (const col of requiredColumns) {
    const value = row[col];
    if (value === null || value === undefined) {
      findings.push({
        rule: "missing_required",
        severity: config.severity,
        column: col,
        message: `${col} is required (NOT NULL on target) but is empty`,
      });
      continue;
    }
    if (typeof value === "string" && value.length === 0) {
      findings.push({
        rule: "missing_required",
        severity: config.severity,
        column: col,
        message: `${col} is required (NOT NULL on target) but is empty string`,
      });
    }
  }
  return findings;
}
