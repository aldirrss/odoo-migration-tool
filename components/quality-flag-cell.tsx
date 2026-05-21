"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertOctagon, AlertTriangle, CheckCircle2, Check, Loader2 } from "lucide-react";

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
  /** When true, renders a compact inline approve button next to the flag badge */
  showInlineApprove?: boolean;
}

export function QualityFlagCell({
  severity,
  findings,
  overridden,
  onAcknowledge,
  isAcknowledging,
  showInlineApprove = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const POPUP_W = 380;
      let left = rect.right - POPUP_W;
      if (left < 8) left = 8;
      if (left + POPUP_W > window.innerWidth - 8) {
        left = window.innerWidth - POPUP_W - 8;
      }
      setPopupStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left,
        width: POPUP_W,
        zIndex: 9999,
      });
    }
    setOpen((v) => !v);
  };

  const count = findings?.length ?? 0;
  const effectiveSeverity: Severity = severity ?? "ok";
  const canApprove =
    (effectiveSeverity === "block" || effectiveSeverity === "warn") &&
    !overridden &&
    !!onAcknowledge;

  const popup = (
    <div
      ref={popupRef}
      style={popupStyle}
      className="overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xl"
      role="dialog"
    >
      {/* header */}
      <div className="border-b bg-muted/40 px-3 py-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          {count === 0
            ? "No quality findings"
            : `${count} quality finding${count === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* findings list */}
      <div className="max-h-72 overflow-y-auto p-2">
        {count === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            This record passed all quality checks.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {findings?.map((f, idx) => (
              <li
                key={idx}
                className="rounded-md border bg-background px-2.5 py-2 text-xs"
              >
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <span
                    className={
                      f.severity === "block"
                        ? "shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700"
                        : "shrink-0 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-700"
                    }
                  >
                    {f.severity}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {f.rule}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[10px] font-medium text-foreground">
                    {f.column}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                  {f.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* acknowledge footer */}
      {effectiveSeverity === "block" && onAcknowledge && (
        <div className="border-t bg-muted/30 px-3 py-2">
          {overridden ? (
            <p className="text-[11px] text-orange-700">
              Acknowledged — this record will be imported despite quality blocks.
            </p>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs"
              onClick={() => {
                onAcknowledge();
                setOpen(false);
              }}
              disabled={isAcknowledging}
            >
              {isAcknowledging ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Acknowledging…
                </>
              ) : (
                <>
                  <Check className="mr-1.5 h-3 w-3" />
                  Acknowledge & allow import
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="inline-flex items-center gap-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title={
          effectiveSeverity === "block"
            ? `${count} quality block${count === 1 ? "" : "s"}${overridden ? " (acknowledged)" : ""}`
            : effectiveSeverity === "warn"
              ? `${count} quality warning${count === 1 ? "" : "s"}${overridden ? " (acknowledged)" : ""}`
              : "No quality findings"
        }
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs hover:bg-muted"
      >
        {effectiveSeverity === "block" ? (
          <>
            <AlertOctagon
              className={`h-3.5 w-3.5 ${overridden ? "text-orange-400" : "text-red-600"}`}
            />
            <span
              className={`font-mono ${overridden ? "text-orange-500" : "text-red-700"}`}
            >
              {count}
            </span>
          </>
        ) : effectiveSeverity === "warn" ? (
          <>
            <AlertTriangle
              className={`h-3.5 w-3.5 ${overridden ? "text-orange-400" : "text-yellow-600"}`}
            />
            <span
              className={`font-mono ${overridden ? "text-orange-500" : "text-yellow-700"}`}
            >
              {count}
            </span>
          </>
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600/70" />
        )}
      </button>

      {/* inline approve button */}
      {showInlineApprove && canApprove && (
        <button
          type="button"
          title="Acknowledge & allow import"
          onClick={() => onAcknowledge?.()}
          disabled={isAcknowledging}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-green-50 hover:text-green-600 disabled:opacity-50"
        >
          {isAcknowledging ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </button>
      )}

      {mounted && open ? createPortal(popup, document.body) : null}
    </div>
  );
}
