"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeftRight, Eye, Pencil, RotateCcw } from "lucide-react";

export type ViewMode = "source" | "edit" | "split";

interface SplitViewProps {
  sourceData: Record<string, unknown>;
  stagedData: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onReset?: () => void;
}

export function SplitViewEditor({
  sourceData,
  stagedData,
  onChange,
  onReset,
}: SplitViewProps) {
  const [mode, setMode] = useState<ViewMode>("split");
  const fieldNames = useMemo(() => {
    const set = new Set<string>([...Object.keys(sourceData), ...Object.keys(stagedData)]);
    return Array.from(set).sort();
  }, [sourceData, stagedData]);

  function updateField(field: string, value: string) {
    onChange({ ...stagedData, [field]: parseValue(value, sourceData[field]) });
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
}

function FieldPanel({
  title,
  data,
  fieldNames,
  editable,
  stagedData,
  sourceData,
  onFieldChange,
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
          return (
            <div key={field} className="grid grid-cols-[140px_1fr] items-center gap-2">
              <label
                className={cn(
                  "truncate text-xs font-medium",
                  isChanged ? "text-yellow-600" : "text-muted-foreground",
                )}
                title={field}
              >
                {field}
              </label>
              {editable ? (
                <Input
                  className={cn("h-8 text-xs", isChanged && "border-yellow-500 bg-yellow-50")}
                  value={stringify(value)}
                  onChange={(e) => onFieldChange?.(field, e.target.value)}
                />
              ) : (
                <div
                  className={cn(
                    "min-h-8 truncate rounded border bg-muted/30 px-2 py-1 text-xs",
                    isChanged && "bg-yellow-50",
                  )}
                  title={stringify(value)}
                >
                  {stringify(value)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
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
