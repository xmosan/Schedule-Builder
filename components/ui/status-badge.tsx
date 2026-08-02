"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusVariant =
  | "synced"
  | "imported"
  | "applied"
  | "undone"
  | "draft"
  | "needs-attention"
  | "readonly"
  | "connected"
  | "disconnected"
  | "pending";

type SourceVariant = "google" | "ics" | "d2l" | "work" | "manual" | "plan";

type StatusBadgeProps = {
  children: ReactNode;
  className?: string;
  dot?: boolean;
  variant: StatusVariant | SourceVariant;
};

const statusStyles: Record<StatusVariant | SourceVariant, string> = {
  synced:
    "border-brand-teal/22 bg-brand-teal/10 text-brand-teal",
  imported:
    "border-brand-ocean/20 bg-brand-ocean/10 text-brand-ocean",
  applied:
    "border-brand-moss/20 bg-brand-moss/10 text-brand-moss",
  undone:
    "border-brand-ink/10 bg-brand-ink/[0.04] text-brand-ink/50",
  draft:
    "border-brand-amber/22 bg-brand-amber/10 text-brand-amber",
  "needs-attention":
    "border-brand-coral/22 bg-brand-coral/10 text-brand-coral",
  readonly:
    "border-brand-ink/10 bg-brand-ink/[0.04] text-brand-ink/55",
  connected:
    "border-brand-teal/22 bg-brand-teal/10 text-brand-teal",
  disconnected:
    "border-brand-ink/10 bg-brand-ink/[0.04] text-brand-ink/50",
  pending:
    "border-brand-amber/20 bg-brand-amber/10 text-brand-amber",
  google:
    "border-brand-teal/20 bg-brand-teal/8 text-brand-teal",
  ics:
    "border-brand-ocean/18 bg-brand-ocean/8 text-brand-ocean",
  d2l:
    "border-brand-amber/20 bg-brand-amber/8 text-brand-amber",
  work:
    "border-brand-coral/20 bg-brand-coral/8 text-brand-coral",
  manual:
    "border-brand-moss/20 bg-brand-moss/8 text-brand-moss",
  plan:
    "border-brand-ink/12 bg-brand-ink/[0.05] text-brand-ink/65",
};

const dotColors: Record<StatusVariant | SourceVariant, string> = {
  synced: "bg-brand-teal",
  imported: "bg-brand-ocean",
  applied: "bg-brand-moss",
  undone: "bg-brand-ink/35",
  draft: "bg-brand-amber",
  "needs-attention": "bg-brand-coral",
  readonly: "bg-brand-ink/35",
  connected: "bg-brand-teal",
  disconnected: "bg-brand-ink/35",
  pending: "bg-brand-amber",
  google: "bg-brand-teal",
  ics: "bg-brand-ocean",
  d2l: "bg-brand-amber",
  work: "bg-brand-coral",
  manual: "bg-brand-moss",
  plan: "bg-brand-ink/45",
};

export function StatusBadge({
  children,
  className,
  dot = false,
  variant,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none",
        statusStyles[variant],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            dotColors[variant],
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
