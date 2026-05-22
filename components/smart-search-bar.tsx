"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { Search, X, Filter } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilterChip =
  | { kind: "text"; id: string; value: string; column?: string }
  | { kind: "dirty" }
  | { kind: "deleted"; value: "any" | "yes" }
  | { kind: "validation"; value: "pass" | "warning" | "fail" | "pending" }
  | { kind: "quality"; value: "block" | "warn" | "ok" };

export interface SmartSearchBarProps {
  chips: FilterChip[];
  pendingText: string;
  onChipsChange: (chips: FilterChip[]) => void;
  onPendingTextChange: (text: string) => void;
  placeholder?: string;
  className?: string;
  /** Available columns for column-specific search suggestions in the dropdown. */
  columns?: string[];
}

// ---------------------------------------------------------------------------
// Dropdown option definitions
// ---------------------------------------------------------------------------

interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}

interface DropdownOption {
  label: string;
  keywords: string[];
  chip: FilterChip;
}

const DROPDOWN_GROUPS: DropdownGroup[] = [
  {
    label: "Status",
    options: [
      {
        label: "Dirty records",
        keywords: ["dirty", "modified", "changed"],
        chip: { kind: "dirty" },
      },
    ],
  },
  {
    label: "Deleted",
    options: [
      {
        label: "Show all (including deleted)",
        keywords: ["deleted", "show all", "all", "include"],
        chip: { kind: "deleted", value: "any" },
      },
      {
        label: "Only deleted",
        keywords: ["deleted", "only deleted", "trash"],
        chip: { kind: "deleted", value: "yes" },
      },
    ],
  },
  {
    label: "Validation",
    options: [
      {
        label: "Validation: Fail",
        keywords: ["fail", "failed", "validation", "invalid", "error"],
        chip: { kind: "validation", value: "fail" },
      },
      {
        label: "Validation: Pass",
        keywords: ["pass", "passed", "valid", "validation", "ok"],
        chip: { kind: "validation", value: "pass" },
      },
      {
        label: "Validation: Warning",
        keywords: ["warning", "warn", "validation"],
        chip: { kind: "validation", value: "warning" },
      },
      {
        label: "Validation: Pending",
        keywords: ["pending", "not validated", "validation"],
        chip: { kind: "validation", value: "pending" },
      },
    ],
  },
  {
    label: "Quality",
    options: [
      {
        label: "Quality: Block",
        keywords: ["block", "blocking", "quality", "critical"],
        chip: { kind: "quality", value: "block" },
      },
      {
        label: "Quality: Warning",
        keywords: ["warning", "warn", "quality"],
        chip: { kind: "quality", value: "warn" },
      },
      {
        label: "Quality: Clean",
        keywords: ["clean", "ok", "good", "quality"],
        chip: { kind: "quality", value: "ok" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a unique key string for a chip — used for dedup checks. */
function chipKey(chip: FilterChip): string {
  switch (chip.kind) {
    case "text":
      return chip.column ? `text:${chip.column}:${chip.id}` : `text:${chip.id}`;
    case "dirty":
      return "dirty";
    case "deleted":
      return `deleted:${chip.value}`;
    case "validation":
      return `validation:${chip.value}`;
    case "quality":
      return `quality:${chip.value}`;
  }
}

/** The "singleton kind" for non-text chips — only one per kind can be active. */
function chipSingletonKind(chip: FilterChip): string | null {
  if (chip.kind === "text") return null;
  return chip.kind;
}

/** Returns true when a chip of this kind is already present in the list. */
function hasChipOfKind(chips: FilterChip[], incoming: FilterChip): boolean {
  const sk = chipSingletonKind(incoming);
  if (!sk) return false;
  return chips.some((c) => c.kind === sk);
}

// ---------------------------------------------------------------------------
// Chip visual label & color classes
// ---------------------------------------------------------------------------

function chipLabel(chip: FilterChip): string {
  switch (chip.kind) {
    case "text":
      return chip.column ? `${chip.column}: "${chip.value}"` : chip.value;
    case "dirty":
      return "Dirty";
    case "deleted":
      return chip.value === "any" ? "Deleted: All" : "Deleted: Yes";
    case "validation":
      return `Validation: ${chip.value.charAt(0).toUpperCase()}${chip.value.slice(1)}`;
    case "quality":
      switch (chip.value) {
        case "block":
          return "Quality: Block";
        case "warn":
          return "Quality: Warn";
        case "ok":
          return "Quality: Clean";
      }
  }
}

function chipClasses(chip: FilterChip): string {
  const base =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0";
  switch (chip.kind) {
    case "text":
      return `${base} bg-secondary text-secondary-foreground`;
    case "dirty":
      return `${base} bg-amber-100 text-amber-800`;
    case "deleted":
      return chip.value === "any"
        ? `${base} bg-muted text-muted-foreground`
        : `${base} bg-orange-100 text-orange-800`;
    case "validation":
      switch (chip.value) {
        case "fail":
          return `${base} bg-red-100 text-red-800`;
        case "pass":
          return `${base} bg-green-100 text-green-800`;
        case "warning":
          return `${base} bg-yellow-100 text-yellow-800`;
        case "pending":
          return `${base} bg-muted text-muted-foreground`;
      }
      break;
    case "quality":
      switch (chip.value) {
        case "block":
          return `${base} bg-red-100 text-red-800`;
        case "warn":
          return `${base} bg-yellow-100 text-yellow-800`;
        case "ok":
          return `${base} bg-green-100 text-green-800`;
      }
  }
  return `${base} bg-secondary text-secondary-foreground`;
}

// ---------------------------------------------------------------------------
// SmartSearchBar component
// ---------------------------------------------------------------------------

export function SmartSearchBar({
  chips,
  pendingText,
  onChipsChange,
  onPendingTextChange,
  placeholder = "Search or add filter...",
  className = "",
  columns,
}: SmartSearchBarProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recalculate dropdown position using fixed coords so it escapes overflow:hidden parents.
  // backgroundColor is set inline (not via Tailwind class) so it's guaranteed opaque
  // even when the portal element lands outside the CSS variable cascade.
  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const isDark = document.documentElement.classList.contains("dark");
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      backgroundColor: isDark ? "hsl(240 10% 3.9%)" : "#ffffff",
      border: "1px solid hsl(240 5.9% 90%)",
      borderRadius: "6px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [open, updateDropdownPosition]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // ---------------------------------------------------------------------------
  // Filtered dropdown groups
  // ---------------------------------------------------------------------------

  const filteredGroups = useMemo<DropdownGroup[]>(() => {
    const query = pendingText.toLowerCase().trim();
    return DROPDOWN_GROUPS.map((group) => {
      const visibleOptions = group.options.filter((opt) => {
        // Hide options whose singleton kind is already active
        if (hasChipOfKind(chips, opt.chip)) return false;
        // If there's a query, match against keywords or label
        if (query) {
          return (
            opt.label.toLowerCase().includes(query) ||
            opt.keywords.some((kw) => kw.includes(query))
          );
        }
        return true;
      });
      return { ...group, options: visibleOptions };
    }).filter((g) => g.options.length > 0);
  }, [pendingText, chips]);

  // ---------------------------------------------------------------------------
  // Chip management
  // ---------------------------------------------------------------------------

  const addChip = useCallback(
    (chip: FilterChip) => {
      let next: FilterChip[];
      const sk = chipSingletonKind(chip);
      if (sk) {
        // Replace existing chip of the same singleton kind
        next = chips.filter((c) => c.kind !== sk).concat(chip);
      } else {
        // Text chips: avoid exact duplicates
        const key = chipKey(chip);
        if (chips.some((c) => chipKey(c) === key)) {
          next = chips;
        } else {
          next = [...chips, chip];
        }
      }
      onChipsChange(next);
      onPendingTextChange("");
      setOpen(false);
      inputRef.current?.focus();
    },
    [chips, onChipsChange, onPendingTextChange],
  );

  const removeChip = useCallback(
    (key: string) => {
      onChipsChange(chips.filter((c) => chipKey(c) !== key));
    },
    [chips, onChipsChange],
  );

  const clearAll = useCallback(() => {
    onChipsChange([]);
    onPendingTextChange("");
    inputRef.current?.focus();
  }, [onChipsChange, onPendingTextChange]);

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && pendingText.trim()) {
        e.preventDefault();
        addChip({
          kind: "text",
          id: crypto.randomUUID(),
          value: pendingText.trim(),
        });
        return;
      }
      if (e.key === "Backspace" && pendingText === "" && chips.length > 0) {
        e.preventDefault();
        const last = chips[chips.length - 1];
        removeChip(chipKey(last));
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    },
    [pendingText, chips, addChip, removeChip],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasContent = chips.length > 0 || pendingText.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Main bar */}
      <div
        className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-sm ring-offset-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${open ? "ring-2 ring-ring ring-offset-2" : ""}`}
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {/* Search icon */}
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        {/* Active filter chips */}
        {chips.map((chip) => {
          const key = chipKey(chip);
          return (
            <span key={key} className={chipClasses(chip)}>
              {chip.kind === "text" && (
                <Search className="h-2.5 w-2.5 shrink-0" />
              )}
              {chip.kind !== "text" && (
                <Filter className="h-2.5 w-2.5 shrink-0" />
              )}
              <span className="max-w-[160px] truncate">{chipLabel(chip)}</span>
              <button
                type="button"
                className="ml-0.5 rounded-full hover:opacity-75 focus:outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  removeChip(key);
                }}
                aria-label={`Remove filter: ${chipLabel(chip)}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          );
        })}

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={pendingText}
          onChange={(e) => onPendingTextChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />

        {/* Clear all button */}
        {hasContent && (
          <button
            type="button"
            className="ml-auto shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            aria-label="Clear all filters"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown — rendered via portal to escape overflow:hidden on parent Cards */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={dropdownStyle}
            className="max-h-72 overflow-y-auto"
          >
            {/* "Search for ..." option — shown only when user has typed something */}
            {pendingText.trim() && (
              <div
                className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addChip({
                    kind: "text",
                    id: crypto.randomUUID(),
                    value: pendingText.trim(),
                  });
                }}
              >
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <span>
                  Search for{" "}
                  <span className="font-medium">&ldquo;{pendingText.trim()}&rdquo;</span>
                </span>
              </div>
            )}

            {/* Column-specific search suggestions */}
            {pendingText.trim() && columns && columns.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground border-t">
                  Columns
                </div>
                {columns.slice(0, 6).map((col) => (
                  <div
                    key={col}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addChip({
                        kind: "text",
                        id: crypto.randomUUID(),
                        value: pendingText.trim(),
                        column: col,
                      });
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground w-24 truncate shrink-0">
                      {col}
                    </span>
                    <span className="text-muted-foreground">contains</span>
                    <span className="font-medium truncate">
                      &ldquo;{pendingText.trim()}&rdquo;
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Filter option groups */}
            {filteredGroups.length === 0 && !pendingText.trim() && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                All filters are active
              </div>
            )}
            {filteredGroups.length === 0 && pendingText.trim() && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No matching filters — press Enter to search
              </div>
            )}
            {filteredGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  {group.label}
                </div>
                {group.options.map((opt) => (
                  <div
                    key={chipKey(opt.chip)}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addChip(opt.chip);
                    }}
                  >
                    <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>{opt.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
