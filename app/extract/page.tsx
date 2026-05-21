"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Play, CheckCircle2, XCircle, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface Profile {
  id: string;
  name: string;
  role: "source" | "target";
}

interface TableStatus {
  id: number;
  tableName: string;
  status: "pending" | "running" | "done" | "failed";
  recordCount: number;
  errorMessage?: string | null;
}

export default function ExtractPage() {
  const { sourceProfileId, targetProfileId, setSourceProfile, setTargetProfile, setActiveJob, activeJobId } =
    useMigrationStore();

  const [running, setRunning] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const r = await fetch("/api/connections");
      return ((await r.json()) as { profiles: Profile[] }).profiles;
    },
  });

  const sourceProfiles = profilesQuery.data?.filter((p) => p.role === "source") ?? [];
  const targetProfiles = profilesQuery.data?.filter((p) => p.role === "target") ?? [];

  const statusQuery = useQuery({
    queryKey: ["extraction-status", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: running ? 2000 : false,
    queryFn: async () => {
      const r = await fetch(`/api/extract/status?jobId=${activeJobId}`);
      return (await r.json()) as { job: any; tables: TableStatus[] };
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceProfileId, targetProfileId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { jobId: number };
    },
    onSuccess: (data) => {
      setActiveJob(data.jobId);
      setRunning(true);
    },
  });

  // Stop polling when job is done
  useEffect(() => {
    if (statusQuery.data?.job && statusQuery.data.job.status !== "running") {
      setRunning(false);
    }
  }, [statusQuery.data?.job]);

  const canStart = !!sourceProfileId && !!targetProfileId && !running;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Extract Data</h1>
        <p className="text-muted-foreground">
          Read all defined tables from the source database into the local staging database.
        </p>
      </div>

      <ProgressStepper current="extract" completed={["connections"]} />

      <Card>
        <CardHeader>
          <CardTitle>Select Profiles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Source DB</Label>
            <Select
              value={sourceProfileId ?? undefined}
              onValueChange={(v) => setSourceProfile(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose source..." />
              </SelectTrigger>
              <SelectContent>
                {sourceProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Target DB</Label>
            <Select
              value={targetProfileId ?? undefined}
              onValueChange={(v) => setTargetProfile(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose target..." />
              </SelectTrigger>
              <SelectContent>
                {targetProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
