"use client";

import React, { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  StopCircle,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
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
import { ProgressStepper } from "@/components/progress-stepper";
import { useMigrationStore } from "@/lib/store";

interface TableStatus {
  id: number;
  tableName: string;
  status: "pending" | "running" | "done" | "failed";
  recordCount: number;
  errorMessage?: string | null;
}

interface Project {
  id: number;
  sourceProfileId: string | null;
  targetProfileId: string | null;
}

export default function ExtractPage({
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

  const statusQuery = useQuery({
    queryKey: ["extraction-status", projectId, activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data as
        | { job: { status: string } | null }
        | undefined;
      return data?.job?.status === "running" ? 2000 : false;
    },
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/extract/status?jobId=${activeJobId}`,
      );
      if (!r.ok) {
        // Stale activeJobId (e.g. job belongs to another project, or was wiped).
        // Clear it so the UI returns to the "no active job" state.
        setActiveJob(null);
        return { job: null, tables: [] as TableStatus[] };
      }
      return (await r.json()) as {
        job: { status: string; cancelRequested?: boolean } | null;
        tables: TableStatus[];
      };
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { jobId: number };
    },
    onSuccess: (data) => {
      setActiveJob(data.jobId);
      // running is derived from statusQuery; trigger an immediate refetch so
      // the modal opens without waiting for the next poll tick.
      statusQuery.refetch();
    },
  });

  // Single source of truth for "is this extraction still in-flight": the job
  // row in the staging DB. Survives page reloads and tab restores. While we're
  // still loading status for a known activeJobId, treat it as running so the
  // Start button can't be double-clicked during the fetch window.
  const statusUnknown = !!activeJobId && statusQuery.isLoading;
  const running =
    statusUnknown || statusQuery.data?.job?.status === "running";

  // Block tab close / reload while extraction is running.
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  // Soft-block the browser Back button while extraction is running.
  // Pushing a dummy state and re-pushing on popstate keeps the user on this URL.
  useEffect(() => {
    if (!running) return;
    window.history.pushState({ extractGuard: true }, "");
    const handler = () => {
      window.history.pushState({ extractGuard: true }, "");
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [running]);

  const canStart =
    !!projectQuery.data?.sourceProfileId &&
    !!projectQuery.data?.targetProfileId &&
    !running;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Extract Data</h1>
        <p className="text-muted-foreground">
          Read all defined tables from the source database into the local staging database.
        </p>
      </div>

      <ProgressStepper
        current="extract"
        completed={["connections"]}
        projectId={projectId}
      />

      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            Source:{" "}
            <span className="font-mono">
              {projectQuery.data?.sourceProfileId ?? "—"}
            </span>
          </div>
          <div>
            Target:{" "}
            <span className="font-mono">
              {projectQuery.data?.targetProfileId ?? "—"}
            </span>
          </div>
          <p className="pt-2 text-xs text-muted-foreground">
            Change in Connections tab.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          disabled={!canStart || startMutation.isPending}
          onClick={() => startMutation.mutate()}
        >
          {startMutation.isPending || running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Start extraction
        </Button>
      </div>

      {statusQuery.data && statusQuery.data.tables && statusQuery.data.tables.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extraction progress</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[120px] text-right">Records</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusQuery.data.tables.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.tableName}</TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.recordCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {t.errorMessage}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ExtractionBlockingModal
        open={running}
        jobId={activeJobId}
        projectId={projectId}
        tables={statusQuery.data?.tables ?? []}
        cancelRequested={statusQuery.data?.job?.cancelRequested ?? false}
      />
    </div>
  );
}

function ExtractionBlockingModal({
  open,
  jobId,
  projectId,
  tables,
  cancelRequested,
}: {
  open: boolean;
  jobId: number | null;
  projectId: number;
  tables: TableStatus[];
  cancelRequested: boolean;
}) {
  const total = tables.length;
  const finished = tables.filter(
    (t) => t.status === "done" || t.status === "failed",
  ).length;
  const failed = tables.filter((t) => t.status === "failed").length;
  const runningRow = tables.find((t) => t.status === "running");
  const percent = total === 0 ? 0 : Math.round((finished / total) * 100);
  const totalRecords = tables.reduce((acc, t) => acc + (t.recordCount ?? 0), 0);

  // Stable, fixed-height log: show all rows but pin the running/recent ones to view.
  const recent = [...tables]
    .filter((t) => t.status !== "pending")
    .slice(-30)
    .reverse();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const requestCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/extract/cancel`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(await r.text());
      setConfirmOpen(false);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err));
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
                  {cancelRequested
                    ? "Cancelling extraction..."
                    : "Extraction in progress"}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {jobId ? `Job #${jobId}` : ""}
                  {cancelRequested
                    ? " — waiting for the current batch to finish, then all extracted data will be deleted."
                    : " — please wait until this finishes. Closing this tab or navigating away may leave the extraction in an inconsistent state."}
                </DialogPrimitive.Description>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {finished} / {total} tables
                </span>
                <span className="text-muted-foreground">{percent}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground">
                    {totalRecords.toLocaleString()}
                  </strong>{" "}
                  records extracted
                </span>
                {failed > 0 && (
                  <span className="flex items-center gap-1 text-red-700">
                    <AlertTriangle className="h-3 w-3" />
                    {failed} failed
                  </span>
                )}
                {runningRow && (
                  <span className="font-mono">
                    Current: {runningRow.tableName}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-md border bg-muted/40">
              <div className="border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                Recent activity
              </div>
              <div className="max-h-56 overflow-auto p-2 text-xs font-mono">
                {recent.length === 0 ? (
                  <div className="px-1 py-1 text-muted-foreground">
                    Waiting for the first table...
                  </div>
                ) : (
                  recent.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 px-1 py-0.5"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <StatusDot status={t.status} />
                        {t.tableName}
                      </span>
                      <span className="text-muted-foreground">
                        {t.status === "done"
                          ? `${t.recordCount.toLocaleString()} rows`
                          : t.status === "failed"
                            ? "failed"
                            : t.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Do not close this tab. Navigation is blocked while the
                extraction runs.
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={cancelling}
              >
                <StopCircle className="mr-2 h-4 w-4" />
                {cancelling
                  ? "Working..."
                  : cancelRequested
                    ? "Force stop now"
                    : "Stop extraction"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>

        {/* Confirm dialog nested inside the blocking modal portal */}
        <DialogPrimitive.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60" />
            <DialogPrimitive.Content
              className="fixed left-[50%] top-[50%] z-[70] w-[92vw] max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-6 shadow-2xl focus:outline-none"
              onEscapeKeyDown={(e) => cancelling && e.preventDefault()}
              onPointerDownOutside={(e) => cancelling && e.preventDefault()}
            >
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                  <div>
                    <DialogPrimitive.Title className="font-semibold">
                      {cancelRequested
                        ? "Force stop and delete now?"
                        : "Cancel and delete all extracted data?"}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                      {cancelRequested ? (
                        <>
                          The extractor is still working on a long query.
                          Force-stopping will immediately delete all data and
                          mark the job as cancelled, even if the orphaned
                          request hasn&apos;t exited yet.
                        </>
                      ) : (
                        <>
                          <strong>{finished}</strong> table
                          {finished === 1 ? "" : "s"} already extracted (
                          <strong>{totalRecords.toLocaleString()}</strong>{" "}
                          rows). All of it will be deleted from staging. This
                          cannot be undone.
                        </>
                      )}
                    </DialogPrimitive.Description>
                  </div>
                </div>
                {cancelError && (
                  <p className="text-sm text-red-700">{cancelError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setConfirmOpen(false)}
                    disabled={cancelling}
                  >
                    Keep running
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={requestCancel}
                    disabled={cancelling}
                  >
                    {cancelling && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Yes, cancel &amp; delete
                  </Button>
                </div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function StatusDot({ status }: { status: TableStatus["status"] }) {
  const color =
    status === "done"
      ? "bg-green-600"
      : status === "failed"
        ? "bg-red-600"
        : status === "running"
          ? "bg-blue-500 animate-pulse"
          : "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function StatusBadge({ status }: { status: TableStatus["status"] }) {
  if (status === "done") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="secondary">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Running
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Clock className="mr-1 h-3 w-3" />
      Pending
    </Badge>
  );
}
