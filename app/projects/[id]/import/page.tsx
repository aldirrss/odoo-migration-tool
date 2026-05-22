"use client";

import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  Upload,
  AlertTriangle,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

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

interface ImportSummary {
  table_name: string;
  total: number;
  success: number;
  errors: number;
  skipped: number;
  pending: number;
}

interface Project {
  id: number;
  targetProfileId: string | null;
}

interface ImportRunState {
  jobId: number;
  running: boolean;
  currentTable: string | null;
  processedTables: number;
  totalTables: number;
  processedRecords: number;
  totalRecords: number;
  cancelRequested: boolean;
  error: string | null;
}

export default function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const projectId = Number(id);
  const { activeJobId, setActiveJob, setCurrentProject } = useMigrationStore();
  const [optimisticRunning, setOptimisticRunning] = useState(false);
  const [completionBanner, setCompletionBanner] = useState<{
    success: number;
    errors: number;
    skipped: number;
  } | null>(null);
  const prevRunningRef = useRef(false);

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
    queryKey: ["import-summary", projectId, activeJobId],
    enabled: !!activeJobId,
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/import/summary?jobId=${activeJobId}`,
      );
      if (!r.ok) {
        setActiveJob(null);
        return [] as ImportSummary[];
      }
      return ((await r.json()) as { summary: ImportSummary[] }).summary;
    },
  });

  const importStatusQuery = useQuery({
    queryKey: ["import-status", projectId, activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data as ImportRunState | { running: false } | undefined;
      return data && "running" in data && data.running ? 2000 : false;
    },
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/import/status?jobId=${activeJobId}`,
      );
      if (!r.ok) return { running: false } as { running: false };
      return (await r.json()) as ImportRunState | { running: false };
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onMutate: () => {
      setOptimisticRunning(true);
    },
    onSuccess: () => {
      importStatusQuery.refetch();
    },
    onError: () => {
      setOptimisticRunning(false);
    },
  });

  // Clear optimistic flag once server confirms running state
  useEffect(() => {
    const data = importStatusQuery.data;
    if (!data) return;
    if ("running" in data && !data.running) setOptimisticRunning(false);
  }, [importStatusQuery.data]);

  const serverRunning =
    importStatusQuery.data &&
    "running" in importStatusQuery.data &&
    (importStatusQuery.data as ImportRunState).running === true;

  const running = optimisticRunning || !!serverRunning;

  // Show completion banner when import transitions from running → done
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      summaryQuery.refetch().then((result) => {
        const data = result.data ?? [];
        const snap = data.reduce(
          (acc, s) => ({
            success: acc.success + s.success,
            errors: acc.errors + s.errors,
            skipped: acc.skipped + s.skipped,
          }),
          { success: 0, errors: 0, skipped: 0 },
        );
        setCompletionBanner(snap);
      });
    }
    prevRunningRef.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Tab-close protection while import is running
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  // Soft-block the browser Back button while import is running
  useEffect(() => {
    if (!running) return;
    window.history.pushState({ importGuard: true }, "");
    const handler = () => {
      window.history.pushState({ importGuard: true }, "");
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [running]);

  if (!activeJobId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Import</h1>
        <ProgressStepper
          current="import"
          completed={["connections", "extract", "clean", "validate"]}
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
      total: acc.total + s.total,
      success: acc.success + s.success,
      errors: acc.errors + s.errors,
      skipped: acc.skipped + s.skipped,
    }),
    { total: 0, success: 0, errors: 0, skipped: 0 },
  );

  const importState =
    importStatusQuery.data && "jobId" in importStatusQuery.data
      ? (importStatusQuery.data as ImportRunState)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Import</h1>
          <p className="text-muted-foreground">
            Write cleaned staging data into the target database.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            if (
              confirm(
                "This will write data into the target database. Make sure the target is a fresh DB and has been backed up. Continue?",
              )
            ) {
              runMutation.mutate();
            }
          }}
          disabled={
            !projectQuery.data?.targetProfileId ||
            running ||
            (!!activeJobId && importStatusQuery.isLoading)
          }
        >
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Run import
        </Button>
      </div>

      <ProgressStepper
        current="import"
        completed={["connections", "extract", "clean", "validate"]}
        projectId={projectId}
      />

      {completionBanner && (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            completionBanner.errors > 0
              ? "border-red-200 bg-red-50 text-red-800"
              : completionBanner.skipped > 0
                ? "border-yellow-200 bg-yellow-50 text-yellow-800"
                : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {completionBanner.errors > 0 ? (
              <XCircle className="h-4 w-4 shrink-0 text-red-600" />
            ) : completionBanner.skipped > 0 ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            )}
            <span>
              Import complete &mdash;{" "}
              {completionBanner.success.toLocaleString()} records imported,{" "}
              {completionBanner.skipped.toLocaleString()} skipped,{" "}
              {completionBanner.errors.toLocaleString()} errors.
            </span>
          </div>
          <button
            onClick={() => setCompletionBanner(null)}
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total" value={totals.total} icon={<Play className="h-5 w-5 text-muted-foreground" />} />
        <StatCard
          label="Success"
          value={totals.success}
          icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
        />
        <StatCard
          label="Errors"
          value={totals.errors}
          icon={<XCircle className="h-5 w-5 text-red-600" />}
        />
        <StatCard
          label="Skipped"
          value={totals.skipped}
          icon={<AlertTriangle className="h-5 w-5 text-yellow-600" />}
        />
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
                <TableHead className="w-[80px] text-right">Total</TableHead>
                <TableHead className="w-[80px] text-right">Success</TableHead>
                <TableHead className="w-[80px] text-right">Errors</TableHead>
                <TableHead className="w-[80px] text-right">Skipped</TableHead>
                <TableHead className="w-[80px] text-right">Pending</TableHead>
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
                    {s.success > 0 ? s.success.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-700">
                    {s.errors > 0 ? s.errors.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-yellow-700">
                    {s.skipped > 0 ? s.skipped.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {s.pending > 0 ? s.pending.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(summaryQuery.data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No import has been performed yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ImportBlockingModal
        open={running}
        jobId={activeJobId}
        projectId={projectId}
        state={importState}
      />
    </div>
  );
}

function ImportBlockingModal({
  open,
  jobId,
  projectId,
  state,
}: {
  open: boolean;
  jobId: number | null;
  projectId: number;
  state: ImportRunState | null;
}) {
  const total = state?.totalRecords ?? 0;
  const processed = state?.processedRecords ?? 0;
  const totalTables = state?.totalTables ?? 0;
  const processedTables = state?.processedTables ?? 0;
  const currentTable = state?.currentTable ?? null;
  const cancelRequested = state?.cancelRequested ?? false;

  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const [cancelling, setCancelling] = useState(false);

  const requestCancel = async () => {
    if (!jobId) return;
    setCancelling(true);
    try {
      await fetch(
        `/api/projects/${projectId}/import/cancel?jobId=${jobId}`,
        { method: "POST" },
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-[92vw] max-w-2xl translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div className="flex-1">
                <DialogPrimitive.Title className="text-lg font-semibold">
                  Import in progress
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {jobId ? `Job #${jobId}` : ""}
                  {" — writing staged records into the target database. Please wait."}
                </DialogPrimitive.Description>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {processedTables} / {totalTables} tables
                  {currentTable && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      ({currentTable})
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {processed.toLocaleString()} / {total.toLocaleString()} records
                  {total > 0 && ` (${percent}%)`}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Do not close this tab. Navigation is blocked while import runs.
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={requestCancel}
                disabled={cancelling || cancelRequested}
              >
                {cancelling
                  ? "Cancelling..."
                  : cancelRequested
                    ? "Cancel requested"
                    : "Cancel import"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
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
