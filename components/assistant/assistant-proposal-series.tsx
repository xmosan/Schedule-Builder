"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  AssistantApplyResult,
  AssistantSuggestion,
} from "@/lib/assistant";
import type { RecurringSeriesProposal } from "@/lib/assistant-semantics";
import {
  getSafeAssistantLabel,
  sanitizeAssistantUserFacingText,
} from "@/lib/assistant-ui-guards";
import { formatStartTime, weekDays, type WeekDay } from "@/lib/weekly-plan";
import { cn } from "@/lib/utils";

export type AssistantProposalRowState = {
  editing: boolean;
  message?: string;
  result?: AssistantApplyResult;
  status: "pending" | "dismissing" | "removed" | "applying" | "applied" | "error";
};

type AssistantProposalSeriesProps = {
  actionStates: Record<string, AssistantProposalRowState>;
  appliedProposalIds: string[];
  onApplySelected: (suggestions: AssistantSuggestion[]) => void;
  onIgnore: (suggestionId: string) => void;
  onSelectionChange: (suggestionId: string, selected: boolean) => void;
  onToggleEdit: (suggestion: AssistantSuggestion) => void;
  onUpdate: (suggestionId: string, patch: Partial<AssistantSuggestion>) => void;
  pendingProposalIds: string[];
  reviewMode?: boolean;
  selectedProposalIds: Set<string>;
  series: RecurringSeriesProposal | null;
  suggestions: AssistantSuggestion[];
};

function addMinutesToTime(startTime: string, durationHours: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = hours * 60 + minutes + Math.round(durationHours * 60);

  return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function formatOccurrenceDate(suggestion: AssistantSuggestion) {
  if (!suggestion.itemDate) {
    return suggestion.day ?? "Date to be confirmed";
  }

  const date = new Date(`${suggestion.itemDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return suggestion.itemDate;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(date);
}

function formatOccurrenceTime(suggestion: AssistantSuggestion) {
  if (!suggestion.startTime) {
    return "Anytime";
  }

  if (!suggestion.estimatedHours) {
    return formatStartTime(suggestion.startTime);
  }

  return `${formatStartTime(suggestion.startTime)}–${formatStartTime(
    addMinutesToTime(suggestion.startTime, suggestion.estimatedHours),
  )}`;
}

function formatMinutes(minutes: number) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${minutes} minutes`;
}

function getRowStatus({
  appliedProposalIds,
  pendingProposalIds,
  state,
  suggestionId,
}: {
  appliedProposalIds: Set<string>;
  pendingProposalIds: Set<string>;
  state: AssistantProposalRowState;
  suggestionId: string;
}) {
  if (appliedProposalIds.has(suggestionId) || state.status === "applied") {
    return "applied" as const;
  }

  if (state.status === "applying") {
    return "applying" as const;
  }

  if (state.status === "error") {
    return "failed" as const;
  }

  if (pendingProposalIds.has(suggestionId)) {
    return "pending" as const;
  }

  return "removed" as const;
}

function OccurrenceEditor({
  onSave,
  onUpdate,
  suggestion,
}: {
  onSave: () => void;
  onUpdate: (patch: Partial<AssistantSuggestion>) => void;
  suggestion: AssistantSuggestion;
}) {
  const isWeeklyBlock = suggestion.type === "suggested_weekly_block";

  return (
    <div className="animate-assistant-details grid gap-3 border-t border-brand-ink/7 px-4 pb-4 pt-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-xs font-semibold text-brand-ink/58">
          Title
        </span>
        <input
          className="min-h-11 w-full rounded-xl border border-brand-ink/10 bg-white px-3 text-sm text-brand-ink"
          value={getSafeAssistantLabel(
            isWeeklyBlock ? suggestion.projectName : suggestion.title,
            "",
          )}
          onChange={(event) =>
            onUpdate(
              isWeeklyBlock
                ? { projectName: event.target.value, title: event.target.value }
                : { title: event.target.value },
            )
          }
        />
      </label>

      {suggestion.itemDate !== undefined ? (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-brand-ink/58">
            Date
          </span>
          <input
            className="min-h-11 w-full rounded-xl border border-brand-ink/10 bg-white px-3 text-sm text-brand-ink"
            type="date"
            value={suggestion.itemDate ?? ""}
            onChange={(event) => {
              const nextDate = event.target.value;
              const date = new Date(`${nextDate}T00:00:00`);

              if (!nextDate || Number.isNaN(date.getTime())) {
                onUpdate({ itemDate: nextDate });
                return;
              }

              const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
              onUpdate({ day: weekDays[dayIndex], itemDate: nextDate });
            }}
          />
        </label>
      ) : suggestion.day !== undefined ? (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-brand-ink/58">
            Day
          </span>
          <select
            className="min-h-11 w-full rounded-xl border border-brand-ink/10 bg-white px-3 text-sm text-brand-ink"
            value={suggestion.day ?? "Monday"}
            onChange={(event) => onUpdate({ day: event.target.value as WeekDay })}
          >
            {weekDays.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-brand-ink/58">
          Start time
        </span>
        <input
          className="min-h-11 w-full rounded-xl border border-brand-ink/10 bg-white px-3 text-sm text-brand-ink"
          type="time"
          value={suggestion.startTime ?? ""}
          onChange={(event) => onUpdate({ startTime: event.target.value })}
        />
      </label>

      {suggestion.estimatedHours !== undefined ? (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-brand-ink/58">
            Duration in hours
          </span>
          <input
            className="min-h-11 w-full rounded-xl border border-brand-ink/10 bg-white px-3 text-sm text-brand-ink"
            min="0.25"
            step="0.25"
            type="number"
            value={suggestion.estimatedHours ?? 1}
            onChange={(event) =>
              onUpdate({ estimatedHours: Number(event.target.value) })
            }
          />
        </label>
      ) : null}

      {suggestion.plannedTask !== undefined ? (
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold text-brand-ink/58">
            Details
          </span>
          <textarea
            className="min-h-20 w-full resize-y rounded-xl border border-brand-ink/10 bg-white px-3 py-2 text-sm leading-6 text-brand-ink"
            value={suggestion.plannedTask ?? ""}
            onChange={(event) => onUpdate({ plannedTask: event.target.value })}
          />
        </label>
      ) : null}

      <div className="sm:col-span-2">
        <Button className="h-10 rounded-xl px-4 text-xs" size="sm" onClick={onSave}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

export function AssistantProposalSeries({
  actionStates,
  appliedProposalIds,
  onApplySelected,
  onIgnore,
  onSelectionChange,
  onToggleEdit,
  onUpdate,
  pendingProposalIds,
  reviewMode = false,
  selectedProposalIds,
  series,
  suggestions,
}: AssistantProposalSeriesProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [showAllOccurrences, setShowAllOccurrences] = useState(false);
  const seriesRef = useRef<HTMLElement | null>(null);
  const pendingIdSet = new Set(pendingProposalIds);
  const appliedIdSet = new Set(appliedProposalIds);
  const pendingSuggestions = suggestions.filter((suggestion) =>
    pendingIdSet.has(suggestion.id),
  );
  const selectedSuggestions = pendingSuggestions.filter((suggestion) =>
    selectedProposalIds.has(suggestion.id),
  );
  const appliedCount = suggestions.filter((suggestion) =>
    appliedIdSet.has(suggestion.id),
  ).length;
  const failedCount = suggestions.filter(
    (suggestion) => actionStates[suggestion.id]?.status === "error",
  ).length;
  const isApplying = suggestions.some(
    (suggestion) => actionStates[suggestion.id]?.status === "applying",
  );
  const firstWeekCount = series?.pattern.sessionsPerWeek ?? suggestions.length;
  const displayedSuggestions =
    reviewMode
      ? suggestions
      : series && !showAllOccurrences
      ? suggestions.slice(0, firstWeekCount)
      : suggestions;
  const sessionMinutes =
    series?.pattern.durationMinutes ??
    Math.round((suggestions[0]?.estimatedHours ?? 0) * 60);
  const weeklyMinutes =
    series?.weeklyTotalMinutes ?? sessionMinutes * suggestions.length;
  const title = getSafeAssistantLabel(
    series?.title,
    `${getSafeAssistantLabel(suggestions[0]?.title, "Proposed")} Plan`,
  );
  const activityTitle = getSafeAssistantLabel(
    suggestions[0]?.projectName || suggestions[0]?.title,
    "",
  );
  const totalProposalMinutes = suggestions.reduce(
    (total, suggestion) =>
      total + Math.round((suggestion.estimatedHours ?? 0) * 60),
    0,
  );
  const allPendingSelected =
    pendingSuggestions.length > 0 &&
    pendingSuggestions.every((suggestion) => selectedProposalIds.has(suggestion.id));
  const resultWithLinks = suggestions
    .map((suggestion) => actionStates[suggestion.id]?.result)
    .find((result) => result?.planHref || result?.calendarHref);
  const previousPendingCountRef = useRef(pendingSuggestions.length);

  useEffect(() => {
    if (
      previousPendingCountRef.current > 0 &&
      pendingSuggestions.length === 0 &&
      appliedCount > 0
    ) {
      seriesRef.current?.focus({ preventScroll: false });
    }

    previousPendingCountRef.current = pendingSuggestions.length;
  }, [appliedCount, pendingSuggestions.length]);

  const statusSummary =
    pendingSuggestions.length === 0 && appliedCount > 0
      ? `Applied · ${appliedCount} ${appliedCount === 1 ? "session" : "sessions"} · ${formatMinutes(totalProposalMinutes)}`
      : appliedCount > 0
        ? `${appliedCount} applied · ${pendingSuggestions.length} awaiting approval${failedCount ? ` · ${failedCount} failed` : ""}`
        : series && series.planningHorizon.weeks > 1
          ? `${series.pattern.sessionsPerWeek} ${sessionMinutes === 60 ? "one-hour" : formatMinutes(sessionMinutes)} sessions per week · ${formatMinutes(weeklyMinutes)} weekly`
          : `${series?.pattern.sessionsPerWeek ?? suggestions.length} ${sessionMinutes === 60 ? "one-hour" : formatMinutes(sessionMinutes)} sessions · ${formatMinutes(weeklyMinutes)} total`;

  return (
    <section
      ref={seriesRef}
      aria-label={title}
      className="animate-assistant-card overflow-hidden rounded-[24px] border border-brand-teal/16 bg-white shadow-[0_18px_44px_rgba(18,32,47,0.09)]"
      tabIndex={-1}
    >
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-[-0.02em] text-brand-ink sm:text-lg">
              {title}
            </h3>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
                pendingSuggestions.length === 0 && appliedCount > 0
                  ? "bg-brand-teal/10 text-brand-teal"
                  : "bg-brand-ink/6 text-brand-ink/55",
              )}
            >
              {pendingSuggestions.length === 0 && appliedCount > 0
                ? "Applied"
                : "Proposed"}
            </span>
          </div>
          <p aria-live="polite" className="mt-1.5 text-sm leading-6 text-brand-ink/58">
            {statusSummary}
          </p>
          {activityTitle || series?.purpose ? (
            <p className="mt-1 text-xs leading-5 text-brand-ink/45">
              {activityTitle}
              {activityTitle && series?.purpose ? " · " : ""}
              {series?.purpose
                ? sanitizeAssistantUserFacingText(series.purpose)
                : null}
            </p>
          ) : null}
        </div>

        {pendingSuggestions.length > 0 ? (
          <button
            className="shrink-0 text-left text-xs font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4 sm:text-right"
            type="button"
            onClick={() =>
              pendingSuggestions.forEach((suggestion) =>
                onSelectionChange(suggestion.id, !allPendingSelected),
              )
            }
          >
            {allPendingSelected ? "Clear selection" : "Select all"}
          </button>
        ) : null}
      </div>

      <div className="border-y border-brand-ink/7 bg-brand-ink/[0.018]">
        {displayedSuggestions.map((suggestion) => {
          const state = actionStates[suggestion.id] ?? {
            editing: false,
            status: "pending" as const,
          };
          const rowStatus = getRowStatus({
            appliedProposalIds: appliedIdSet,
            pendingProposalIds: pendingIdSet,
            state,
            suggestionId: suggestion.id,
          });
          const expanded = expandedIds.has(suggestion.id);
          const occurrenceDate = formatOccurrenceDate(suggestion);
          const occurrenceTime = formatOccurrenceTime(suggestion);
          const canEdit = rowStatus === "pending" || rowStatus === "failed";

          return (
            <div key={suggestion.id} className="border-b border-brand-ink/7 last:border-b-0">
              <div className="flex min-h-[62px] items-center gap-3 px-4 py-3 sm:px-5">
                {rowStatus === "pending" || rowStatus === "failed" ? (
                  <input
                    aria-label={`Select ${occurrenceDate}, ${occurrenceTime}`}
                    checked={selectedProposalIds.has(suggestion.id)}
                    className="h-5 w-5 shrink-0 accent-brand-teal"
                    type="checkbox"
                    onChange={(event) =>
                      onSelectionChange(suggestion.id, event.target.checked)
                    }
                  />
                ) : (
                  <span
                    aria-label={rowStatus === "applied" ? "Applied" : "Removed"}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      rowStatus === "applied"
                        ? "bg-brand-teal text-white"
                        : "bg-brand-ink/8 text-brand-ink/45",
                    )}
                    role="img"
                  >
                    {rowStatus === "applied" ? "✓" : "–"}
                  </span>
                )}

                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2">
                  <p className="truncate text-sm font-semibold text-brand-ink">
                    {occurrenceDate}
                  </p>
                  <span aria-hidden="true" className="hidden text-brand-ink/25 sm:inline">
                    ·
                  </span>
                  <p className="mt-0.5 text-sm text-brand-ink/58 sm:mt-0">
                    {occurrenceTime}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} details for ${occurrenceDate}`}
                    className="min-h-10 rounded-xl px-2.5 text-xs font-semibold text-brand-ink/52 hover:bg-brand-ink/5 hover:text-brand-ink"
                    type="button"
                    onClick={() =>
                      setExpandedIds((current) => {
                        const next = new Set(current);
                        if (next.has(suggestion.id)) next.delete(suggestion.id);
                        else next.add(suggestion.id);
                        return next;
                      })
                    }
                  >
                    {expanded ? "Hide" : "Details"}
                  </button>
                  {canEdit && !state.editing ? (
                    <button
                      className="min-h-10 rounded-xl px-2.5 text-xs font-semibold text-brand-teal hover:bg-brand-teal/[0.07]"
                      type="button"
                      onClick={() => {
                        setExpandedIds((current) => new Set(current).add(suggestion.id));
                        onToggleEdit(suggestion);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>

              {expanded && !state.editing ? (
                <div className="animate-assistant-details grid gap-3 border-t border-brand-ink/7 px-4 pb-4 pt-3 text-sm sm:grid-cols-2 sm:px-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/38">
                      Title
                    </p>
                    <p className="mt-1 text-brand-ink/72">
                      {getSafeAssistantLabel(
                        suggestion.projectName || suggestion.title,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/38">
                      Duration
                    </p>
                    <p className="mt-1 text-brand-ink/72">
                      {formatMinutes(Math.round((suggestion.estimatedHours ?? 0) * 60))}
                    </p>
                  </div>
                  {suggestion.plannedTask || suggestion.rationale ? (
                    <div className="sm:col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/38">
                        Purpose
                      </p>
                      <p className="mt-1 leading-6 text-brand-ink/72">
                        {sanitizeAssistantUserFacingText(
                          suggestion.plannedTask || suggestion.rationale || "",
                        )}
                      </p>
                    </div>
                  ) : null}
                  {suggestion.conflictWarnings?.length ? (
                    <div className="sm:col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-coral">
                        Conflict status
                      </p>
                      <p className="mt-1 leading-6 text-brand-coral">
                        {sanitizeAssistantUserFacingText(
                          suggestion.conflictWarnings.join(" "),
                        )}
                      </p>
                    </div>
                  ) : null}
                  {canEdit ? (
                    <button
                      className="justify-self-start text-xs font-semibold text-brand-coral underline decoration-brand-coral/25 underline-offset-4 sm:col-span-2"
                      type="button"
                      onClick={() => onIgnore(suggestion.id)}
                    >
                      Remove occurrence
                    </button>
                  ) : null}
                </div>
              ) : null}

              {state.editing ? (
                <OccurrenceEditor
                  suggestion={suggestion}
                  onSave={() => onToggleEdit(suggestion)}
                  onUpdate={(patch) => onUpdate(suggestion.id, patch)}
                />
              ) : null}

              {state.message ? (
                <p
                  className={cn(
                    "mx-4 mb-4 rounded-xl px-3 py-2 text-xs leading-5 sm:mx-5",
                    state.status === "error"
                      ? "bg-brand-coral/10 text-brand-coral"
                      : "bg-brand-teal/10 text-brand-teal",
                  )}
                  role={state.status === "error" ? "alert" : "status"}
                >
                  {state.message}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {!reviewMode && series && suggestions.length > firstWeekCount ? (
        <button
          className="mx-4 mt-3 text-xs font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4 sm:mx-5"
          type="button"
          onClick={() => setShowAllOccurrences((current) => !current)}
        >
          {showAllOccurrences
            ? "Show first week"
            : `Show all ${suggestions.length} sessions`}
        </button>
      ) : null}

      <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        {pendingSuggestions.length > 0 ? (
          <>
            <Button
              aria-live="polite"
              className="h-11 rounded-2xl px-5 text-sm"
              disabled={selectedSuggestions.length === 0 || isApplying}
              onClick={() => onApplySelected(selectedSuggestions)}
            >
              {isApplying
                ? "Applying approved changes…"
                : selectedSuggestions.length === pendingSuggestions.length
                  ? `Apply all ${pendingSuggestions.length}`
                  : `Apply selected (${selectedSuggestions.length})`}
            </Button>
            <Button
              className="h-11 rounded-2xl px-5 text-sm"
              variant="outline"
              onClick={() =>
                setExpandedIds(new Set(displayedSuggestions.map((suggestion) => suggestion.id)))
              }
            >
              Adjust plan
            </Button>
          </>
        ) : appliedCount > 0 ? (
          <>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 bg-white px-4 text-sm font-semibold text-brand-ink hover:border-brand-teal/30 hover:text-brand-teal"
              href={resultWithLinks?.planHref ?? "/plan"}
            >
              View in Weekly Plan
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 bg-white px-4 text-sm font-semibold text-brand-ink hover:border-brand-teal/30 hover:text-brand-teal"
              href={resultWithLinks?.calendarHref ?? "/calendar"}
            >
              View in Calendar
            </Link>
          </>
        ) : (
          <p className="text-sm font-semibold text-brand-ink/52">
            No changes remain in this review.
          </p>
        )}
      </div>
    </section>
  );
}
