"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Wand2,
  Eye,
  RotateCcw,
  Trash2,
  Undo2,
  GitCompare,
  ExternalLink,
  Columns2,
  AlertOctagon,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";

import { SmartSearchBar, type FilterChip } from "@/components/smart-search-bar";
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
import { QualityFlagCell } from "@/components/quality-flag-cell";
import type {
  QualityFinding,
  Severity,
} from "@/lib/migration/quality/types";
import { useMigrationStore } from "@/lib/store";
import { findTable, getOutgoingRelations } from "@/lib/odoo/modules";
import type { RelationDefinition } from "@/lib/odoo/types";
import { inferFkRelation } from "@/lib/odoo/fk-heuristics";
import {
  isTranslationDict,
  unwrapTranslation,
  wrapTranslation,
} from "@/lib/odoo/translation";

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
  qualityFlags?: QualityFinding[] | null;
  qualitySeverity?: Severity | null;
  qualityOverridden?: boolean;
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

type SortConfig = { column: string; direction: "asc" | "desc" } | null;

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
  const [filterChips, setFilterChips] = useState<FilterChip[]>([]);
  const [pendingSearch, setPendingSearch] = useState("");
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
  const [diffMode, setDiffMode] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [fkPreview, setFkPreview] = useState<{
    relation: RelationDefinition;
    sourceId: number;
  } | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  // Outgoing FK relations for this table (where this row points to a parent).
  // Module registry takes precedence; common Odoo column-name conventions
  // (parent_id, create_uid, partner_id, etc.) fill in the rest via heuristics.
  const fkByColumn = useMemo(() => {
    const out = new Map<string, RelationDefinition>();
    for (const rel of getOutgoingRelations(tableName)) {
      out.set(rel.fromColumn, rel);
    }
    // Augment with heuristic-inferred FKs that aren't already declared.
    // We don't know the full column set yet; consult heuristics lazily by
    // also exposing a resolver. For now we'll attempt inference for any
    // column we observe via a thin wrapper below.
    return out;
  }, [tableName]);

  const fkResolver = useMemo(() => {
    const cache = new Map<string, RelationDefinition | null>();
    return (column: string): RelationDefinition | null => {
      const cached = cache.get(column);
      if (cached !== undefined) return cached;
      const declared = fkByColumn.get(column);
      const result = declared ?? inferFkRelation(tableName, column);
      cache.set(column, result);
      return result;
    };
  }, [fkByColumn, tableName]);

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

  const debouncedPendingSearch = useDebouncedValue(pendingSearch, 300);

  // Derive filter values from chips + debounced pending text

  // Global text chips (no column specified) + debounced pending search
  const globalSearchTerms = [
    ...filterChips
      .filter(
        (c): c is Extract<FilterChip, { kind: "text" }> =>
          c.kind === "text" && !c.column,
      )
      .map((c) => c.value),
    ...(debouncedPendingSearch.trim() ? [debouncedPendingSearch.trim()] : []),
  ];

  // Column-specific text chips
  const colSearchTerms = filterChips
    .filter(
      (c): c is Extract<FilterChip, { kind: "text" }> =>
        c.kind === "text" && !!c.column,
    )
    .map((c) => ({ col: c.column!, val: c.value }));

  const filterDirty = filterChips.some((c) => c.kind === "dirty");

  const deletedChip = filterChips.find(
    (c): c is Extract<FilterChip, { kind: "deleted" }> => c.kind === "deleted",
  );
  const filterDeleted: "any" | "yes" | "no" = deletedChip
    ? deletedChip.value === "yes"
      ? "yes"
      : "any"
    : "no";

  const validationChip = filterChips.find(
    (c): c is Extract<FilterChip, { kind: "validation" }> => c.kind === "validation",
  );
  const filterValidation = validationChip ? validationChip.value : "";

  const qualityChip = filterChips.find(
    (c): c is Extract<FilterChip, { kind: "quality" }> => c.kind === "quality",
  );
  const filterQuality: "all" | "block" | "warn" | "ok" = qualityChip
    ? qualityChip.value
    : "all";

  // Reset page when chips or debounced search changes
  useEffect(() => {
    setPage(1);
  }, [filterChips, debouncedPendingSearch]);

  const recordsQuery = useQuery({
    queryKey: [
      "staged-records",
      projectId,
      activeJobId,
      tableName,
      page,
      globalSearchTerms,
      colSearchTerms,
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
      for (const term of globalSearchTerms) {
        url.searchParams.append("q", term);
      }
      for (const { col, val } of colSearchTerms) {
        url.searchParams.append("qc", `${col}=${val}`);
      }
      if (filterDirty) url.searchParams.set("dirty", "1");
      if (filterDeleted === "yes") url.searchParams.set("deleted", "1");
      if (filterDeleted === "no") url.searchParams.set("deleted", "0");
      if (filterValidation) url.searchParams.set("validationStatus", filterValidation);
      const r = await fetch(url.toString());
      if (!r.ok) {
        setActiveJob(null);
        return {
          records: [] as StagedRecord[],
          total: 0,
          page: 1,
          pageSize: PAGE_SIZE,
        };
      }
      return (await r.json()) as {
        records: StagedRecord[];
        total: number;
        page: number;
        pageSize: number;
      };
    },
  });

  const rawRecords = useMemo(
    () => recordsQuery.data?.records ?? [],
    [recordsQuery.data?.records],
  );
  const records = useMemo(() => {
    if (filterQuality === "all") return rawRecords;
    return rawRecords.filter((r) => {
      const sev = r.qualitySeverity ?? "ok";
      return sev === filterQuality;
    });
  }, [rawRecords, filterQuality]);
  const total = recordsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qualityCounts = useMemo(() => {
    let blocks = 0;
    let warns = 0;
    for (const r of records) {
      if (r.qualitySeverity === "block") blocks++;
      else if (r.qualitySeverity === "warn") warns++;
    }
    return { blocks, warns };
  }, [records]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  };

  const sortedRecords = useMemo(() => {
    if (!sortConfig) return records;
    return [...records].sort((a, b) => {
      let aVal: unknown;
      let bVal: unknown;
      if (sortConfig.column === "__id__") {
        aVal = a.sourceId;
        bVal = b.sourceId;
      } else {
        aVal = (a.stagedData as Record<string, unknown>)[sortConfig.column];
        bVal = (b.stagedData as Record<string, unknown>)[sortConfig.column];
      }
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortConfig.direction === "asc" ? 1 : -1;
      if (bVal == null) return sortConfig.direction === "asc" ? -1 : 1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortConfig.direction === "asc" ? cmp : -cmp;
    });
  }, [records, sortConfig]);

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

  const rescanMutation = useMutation({
    mutationFn: async () => {
      if (!activeJobId) throw new Error("No active job");
      const r = await fetch(`/api/projects/${projectId}/quality/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId, tableName }),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { scanned: number; flagged: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staged-records"] });
      qc.invalidateQueries({ queryKey: ["staging-stats"] });
      qc.invalidateQueries({ queryKey: ["project-quality-summary", projectId] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (recordId: number) => {
      const r = await fetch(
        `/api/projects/${projectId}/staging/records/${recordId}/acknowledge-quality`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { record: StagedRecord };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staged-records"] });
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
    for (const term of globalSearchTerms) {
      url.searchParams.append("q", term);
    }
    for (const { col, val } of colSearchTerms) {
      url.searchParams.append("qc", `${col}=${val}`);
    }
    if (filterDirty) url.searchParams.set("dirty", "1");
    if (filterDeleted === "yes") url.searchParams.set("deleted", "1");
    if (filterDeleted === "no") url.searchParams.set("deleted", "0");
    if (filterValidation) url.searchParams.set("validationStatus", filterValidation);
    const r = await fetch(url.toString());
    const data = (await r.json()) as { ids: number[] };
    setSelectedIds(new Set(data.ids));
  };

  const toggleRowSelection = (id: number, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const startEditingCell = (recordId: number, column: string, currentValue: unknown) => {
    setEditingCell({ recordId, column });
    // For translation fields, edit only the displayed locale's text.
    const t = unwrapTranslation(currentValue);
    if (t) {
      setEditValue(t.text);
      return;
    }
    setEditValue(currentValue == null ? "" : String(currentValue));
  };

  const commitCellEdit = (record: StagedRecord, overrideValue?: unknown) => {
    if (!editingCell) return;
    const current = (record.stagedData as Record<string, unknown>)[editingCell.column];
    let parsed: unknown = overrideValue !== undefined ? overrideValue : editValue;
    if (overrideValue === undefined) {
      if (isTranslationDict(current)) {
        // Preserve other locales; only update the preferred one.
        parsed = wrapTranslation(current, editValue);
      } else if (typeof current === "number") {
        parsed = Number(editValue);
      } else if (typeof current === "boolean") {
        parsed = editValue === "true";
      }
    }
    // Skip the API call if nothing actually changed — prevents resetting
    // validationStatus to "pending" on a no-op click.
    if (JSON.stringify(parsed) === JSON.stringify(current)) {
      setEditingCell(null);
      return;
    }
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
          <div className="flex items-center gap-2">
            <SmartSearchBar
              chips={filterChips}
              pendingText={pendingSearch}
              onChipsChange={(chips) => {
                setFilterChips(chips);
                setPage(1);
              }}
              onPendingTextChange={setPendingSearch}
              columns={displayColumns}
              placeholder="Search or add filter..."
              className="flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => rescanMutation.mutate()}
              disabled={rescanMutation.isPending || !activeJobId}
              title="Re-run the data-quality scan on this table"
            >
              {rescanMutation.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="mr-1 h-3 w-3" />
              )}
              Re-scan
            </Button>
            <Button
              size="sm"
              variant={diffMode ? "default" : "outline"}
              onClick={() => {
                setDiffMode((v) => !v);
                if (!diffMode) setSplitView(false);
              }}
              title="Show source vs staged stacked inside each cell"
            >
              <GitCompare className="mr-1 h-3 w-3" />
              Diff
            </Button>
            <Button
              size="sm"
              variant={splitView ? "default" : "outline"}
              onClick={() => {
                setSplitView((v) => !v);
                if (!splitView) setDiffMode(false);
              }}
              title="Show two side-by-side tables: source (read-only) | staged (editable)"
            >
              <Columns2 className="mr-1 h-3 w-3" />
              Split
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowColumnPicker(true)}
            >
              Columns ({displayColumns.length})
            </Button>
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

      {splitView ? (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <div className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              Source (read-only)
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead colKey="__id__" label="id" sortConfig={sortConfig} onSort={handleSort} className="w-[80px]" />
                    {displayColumns.map((col) => (
                      <SortableHead key={col} colKey={col} label={col} sortConfig={sortConfig} onSort={handleSort} className="font-mono text-xs" />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordsQuery.isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={displayColumns.length + 1}
                        className="py-6 text-center"
                      >
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!recordsQuery.isLoading && records.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={displayColumns.length + 1}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No records.
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedRecords.map((r) => (
                    <TableRow
                      key={r.id}
                      className="align-top text-muted-foreground"
                    >
                      <TableCell className="font-mono text-xs">
                        {r.sourceId}
                      </TableCell>
                      {displayColumns.map((col) => {
                        const sourceValue = (r.sourceData as Record<string, unknown>)[col];
                        return (
                          <TableCell
                            key={col}
                            className="text-xs"
                            title={String(sourceValue ?? "")}
                          >
                            <div className="truncate">
                              {renderCell(sourceValue)}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <div className="border-b border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
              Staging (editable)
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedIds.size > 0}
                        onCheckedChange={(v) => {
                          if (v === true) selectAllMatchingFilter();
                          else setSelectedIds(new Set());
                        }}
                        title={
                          selectedIds.size > 0
                            ? "Clear selection"
                            : "Select all matching filter"
                        }
                      />
                    </TableHead>
                    <SortableHead colKey="__id__" label="id" sortConfig={sortConfig} onSort={handleSort} className="w-[80px]" />
                    {displayColumns.map((col) => (
                      <SortableHead key={col} colKey={col} label={col} sortConfig={sortConfig} onSort={handleSort} className="font-mono text-xs" />
                    ))}
                    <TableHead className="w-[80px]">flags</TableHead>
                    <TableHead className="w-[140px]">
                      <QualityColumnHeader
                        blocks={qualityCounts.blocks}
                        warns={qualityCounts.warns}
                      />
                    </TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordsQuery.isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={displayColumns.length + 6}
                        className="py-6 text-center"
                      >
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!recordsQuery.isLoading && records.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={displayColumns.length + 6}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No records.
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedRecords.map((r) => {
                    const checked = selectedIds.has(r.id);
                    return (
                      <StagedRowCells
                        key={r.id}
                        record={r}
                        displayColumns={displayColumns}
                        editingCell={editingCell}
                        editValue={editValue}
                        setEditValue={setEditValue}
                        startEditingCell={startEditingCell}
                        commitCellEdit={commitCellEdit}
                        setEditingCell={setEditingCell}
                        getFk={fkResolver}
                        setFkPreview={setFkPreview}
                        setInspectId={setInspectId}
                        diffMode={false}
                        checked={checked}
                        toggleRowSelection={toggleRowSelection}
                        onAcknowledgeQuality={(id) => acknowledgeMutation.mutate(id)}
                        acknowledgingId={
                          acknowledgeMutation.isPending
                            ? (acknowledgeMutation.variables as number | undefined) ?? null
                            : null
                        }
                        projectId={projectId}
                        activeJobId={activeJobId}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={selectedIds.size > 0}
                      onCheckedChange={(v) => {
                        if (v === true) selectAllMatchingFilter();
                        else setSelectedIds(new Set());
                      }}
                      title={
                        selectedIds.size > 0
                          ? "Clear selection"
                          : "Select all matching filter"
                      }
                    />
                  </TableHead>
                  <SortableHead colKey="__id__" label="id" sortConfig={sortConfig} onSort={handleSort} className="w-[80px]" />
                  {displayColumns.map((col) => (
                    <SortableHead key={col} colKey={col} label={col} sortConfig={sortConfig} onSort={handleSort} className="font-mono text-xs" />
                  ))}
                  <TableHead className="w-[80px]">flags</TableHead>
                  <TableHead className="w-[140px]">
                    <QualityColumnHeader
                      blocks={qualityCounts.blocks}
                      warns={qualityCounts.warns}
                    />
                  </TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recordsQuery.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={displayColumns.length + 5}
                      className="py-6 text-center"
                    >
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {!recordsQuery.isLoading && records.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={displayColumns.length + 5}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No records match the current filter.
                    </TableCell>
                  </TableRow>
                )}
                {sortedRecords.map((r) => {
                  const checked = selectedIds.has(r.id);
                  return (
                    <StagedRowCells
                      key={r.id}
                      record={r}
                      displayColumns={displayColumns}
                      editingCell={editingCell}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      startEditingCell={startEditingCell}
                      commitCellEdit={commitCellEdit}
                      setEditingCell={setEditingCell}
                      getFk={fkResolver}
                      setFkPreview={setFkPreview}
                      setInspectId={setInspectId}
                      diffMode={diffMode}
                      checked={checked}
                      toggleRowSelection={toggleRowSelection}
                      onAcknowledgeQuality={(id) => acknowledgeMutation.mutate(id)}
                      acknowledgingId={
                        acknowledgeMutation.isPending
                          ? (acknowledgeMutation.variables as number | undefined) ?? null
                          : null
                      }
                      projectId={projectId}
                      activeJobId={activeJobId}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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

      <FkPreviewDialog
        projectId={projectId}
        jobId={activeJobId}
        preview={fkPreview}
        onClose={() => setFkPreview(null)}
      />

      <Dialog
        open={inspectRecord !== null}
        onOpenChange={(o) => !o && setInspectId(null)}
      >
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="border-b p-6 pb-4">
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
              getFk={fkResolver}
              onPreviewFk={(relation, sourceId) =>
                setFkPreview({ relation, sourceId })
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  if (!active) {
    return (
      <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/30" />
    );
  }
  return direction === "asc" ? (
    <ArrowUp className="h-3 w-3 shrink-0 text-foreground" />
  ) : (
    <ArrowDown className="h-3 w-3 shrink-0 text-foreground" />
  );
}

function SortableHead({
  colKey,
  label,
  sortConfig,
  onSort,
  className = "",
}: {
  colKey: string;
  label: string;
  sortConfig: SortConfig;
  onSort: (col: string) => void;
  className?: string;
}) {
  const active = sortConfig?.column === colKey;
  const direction = active ? sortConfig!.direction : "asc";
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/40 ${className}`}
      onClick={() => onSort(colKey)}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <div className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        <SortIcon active={active} direction={direction} />
      </div>
    </TableHead>
  );
}

function QualityColumnHeader({
  blocks,
  warns,
}: {
  blocks: number;
  warns: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span>quality</span>
      {blocks > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 ring-1 ring-inset ring-red-200">
          <AlertOctagon className="h-2.5 w-2.5" />
          {blocks}
        </span>
      )}
      {warns > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="h-2.5 w-2.5" />
          {warns}
        </span>
      )}
    </div>
  );
}

const FK_LABEL_MAX = 28;

function truncateLabel(label: string): string {
  if (!label) return "";
  return label.length > FK_LABEL_MAX ? label.slice(0, FK_LABEL_MAX) + "…" : label;
}

function FkCombobox({
  projectId,
  jobId,
  targetTable,
  currentId,
  onSelect,
  onClose,
}: {
  projectId: number;
  jobId: number | null;
  targetTable: string;
  currentId: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const optionsQuery = useQuery({
    queryKey: ["fk-options", projectId, jobId, targetTable, search],
    enabled: !!jobId,
    queryFn: async () => {
      const url = new URL(
        `/api/projects/${projectId}/staging/fk-options`,
        window.location.origin,
      );
      url.searchParams.set("table", targetTable);
      url.searchParams.set("jobId", String(jobId));
      if (search) url.searchParams.set("q", search);
      const r = await fetch(url.toString());
      if (!r.ok) return [] as Array<{ id: number; label: string }>;
      return ((await r.json()) as { options: Array<{ id: number; label: string }> }).options;
    },
    staleTime: 30_000,
  });

  // Position dropdown via fixed coords to escape table cell overflow:hidden
  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const isDark = document.documentElement.classList.contains("dark");
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 2,
      left: rect.left,
      width: Math.max(rect.width, 224),
      zIndex: 9999,
      backgroundColor: isDark ? "hsl(240 10% 3.9%)" : "#ffffff",
      border: "1px solid hsl(240 5.9% 90%)",
      borderRadius: "6px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
    });
  }, []);

  useEffect(() => {
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const options = optionsQuery.data ?? [];

  const dropdown = (
    <div style={dropdownStyle} className="max-h-52 overflow-y-auto">
      {optionsQuery.isLoading ? (
        <div className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </div>
      ) : options.length === 0 ? (
        <div className="py-2 text-center text-xs text-muted-foreground">No results</div>
      ) : (
        <ul className="py-1">
          {currentId !== null && (
            <li>
              <button
                type="button"
                className="w-full px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(null);
                }}
              >
                — clear (set null)
              </button>
            </li>
          )}
          {options.map((opt) => (
            <li key={opt.id}>
              <button
                type="button"
                className={`w-full px-2 py-1 text-left text-xs hover:bg-muted ${
                  opt.id === currentId ? "bg-muted/60 font-medium" : ""
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(opt.id);
                }}
                title={opt.label ? `${opt.id} — ${opt.label}` : String(opt.id)}
              >
                <span className="font-mono text-muted-foreground">{opt.id}</span>
                {opt.label && (
                  <span className="ml-1 text-foreground">
                    — {truncateLabel(opt.label)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div ref={containerRef}>
      <input
        ref={inputRef}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder={currentId ? `Current: ${currentId}` : "Search…"}
        className="h-7 w-full rounded border bg-background px-1.5 text-xs"
      />
      {typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </div>
  );
}

function StagedRowCells({
  record: r,
  displayColumns,
  editingCell,
  editValue,
  setEditValue,
  startEditingCell,
  commitCellEdit,
  setEditingCell,
  getFk,
  setFkPreview,
  setInspectId,
  diffMode,
  checked,
  toggleRowSelection,
  onAcknowledgeQuality,
  acknowledgingId,
  projectId,
  activeJobId,
}: {
  record: StagedRecord;
  displayColumns: string[];
  editingCell: { recordId: number; column: string } | null;
  editValue: string;
  setEditValue: (v: string) => void;
  startEditingCell: (recordId: number, column: string, currentValue: unknown) => void;
  commitCellEdit: (record: StagedRecord, overrideValue?: unknown) => void;
  setEditingCell: (v: { recordId: number; column: string } | null) => void;
  getFk: (column: string) => RelationDefinition | null;
  setFkPreview: (v: { relation: RelationDefinition; sourceId: number } | null) => void;
  setInspectId: (id: number | null) => void;
  diffMode: boolean;
  checked: boolean;
  toggleRowSelection: (id: number, checked: boolean) => void;
  onAcknowledgeQuality: (recordId: number) => void;
  acknowledgingId: number | null;
  projectId: number;
  activeJobId: number | null;
}) {
  return (
    <TableRow className={`align-top ${r.isDeleted ? "opacity-60" : ""}`}>
      <TableCell>
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => toggleRowSelection(r.id, v === true)}
        />
      </TableCell>
      <TableCell className="font-mono text-xs">{r.sourceId}</TableCell>
      {displayColumns.map((col) => {
        const stagedValue = (r.stagedData as Record<string, unknown>)[col];
        const sourceValue = (r.sourceData as Record<string, unknown>)[col];
        const isEditing =
          editingCell?.recordId === r.id && editingCell?.column === col;
        const changed =
          JSON.stringify(sourceValue) !== JSON.stringify(stagedValue);
        const fkRel = getFk(col);
        const fkTarget =
          fkRel && typeof stagedValue === "number" && stagedValue > 0
            ? stagedValue
            : null;
        return (
          <TableCell
            key={col}
            className={`text-xs ${changed ? "bg-yellow-50" : ""}`}
          >
            {isEditing ? (
              fkRel ? (
                <FkCombobox
                  projectId={projectId}
                  jobId={activeJobId}
                  targetTable={fkRel.toTable}
                  currentId={typeof stagedValue === "number" ? stagedValue : null}
                  onSelect={(id) => commitCellEdit(r, id)}
                  onClose={() => setEditingCell(null)}
                />
              ) : (
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
              )
            ) : (
              <div className="flex items-center gap-1">
                <div
                  className="flex-1 cursor-text truncate"
                  onClick={() => startEditingCell(r.id, col, stagedValue)}
                  title={String(stagedValue ?? "")}
                >
                  {diffMode && changed ? (
                    <span className="flex flex-col leading-tight">
                      <span className="text-[10px] text-muted-foreground line-through">
                        {renderCell(sourceValue)}
                      </span>
                      <span className="font-semibold">
                        {renderCell(stagedValue)}
                      </span>
                    </span>
                  ) : (
                    renderCell(stagedValue)
                  )}
                </div>
                {fkRel && fkTarget !== null && (
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={`Preview ${fkRel.toTable}#${fkTarget}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFkPreview({ relation: fkRel, sourceId: fkTarget });
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
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
        <QualityFlagCell
          severity={r.qualitySeverity ?? null}
          findings={r.qualityFlags ?? null}
          overridden={r.qualityOverridden}
          onAcknowledge={() => onAcknowledgeQuality(r.id)}
          isAcknowledging={acknowledgingId === r.id}
          showInlineApprove
        />
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
}

function FkPreviewDialog({
  projectId,
  jobId,
  preview,
  onClose,
}: {
  projectId: number;
  jobId: number | null;
  preview: { relation: RelationDefinition; sourceId: number } | null;
  onClose: () => void;
}) {
  const previewQuery = useQuery({
    queryKey: [
      "fk-preview",
      projectId,
      jobId,
      preview?.relation.toTable,
      preview?.sourceId,
    ],
    enabled: !!preview && !!jobId,
    queryFn: async () => {
      if (!preview || !jobId) return null;
      const url = new URL(
        `/api/projects/${projectId}/staging/lookup`,
        window.location.origin,
      );
      url.searchParams.set("table", preview.relation.toTable);
      url.searchParams.set("sourceId", String(preview.sourceId));
      url.searchParams.set("jobId", String(jobId));
      const r = await fetch(url.toString());
      if (!r.ok) throw new Error(await r.text());
      return ((await r.json()) as { record: StagedRecord | null }).record;
    },
  });

  const record = previewQuery.data;
  const data = (record?.stagedData as Record<string, unknown> | undefined) ?? null;

  // Show "summary" fields first (name, code, etc.), then the rest.
  const summaryKeys = [
    "id",
    "display_name",
    "name",
    "code",
    "ref",
    "complete_name",
    "active",
  ];
  const dataKeys = data ? Object.keys(data) : [];
  const ordered = [
    ...summaryKeys.filter((k) => dataKeys.includes(k)),
    ...dataKeys.filter((k) => !summaryKeys.includes(k)),
  ];

  return (
    <Dialog open={preview !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>
            {preview && (
              <>
                <span className="font-mono">{preview.relation.toTable}</span>
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  #{preview.sourceId}
                </span>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {preview && (
              <>
                Referenced from{" "}
                <span className="font-mono">
                  {preview.relation.fromTable}.{preview.relation.fromColumn}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {previewQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : previewQuery.error ? (
            <p className="text-sm text-red-700">
              {(previewQuery.error as Error).message}
            </p>
          ) : !record ? (
            <p className="text-sm text-muted-foreground">
              Parent record not found in this extraction. It may live in the
              built-in target DB or be missing from the source data.
            </p>
          ) : data ? (
            <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 text-xs">
              {ordered.map((k) => (
                <React.Fragment key={k}>
                  <dt className="font-mono text-muted-foreground">{k}</dt>
                  <dd className="break-all font-mono">
                    {renderCell(data[k])}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InspectBody({
  record,
  onSave,
  isSaving,
  getFk,
  onPreviewFk,
}: {
  record: StagedRecord;
  onSave: (next: Record<string, unknown>) => void;
  isSaving: boolean;
  getFk: (column: string) => RelationDefinition | null;
  onPreviewFk: (relation: RelationDefinition, sourceId: number) => void;
}) {
  const [draft, setDraft] = useState(record.stagedData);
  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <SplitViewEditor
          sourceData={record.sourceData}
          stagedData={draft}
          onChange={(next) => setDraft(next)}
          onReset={() => setDraft(record.sourceData)}
          getFk={getFk}
          onPreviewFk={onPreviewFk}
        />
      </div>
      <DialogFooter className="border-t p-4">
        <Button onClick={() => onSave(draft)} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </>
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
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
  // Odoo translation field: show only the preferred locale's text.
  const t = unwrapTranslation(value);
  if (t) return t.text;
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
