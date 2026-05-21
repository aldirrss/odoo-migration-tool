"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Building2,
  Calculator,
  Users,
  Package,
  ShoppingCart,
  TrendingUp,
  Factory,
  FolderKanban,
  Handshake,
  CreditCard,
  Mail,
  Database,
  AlertOctagon,
  AlertTriangle,
} from "lucide-react";
import { useMigrationStore } from "@/lib/store";

import { ProgressStepper } from "@/components/progress-stepper";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { moduleRegistry } from "@/lib/odoo/modules";

interface TableStat {
  table_name: string;
  total: number;
  dirty: number;
  deleted: number;
  validation_failed: number;
  validation_warning: number;
  quality_block: number;
  quality_warn: number;
}

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  base: Building2,
  accounting: Calculator,
  hr: Users,
  stock: Package,
  purchase: ShoppingCart,
  sale: TrendingUp,
  mrp: Factory,
  project: FolderKanban,
  crm: Handshake,
  pos: CreditCard,
  mail: Mail,
};

export default function StagingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const projectId = Number(id);
  const { activeJobId, setActiveJob, setCurrentProject } = useMigrationStore();
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const latestJobQuery = useQuery({
    queryKey: ["project-latest-extraction", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/extract/latest`);
      if (!r.ok) return null;
      return ((await r.json()) as { job: { id: number } | null }).job;
    },
  });

  useEffect(() => {
    if (latestJobQuery.data && !activeJobId) {
      setActiveJob(latestJobQuery.data.id);
    }
  }, [latestJobQuery.data, activeJobId, setActiveJob]);

  const statsQuery = useQuery({
    queryKey: ["staging-stats", projectId, activeJobId],
    enabled: !!activeJobId,
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/staging/stats?jobId=${activeJobId}`,
      );
      if (!r.ok) {
        setActiveJob(null);
        return [] as TableStat[];
      }
      return ((await r.json()) as { stats: TableStat[] }).stats;
    },
  });

  const toggleModule = (name: string) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (!activeJobId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Clean Data</h1>
        <ProgressStepper
          current="clean"
          completed={["connections", "extract"]}
          projectId={projectId}
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No active extraction job. Run an extraction first.
          </CardContent>
        </Card>
      </div>
    );
  }

  const statsByTable = new Map(statsQuery.data?.map((s) => [s.table_name, s]) ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Clean Data</h1>
        <p className="text-muted-foreground">
          Browse staged tables. Click a table to open the split-view editor.
        </p>
      </div>

      <ProgressStepper
        current="clean"
        completed={["connections", "extract"]}
        projectId={projectId}
      />

      {moduleRegistry.map((mod) => {
        const isCollapsed = collapsedModules.has(mod.name);
        const Icon = MODULE_ICONS[mod.name] ?? Database;

        // Aggregate module-level stats
        const modTotal = mod.tables.reduce(
          (sum, t) => sum + (statsByTable.get(t.tableName)?.total ?? 0),
          0,
        );
        const modQualityBlock = mod.tables.reduce(
          (sum, t) => sum + (statsByTable.get(t.tableName)?.quality_block ?? 0),
          0,
        );
        const modQualityWarn = mod.tables.reduce(
          (sum, t) => sum + (statsByTable.get(t.tableName)?.quality_warn ?? 0),
          0,
        );

        return (
          <Card key={mod.name}>
            <CardHeader
              className="cursor-pointer select-none py-4 transition-colors hover:bg-muted/30"
              onClick={() => toggleModule(mod.name)}
            >
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>{mod.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    ({mod.tables.length} tables)
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {modTotal > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {modTotal.toLocaleString()} records
                    </span>
                  )}
                  {modQualityBlock > 0 && (
                    <span className="flex items-center gap-1 text-xs font-normal text-red-600">
                      <AlertOctagon className="h-3.5 w-3.5" />
                      {modQualityBlock.toLocaleString()} block
                    </span>
                  )}
                  {modQualityWarn > 0 && (
                    <span className="flex items-center gap-1 text-xs font-normal text-yellow-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {modQualityWarn.toLocaleString()} warn
                    </span>
                  )}
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardTitle>
            </CardHeader>

            {!isCollapsed && (
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead className="w-[100px]">Type</TableHead>
                      <TableHead className="w-[100px] text-right">Total</TableHead>
                      <TableHead className="w-[100px] text-right">Dirty</TableHead>
                      <TableHead className="w-[100px] text-right">Deleted</TableHead>
                      <TableHead className="w-[160px] text-right">Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mod.tables.map((t) => {
                      const s = statsByTable.get(t.tableName);
                      return (
                        <TableRow key={t.tableName}>
                          <TableCell>
                            <Link
                              href={`/projects/${projectId}/staging/${t.tableName}`}
                              className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                            >
                              {t.tableName}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {t.label}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={t.type === "master" ? "outline" : "secondary"}
                            >
                              {t.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {(s?.total ?? 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {s?.dirty ? (
                              <span className="text-yellow-600">{s.dirty}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {s?.deleted ? (
                              <span className="text-red-600">{s.deleted}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {s?.validation_failed ? (
                                <Badge variant="destructive">
                                  {s.validation_failed} fail
                                </Badge>
                              ) : s?.validation_warning ? (
                                <Badge variant="warning">
                                  {s.validation_warning} warn
                                </Badge>
                              ) : null}
                              {s?.quality_block ? (
                                <span className="flex items-center gap-0.5 text-[11px] text-red-600">
                                  <AlertOctagon className="h-3 w-3" />
                                  {s.quality_block}
                                </span>
                              ) : null}
                              {s?.quality_warn ? (
                                <span className="flex items-center gap-0.5 text-[11px] text-yellow-600">
                                  <AlertTriangle className="h-3 w-3" />
                                  {s.quality_warn}
                                </span>
                              ) : null}
                              {!s?.validation_failed &&
                                !s?.validation_warning &&
                                !s?.quality_block &&
                                !s?.quality_warn && (
                                  <span className="text-xs text-muted-foreground">
                                    —
                                  </span>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
