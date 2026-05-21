import type { QualityFinding, QualityRuleConfig } from "../types";

const DATE_COL = /^(date|date_.*|.*_date)$/;
const FIVE_YEARS_MS = 5 * 365 * 24 * 3600 * 1000;

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function checkStaleDate(args: {
  row: Record<string, unknown>;
  cutoffDate: Date;
  config: QualityRuleConfig;
}): QualityFinding[] {
  const { row, cutoffDate, config } = args;
  if (!config.enabled) return [];
  const threshold = new Date(cutoffDate.getTime() - FIVE_YEARS_MS);
  const findings: QualityFinding[] = [];
  for (const [col, value] of Object.entries(row)) {
    if (!DATE_COL.test(col)) continue;
    const d = parseDate(value);
    if (!d) continue;
    if (d.getTime() < threshold.getTime()) {
      findings.push({
        rule: "stale_date",
        severity: config.severity,
        column: col,
        message: `${col} = ${d.toISOString().slice(0, 10)} is older than 5 years before cutoff`,
      });
    }
  }
  return findings;
}
