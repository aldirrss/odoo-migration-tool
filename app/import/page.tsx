"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Loader2, Play, Upload, AlertTriangle } from "lucide-react";

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

export default function ImportPage() {
  const { activeJobId, targetProfileId } = useMigrationStore();

  const summaryQuery = useQuery({
    queryKey: ["import-summary", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: 3000,
    queryFn: async () => {
      const r = await fetch(`/api/import/summary?jobId=${activeJobId}`);
      return ((await r.json()) as { summary: ImportSummary[] }).summary;
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId, targetProfileId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onSuccess: () => summaryQuery.refetch(),
  });

  if (!activeJobId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Import</h1>
        <ProgressStepper
          current="import"
          completed={["connections", "extract", "clean", "validate"]}
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
          disabled={!targetProfileId || runMutation.isPending}
        >
          {runMutation.isPending ? (
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
      />

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
                  <TableCell className="text-right font-mono">{s.total.toLocaleString()}</TableCell>
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
    </div>
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
