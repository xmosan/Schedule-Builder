"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  AssistantContextSourceState,
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

const sourceStateStyles: Record<AssistantContextSourceState, string> = {
  available: "bg-brand-teal",
  empty: "bg-brand-ink/25",
  failed: "bg-brand-coral",
  not_connected: "bg-brand-ink/25",
};

function formatFreshness(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
  const items = [
    {
      action: "View Work Schedule",
      href: "/work",
      label: "Work schedule",
      status: workStatus,
    },
    {
      action:
        calendarStatus.state === "not_connected"
          ? "Connect a calendar"
          : "View Calendar",
      href:
        calendarStatus.state === "not_connected" ? "/integrations" : "/calendar",
      label: "External calendars",
      status: calendarStatus,
    },
    {
      action: "Open Weekly Plan",
      href: "/plan",
      label: "Weekly plan",
      status: planStatus,
    },
    {
      action: "View Work Schedule",
      href: "/work",
      label: "Temporary changes",
      status: temporaryChangesStatus,
    },
  ].filter(
    (item) =>
      !(
        warning &&
        item.label === "Temporary changes" &&
        item.status.state === "failed"
      ),
  );

  return (
    <aside
      aria-label="Planning context"
      className="order-first shrink-0 rounded-[24px] border border-white/75 bg-white/68 p-3 shadow-[0_16px_42px_rgba(18,32,47,0.06)] backdrop-blur-sm xl:order-last xl:sticky xl:top-0 xl:max-h-full xl:overflow-y-auto xl:p-4"
    >
      <button
        aria-expanded={mobileOpen}
        aria-controls="assistant-planning-context"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[16px] px-1 text-left xl:hidden"
        type="button"
        onClick={() => setMobileOpen((current) => !current)}
      >
        <span className="min-w-0 truncate text-sm font-semibold text-brand-ink">
          {summary}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "text-lg text-brand-ink/45 transition-transform",
            mobileOpen && "rotate-180",
          )}
        >
          ⌄
        </span>
      </button>

      {warning ? (
        <div
          className="animate-assistant-message mt-2 rounded-[18px] border border-brand-coral/18 bg-brand-coral/[0.07] p-3 xl:mt-0"
          role="status"
        >
          <p className="text-xs font-semibold text-brand-coral">
            Some schedule data is unavailable
          </p>
          <p className="mt-1 text-[11px] leading-5 text-brand-ink/58">
            {warning}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
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

      <div
        id="assistant-planning-context"
        className={cn(
          "pt-3 xl:block xl:pt-0",
          mobileOpen ? "block animate-assistant-details" : "hidden",
        )}
      >
        <div className="hidden xl:block">
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-brand-teal">
            Planning context
          </p>
          <p className="mt-2 text-sm leading-6 text-brand-ink/56">
            Sources checked before the Assistant proposes a change.
          </p>
        </div>

        <div className="divide-y divide-brand-ink/7 xl:mt-4">
          {items.map((item) => (
            <div key={item.label} className="py-3 first:pt-0 xl:first:pt-3">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    sourceStateStyles[item.status.state],
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/42">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-brand-ink/72">
                    {item.status.detail}
                  </p>
                  {item.label === "External calendars" && calendarFreshness ? (
                    <p className="mt-0.5 text-[10px] text-brand-ink/42">
                      Last updated {calendarFreshness}
                    </p>
                  ) : null}
                  <Link
                    className="mt-1.5 inline-flex text-[11px] font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
                    href={item.href}
                  >
                    {item.action}
                  </Link>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/42">
                  Pending review
                </p>
                <p className="mt-1 text-xs font-semibold leading-5 text-brand-ink/72">
                  {pendingReviewCount > 0
                    ? `${pendingReviewCount} change${pendingReviewCount === 1 ? "" : "s"} ready to review`
                    : "No changes awaiting review"}
                </p>
                {pendingReviewCount > 0 ? (
                  <button
                    className="mt-1.5 text-[11px] font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
                    type="button"
                    onClick={onReviewChanges}
                  >
                    Review changes
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-brand-ink/7 pt-3">
          <p className="text-[10px] leading-4 text-brand-ink/42">
            {refreshedAt ? `Updated ${refreshedAt}` : "Source freshness unavailable"}
          </p>
          <Button
            className="h-8 rounded-full px-3 text-[11px] font-semibold"
            disabled={refreshing || loading}
            size="sm"
            type="button"
            variant="outline"
            onClick={onRefresh}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
