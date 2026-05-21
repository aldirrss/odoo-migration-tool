"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  QualityFinding,
  Severity,
} from "@/lib/migration/quality/types";

interface Props {
  severity: Severity | null;
  findings: QualityFinding[] | null;
  overridden?: boolean;
  onAcknowledge?: () => void;
  isAcknowledging?: boolean;
}

export function QualityFlagCell({
  severity,
  findings,
  overridden,
  onAcknowledge,
  isAcknowledging,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const count = findings?.length ?? 0;
  const effectiveSeverity: Severity = severity ?? "ok";

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          effectiveSeverity === "block"
            ? `Blocked by ${count} quality rule${count === 1 ? "" : "s"}`
            : effectiveSeverity === "warn"
              ? `${count} quality warning${count === 1 ? "" : "s"}`
              : "No quality findings"
        }
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs hover:bg-muted"
      >
        {effectiveSeverity === "block" ? (
          <>
            <AlertOctagon
              className={`h-3.5 w-3.5 ${overridden ? "text-orange-500" : "text-red-600"}`}
            />
            <span
              className={`font-mono ${overridden ? "text-orange-700" : "text-red-700"}`}
            >
              {count}
            </span>
          </>
        ) : effectiveSeverity === "warn" ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />
            <span className="font-mono text-yellow-700">{count}</span>
          </>
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600/70" />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-[360px] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
          role="dialog"
        >
          {count === 0 ? (
            <p className="text-xs text-muted-foreground">
              No quality findings for this record.
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
              {findings?.map((f, idx) => (
                <li key={idx} className="border-b pb-1.5 last:border-b-0 last:pb-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={
                        f.severity === "block"
                          ? "rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800"
                          : "rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800"
                      }
                    >
                      {f.severity}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {f.rule}
                    </span>
                    <span className="font-mono text-[10px]">{f.column}</span>
                  </div>
                  <p className="mt-0.5 break-words text-muted-foreground">
                    {f.message}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {effectiveSeverity === "block" && onAcknowledge && (
            <div className="mt-3 border-t pt-2">
              {overridden ? (
                <p className="text-xs text-orange-700">
                  Acknowledged — record will be imported despite blocks.
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    onAcknowledge();
                  }}
                  disabled={isAcknowledging}
                >
                  {isAcknowledging
                    ? "Acknowledging…"
                    : "Acknowledge & allow import"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
