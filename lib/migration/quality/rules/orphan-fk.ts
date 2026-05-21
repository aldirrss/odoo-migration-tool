import type { QualityFinding, QualityRuleConfig } from "../types";
import type { RelationDefinition } from "../../../odoo/types";
import { inferFkRelation } from "../../../odoo/fk-heuristics";

const FK_COL = /_id$/;

/**
 * For every `*_id` column with a positive integer value, resolve the target
 * table (declared relations first, then inferred). Flag when the referenced
 * id does not exist in `existingIds[targetTable]`.
 */
export function checkOrphanFk(args: {
  row: Record<string, unknown>;
  tableName: string;
  relations: RelationDefinition[];
  existingIds: Map<string, Set<number>>;
  config: QualityRuleConfig;
}): QualityFinding[] {
  const { row, tableName, relations, existingIds, config } = args;
  if (!config.enabled) return [];
  const findings: QualityFinding[] = [];

  const declaredByCol = new Map<string, RelationDefinition>();
  for (const rel of relations) declaredByCol.set(rel.fromColumn, rel);

  for (const [col, value] of Object.entries(row)) {
    if (!FK_COL.test(col)) continue;
    if (value === null || value === undefined) continue;
    const refId = Number(value);
    if (!Number.isFinite(refId) || refId <= 0) continue;
    const rel = declaredByCol.get(col) ?? inferFkRelation(tableName, col);
    if (!rel) continue;
    const set = existingIds.get(rel.toTable);
    if (!set || !set.has(refId)) {
      findings.push({
        rule: "orphan_fk",
        severity: config.severity,
        column: col,
        message: `${col} = ${refId} references ${rel.toTable}.id but no such row exists in staging or target`,
      });
    }
  }
  return findings;
}
