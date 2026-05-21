"use client";

import React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, Check } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface DiscoveredModule {
  id: number;
  projectId: number;
  name: string;
  label: string;
  installed: boolean;
  enabled: boolean;
}

interface DiscoveredTable {
  id: number;
  projectId: number;
  moduleId: number;
  tableName: string;
  odooModel: string;
  type: "master" | "transaction";
  dateFilterColumn: string | null;
  importOrder: number;
  columns: Array<{ name: string; label?: string; type?: string }>;
  confidence: "high" | "medium" | "low";
  userClassified: boolean;
  enabled: boolean;
}

interface DiscoveredRelation {
  id: number;
  projectId: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete: "block" | "nullify" | "cascade";
  source: "introspect" | "manual";
}

interface DiscoveryPayload {
  modules: DiscoveredModule[];
  tables: DiscoveredTable[];
  relations: DiscoveredRelation[];
  allowedModules: string[];
}

export default function DiscoveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const projectId = Number(id);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [scanResult, setScanResult] = React.useState<{
    modulesDiscovered: number;
    tablesDiscovered: number;
    relationsDiscovered: number;
  } | null>(null);
  const [previewState, setPreviewState] = React.useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | {
        phase: "ready";
        installedModules: number;
        candidateModels: number;
      }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  const [scanStartedAt, setScanStartedAt] = React.useState<number | null>(null);

  const dataQuery = useQuery({
    queryKey: ["discovery", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/discovery`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as DiscoveryPayload;
    },
  });

  const scan = useMutation({
    mutationFn: async () => {
      setScanStartedAt(Date.now());
      const r = await fetch(`/api/projects/${projectId}/discovery/scan`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as {
        modulesDiscovered: number;
        tablesDiscovered: number;
        relationsDiscovered: number;
      };
    },
    onSuccess: (res) => {
      setScanResult(res);
      setScanError(null);
      queryClient.invalidateQueries({ queryKey: ["discovery", projectId] });
    },
    onError: (err) => {
      setScanError(err instanceof Error ? err.message : String(err));
      setScanResult(null);
    },
    onSettled: () => {
      setScanStartedAt(null);
    },
  });

  const loadPreview = async () => {
    setPreviewState({ phase: "loading" });
    try {
      const r = await fetch(`/api/projects/${projectId}/discovery/preview`);
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as {
        installedModules: number;
        candidateModels: number;
      };
      setPreviewState({
        phase: "ready",
        installedModules: data.installedModules,
        candidateModels: data.candidateModels,
      });
    } catch (err) {
      setPreviewState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const moduleMutation = useMutation({
    mutationFn: async ({ moduleId, enabled }: { moduleId: number; enabled: boolean }) => {
      const r = await fetch(
        `/api/projects/${projectId}/discovery/modules/${moduleId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discovery", projectId] });
    },
  });

  const tableMutation = useMutation({
    mutationFn: async ({
      tableId,
      patch,
    }: {
      tableId: number;
      patch: {
        type?: "master" | "transaction";
        dateFilterColumn?: string | null;
        importOrder?: number;
        enabled?: boolean;
        userClassified?: true;
      };
    }) => {
      const r = await fetch(
        `/api/projects/${projectId}/discovery/tables/${tableId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discovery", projectId] });
    },
  });

  const relationMutation = useMutation({
    mutationFn: async ({
      relationId,
      onDelete,
    }: {
      relationId: number;
      onDelete: "block" | "nullify" | "cascade";
    }) => {
      const r = await fetch(
        `/api/projects/${projectId}/discovery/relations/${relationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onDelete }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discovery", projectId] });
    },
  });

  if (dataQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading discovery state...</p>;
  }
  if (dataQuery.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load: {(dataQuery.error as Error).message}
      </p>
    );
  }
  const data = dataQuery.data!;

  const tablesByModule = new Map<number, DiscoveredTable[]>();
  for (const t of data.tables) {
    const arr = tablesByModule.get(t.moduleId) ?? [];
    arr.push(t);
    tablesByModule.set(t.moduleId, arr);
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}`}>← Back to project</Link>
        </Button>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Discovery</h1>
        <p className="text-muted-foreground">
          Scan the source DB for installed Odoo modules and table metadata.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source DB scan</CardTitle>
          <CardDescription>
            Reads <code>ir_module_module</code>, <code>ir_model</code>, and
            <code> information_schema</code> to propose tables and relations.
            Tables already provided by the built-in registry are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={loadPreview}
              disabled={previewState.phase === "loading"}
            >
              {previewState.phase === "loading" ? "Checking..." : "Check size first"}
            </Button>
            <Button
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              <Search className="mr-2 h-4 w-4" />
              {scan.isPending ? "Scanning..." : "Scan source DB"}
            </Button>
            {scan.isPending && scanStartedAt && (
              <ElapsedTimer startedAt={scanStartedAt} />
            )}
          </div>

          {previewState.phase === "ready" && (
            <p className="text-sm text-muted-foreground">
              Source DB has{" "}
              <strong>{previewState.installedModules}</strong> installed module
              {previewState.installedModules === 1 ? "" : "s"} and{" "}
              <strong>{previewState.candidateModels}</strong> candidate model
              {previewState.candidateModels === 1 ? "" : "s"}. Built-in tables
              (base / accounting / pos) will be skipped during the scan.
            </p>
          )}
          {previewState.phase === "error" && (
            <p className="text-sm text-red-700">
              Preview failed: {previewState.message}
            </p>
          )}

          {scanResult && (
            <p className="text-sm text-green-700">
              Discovered {scanResult.modulesDiscovered} new modules,{" "}
              {scanResult.tablesDiscovered} new tables,{" "}
              {scanResult.relationsDiscovered} new relations.
            </p>
          )}
          {scanError && <p className="text-sm text-red-700">{scanError}</p>}

          <p className="text-xs text-muted-foreground">
            Scanning reads <code>ir_module_module</code>, <code>ir_model</code>,
            and <code>pg_catalog</code> in bulk. Typical runtime: a few seconds
            even for large Odoo databases.
          </p>
        </CardContent>
      </Card>

      {data.modules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No discovery results yet. Click &quot;Scan source DB&quot; to begin.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.modules.map((mod) => {
            const moduleTables = tablesByModule.get(mod.id) ?? [];
            const isExpanded = expanded[mod.id] ?? false;
            const isActiveInPipeline = data.allowedModules.includes(mod.name);
            return (
              <Card key={mod.id}>
                <CardHeader className="cursor-pointer">
                  <div
                    className="flex items-center justify-between gap-3"
                    onClick={() =>
                      setExpanded((s) => ({ ...s, [mod.id]: !isExpanded }))
                    }
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <div>
                        <CardTitle className="text-base">
                          {mod.label}{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            ({mod.name})
                          </span>
                        </CardTitle>
                        <CardDescription>
                          {moduleTables.length} tables
                          {mod.installed && (
                            <Badge className="ml-2" variant="secondary">
                              installed
                            </Badge>
                          )}
                          {isActiveInPipeline && (
                            <Badge className="ml-2" variant="success">
                              active in pipeline
                            </Badge>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                    <label
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-sm">Enabled</span>
                      <Checkbox
                        checked={mod.enabled}
                        onCheckedChange={(v) =>
                          moduleMutation.mutate({
                            moduleId: mod.id,
                            enabled: v === true,
                          })
                        }
                      />
                    </label>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="space-y-3">
                    {moduleTables.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No tables in this module.
                      </p>
                    ) : (
                      moduleTables.map((tbl) => (
                        <TableRow
                          key={tbl.id}
                          table={tbl}
                          relations={data.relations.filter(
                            (r) => r.fromTable === tbl.tableName,
                          )}
                          onTableChange={(patch) =>
                            tableMutation.mutate({ tableId: tbl.id, patch })
                          }
                          onConfirm={() =>
                            tableMutation.mutate({
                              tableId: tbl.id,
                              patch: { userClassified: true },
                            })
                          }
                          onRelationChange={(relationId, onDelete) =>
                            relationMutation.mutate({ relationId, onDelete })
                          }
                        />
                      ))
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="text-sm text-muted-foreground">{elapsed}s elapsed</span>;
}

function TableRow({
  table,
  relations,
  onTableChange,
  onConfirm,
  onRelationChange,
}: {
  table: DiscoveredTable;
  relations: DiscoveredRelation[];
  onTableChange: (patch: {
    type?: "master" | "transaction";
    dateFilterColumn?: string | null;
    importOrder?: number;
    enabled?: boolean;
  }) => void;
  onConfirm: () => void;
  onRelationChange: (
    relationId: number,
    onDelete: "block" | "nullify" | "cascade",
  ) => void;
}) {
  const confidenceVariant: Record<DiscoveredTable["confidence"], "success" | "secondary" | "destructive"> = {
    high: "success",
    medium: "secondary",
    low: "destructive",
  };
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="font-mono text-sm">{table.tableName}</div>
          <div className="text-xs text-muted-foreground">{table.odooModel}</div>
        </div>
        <Badge variant={confidenceVariant[table.confidence]}>
          {table.confidence}
        </Badge>
        {table.userClassified && (
          <Badge variant="outline">
            <Check className="mr-1 h-3 w-3" />
            confirmed
          </Badge>
        )}
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={table.enabled}
            onCheckedChange={(v) => onTableChange({ enabled: v === true })}
          />
          <span className="text-xs">enabled</span>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={table.type}
            onChange={(e) =>
              onTableChange({ type: e.target.value as "master" | "transaction" })
            }
          >
            <option value="master">master</option>
            <option value="transaction">transaction</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Date filter column</label>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={table.dateFilterColumn ?? ""}
            onChange={(e) =>
              onTableChange({ dateFilterColumn: e.target.value || null })
            }
            disabled={table.type !== "transaction"}
          >
            <option value="">(none)</option>
            {table.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Import order</label>
          <Input
            type="number"
            value={table.importOrder}
            onChange={(e) =>
              onTableChange({ importOrder: Number(e.target.value) || 0 })
            }
          />
        </div>
      </div>

      {relations.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <div className="text-xs font-semibold text-muted-foreground">
            Foreign-key relations
          </div>
          <div className="space-y-1.5">
            {relations.map((rel) => (
              <div
                key={rel.id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="font-mono">
                  {rel.fromTable}.{rel.fromColumn} →{" "}
                  {rel.toTable}.{rel.toColumn}
                </span>
                <select
                  className="h-7 rounded-md border bg-background px-2 text-xs"
                  value={rel.onDelete}
                  onChange={(e) =>
                    onRelationChange(
                      rel.id,
                      e.target.value as "block" | "nullify" | "cascade",
                    )
                  }
                >
                  <option value="block">block</option>
                  <option value="nullify">nullify</option>
                  <option value="cascade">cascade</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {!table.userClassified && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onConfirm}>
            <Check className="mr-1 h-3 w-3" />
            Confirm classification
          </Button>
        </div>
      )}
    </div>
  );
}
