"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type MigrationStep =
  | "connections"
  | "extract"
  | "clean"
  | "validate"
  | "import";

interface StepDescriptor {
  id: MigrationStep;
  label: string;
  href: string;
}

const STEPS: StepDescriptor[] = [
  { id: "connections", label: "Connections", href: "/connections" },
  { id: "extract", label: "Extract", href: "/extract" },
  { id: "clean", label: "Clean", href: "/staging" },
  { id: "validate", label: "Validate", href: "/validate" },
  { id: "import", label: "Import", href: "/import" },
];

interface ProgressStepperProps {
  current: MigrationStep;
  completed?: MigrationStep[];
}

export function ProgressStepper({ current, completed = [] }: ProgressStepperProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Migration progress" className="w-full">
      <ol className="flex w-full items-center gap-2">
        {STEPS.map((step, idx) => {
          const isCompleted = completed.includes(step.id) || idx < currentIndex;
          const isCurrent = step.id === current;
          return (
            <li key={step.id} className="flex flex-1 items-center gap-2">
              <a
                href={step.href}
                className="flex items-center gap-2"
                aria-current={isCurrent ? "step" : undefined}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                    isCompleted &&
                      "border-primary bg-primary text-primary-foreground",
                    isCurrent &&
                      !isCompleted &&
                      "border-primary bg-background text-primary",
                    !isCompleted && !isCurrent && "border-muted text-muted-foreground",
                  )}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : idx + 1}
                </div>
                <span
                  className={cn(
                    "text-sm font-medium",
                    isCurrent && "text-foreground",
                    !isCurrent && !isCompleted && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </a>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-px flex-1 bg-border",
                    (isCompleted || (isCurrent && idx < currentIndex)) && "bg-primary",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
