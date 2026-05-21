import type { QualityFinding, QualityRuleConfig } from "../types";

const DATE_COL = /^(date|date_.*|.*_date)$/;

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function checkFutureDate(args: {
  row: Record<string, unknown>;
  config: QualityRuleConfig;
  now?: Date;
}): QualityFinding[] {
  const { row, config, now = new Date() } = args;
  if (!config.enabled) return [];
  const findings: QualityFinding[] = [];
  for (const [col, value] of Object.entries(row)) {
    if (!DATE_COL.test(col)) continue;
    const d = parseDate(value);
    if (!d) continue;
    if (d.getTime() > now.getTime()) {
      findings.push({
        rule: "future_date",
        severity: config.severity,
        column: col,
        message: `${col} = ${d.toISOString().slice(0, 10)} is in the future`,
      });
    }
  }
  return findings;
}
