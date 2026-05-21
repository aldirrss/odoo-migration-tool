"use client";

import { AlertTriangle, Ban, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface RelationImpactItem {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  action: "block" | "nullify" | "cascade";
  label: string;
  dependentCount: number;
}

interface RelationWarningProps {
  impacts: RelationImpactItem[];
  className?: string;
}

export function RelationWarning({ impacts, className }: RelationWarningProps) {
  const active = impacts.filter((i) => i.dependentCount > 0);
  if (active.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border bg-green-50 p-3 text-sm text-green-800",
          className,
        )}
      >
        No dependent records found. Safe to delete or modify.
      </div>
    );
  }

  const hasBlocking = active.some((i) => i.action === "block");

  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        hasBlocking ? "border-destructive bg-red-50 text-red-900" : "border-yellow-400 bg-yellow-50 text-yellow-900",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 font-semibold">
        {hasBlocking ? (
          <Ban className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        Dependent records detected
      </div>
      <ul className="space-y-1.5">
        {active.map((i, idx) => (
          <li key={idx} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-3 w-3 opacity-70" />
              <span className="font-mono">{i.fromTable}.{i.fromColumn}</span>
              <span className="text-muted-foreground">— {i.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={i.action === "block" ? "destructive" : "warning"}>
                {i.action}
              </Badge>
              <span className="font-semibold">{i.dependentCount} rec.</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
