"use client";

import React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Plus, Trash2, Save } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { moduleRegistry } from "@/lib/odoo/modules";
import { QualityRulesPanel } from "@/components/configuration/quality-rules-panel";
import type { QualityRulesConfig } from "@/lib/migration/quality/types";

type OnMissingDateColumn = "fallback" | "skip_filter" | "skip_table";

interface ProjectConfig {
  projectId: number;
  transactionDateFrom: string;
  dateFallbackEnabled: boolean;
  dateFallbackChain: string[];
  allowedModules: string[];
  onMissingDateColumn: OnMissingDateColumn;
  qualityRules?: QualityRulesConfig | null;
}

export default function ConfigurationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const projectId = Number(id);
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = React.useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const configQuery = useQuery({
    queryKey: ["project-config", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/config`);
      if (!r.ok) throw new Error(await r.text());
      return ((await r.json()) as { config: ProjectConfig }).config;
    },
  });

  const [draft, setDraft] = React.useState<ProjectConfig | null>(null);

  React.useEffect(() => {
    if (configQuery.data && !draft) {
      setDraft(configQuery.data);
    }
  }, [configQuery.data, draft]);

  const mutation = useMutation({
    mutationFn: async (payload: ProjectConfig) => {
      const r = await fetch(`/api/projects/${projectId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionDateFrom: payload.transactionDateFrom,
          dateFallbackEnabled: payload.dateFallbackEnabled,
          dateFallbackChain: payload.dateFallbackChain,
          allowedModules: payload.allowedModules,
          onMissingDateColumn: payload.onMissingDateColumn,
          qualityRules: payload.qualityRules ?? null,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return ((await r.json()) as { config: ProjectConfig }).config;
    },
    onSuccess: (saved) => {
      setDraft(saved);
      queryClient.setQueryData(["project-config", projectId], saved);
      setFeedback({ kind: "success", message: "Configuration saved." });
    },
    onError: (err) => {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  if (configQuery.isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Loading configuration...</p>;
  }
  if (configQuery.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load: {(configQuery.error as Error).message}
      </p>
    );
  }

  const updateChainAt = (idx: number, value: string) => {
    const next = [...draft.dateFallbackChain];
    next[idx] = value;
    setDraft({ ...draft, dateFallbackChain: next });
  };
  const moveChain = (idx: number, dir: -1 | 1) => {
    const next = [...draft.dateFallbackChain];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    setDraft({ ...draft, dateFallbackChain: next });
  };
  const removeChain = (idx: number) => {
    if (draft.dateFallbackChain.length <= 1) return;
    const next = draft.dateFallbackChain.filter((_, i) => i !== idx);
    setDraft({ ...draft, dateFallbackChain: next });
  };
  const addChain = () => {
    setDraft({
      ...draft,
      dateFallbackChain: [...draft.dateFallbackChain, ""],
    });
  };

  const toggleModule = (name: string, on: boolean) => {
    const set = new Set(draft.allowedModules);
    if (on) set.add(name);
    else set.delete(name);
    setDraft({ ...draft, allowedModules: Array.from(set) });
  };

  const onSave = () => {
    setFeedback(null);
    const cleaned = {
      ...draft,
      dateFallbackChain: draft.dateFallbackChain
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
    if (cleaned.dateFallbackChain.length === 0) {
      setFeedback({ kind: "error", message: "Fallback chain must have at least one column." });
      return;
    }
    mutation.mutate(cleaned);
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}`}>← Back to project</Link>
        </Button>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground">
          Per-project settings for extraction date filtering and allowed modules.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction Date</CardTitle>
          <CardDescription>
            Records in transaction tables with a date &gt;= this value will be extracted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="transactionDateFrom">From date</Label>
            <Input
              id="transactionDateFrom"
              type="date"
              value={draft.transactionDateFrom}
              onChange={(e) =>
                setDraft({ ...draft, transactionDateFrom: e.target.value })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Date Fallback</CardTitle>
          <CardDescription>
            When a table&apos;s declared date column does not exist in the source DB,
            use this fallback strategy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={draft.dateFallbackEnabled}
              onCheckedChange={(v) =>
                setDraft({ ...draft, dateFallbackEnabled: v === true })
              }
            />
            <span className="text-sm">Enable date-column fallback</span>
          </label>

          <div className="space-y-2">
            <Label>Fallback chain (in order)</Label>
            <p className="text-xs text-muted-foreground">
              Tried top-to-bottom. The first column that exists on the table wins.
            </p>
            <div className="space-y-2">
              {draft.dateFallbackChain.map((col, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={col}
                    onChange={(e) => updateChainAt(idx, e.target.value)}
                    placeholder="column name"
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => moveChain(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => moveChain(idx, 1)}
                    disabled={idx === draft.dateFallbackChain.length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeChain(idx)}
                    disabled={draft.dateFallbackChain.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={addChain}>
                <Plus className="mr-1 h-3 w-3" />
                Add column
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>If no date column matches</Label>
            <div className="space-y-1.5">
              {(
                [
                  ["fallback", "Use fallback chain above"],
                  ["skip_filter", "Skip filter, extract all rows"],
                  ["skip_table", "Skip the table entirely"],
                ] as Array<[OnMissingDateColumn, string]>
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="onMissingDateColumn"
                    value={value}
                    checked={draft.onMissingDateColumn === value}
                    onChange={() =>
                      setDraft({ ...draft, onMissingDateColumn: value })
                    }
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed Modules</CardTitle>
          <CardDescription>
            Only tables from modules checked below will be included in extraction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {moduleRegistry.map((mod) => {
              const masterCount = mod.tables.filter((t) => t.type === "master").length;
              const transactionCount = mod.tables.filter(
                (t) => t.type === "transaction",
              ).length;
              const checked = draft.allowedModules.includes(mod.name);
              return (
                <label
                  key={mod.name}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleModule(mod.name, v === true)}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="font-medium text-sm">{mod.label}</div>
                    <div className="text-xs text-muted-foreground">{mod.name}</div>
                    <div className="flex gap-1.5 pt-1">
                      <Badge variant="secondary">{mod.tables.length} tables</Badge>
                      {masterCount > 0 && (
                        <Badge variant="outline">{masterCount} master</Badge>
                      )}
                      {transactionCount > 0 && (
                        <Badge variant="outline">{transactionCount} txn</Badge>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <QualityRulesPanel
        value={draft.qualityRules ?? null}
        onChange={(next) => setDraft({ ...draft, qualityRules: next })}
      />

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-md border bg-background/95 p-3 shadow backdrop-blur">
        {feedback && (
          <span
            className={
              feedback.kind === "success"
                ? "text-sm text-green-700"
                : "text-sm text-red-700"
            }
          >
            {feedback.message}
          </span>
        )}
        <Button onClick={onSave} disabled={mutation.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {mutation.isPending ? "Saving..." : "Save configuration"}
        </Button>
      </div>
    </div>
  );
}
