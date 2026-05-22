"use client";

import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Play,
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
import type { ValidationRunState } from "@/lib/migration/validator";

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
  const [optimisticRunning, setOptimisticRunning] = useState(false);
  const [completionBanner, setCompletionBanner] = useState<{
    failed: number;
    warnings: number;
    passed: number;
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

  const validationStatusQuery = useQuery({
    queryKey: ["validation-status", projectId, activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data as ValidationRunState | { running: false } | undefined;
      return data && "running" in data && data.running ? 2000 : false;
    },
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/validate/status?jobId=${activeJobId}`,
      );
      if (!r.ok) return { running: false } as { running: false };
      return (await r.json()) as ValidationRunState | { running: false };
    },
  });

  const summaryQuery = useQuery({
    queryKey: ["validation-summary", projectId, activeJobId],
    enabled: !!activeJobId,
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/validate/summary?jobId=${activeJobId}`,
      );
      if (!r.ok) {
        setActiveJob(null);
        return [] as ValidationSummary[];
      }
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
    onMutate: () => {
      setOptimisticRunning(true);
    },
    onSuccess: () => {
      validationStatusQuery.refetch();
    },
    onError: () => {
      setOptimisticRunning(false);
    },
  });

  // Clear optimistic flag once server confirms running state
  useEffect(() => {
    const data = validationStatusQuery.data;
    if (!data) return;
    if ("running" in data) {
      if (!data.running) setOptimisticRunning(false);
    }
  }, [validationStatusQuery.data]);

  // Refetch summary when validation finishes (driven by server state)
  useEffect(() => {
    const data = validationStatusQuery.data as ValidationRunState | { running: false } | undefined;
    if (!data) return;
    if ("running" in data && !data.running && "jobId" in data) {
      summaryQuery.refetch();
    }
    // summaryQuery is intentionally omitted — its identity changes on every
    // render but calling refetch() here only needs the latest version, which
    // is always captured via the closure at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationStatusQuery.data]);

  const serverRunning =
    validationStatusQuery.data &&
    "running" in validationStatusQuery.data &&
    (validationStatusQuery.data as ValidationRunState).running === true;

  const running = optimisticRunning || !!serverRunning;

  // Show completion banner when validation transitions from running → done
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      // Refetch summary then display the result banner
      summaryQuery.refetch().then((result) => {
        const data = result.data ?? [];
        const totalsSnap = data.reduce(
          (acc, s) => ({
            failed: acc.failed + s.failed,
            warnings: acc.warnings + s.warnings,
            passed: acc.passed + s.passed,
          }),
          { failed: 0, warnings: 0, passed: 0 },
        );
        setCompletionBanner(totalsSnap);
      });
    }
    prevRunningRef.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const statusUnknown = !!activeJobId && validationStatusQuery.isLoading;
  const startLocked = running || statusUnknown;

  // Block tab close while validation is running
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  // Soft-block the browser Back button while validation is running
  useEffect(() => {
    if (!running) return;
    window.history.pushState({ validateGuard: true }, "");
    const handler = () => {
      window.history.pushState({ validateGuard: true }, "");
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [running]);

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

  const validationState =
    validationStatusQuery.data && "jobId" in validationStatusQuery.data
      ? (validationStatusQuery.data as ValidationRunState)
      : null;

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
          disabled={!projectQuery.data?.targetProfileId || startLocked}
        >
          {running ? (
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

      {completionBanner && (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            completionBanner.failed > 0
              ? "border-red-200 bg-red-50 text-red-800"
              : completionBanner.warnings > 0
                ? "border-yellow-200 bg-yellow-50 text-yellow-800"
                : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {completionBanner.failed > 0 ? (
              <XCircle className="h-4 w-4 shrink-0 text-red-600" />
            ) : completionBanner.warnings > 0 ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            )}
            <span>
              {completionBanner.failed > 0
                ? `Validation complete — ${completionBanner.failed.toLocaleString()} record(s) failed. Review the table below.`
                : completionBanner.warnings > 0
                  ? `Validation complete — ${completionBanner.warnings.toLocaleString()} warning(s) found. ${completionBanner.passed.toLocaleString()} records passed.`
                  : `Validation complete — all ${completionBanner.passed.toLocaleString()} records passed without issues.`}
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

      <ValidationBlockingModal
        open={running}
        jobId={activeJobId}
        projectId={projectId}
        state={validationState}
      />
    </div>
  );
}

function ValidationBlockingModal({
  open,
  jobId,
  projectId,
  state,
}: {
  open: boolean;
  jobId: number | null;
  projectId: number;
  state: ValidationRunState | null;
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
        `/api/projects/${projectId}/validate/cancel?jobId=${jobId}`,
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
                  Validation in progress
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {jobId ? `Job #${jobId}` : ""}
                  {" — checking all staged records against the target database. Please wait until this finishes."}
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
                Do not close this tab. Navigation is blocked while validation runs.
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
                    : "Cancel validation"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
