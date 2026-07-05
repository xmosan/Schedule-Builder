"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  onRefresh: () => void;
  onReviewChanges: () => void;
  pendingReviewCount: number;
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

function ContextContents({
  calendarFreshness,
  items,
  loading,
  onRefresh,
  onReviewChanges,
  pendingReviewCount,
  refreshedAt,
  refreshing,
  warning,
}: {
  calendarFreshness: string | null;
  items: ContextItem[];
  loading: boolean;
  onRefresh: () => void;
  onReviewChanges: () => void;
  pendingReviewCount: number;
  refreshedAt: string | null;
  refreshing: boolean;
  warning: string | null;
}) {
  return (
    <>
      {warning ? (
        <div
          className="rounded-[18px] bg-brand-coral/[0.07] p-3"
          role="status"
        >
          <p className="text-xs font-semibold text-brand-coral">
            Some schedule data is unavailable
          </p>
          <p className="mt-1 text-[11px] leading-5 text-brand-ink/58">
            {warning}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              className="text-xs font-semibold text-brand-coral underline decoration-brand-coral/30 underline-offset-4 disabled:opacity-50"
              disabled={refreshing}
              type="button"
              onClick={onRefresh}
            >
              {refreshing ? "Retrying…" : "Retry"}
            </button>
            <Link
              className="text-xs font-semibold text-brand-ink/58 underline decoration-brand-ink/20 underline-offset-4"
              href="/work"
            >
              View Work Schedule
            </Link>
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-brand-ink/7">
        {items.map((item) => (
          <div key={item.label} className="py-3">
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  sourceStateStyles[item.status.state],
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-brand-ink/72">
                    {item.label}
                  </p>
                  <Link
                    className="shrink-0 text-[11px] font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
                    href={item.href}
                  >
                    {item.action}
                  </Link>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-brand-ink/52">
                  {item.status.detail}
                </p>
                {item.label === "External calendars" && calendarFreshness ? (
                  <p className="mt-0.5 text-[10px] text-brand-ink/38">
                    Updated {calendarFreshness}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        <div className="py-3">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                pendingReviewCount > 0 ? "bg-brand-teal" : "bg-brand-ink/25",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-brand-ink/72">
                  Pending review
                </p>
                {pendingReviewCount > 0 ? (
                  <button
                    className="shrink-0 text-[11px] font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
                    type="button"
                    onClick={onReviewChanges}
                  >
                    Review
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-5 text-brand-ink/52">
                {pendingReviewCount > 0
                  ? `${pendingReviewCount} awaiting approval`
                  : "No changes awaiting review"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-brand-ink/7 pt-3">
        <p className="text-[10px] leading-4 text-brand-ink/42">
          {refreshedAt ? `Updated ${refreshedAt}` : "Freshness unavailable"}
        </p>
        <Button
          className="h-8 rounded-full px-3 text-[11px] font-semibold"
          disabled={refreshing || loading}
          size="sm"
          variant="outline"
          onClick={onRefresh}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
    </>
  );
}

export function AssistantContextPanel({
  context,
  contextStatus,
  loading,
  onRefresh,
  onReviewChanges,
  pendingReviewCount,
  refreshing,
  warning,
}: AssistantContextPanelProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const workStatus = contextStatus?.workSchedule ?? {
    detail: context
      ? context.workShiftsCount > 0
        ? `${context.workShiftsCount} shift${context.workShiftsCount === 1 ? "" : "s"} loaded`
        : "No shifts added"
      : "Loading…",
    state: context ? (context.workShiftsCount > 0 ? "available" : "empty") : "empty",
  };
  const calendarStatus = contextStatus?.externalCalendars ?? {
    detail: context
      ? context.importedEventsCount > 0
        ? `${context.importedEventsCount} event${context.importedEventsCount === 1 ? "" : "s"} this week`
        : "Checking connection…"
      : "Loading…",
    state: context?.importedEventsCount ? "available" : "empty",
  };
  const planStatus = contextStatus?.weeklyPlan ?? {
    detail: context
      ? context.weeklyBlocksCount > 0
        ? `${context.weeklyBlocksCount} time block${context.weeklyBlocksCount === 1 ? "" : "s"} this week`
        : "No time blocks this week"
      : "Loading…",
    state: context?.weeklyBlocksCount ? "available" : "empty",
  };
  const temporaryChangesStatus = contextStatus?.scheduleExceptions ?? {
    detail: "Checking temporary changes…",
    state: "empty" as const,
  };
  const refreshedAt = formatFreshness(contextStatus?.refreshedAt);
  const calendarFreshness = formatFreshness(calendarStatus.lastUpdatedAt);
  const summary = loading
    ? "Planning context · Loading sources"
    : `Planning context · ${context?.workShiftsCount ?? 0} shifts · ${context?.weeklyBlocksCount ?? 0} blocks · ${pendingReviewCount} reviews`;
  const items: ContextItem[] = [
    {
      action: "Open",
      href: "/work",
      label: "Work Schedule",
      status: workStatus,
    },
    {
      action: calendarStatus.state === "not_connected" ? "Connect" : "Open",
      href: calendarStatus.state === "not_connected" ? "/integrations" : "/calendar",
      label: "External calendars",
      status: calendarStatus,
    },
    {
      action: "Open",
      href: "/plan",
      label: "Weekly Plan",
      status: planStatus,
    },
    {
      action: "Open",
      href: "/work",
      label: "Temporary changes",
      status: temporaryChangesStatus,
    },
  ].filter(
    (item) =>
      !(warning && item.label === "Temporary changes" && item.status.state === "failed"),
  );

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      triggerRef.current?.focus();
    };
  }, [mobileOpen]);

  const contents = (
    <ContextContents
      calendarFreshness={calendarFreshness}
      items={items}
      loading={loading}
      pendingReviewCount={pendingReviewCount}
      refreshedAt={refreshedAt}
      refreshing={refreshing}
      warning={warning}
      onRefresh={onRefresh}
      onReviewChanges={onReviewChanges}
    />
  );

  return (
    <>
      <div className="order-first xl:hidden">
        {!mobileOpen ? (
          <button
            ref={triggerRef}
            aria-haspopup="dialog"
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[18px] bg-white/78 px-4 text-left shadow-[0_10px_28px_rgba(18,32,47,0.06)]"
            type="button"
            onClick={() => setMobileOpen(true)}
          >
            <span className="min-w-0 truncate text-sm font-semibold text-brand-ink">
              {summary}
            </span>
            <span aria-hidden="true" className="text-lg text-brand-ink/42">
              +
            </span>
          </button>
        ) : (
          <div
            className="fixed inset-0 z-[110] flex items-end bg-brand-ink/24 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setMobileOpen(false);
            }}
          >
            <section
              ref={drawerRef}
              aria-label="Planning context"
              aria-modal="true"
              className="animate-assistant-details max-h-[82dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-4 shadow-[0_-22px_70px_rgba(18,32,47,0.2)] sm:max-w-md sm:rounded-[28px] sm:p-5"
              role="dialog"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-brand-ink">
                    Planning context
                  </h2>
                  <p className="mt-0.5 text-xs text-brand-ink/48">
                    Sources used to build your plan
                  </p>
                </div>
                <button
                  ref={closeButtonRef}
                  aria-label="Close planning context"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-ink/6 text-xl text-brand-ink/58"
                  type="button"
                  onClick={() => setMobileOpen(false)}
                >
                  ×
                </button>
              </div>
              {contents}
            </section>
          </div>
        )}
      </div>

      <aside
        aria-label="Planning context"
        className="order-last hidden min-h-0 rounded-[22px] bg-white/66 p-4 shadow-[0_16px_42px_rgba(18,32,47,0.055)] xl:sticky xl:top-0 xl:block xl:max-h-full xl:overflow-y-auto"
      >
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-brand-ink">
            Planning context
          </h2>
          <p className="mt-1 text-xs leading-5 text-brand-ink/48">
            Sources used to build your plan
          </p>
        </div>
        {contents}
      </aside>
    </>
  );
}
