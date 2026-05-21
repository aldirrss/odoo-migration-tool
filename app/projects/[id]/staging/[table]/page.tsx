"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowLeft,
  Loader2,
  Wand2,
  Eye,
  RotateCcw,
  Trash2,
  Undo2,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SplitViewEditor } from "@/components/split-view-editor";
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

type BulkOperation =
  | { kind: "set_field"; column: string; value: unknown }
  | {
      kind: "find_replace";
      column: string | null;
      find: string;
      replace: string;
      useRegex: boolean;
    }
  | { kind: "clear_field"; column: string }
  | { kind: "revert_to_source" }
  | { kind: "soft_delete" }
  | { kind: "restore" };

interface BulkResult {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  failures: Array<{ recordId: number; sourceId: number; reason: string }>;
}

const PAGE_SIZE = 50;
const DEFAULT_COLUMN_BUDGET = 8;

export default function TableEditorPage({
  params,
}: {
  params: Promise<{ id: string; table: string }>;
}) {
  const resolved = React.use(params);
  const projectId = Number(resolved.id);
  const tableName = resolved.table;
  const { activeJobId, setActiveJob, setCurrentProject } = useMigrationStore();
  const qc = useQueryClient();

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterDirty, setFilterDirty] = useState(false);
  const [filterDeleted, setFilterDeleted] = useState<"any" | "yes" | "no">("no");
  const [filterValidation, setFilterValidation] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<string[] | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [inspectId, setInspectId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{
    recordId: number;
    column: string;
  } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const tableDef = findTable(tableName);

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

  const debouncedSearch = useDebouncedValue(searchInput, 300);
  useEffect(() => {
    setSearch(debouncedSearch);
    setPage(1);
  }, [debouncedSearch]);

  const recordsQuery = useQuery({
    queryKey: [
      "staged-records",
      projectId,
      activeJobId,
      tableName,
      page,
      search,
      filterDirty,
      filterDeleted,
      filterValidation,
    ],
    enabled: !!activeJobId,
    queryFn: async () => {
      const url = new URL(
        `/api/projects/${projectId}/staging/${tableName}`,
        window.location.origin,
      );
      url.searchParams.set("jobId", String(activeJobId));
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      if (search) url.searchParams.set("q", search);
      if (filterDirty) url.searchParams.set("dirty", "1");
      if (filterDeleted === "yes") url.searchParams.set("deleted", "1");
      if (filterDeleted === "no") url.searchParams.set("deleted", "0");
      if (filterValidation) url.searchParams.set("validationStatus", filterValidation);
      const r = await fetch(url.toString());
      return (await r.json()) as {
        records: StagedRecord[];
        total: number;
        page: number;
        pageSize: number;
      };
    },
  });

  const records = useMemo(
    () => recordsQuery.data?.records ?? [],
    [recordsQuery.data?.records],
  );
  const total = recordsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allColumns = useMemo(() => {
    if (records.length === 0) return [] as string[];
    const counts = new Map<string, number>();
    for (const r of records) {
      for (const key of Object.keys(r.stagedData ?? {})) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }, [records]);

  const displayColumns = useMemo(() => {
    if (visibleColumns) return visibleColumns;
    if (allColumns.length === 0) return [];
    const preferred = [
      "id",
      "name",
      "display_name",
      "code",
      "ref",
      "number",
    ].filter((c) => allColumns.includes(c));
    const remaining = allColumns.filter((c) => !preferred.includes(c));
    return [...preferred, ...remaining].slice(0, DEFAULT_COLUMN_BUDGET);
  }, [visibleColumns, allColumns]);

  const inspectRecord = useMemo(
    () => records.find((r) => r.id === inspectId) ?? null,
    [records, inspectId],
  );

  const cellSaveMutation = useMutation({
    mutationFn: async (args: { recordId: number; nextStaged: Record<string, unknown> }) => {
      const r = await fetch(
        `/api/projects/${projectId}/staging/record/${args.recordId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stagedData: args.nextStaged }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { record: StagedRecord };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staging-stats"] });
    },
  });

  const inspectSaveMutation = useMutation({
    mutationFn: async (args: { recordId: number; nextStaged: Record<string, unknown> }) => {
      const r = await fetch(
        `/api/projects/${projectId}/staging/record/${args.recordId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stagedData: args.nextStaged }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staging-stats"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async (op: BulkOperation) => {
      const r = await fetch(
        `/api/projects/${projectId}/staging/${tableName}/bulk`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recordIds: Array.from(selectedIds),
            operation: op,
          }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as BulkResult;
    },
    onSuccess: (res) => {
      setBulkResult(res);
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staging-stats"] });
    },
  });

  const selectAllMatchingFilter = async () => {
    const url = new URL(
      `/api/projects/${projectId}/staging/${tableName}`,
      window.location.origin,
    );
    url.searchParams.set("jobId", String(activeJobId));
    url.searchParams.set("idsOnly", "1");
    if (search) url.searchParams.set("q", search);
    if (filterDirty) url.searchParams.set("dirty", "1");
    if (filterDeleted === "yes") url.searchParams.set("deleted", "1");
    if (filterDeleted === "no") url.searchParams.set("deleted", "0");
    if (filterValidation) url.searchParams.set("validationStatus", filterValidation);
    const r = await fetch(url.toString());
    const data = (await r.json()) as { ids: number[] };
    setSelectedIds(new Set(data.ids));
  };

  const togglePageSelection = (checked: boolean) => {
    if (checked) {
      const next = new Set(selectedIds);
      for (const r of records) next.add(r.id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const r of records) next.delete(r.id);
      setSelectedIds(next);
    }
  };

  const toggleRowSelection = (id: number, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const startEditingCell = (recordId: number, column: string, currentValue: unknown) => {
    setEditingCell({ recordId, column });
    setEditValue(currentValue == null ? "" : String(currentValue));
  };

  const commitCellEdit = (record: StagedRecord) => {
    if (!editingCell) return;
    const current = (record.stagedData as Record<string, unknown>)[editingCell.column];
    let parsed: unknown = editValue;
    if (typeof current === "number") parsed = Number(editValue);
    else if (typeof current === "boolean") parsed = editValue === "true";
    const next = { ...(record.stagedData as Record<string, unknown>), [editingCell.column]: parsed };
    setEditingCell(null);
    cellSaveMutation.mutate({ recordId: record.id, nextStaged: next });
  };

  if (!activeJobId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No active extraction job.{" "}
          <Link href={`/projects/${projectId}/extract`} className="underline">
            Start one.
          </Link>
        </CardContent>
      </Card>
    );
  }

  const allPageSelected =
    records.length > 0 && records.every((r) => selectedIds.has(r.id));
  const somePageSelected =
    records.some((r) => selectedIds.has(r.id)) && !allPageSelected;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${projectId}/staging`}>
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

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search inside row data..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={filterDirty}
                onCheckedChange={(v) => {
                  setFilterDirty(v === true);
                  setPage(1);
                }}
              />
              Dirty only
            </label>
            <div className="flex items-center gap-1.5 text-sm">
              <span>Deleted:</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={filterDeleted}
                onChange={(e) => {
                  setFilterDeleted(e.target.value as "any" | "yes" | "no");
                  setPage(1);
                }}
              >
                <option value="no">no</option>
                <option value="yes">yes</option>
                <option value="any">any</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <span>Validation:</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={filterValidation}
                onChange={(e) => {
                  setFilterValidation(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">any</option>
                <option value="pending">pending</option>
                <option value="pass">pass</option>
                <option value="warning">warning</option>
                <option value="fail">fail</option>
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowColumnPicker(true)}
              >
                Columns ({displayColumns.length})
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <div className="text-sm">
              <span className="font-semibold">{selectedIds.size}</span> /{" "}
              {total.toLocaleString()} selected
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={selectAllMatchingFilter}
              disabled={total === 0}
            >
              Select all matching filter
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedIds.size === 0}
            >
              Clear selection
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={() => setShowBulkPanel(true)}
            >
              <Wand2 className="mr-1 h-3 w-3" />
              Bulk operations
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allPageSelected || somePageSelected}
                    onCheckedChange={(v) => togglePageSelection(v === true)}
                  />
                </TableHead>
                <TableHead className="w-[80px]">id</TableHead>
                {displayColumns.map((col) => (
                  <TableHead key={col} className="font-mono text-xs">
                    {col}
                  </TableHead>
                ))}
                <TableHead className="w-[80px]">flags</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recordsQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={displayColumns.length + 4} className="py-6 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!recordsQuery.isLoading && records.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={displayColumns.length + 4}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No records match the current filter.
                  </TableCell>
                </TableRow>
              )}
              {records.map((r) => {
                const checked = selectedIds.has(r.id);
                return (
                  <TableRow key={r.id} className={r.isDeleted ? "opacity-60" : ""}>
                    <TableCell>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleRowSelection(r.id, v === true)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.sourceId}</TableCell>
                    {displayColumns.map((col) => {
                      const value = (r.stagedData as Record<string, unknown>)[col];
                      const isEditing =
                        editingCell?.recordId === r.id && editingCell?.column === col;
                      return (
                        <TableCell key={col} className="text-xs">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitCellEdit(r)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitCellEdit(r);
                                else if (e.key === "Escape") setEditingCell(null);
                              }}
                              className="h-7 w-full rounded border bg-background px-1.5"
                            />
                          ) : (
                            <div
                              className="cursor-text truncate"
                              onClick={() => startEditingCell(r.id, col, value)}
                              title={String(value ?? "")}
                            >
                              {renderCell(value)}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <div className="flex gap-1">
                        {r.isDirty && (
                          <span
                            className="h-2 w-2 rounded-full bg-yellow-500"
                            title="dirty"
                          />
                        )}
                        {r.isDeleted && (
                          <span
                            className="h-2 w-2 rounded-full bg-red-500"
                            title="deleted"
                          />
                        )}
                        {r.validationStatus === "fail" && (
                          <span
                            className="h-2 w-2 rounded-full bg-red-700"
                            title="validation failed"
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setInspectId(r.id)}
                        title="Inspect"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} of {totalPages} · {total.toLocaleString()} rows
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

      <ColumnPickerDialog
        open={showColumnPicker}
        onOpenChange={setShowColumnPicker}
        allColumns={allColumns}
        selected={displayColumns}
        onChange={(cols) => setVisibleColumns(cols)}
      />

      <BulkOperationDialog
        open={showBulkPanel}
        onOpenChange={(o) => {
          setShowBulkPanel(o);
          if (!o) setBulkResult(null);
        }}
        selectedCount={selectedIds.size}
        availableColumns={allColumns}
        onApply={(op) => bulkMutation.mutate(op)}
        result={bulkResult}
        isPending={bulkMutation.isPending}
      />

      <Dialog
        open={inspectRecord !== null}
        onOpenChange={(o) => !o && setInspectId(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Inspect #{inspectRecord?.sourceId}
            </DialogTitle>
            <DialogDescription>
              Compare source vs staged. Edits save when you click Save changes.
            </DialogDescription>
          </DialogHeader>
          {inspectRecord && (
            <InspectBody
              record={inspectRecord}
              onSave={(next) =>
                inspectSaveMutation.mutate(
                  { recordId: inspectRecord.id, nextStaged: next },
                  { onSuccess: () => setInspectId(null) },
                )
              }
              isSaving={inspectSaveMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InspectBody({
  record,
  onSave,
  isSaving,
}: {
  record: StagedRecord;
  onSave: (next: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [draft, setDraft] = useState(record.stagedData);
  return (
    <div className="space-y-3">
      <SplitViewEditor
        sourceData={record.sourceData}
        stagedData={draft}
        onChange={(next) => setDraft(next)}
        onReset={() => setDraft(record.sourceData)}
      />
      <DialogFooter>
        <Button onClick={() => onSave(draft)} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </div>
  );
}

function ColumnPickerDialog({
  open,
  onOpenChange,
  allColumns,
  selected,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allColumns: string[];
  selected: string[];
  onChange: (cols: string[]) => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  useEffect(() => {
    if (open) setDraft(new Set(selected));
  }, [open, selected]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Visible columns</DialogTitle>
          <DialogDescription>Pick which columns appear in the table.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[300px] space-y-1.5 overflow-auto">
          {allColumns.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.has(c)}
                onCheckedChange={(v) => {
                  const next = new Set(draft);
                  if (v === true) next.add(c);
                  else next.delete(c);
                  setDraft(next);
                }}
              />
              <span className="font-mono text-xs">{c}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onChange(allColumns.filter((c) => draft.has(c)));
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkOperationDialog({
  open,
  onOpenChange,
  selectedCount,
  availableColumns,
  onApply,
  result,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedCount: number;
  availableColumns: string[];
  onApply: (op: BulkOperation) => void;
  result: BulkResult | null;
  isPending: boolean;
}) {
  type Kind = BulkOperation["kind"];
  const [kind, setKind] = useState<Kind>("set_field");
  const [column, setColumn] = useState<string>(availableColumns[0] ?? "");
  const [allColumns, setAllColumns] = useState<boolean>(false);
  const [value, setValue] = useState<string>("");
  const [find, setFind] = useState<string>("");
  const [replace, setReplace] = useState<string>("");
  const [useRegex, setUseRegex] = useState<boolean>(false);

  useEffect(() => {
    if (open && availableColumns.length > 0 && !availableColumns.includes(column)) {
      setColumn(availableColumns[0]!);
    }
  }, [open, availableColumns, column]);

  const apply = () => {
    let op: BulkOperation;
    switch (kind) {
      case "set_field":
        op = { kind: "set_field", column, value: parseLooseValue(value) };
        break;
      case "find_replace":
        op = {
          kind: "find_replace",
          column: allColumns ? null : column,
          find,
          replace,
          useRegex,
        };
        break;
      case "clear_field":
        op = { kind: "clear_field", column };
        break;
      case "revert_to_source":
        op = { kind: "revert_to_source" };
        break;
      case "soft_delete":
        op = { kind: "soft_delete" };
        break;
      case "restore":
        op = { kind: "restore" };
        break;
    }
    onApply(op);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk operations</DialogTitle>
          <DialogDescription>
            Apply to {selectedCount.toLocaleString()} selected row{selectedCount === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Operation</label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="set_field">Set field</option>
              <option value="find_replace">Find &amp; replace</option>
              <option value="clear_field">Clear field</option>
              <option value="revert_to_source">Revert to source</option>
              <option value="soft_delete">Soft delete</option>
              <option value="restore">Restore (un-delete)</option>
            </select>
          </div>

          {(kind === "set_field" || kind === "clear_field") && (
            <div>
              <label className="text-xs text-muted-foreground">Column</label>
              <ColumnSelect
                columns={availableColumns}
                value={column}
                onChange={setColumn}
              />
            </div>
          )}

          {kind === "set_field" && (
            <div>
              <label className="text-xs text-muted-foreground">New value</label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                Plain text becomes a string. Use numbers (e.g. 42), true/false, or
                null without quotes for those types.
              </p>
            </div>
          )}

          {kind === "find_replace" && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Find</label>
                <Input value={find} onChange={(e) => setFind(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Replace</label>
                <Input value={replace} onChange={(e) => setReplace(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={useRegex}
                  onCheckedChange={(v) => setUseRegex(v === true)}
                />
                Treat &quot;Find&quot; as a regular expression
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allColumns}
                  onCheckedChange={(v) => setAllColumns(v === true)}
                />
                Apply to all string columns
              </label>
              {!allColumns && (
                <div>
                  <label className="text-xs text-muted-foreground">Column</label>
                  <ColumnSelect
                    columns={availableColumns}
                    value={column}
                    onChange={setColumn}
                  />
                </div>
              )}
            </div>
          )}

          {kind === "revert_to_source" && (
            <p className="text-sm text-muted-foreground">
              <RotateCcw className="mr-1 inline h-3 w-3" />
              Resets <code>stagedData</code> back to <code>sourceData</code> and
              clears the dirty flag for all selected rows.
            </p>
          )}
          {kind === "soft_delete" && (
            <p className="text-sm text-muted-foreground">
              <Trash2 className="mr-1 inline h-3 w-3" />
              Marks rows as deleted (won&apos;t be imported). Rows with active
              dependencies under an <code>onDelete: block</code> relation are
              blocked individually.
            </p>
          )}
          {kind === "restore" && (
            <p className="text-sm text-muted-foreground">
              <Undo2 className="mr-1 inline h-3 w-3" />
              Removes the deleted flag.
            </p>
          )}

          {result && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                <strong>Result:</strong>{" "}
                <span className="text-green-700">{result.successCount} ok</span>{" "}
                ·{" "}
                <span className="text-red-700">{result.failedCount} failed</span>
              </p>
              {result.failures.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">
                    Show {result.failures.length} failure
                    {result.failures.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-2 max-h-40 overflow-auto text-xs">
                    {result.failures.map((f, i) => (
                      <li key={i} className="border-b py-1 last:border-0">
                        <span className="font-mono">#{f.sourceId}</span> —{" "}
                        {f.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={apply}
            disabled={isPending || selectedCount === 0}
          >
            {isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Apply to {selectedCount.toLocaleString()} row
            {selectedCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnSelect({
  columns,
  value,
  onChange,
}: {
  columns: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {columns.length === 0 && <option value="">(no columns)</option>}
      {columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function renderCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function parseLooseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
