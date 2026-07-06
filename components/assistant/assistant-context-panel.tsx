"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type {
  AssistantContextSourceState,
  AssistantContextSourceStatus,
  AssistantContextStatus,
  AssistantContextSummary,
} from "@/lib/assistant";
import { cn } from "@/lib/utils";

type AssistantContextPanelProps = {
  context?: AssistantContextSummary;
  contextStatus?: AssistantContextStatus;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  open: boolean;
  refreshing: boolean;
  warning: string | null;
};

type ContextItem = {
  action: string;
  href: string;
  label: string;
  status: AssistantContextSourceStatus;
};

const sourceStateStyles: Record<AssistantContextSourceState, string> = {
  available: "bg-brand-teal",
  empty: "bg-brand-ink/25",
  failed: "bg-brand-coral",
  not_connected: "bg-brand-ink/25",
};

function formatFreshness(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function AssistantContextPanel({
  context,
  contextStatus,
  loading,
  onClose,
  onRefresh,
  open,
  refreshing,
  warning,
}: AssistantContextPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const workStatus = contextStatus?.workSchedule ?? {
    detail: context?.workShiftsCount
      ? `${context.workShiftsCount} shifts loaded`
      : "No shifts added",
    state: context?.workShiftsCount ? ("available" as const) : ("empty" as const),
  };
  const calendarStatus = contextStatus?.externalCalendars ?? {
    detail: context?.importedEventsCount
      ? `${context.importedEventsCount} events this week`
      : "No imported events this week",
    state: context?.importedEventsCount ? ("available" as const) : ("empty" as const),
  };
  const planStatus = contextStatus?.weeklyPlan ?? {
    detail: context?.weeklyBlocksCount
      ? `${context.weeklyBlocksCount} time blocks this week`
      : "No time blocks this week",
    state: context?.weeklyBlocksCount ? ("available" as const) : ("empty" as const),
  };
  const temporaryChangesStatus = contextStatus?.scheduleExceptions ?? {
    detail: "No temporary changes loaded",
    state: "empty" as const,
  };
  const items: ContextItem[] = [
    { action: "Open", href: "/work", label: "Work Schedule", status: workStatus },
    {
      action: calendarStatus.state === "not_connected" ? "Connect" : "Open",
      href: calendarStatus.state === "not_connected" ? "/integrations" : "/calendar",
      label: "External calendars",
      status: calendarStatus,
    },
    { action: "Open", href: "/plan", label: "Weekly Plan", status: planStatus },
    {
      action: "Open",
      href: "/work",
      label: "Temporary changes",
      status: temporaryChangesStatus,
    },
  ];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end bg-brand-ink/24 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        aria-label="Schedule context"
        aria-modal="true"
        className="animate-assistant-details max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-[0_-22px_70px_rgba(18,32,47,0.2)] sm:max-w-lg sm:rounded-[28px] sm:p-5"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-brand-ink">Schedule context</h2>
            <p className="mt-1 text-sm leading-6 text-brand-ink/52">
              Sources the Assistant uses when validating your plan.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Close schedule context"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-ink/6 text-xl text-brand-ink/58"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {warning ? (
          <div className="mt-4 rounded-[18px] bg-brand-coral/[0.07] p-3" role="status">
            <p className="text-xs font-semibold text-brand-coral">
              Some schedule data is unavailable
            </p>
            <p className="mt-1 text-[11px] leading-5 text-brand-ink/58">{warning}</p>
          </div>
        ) : null}

        <div className="mt-4 divide-y divide-brand-ink/7 border-y border-brand-ink/7">
          {items.map((item) => (
            <div key={item.label} className="flex items-start gap-3 py-3">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  sourceStateStyles[item.status.state],
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-brand-ink/74">{item.label}</p>
                  <Link
                    className="text-xs font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
                    href={item.href}
                  >
                    {item.action}
                  </Link>
                </div>
                <p className="mt-1 text-xs leading-5 text-brand-ink/50">
                  {item.status.detail}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-brand-ink/42">
            {formatFreshness(contextStatus?.refreshedAt)
              ? `Updated ${formatFreshness(contextStatus?.refreshedAt)}`
              : "Freshness unavailable"}
          </p>
          <Button
            className="h-10 rounded-xl px-4 text-xs"
            disabled={loading || refreshing}
            size="sm"
            variant="outline"
            onClick={onRefresh}
          >
            {refreshing ? "Refreshing…" : "Refresh context"}
          </Button>
        </div>
      </section>
    </div>
  );
}
