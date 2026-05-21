"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  Search,
  Trash2,
  ArrowLeft,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Checkbox } from "@/components/ui/checkbox";
import { SplitViewEditor } from "@/components/split-view-editor";
import { RelationWarning, type RelationImpactItem } from "@/components/relation-warning";
import { useMigrationStore } from "@/lib/store";
import { findTable } from "@/lib/odoo/modules";

interface StagedRecord {
  id: number;
  sourceId: number;
  tableName: string;
  sourceData: Record<string, unknown>;
  stagedData: Record<string, unknown>;
  isDirty: boolean;
  isDeleted: boolean;
  validationStatus: string;
  importStatus: string;
}

export default function TableEditorPage({
  params,
}: {
  params: Promise<{ table: string }>;
}) {
  const resolvedParams = React.use(params);
  const tableName = resolvedParams.table;
  const { activeJobId } = useMigrationStore();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterDirty, setFilterDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const tableDef = findTable(tableName);
  const pageSize = 25;

  const recordsQuery = useQuery({
    queryKey: ["staged-records", activeJobId, tableName, page, search, filterDirty],
    enabled: !!activeJobId,
    queryFn: async () => {
      const url = new URL(`/api/staging/${tableName}`, window.location.origin);
      url.searchParams.set("jobId", String(activeJobId));
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (search) url.searchParams.set("search", search);
      if (filterDirty) url.searchParams.set("dirty", "1");
      const r = await fetch(url.toString());
      return (await r.json()) as {
        records: StagedRecord[];
        total: number;
        page: number;
        pageSize: number;
      };
    },
  });

  const recordQuery = useQuery({
    queryKey: ["staged-record", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const r = await fetch(`/api/staging/record/${selectedId}`);
      return (await r.json()) as { record: StagedRecord };
    },
  });

  const impactQuery = useQuery({
    queryKey: ["staged-record-impact", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const r = await fetch(`/api/staging/record/${selectedId}/impact`);
      return (await r.json()) as { impacts: RelationImpactItem[] };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (next: Record<string, unknown>) => {
      const r = await fetch(`/api/staging/record/${selectedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stagedData: next }),
      });
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staged-record"] });
      qc.invalidateQueries({ queryKey: ["staging-stats"] });
      setDraft(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/staging/record/${selectedId}/reset`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staged-record"] });
      setDraft(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const r = await fetch(`/api/staging/record/${selectedId}?force=${force ? "1" : "0"}`, {
        method: "DELETE",
      });
      const data = await r.json();
      if (!r.ok && !data.blocking) throw new Error(data.message ?? "Delete failed");
      return data;
    },
    onSuccess: (data) => {
      if (data.blocking) {
        if (confirm(`Deletion has ${data.blocking.length} blocking dependency. Force delete anyway?`)) {
          deleteMutation.mutate(true);
        }
        return;
      }
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staged-record"] });
    },
  });

  if (!activeJobId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No active extraction job. <Link href="/extract" className="underline">Start one.</Link>
        </CardContent>
      </Card>
    );
  }

  const total = recordsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedRecord = recordQuery.data?.record;
  const currentData = draft ?? selectedRecord?.stagedData ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/staging">
              <ArrowLeft className="mr-1 h-3 w-3" />
              All tables
            </Link>
          </Button>
          <h1 className="mt-2 text-2xl font-bold">
            <span className="font-mono">{tableName}</span>
            {tableDef && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {tableDef.label}
              </span>
            )}
          </h1>
        </div>
        {tableDef && (
          <Badge variant={tableDef.type === "master" ? "outline" : "secondary"}>
            {tableDef.type}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        {/* List panel */}
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput);
              setPage(1);
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Search..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" size="icon" variant="outline">
              <Search className="h-4 w-4" />
            </Button>
          </form>

          <div className="flex items-center gap-2 text-xs">
            <Checkbox
              id="dirty-filter"
              checked={filterDirty}
              onCheckedChange={(c) => {
                setFilterDirty(c);
                setPage(1);
              }}
            />
            <label htmlFor="dirty-filter" className="cursor-pointer">
              Only show modified
            </label>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>Preview</TableHead>
                    <TableHead className="w-[60px]">Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordsQuery.data?.records.map((r) => (
                    <TableRow
                      key={r.id}
                      className={selectedId === r.id ? "bg-muted" : ""}
                      onClick={() => {
                        setSelectedId(r.id);
                        setDraft(null);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <TableCell className="font-mono text-xs">{r.sourceId}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {previewLabel(r.stagedData)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.isDirty && (
                            <span className="h-2 w-2 rounded-full bg-yellow-500" title="dirty" />
                          )}
                          {r.isDeleted && (
                            <span className="h-2 w-2 rounded-full bg-red-500" title="deleted" />
                          )}
                          {r.validationStatus === "fail" && (
                            <span className="h-2 w-2 rounded-full bg-red-700" title="validation failed" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {recordsQuery.data?.records.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-4 text-center text-xs text-muted-foreground">
                        No records.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages} ({total.toLocaleString()})
            </span>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* Editor panel */}
        <div className="space-y-4">
          {!selectedId ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Select a record from the list to edit.
              </CardContent>
            </Card>
          ) : recordQuery.isLoading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : selectedRecord && currentData ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Record #{selectedRecord.sourceId}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SplitViewEditor
                    sourceData={selectedRecord.sourceData}
                    stagedData={currentData}
                    onChange={(next) => setDraft(next)}
                    onReset={() => resetMutation.mutate()}
                  />
                </CardContent>
              </Card>

              {impactQuery.data && (
                <RelationWarning impacts={impactQuery.data.impacts} />
              )}

              <div className="flex justify-between gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Mark this record as deleted? It won't be imported.")) {
                      deleteMutation.mutate(false);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Mark deleted
                </Button>
                <Button
                  size="sm"
                  onClick={() => draft && saveMutation.mutate(draft)}
                  disabled={!draft || saveMutation.isPending}
                >
                  {saveMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  <Save className="mr-1 h-3 w-3" />
                  Save changes
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function previewLabel(data: Record<string, unknown>): string {
  for (const key of ["display_name", "name", "complete_name", "code", "ref", "number"]) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return JSON.stringify(data).slice(0, 60);
}
