"use client";

import Link from "next/link";
import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AssistantSuggestion } from "@/lib/assistant";
import {
  getAppliedPlanTitle,
  normalizeApplyWorkflowResult,
  type AppliedWorkflowRecord,
  type ApplyResponsePlan,
  type ApplyWorkflowResult,
} from "@/lib/assistant-apply-result";
import type { CompactActionReceipt } from "@/lib/assistant-automation";
import {
  getPlanApplyLabel,
  getPlanPresentationKind,
  getPlanReviewLabel,
} from "@/lib/assistant-plan-presentation";
import type { RecurringSeriesProposal } from "@/lib/assistant-semantics";
import {
  getSafeAssistantLabel,
  sanitizeAssistantUserFacingText,
} from "@/lib/assistant-ui-guards";
import { formatStartTime } from "@/lib/weekly-plan";

type AssistantPlanSummaryProps = {
  applyResponsePlan?: ApplyResponsePlan | null;
  applyResult?: ApplyWorkflowResult | null;
  batchId?: string | null;
  isApplying: boolean;
  isUndoing?: boolean;
  onApplyAll: (suggestions: AssistantSuggestion[]) => void;
  onUndo?: (decisionRecordId: string) => void;
  pendingProposalIds: string[];
  series?: RecurringSeriesProposal | null;
  suggestions: AssistantSuggestion[];
  automationReceipt?: CompactActionReceipt | null;
};

function addMinutesToTime(startTime: string, durationHours: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = hours * 60 + minutes + Math.round(durationHours * 60);
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function formatOccurrenceDate(suggestion: AssistantSuggestion) {
  if (!suggestion.itemDate) return suggestion.day ?? "Date to be confirmed";
  const date = new Date(`${suggestion.itemDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return suggestion.itemDate;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
}

function formatOccurrenceTime(suggestion: AssistantSuggestion) {
  if (!suggestion.startTime) return "Anytime";
  if (!suggestion.estimatedHours) return formatStartTime(suggestion.startTime);
  return `${formatStartTime(suggestion.startTime)}–${formatStartTime(
    addMinutesToTime(suggestion.startTime, suggestion.estimatedHours),
  )}`;
}

function formatAppliedRecordDate(record: AppliedWorkflowRecord) {
  const date = new Date(`${record.date}T12:00:00`);
  if (Number.isNaN(date.getTime())) return record.date;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
}

function formatAppliedRecordTime(record: AppliedWorkflowRecord) {
  return `${formatStartTime(record.startTime)}–${formatStartTime(record.endTime)}`;
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

function getUniqueDays(suggestions: AssistantSuggestion[]) {
  return [...new Set(suggestions.map((suggestion) => suggestion.day).filter(Boolean))];
}

export function AssistantPlanSummary({
  applyResponsePlan,
  applyResult: rawApplyResult,
  automationReceipt,
  batchId,
  isApplying,
  isUndoing = false,
  onApplyAll,
  onUndo,
  pendingProposalIds,
  series,
  suggestions,
}: AssistantPlanSummaryProps) {
  const applyResult = normalizeApplyWorkflowResult(rawApplyResult);
  const authoritativePendingProposalIds =
    applyResult?.pendingProposalIds ?? pendingProposalIds;
  const pendingSet = new Set(authoritativePendingProposalIds);
  const pending = suggestions.filter((suggestion) => pendingSet.has(suggestion.id));
  const appliedRecords =
    applyResult && !applyResult.nothingChanged ? applyResult.applied : [];
  const hasVerifiedAppliedRecords = appliedRecords.length > 0;
  const kind = getPlanPresentationKind({
    appliedCount: appliedRecords.length,
    pendingCount: pending.length,
    series,
    suggestions,
  });
  const activityTitle = getSafeAssistantLabel(
    applyResponsePlan?.activityTitle ||
      suggestions[0]?.projectName ||
      suggestions[0]?.title,
    "Plan",
  );
  const seriesTitle = getSafeAssistantLabel(series?.title, activityTitle);
  const isUndone = automationReceipt?.actionType === "action_undone";
  const appliedPlanTitle = getAppliedPlanTitle(appliedRecords, seriesTitle);
  const undoDecisionId = applyResult?.planningDecisionId;
  const title =
    isUndone
      ? `${appliedPlanTitle} removed`
      : hasVerifiedAppliedRecords
      ? appliedPlanTitle
      : kind === "multi_item_week"
        ? "Proposed week"
        : kind === "linked_changes"
          ? "Today’s adjusted plan"
          : kind === "routine"
            ? `${activityTitle} routine`
            : seriesTitle;
  const preview = suggestions.slice(0, 3);
  const remainingCount = Math.max(0, suggestions.length - preview.length);
  const uniqueDays = getUniqueDays(suggestions);
  const totalMinutes = suggestions.reduce(
    (total, suggestion) => total + Math.round((suggestion.estimatedHours ?? 0) * 60),
    0,
  );
  const appliedMinutes = appliedRecords.reduce(
    (total, record) => total + record.durationMinutes,
    0,
  );
  const appliedSummary = `${appliedRecords.length} ${
    appliedRecords.length === 1 ? "session" : "sessions"
  } · ${formatDuration(appliedMinutes)} total`;
  const statusSummary =
    appliedRecords.length > 0 && pending.length > 0
      ? `${appliedRecords.length} added · ${pending.length} awaiting approval`
      : `${pending.length} awaiting approval`;

  return (
    <section
      aria-label={title}
      className={cn(
        "assistant-receipt animate-assistant-card w-full px-5 py-5 sm:px-6",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3.5px] before:rounded-l-[22px]",
        isUndone
          ? "before:bg-brand-moss"
          : hasVerifiedAppliedRecords
          ? "before:bg-brand-teal"
          : "before:bg-brand-teal/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-[-0.02em] text-brand-ink sm:text-lg">
            {title}
          </h3>
          {isUndone ? (
            <p aria-live="polite" className="mt-1 text-sm text-brand-teal">
              {automationReceipt.summary}
            </p>
          ) : hasVerifiedAppliedRecords ? (
            <p aria-live="polite" className="mt-1 text-sm text-brand-teal">
              {appliedSummary}
            </p>
          ) : kind === "recurring_series" && series ? (
            <p className="mt-1 text-sm leading-6 text-brand-ink/58">
              {series.pattern.sessionsPerWeek} sessions per week · {formatDuration(series.pattern.durationMinutes)} each · {series.planningHorizon.weeks} {series.planningHorizon.weeks === 1 ? "week" : "weeks"} · {series.totalOccurrences} total sessions
            </p>
          ) : kind === "routine" ? (
            <p className="mt-1 text-sm leading-6 text-brand-ink/58">
              {uniqueDays.join(" · ")}<br />
              {formatDuration(series?.pattern.durationMinutes ?? Math.round((suggestions[0]?.estimatedHours ?? 0) * 60))} · Repeats weekly
            </p>
          ) : kind === "linked_changes" ? (
            <p className="mt-1 text-sm leading-6 text-brand-ink/58">
              {suggestions.length} related changes
            </p>
          ) : kind === "single_item" ? null : (
            <p className="mt-1 text-sm leading-6 text-brand-ink/58">
              {suggestions.length} items · {formatDuration(totalMinutes)} planned
            </p>
          )}
        </div>
        {pending.length > 0 ? (
          <span
            aria-live="polite"
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.10em] text-brand-teal/80"
          >
            {statusSummary}
          </span>
        ) : null}
      </div>

      {!isUndone && hasVerifiedAppliedRecords ? (
        <div className="mt-4 divide-y divide-brand-ink/5">
          {appliedRecords.map((record) => (
            <div
              key={`${record.proposalId}:${record.recordId}`}
              className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-brand-ink/80">
                  {getSafeAssistantLabel(record.title, activityTitle)}
                </p>
                <p className="text-xs text-brand-ink/42">
                  {formatAppliedRecordDate(record)}
                </p>
              </div>
              <p className="shrink-0 text-sm text-brand-ink/50">
                {formatAppliedRecordTime(record)}
              </p>
            </div>
          ))}
        </div>
      ) : !isUndone && kind !== "routine" ? (
        <div className="mt-4 border-y border-brand-ink/7 py-2">
          {kind === "linked_changes" ? (
            preview.map((suggestion) => (
              <p key={suggestion.id} className="py-1.5 text-sm text-brand-ink/70">
                • {sanitizeAssistantUserFacingText(suggestion.description || suggestion.title)}
              </p>
            ))
          ) : kind === "multi_item_week" ? (
            preview.map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:gap-3"
              >
                <p className="text-sm font-semibold text-brand-ink/76">
                  {formatOccurrenceDate(suggestion)}
                </p>
                <p className="text-sm text-brand-ink/54">
                  {getSafeAssistantLabel(suggestion.projectName || suggestion.title)}
                </p>
              </div>
            ))
          ) : (
            (kind === "single_item" ? preview.slice(0, 1) : preview).map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <p className="text-sm font-semibold text-brand-ink/76">
                  {formatOccurrenceDate(suggestion)}
                </p>
                <p className="text-sm text-brand-ink/54">
                  {formatOccurrenceTime(suggestion)}
                </p>
              </div>
            ))
          )}
          {remainingCount > 0 ? (
            <p className="py-1.5 text-xs font-semibold text-brand-ink/42">
              + {remainingCount} more {kind === "multi_item_week" ? (remainingCount === 1 ? "item" : "items") : (remainingCount === 1 ? "session" : "sessions")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {isUndone || hasVerifiedAppliedRecords ? (
          <>
            {!isUndone &&
            undoDecisionId &&
            applyResult?.undoAvailable &&
            onUndo ? (
              <Button
                className="h-11 rounded-2xl px-5 text-sm"
                disabled={isUndoing}
                type="button"
                variant="outline"
                onClick={() => onUndo(undoDecisionId)}
              >
                {isUndoing ? "Undoing…" : "Undo"}
              </Button>
            ) : null}
            {!isUndone && hasVerifiedAppliedRecords ? (
              <>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 px-4 text-sm font-semibold text-brand-ink hover:border-brand-teal/30 hover:text-brand-teal"
                  href="/plan"
                >
                  View Weekly Plan
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 px-4 text-sm font-semibold text-brand-ink hover:border-brand-teal/30 hover:text-brand-teal"
                  href="/calendar"
                >
                  View Calendar
                </Link>
              </>
            ) : null}
          </>
        ) : (
          <>
            {batchId ? (
              <Link
                aria-label={`${getPlanReviewLabel(kind)}: ${title}`}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 px-4 text-sm font-semibold text-brand-ink hover:border-brand-teal/30 hover:text-brand-teal"
                href={`/assistant/review/${encodeURIComponent(batchId)}`}
              >
                {getPlanReviewLabel(kind)}
              </Link>
            ) : null}
            <Button
              aria-live="polite"
              className="h-11 rounded-2xl px-5 text-sm"
              disabled={pending.length === 0 || isApplying}
              onClick={() => onApplyAll(pending)}
            >
              {isApplying
                ? "Applying…"
                : getPlanApplyLabel(kind, pending.length)}
            </Button>
          </>
        )}
      </div>
      {!isUndone &&
      hasVerifiedAppliedRecords &&
      !applyResult?.undoAvailable &&
      applyResult?.undoUnavailableReason ? (
        <p className="mt-3 text-xs leading-5 text-brand-ink/48">
          {sanitizeAssistantUserFacingText(applyResult.undoUnavailableReason)}
        </p>
      ) : null}
    </section>
  );
}
