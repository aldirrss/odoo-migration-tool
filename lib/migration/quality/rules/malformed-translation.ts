import type { QualityFinding, QualityRuleConfig } from "../types";
import { isTranslationDict } from "../../../odoo/translation";

const LOCALE_LIKE = /^[a-z]{2}(_[A-Z]{2})?$/;

/**
 * If any object-valued column looks "locale-shaped" (most keys match the
 * locale regex) but isTranslationDict() rejects it (e.g. non-string values
 * or rogue keys), surface a finding.
 */
export function checkMalformedTranslation(args: {
  row: Record<string, unknown>;
  config: QualityRuleConfig;
}): QualityFinding[] {
  const { row, config } = args;
  if (!config.enabled) return [];
  const findings: QualityFinding[] = [];

  for (const [col, value] of Object.entries(row)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    if (isTranslationDict(value)) continue;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) continue;
    const localeKeyCount = keys.filter((k) => LOCALE_LIKE.test(k)).length;
    if (localeKeyCount === 0) continue;
    // Treat as translation-shaped if >= 50% of keys are locale-like.
    if (localeKeyCount * 2 < keys.length) continue;
    findings.push({
      rule: "malformed_translation",
      severity: config.severity,
      column: col,
      message: `${col} looks like a translation dict but has invalid keys or non-string values`,
    });
  }
  return findings;
}
