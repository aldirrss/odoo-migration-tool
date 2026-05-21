import type { QualityFinding, QualityRuleConfig } from "../types";

// U+FFFD (replacement char) and disallowed C0 control chars except \t \n \r.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[�\x00-\x08\x0B\x0C\x0E-\x1F]/;

export function checkEncodingIssue(args: {
  row: Record<string, unknown>;
  config: QualityRuleConfig;
}): QualityFinding[] {
  const { row, config } = args;
  if (!config.enabled) return [];
  const findings: QualityFinding[] = [];
  for (const [col, value] of Object.entries(row)) {
    if (typeof value !== "string") continue;
    if (BAD_CHARS.test(value)) {
      findings.push({
        rule: "encoding_issue",
        severity: config.severity,
        column: col,
        message: `${col} contains control characters or U+FFFD replacement chars`,
      });
    }
  }
  return findings;
}
