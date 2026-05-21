"use client";

import React, { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Play, CheckCircle2, XCircle, Clock } from "lucide-react";

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

  const [running, setRunning] = useState(false);

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
    refetchInterval: running ? 2000 : false,
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/extract/status?jobId=${activeJobId}`,
      );
      return (await r.json()) as {
        job: { status: string } | null;
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
      setRunning(true);
    },
  });

  useEffect(() => {
    if (statusQuery.data?.job && statusQuery.data.job.status !== "running") {
      setRunning(false);
    }
  }, [statusQuery.data?.job]);

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

      {statusQuery.data && (
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
    </div>
  );
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
