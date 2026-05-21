import type { QualityFinding, QualityRuleConfig } from "../types";

const NUMERIC_COL = /^(amount_|price_|qty_|cost_)/;

export function checkSuspiciousNegative(args: {
  row: Record<string, unknown>;
  config: QualityRuleConfig;
}): QualityFinding[] {
  const { row, config } = args;
  if (!config.enabled) return [];
  const findings: QualityFinding[] = [];
  for (const [col, value] of Object.entries(row)) {
    if (!NUMERIC_COL.test(col)) continue;
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) continue;
    if (num < 0) {
      findings.push({
        rule: "suspicious_negative",
        severity: config.severity,
        column: col,
        message: `${col} = ${num} is negative`,
      });
    }
  }
  return findings;
}
