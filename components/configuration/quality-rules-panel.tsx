"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEFAULT_QUALITY_RULES,
  QUALITY_RULE_DESCRIPTIONS,
  type QualityRuleCode,
  type QualityRulesConfig,
  type Severity,
} from "@/lib/migration/quality/types";

export function QualityRulesPanel({
  value,
  onChange,
}: {
  value: QualityRulesConfig | null | undefined;
  onChange: (next: QualityRulesConfig) => void;
}) {
  const effective: QualityRulesConfig = React.useMemo(() => {
    const merged: QualityRulesConfig = { ...DEFAULT_QUALITY_RULES };
    if (value) {
      for (const key of Object.keys(DEFAULT_QUALITY_RULES) as QualityRuleCode[]) {
        const override = value[key];
        if (override) merged[key] = { ...merged[key], ...override };
      }
    }
    return merged;
  }, [value]);

  const updateRule = (
    rule: QualityRuleCode,
    patch: Partial<QualityRulesConfig[QualityRuleCode]>,
  ) => {
    const next: QualityRulesConfig = {
      ...effective,
      [rule]: { ...effective[rule], ...patch },
    };
    onChange(next);
  };

  const ruleCodes = Object.keys(DEFAULT_QUALITY_RULES) as QualityRuleCode[];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quality Rules</CardTitle>
        <CardDescription>
          Configure the data-quality scan run automatically after each
          extraction. Findings appear as colored badges in the staging table.
          Block-severity rules prevent import unless individually acknowledged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {ruleCodes.map((code) => {
            const cfg = effective[code];
            return (
              <div
                key={code}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={cfg.enabled}
                    onCheckedChange={(v) =>
                      updateRule(code, { enabled: v === true })
                    }
                  />
                  <span className="font-mono text-xs">{code}</span>
                </label>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">severity:</span>
                  <select
                    className="h-7 rounded-md border bg-background px-2 text-xs"
                    value={cfg.severity}
                    onChange={(e) =>
                      updateRule(code, { severity: e.target.value as Severity })
                    }
                  >
                    <option value="block">block</option>
                    <option value="warn">warn</option>
                  </select>
                </div>
                <p className="flex-1 basis-full text-xs text-muted-foreground sm:basis-auto">
                  {QUALITY_RULE_DESCRIPTIONS[code]}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
