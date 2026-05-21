"use client";

import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
}

export default function StagingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const projectId = Number(id);
  const { activeJobId, setActiveJob, setCurrentProject } = useMigrationStore();

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
      return ((await r.json()) as { stats: TableStat[] }).stats;
    },
  });

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

      {moduleRegistry.map((mod) => (
        <Card key={mod.name}>
          <CardHeader>
            <CardTitle className="text-base">{mod.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead className="w-[100px] text-right">Total</TableHead>
                  <TableHead className="w-[100px] text-right">Dirty</TableHead>
                  <TableHead className="w-[100px] text-right">Deleted</TableHead>
                  <TableHead className="w-[120px] text-right">Issues</TableHead>
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
                        <div className="text-xs text-muted-foreground">{t.label}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.type === "master" ? "outline" : "secondary"}>
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
                        {s?.validation_failed ? (
                          <Badge variant="destructive">{s.validation_failed} fail</Badge>
                        ) : s?.validation_warning ? (
                          <Badge variant="warning">{s.validation_warning} warn</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
