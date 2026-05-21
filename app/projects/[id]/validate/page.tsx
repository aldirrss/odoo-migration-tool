"use client";

import React, { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProgressStepper } from "@/components/progress-stepper";
import { useMigrationStore } from "@/lib/store";

interface ValidationSummary {
  table_name: string;
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  pending: number;
}

interface Project {
  id: number;
  targetProfileId: string | null;
}

export default function ValidatePage({
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

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) throw new Error(await r.text());
      return ((await r.json()) as { project: Project }).project;
    },
  });

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

  const summaryQuery = useQuery({
    queryKey: ["validation-summary", projectId, activeJobId],
    enabled: !!activeJobId,
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/validate/summary?jobId=${activeJobId}`,
      );
      return ((await r.json()) as { summary: ValidationSummary[] }).summary;
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onSuccess: () => summaryQuery.refetch(),
  });

  if (!activeJobId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Validate</h1>
        <ProgressStepper
          current="validate"
          completed={["connections", "extract", "clean"]}
          projectId={projectId}
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No active extraction job.
          </CardContent>
        </Card>
      </div>
    );
  }

  const totals = (summaryQuery.data ?? []).reduce(
    (acc, s) => ({
      passed: acc.passed + s.passed,
      warnings: acc.warnings + s.warnings,
      failed: acc.failed + s.failed,
      pending: acc.pending + s.pending,
    }),
    { passed: 0, warnings: 0, failed: 0, pending: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Validate</h1>
          <p className="text-muted-foreground">
            Check that all staged records can be imported into the target database.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => runMutation.mutate()}
          disabled={!projectQuery.data?.targetProfileId || runMutation.isPending}
        >
          {runMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Run validation
        </Button>
      </div>

      <ProgressStepper
        current="validate"
        completed={["connections", "extract", "clean"]}
        projectId={projectId}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Passed" value={totals.passed} variant="success" />
        <SummaryCard label="Warnings" value={totals.warnings} variant="warning" />
        <SummaryCard label="Failed" value={totals.failed} variant="destructive" />
        <SummaryCard label="Pending" value={totals.pending} variant="secondary" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By table</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead className="w-[100px] text-right">Total</TableHead>
                <TableHead className="w-[100px] text-right">Passed</TableHead>
                <TableHead className="w-[100px] text-right">Warnings</TableHead>
                <TableHead className="w-[100px] text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryQuery.data?.map((s) => (
                <TableRow key={s.table_name}>
                  <TableCell className="font-mono text-xs">{s.table_name}</TableCell>
                  <TableCell className="text-right font-mono">
                    {s.total.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-green-700">
                    {s.passed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-yellow-700">
                    {s.warnings > 0 ? s.warnings.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-700">
                    {s.failed > 0 ? s.failed.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(summaryQuery.data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No validation results yet. Click &ldquo;Run validation&rdquo;.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "warning" | "destructive" | "secondary";
}) {
  const icon =
    variant === "success" ? (
      <CheckCircle2 className="h-5 w-5 text-green-600" />
    ) : variant === "warning" ? (
      <AlertTriangle className="h-5 w-5 text-yellow-600" />
    ) : variant === "destructive" ? (
      <XCircle className="h-5 w-5 text-red-600" />
    ) : (
      <Loader2 className="h-5 w-5 text-muted-foreground" />
    );
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        {icon}
        <div>
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value.toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}
