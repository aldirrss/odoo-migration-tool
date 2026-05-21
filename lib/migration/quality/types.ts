/**
 * Types for the auto data-quality screening pipeline.
 *
 * Findings are written per-row into `staged_records.qualityFlags` (jsonb array)
 * with a denormalized `qualitySeverity` for cheap filtering and index lookups.
 */

export type Severity = "ok" | "warn" | "block";

export type QualityRuleCode =
  | "orphan_fk"
  | "missing_required"
  | "malformed_translation"
  | "duplicate_natural_key"
  | "future_date"
  | "stale_date"
  | "suspicious_negative"
  | "encoding_issue";

export interface QualityFinding {
  rule: QualityRuleCode;
  severity: Severity;
  column: string;
  message: string;
}

export interface QualityRuleConfig {
  severity: Severity;
  enabled: boolean;
}

export type QualityRulesConfig = Record<QualityRuleCode, QualityRuleConfig>;

export const DEFAULT_QUALITY_RULES: QualityRulesConfig = {
  orphan_fk: { severity: "block", enabled: true },
  missing_required: { severity: "block", enabled: true },
  malformed_translation: { severity: "block", enabled: true },
  duplicate_natural_key: { severity: "warn", enabled: true },
  future_date: { severity: "warn", enabled: true },
  stale_date: { severity: "warn", enabled: false },
  suspicious_negative: { severity: "warn", enabled: true },
  encoding_issue: { severity: "warn", enabled: true },
};

export const QUALITY_RULE_DESCRIPTIONS: Record<QualityRuleCode, string> = {
  orphan_fk: "Foreign key references a row that doesn't exist in staging or target",
  missing_required: "NOT NULL column on target schema is empty",
  malformed_translation: "Translatable JSONB column has invalid locale shape",
  duplicate_natural_key: "Natural key column collides with another staged row",
  future_date: "Date or datetime column is in the future",
  stale_date: "Date or datetime column is older than 5 years before cutoff",
  suspicious_negative: "Numeric amount/price/qty column is negative",
  encoding_issue: "Text column contains control characters or U+FFFD",
};

export interface QualityScanResult {
  scanned: number;
  flagged: number;
}

/** Worst-of helper: block > warn > ok. */
export function maxSeverity(...sevs: Severity[]): Severity {
  if (sevs.includes("block")) return "block";
  if (sevs.includes("warn")) return "warn";
  return "ok";
}
