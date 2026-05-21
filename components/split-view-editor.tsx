"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight,
  ExternalLink,
  Eye,
  Globe,
  Pencil,
  RotateCcw,
} from "lucide-react";
import type { RelationDefinition } from "@/lib/odoo/types";
import {
  isTranslationDict,
  unwrapTranslation,
  wrapTranslation,
} from "@/lib/odoo/translation";

export type ViewMode = "source" | "edit" | "split";

interface SplitViewProps {
  sourceData: Record<string, unknown>;
  stagedData: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onReset?: () => void;
  /**
   * Optional FK resolver. If provided, each field whose column resolves to a
   * relation AND whose value is a positive integer gets a preview button.
   */
  getFk?: (column: string) => RelationDefinition | null;
  /** Called when the user clicks the FK preview button on a field. */
  onPreviewFk?: (relation: RelationDefinition, sourceId: number) => void;
}

export function SplitViewEditor({
  sourceData,
  stagedData,
  onChange,
  onReset,
  getFk,
  onPreviewFk,
}: SplitViewProps) {
  const [mode, setMode] = useState<ViewMode>("split");
  const fieldNames = useMemo(() => {
    const set = new Set<string>([...Object.keys(sourceData), ...Object.keys(stagedData)]);
    return Array.from(set).sort();
  }, [sourceData, stagedData]);

  function updateField(field: string, value: string) {
    const currentStaged = stagedData[field];
    const original = sourceData[field];
    // Translation fields: rewrap text into the JSONB, preserving other locales.
    if (isTranslationDict(currentStaged)) {
      onChange({
        ...stagedData,
        [field]: wrapTranslation(currentStaged, value),
      });
      return;
    }
    if (isTranslationDict(original)) {
      onChange({
        ...stagedData,
        [field]: wrapTranslation(original, value),
      });
      return;
    }
    onChange({ ...stagedData, [field]: parseValue(value, original) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="source">
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Source
            </TabsTrigger>
            <TabsTrigger value="edit">
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </TabsTrigger>
            <TabsTrigger value="split">
              <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />
              Split
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {onReset && (
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset to source
          </Button>
        )}
      </div>

      <div
        className={cn(
          "grid gap-4 rounded-md border bg-card p-4",
          mode === "split" ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {(mode === "source" || mode === "split") && (
          <FieldPanel
            title="Source (read-only)"
            data={sourceData}
            fieldNames={fieldNames}
            editable={false}
            stagedData={stagedData}
            getFk={getFk}
            onPreviewFk={onPreviewFk}
          />
        )}
        {(mode === "edit" || mode === "split") && (
          <FieldPanel
            title="Staging (editable)"
            data={stagedData}
            fieldNames={fieldNames}
            editable
            stagedData={stagedData}
            sourceData={sourceData}
            onFieldChange={updateField}
            getFk={getFk}
            onPreviewFk={onPreviewFk}
          />
        )}
      </div>
    </div>
  );
}

interface FieldPanelProps {
  title: string;
  data: Record<string, unknown>;
  fieldNames: string[];
  editable: boolean;
  stagedData: Record<string, unknown>;
  sourceData?: Record<string, unknown>;
  onFieldChange?: (field: string, value: string) => void;
  getFk?: (column: string) => RelationDefinition | null;
  onPreviewFk?: (relation: RelationDefinition, sourceId: number) => void;
}

function FieldPanel({
  title,
  data,
  fieldNames,
  editable,
  stagedData,
  sourceData,
  onFieldChange,
  getFk,
  onPreviewFk,
}: FieldPanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {fieldNames.map((field) => {
          const value = data[field];
          const sourceValue = sourceData ? sourceData[field] : stagedData[field];
          const isChanged =
            JSON.stringify(value) !== JSON.stringify(stagedData[field])
              ? false
              : editable
                ? JSON.stringify(value) !== JSON.stringify(sourceValue)
                : JSON.stringify(sourceValue) !== JSON.stringify(stagedData[field]);
          const fkRel = getFk?.(field) ?? null;
          const numericValue =
            typeof value === "number" && value > 0 ? value : null;
          const showFkButton =
            fkRel !== null && numericValue !== null && !!onPreviewFk;
          const translationInfo = unwrapTranslation(value);
          return (
            <div key={field} className="grid grid-cols-[140px_1fr] items-center gap-2">
              <label
                className={cn(
                  "flex items-center gap-1 truncate text-xs font-medium",
                  isChanged ? "text-yellow-600" : "text-muted-foreground",
                )}
                title={
                  translationInfo
                    ? `${field} (translatable, showing ${translationInfo.locale})`
                    : field
                }
              >
                {translationInfo && <Globe className="h-3 w-3 shrink-0" />}
                <span className="truncate">{field}</span>
              </label>
              <div className="flex items-center gap-1">
                {editable ? (
                  <Input
                    className={cn(
                      "h-8 text-xs",
                      isChanged && "border-yellow-500 bg-yellow-50",
                    )}
                    value={stringify(value)}
                    onChange={(e) => onFieldChange?.(field, e.target.value)}
                  />
                ) : (
                  <div
                    className={cn(
                      "min-h-8 flex-1 truncate rounded border bg-muted/30 px-2 py-1 text-xs",
                      isChanged && "bg-yellow-50",
                    )}
                    title={stringify(value)}
                  >
                    {stringify(value)}
                  </div>
                )}
                {showFkButton && (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={`Preview ${fkRel.toTable}#${numericValue}`}
                    onClick={() => onPreviewFk?.(fkRel, numericValue)}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Odoo translation field: render only the preferred locale's text.
  const t = unwrapTranslation(v);
  if (t) return t.text;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function parseValue(raw: string, original: unknown): unknown {
  if (raw === "") return null;
  if (typeof original === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (typeof original === "boolean") {
    return raw === "true" || raw === "1";
  }
  if (typeof original === "object" && original !== null) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
