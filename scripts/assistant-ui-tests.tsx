import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantPlanSummary } from "../components/assistant/assistant-plan-summary";
import {
  AssistantProposalSeries,
  type AssistantProposalRowState,
} from "../components/assistant/assistant-proposal-series";
import type { AssistantSuggestion } from "../lib/assistant";
import type { CompactActionReceipt } from "../lib/assistant-automation";
import {
  createApplyWorkflowResult,
  type ApplyWorkflowResult,
} from "../lib/assistant-apply-result";
import {
  getPlanPresentationKind,
  type PlanPresentationKind,
} from "../lib/assistant-plan-presentation";
import type { AssistantSchedulingContext } from "../lib/assistant-schedule-analysis";
import type { RecurringSeriesProposal } from "../lib/assistant-semantics";
import {
  getSafeClarificationQuestion,
  sanitizeAssistantUserFacingText,
  shouldRenderAssistantClarification,
} from "../lib/assistant-ui-guards";
import { isConversationOnlyAssistantResponseMode } from "../lib/assistant-presentation";
import type { SchedulingWorkflowContext } from "../lib/assistant-workflow";

const occurrenceSeeds = [
  ["2026-07-05", "Sunday", "08:00"],
  ["2026-07-08", "Wednesday", "17:00"],
  ["2026-07-10", "Friday", "11:00"],
  ["2026-07-12", "Sunday", "08:00"],
  ["2026-07-15", "Wednesday", "17:00"],
  ["2026-07-17", "Friday", "11:00"],
  ["2026-07-19", "Sunday", "08:00"],
  ["2026-07-22", "Wednesday", "17:00"],
  ["2026-07-24", "Friday", "11:00"],
] as const;

const suggestions: AssistantSuggestion[] = occurrenceSeeds.map(
  ([itemDate, day, startTime], index) => ({
    batchId: "batch-1",
    confidence: 1,
    day,
    description: "A validated reading session.",
    estimatedHours: 1,
    id: `proposal-${index + 1}`,
    itemDate,
    plannedTask: "Prepare for the masjid halaqah.",
    projectName: "Read The Sealed Nectar",
    rationale: "Fits an open schedule window.",
    severity: "info",
    startTime,
    summary: "One-hour reading session",
    title: "Read The Sealed Nectar",
    type: "suggested_weekly_block",
    workflowId: "workflow-1",
  }),
);

const series: RecurringSeriesProposal = {
  assumptions: [],
  conflicts: [],
  id: "sealed-nectar-series",
  occurrenceProposalIds: suggestions.map((suggestion) => suggestion.id),
  pattern: {
    durationMinutes: 60,
    preferredWeekdays: ["Sunday", "Wednesday", "Friday"],
    sessionsPerWeek: 3,
    typicalTimes: ["08:00", "17:00", "11:00"],
  },
  planningHorizon: {
    endDate: "2026-07-25",
    startDate: "2026-07-05",
    weeks: 3,
  },
  purpose: "Prepare for the masjid halaqah.",
  status: "pending",
  title: "Sealed Nectar Reading Plan",
  totalOccurrences: 9,
  weeklyTotalMinutes: 180,
  workflowId: "workflow-1",
};

const noOp = () => undefined;

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function addTestMinutes(startTime: string, durationMinutes: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function renderSummary({
  appliedIds = [],
  planSeries = series,
  planSuggestions = suggestions,
  pendingIds = planSuggestions.map((suggestion) => suggestion.id),
  automationReceipt = null,
}: {
  appliedIds?: string[];
  planSeries?: RecurringSeriesProposal | null;
  planSuggestions?: AssistantSuggestion[];
  pendingIds?: string[];
  automationReceipt?: CompactActionReceipt | null;
} = {}) {
  const applyResult: ApplyWorkflowResult | null =
    appliedIds.length > 0
      ? createApplyWorkflowResult({
          applied: planSuggestions
            .filter((suggestion) => appliedIds.includes(suggestion.id))
            .map((suggestion) => {
              const durationMinutes = Math.round(
                (suggestion.estimatedHours ?? 0) * 60,
              );
              const startTime = suggestion.startTime ?? "";
              const endTime = addTestMinutes(startTime, durationMinutes);
              return {
                date: suggestion.itemDate ?? "",
                durationMinutes,
                endsAt: `${suggestion.itemDate}T${endTime}:00-04:00`,
                endTime,
                proposalId: suggestion.id,
                recordId: `record-${suggestion.id}`,
                recordType: "weekly_plan_block" as const,
                startsAt: `${suggestion.itemDate}T${startTime}:00-04:00`,
                startTime,
                title: suggestion.projectName ?? suggestion.title,
              };
            }),
          automationMode:
            pendingIds.length === 0 ? "auto_apply" : "manual_batch_apply",
          pendingProposalIds: pendingIds,
          planningDecisionId: "decision-1",
          requestedProposalIds: [...new Set([...appliedIds, ...pendingIds])],
          undoAvailable: pendingIds.length === 0,
          workflowId: "workflow-1",
        })
      : null;

  return renderToStaticMarkup(
    <AssistantPlanSummary
      applyResult={applyResult}
      automationReceipt={automationReceipt}
      batchId="batch-1"
      isApplying={false}
      pendingProposalIds={pendingIds}
      series={planSeries}
      suggestions={planSuggestions}
      onApplyAll={noOp}
      onUndo={noOp}
    />,
  );
}

function renderReview({
  appliedIds = [],
  pendingIds = suggestions.map((suggestion) => suggestion.id),
  selectedIds = pendingIds,
}: {
  appliedIds?: string[];
  pendingIds?: string[];
  selectedIds?: string[];
} = {}) {
  const actionStates = Object.fromEntries(
    suggestions.map((suggestion) => [
      suggestion.id,
      {
        editing: false,
        status: appliedIds.includes(suggestion.id) ? "applied" : "pending",
      } satisfies AssistantProposalRowState,
    ]),
  );

  return renderToStaticMarkup(
    <AssistantProposalSeries
      actionStates={actionStates}
      appliedProposalIds={appliedIds}
      pendingProposalIds={pendingIds}
      reviewMode
      selectedProposalIds={new Set(selectedIds)}
      series={series}
      suggestions={suggestions}
      onApplySelected={noOp}
      onIgnore={noOp}
      onSelectionChange={noOp}
      onToggleEdit={noOp}
      onUpdate={noOp}
    />,
  );
}

function runCompactSummaryCases() {
  const recurring = renderSummary();
  assert.equal(countMatches(recurring, />Sealed Nectar Reading Plan</g), 1);
  assert.match(recurring, /3 sessions per week · 1 hour each · 3 weeks · 9 total sessions/);
  assert.equal(countMatches(recurring, /Jul 5|Jul 8|Jul 10/g), 3);
  assert.doesNotMatch(recurring, /Jul 12|Jul 15|Jul 17|Jul 19|Jul 22|Jul 24/);
  assert.match(recurring, /\+ 6 more sessions/);
  assert.match(recurring, /href="\/assistant\/review\/batch-1"/);
  assert.match(recurring, /Apply all 9/);
  assert.doesNotMatch(recurring, /type="checkbox"|Remove occurrence|overflow-y-auto/);

  const single = renderSummary({
    planSeries: null,
    planSuggestions: suggestions.slice(0, 1),
    pendingIds: [suggestions[0].id],
  });
  assert.match(single, />Read The Sealed Nectar</);
  assert.match(single, />Edit</);
  assert.match(single, />Apply</);

  const applied = renderSummary({
    appliedIds: suggestions.map((suggestion) => suggestion.id),
    automationReceipt: {
      actionType: "plan_applied",
      availableActions: ["undo", "view"],
      createdAt: "2026-07-06T18:00:00.000Z",
      decisionRecordId: "decision-1",
      id: "receipt-1",
      itemCount: 9,
      summary: "9 Schedule Builder time blocks were added.",
      title: "Sealed Nectar Reading Plan",
      userId: "user-1",
    },
    pendingIds: [],
  });
  assert.match(applied, /Read The Sealed Nectar Plan/);
  assert.match(applied, /9 sessions · 9 hours total/);
  assert.match(applied, /View Weekly Plan/);
  assert.match(applied, />Undo</);
  assert.doesNotMatch(applied, /Apply all|awaiting approval/);

  const undone = renderSummary({
    appliedIds: suggestions.map((suggestion) => suggestion.id),
    automationReceipt: {
      actionType: "action_undone",
      availableActions: ["view"],
      createdAt: "2026-07-06T18:00:00.000Z",
      decisionRecordId: "decision-1",
      id: "receipt-1",
      itemCount: 9,
      summary: "The automatically created Schedule Builder blocks were removed.",
      title: "Sealed Nectar Reading Plan",
      userId: "user-1",
    },
    pendingIds: [],
  });
  assert.match(undone, /Read The Sealed Nectar Plan removed/);
  assert.doesNotMatch(undone, />Undo|>Apply/);

  const partial = renderSummary({
    appliedIds: [suggestions[0].id, suggestions[1].id],
    pendingIds: suggestions.slice(2).map((suggestion) => suggestion.id),
  });
  assert.match(partial, /2 added · 7 awaiting approval/);

  const feSuggestions = suggestions.slice(0, 3).map((suggestion, index) => ({
    ...suggestion,
    estimatedHours: index < 2 ? 1.5 : 1,
    projectName: index < 2 ? "FE Civil Study" : "FE Civil Review",
    title: index < 2 ? "FE Civil Study" : "FE Civil Review",
  }));
  const feApplyResult = createApplyWorkflowResult({
    applied: feSuggestions.map((suggestion) => {
      const durationMinutes = Math.round((suggestion.estimatedHours ?? 0) * 60);
      const startTime = suggestion.startTime ?? "";
      const endTime = addTestMinutes(startTime, durationMinutes);
      return {
        date: suggestion.itemDate ?? "",
        durationMinutes,
        endsAt: `${suggestion.itemDate}T${endTime}:00-04:00`,
        endTime,
        proposalId: suggestion.id,
        recordId: `record-${suggestion.id}`,
        recordType: "weekly_plan_block" as const,
        startsAt: `${suggestion.itemDate}T${startTime}:00-04:00`,
        startTime,
        title: suggestion.title,
      };
    }),
    automationMode: "auto_apply",
    requestedProposalIds: feSuggestions.map((suggestion) => suggestion.id),
    undoAvailable: false,
    undoUnavailableReason: "No planning decision was saved, so Undo is unavailable.",
    workflowId: "workflow-fe",
  });
  const feApplied = renderToStaticMarkup(
    <AssistantPlanSummary
      applyResult={feApplyResult}
      batchId="batch-fe"
      isApplying={false}
      pendingProposalIds={[]}
      series={null}
      suggestions={feSuggestions}
      onApplyAll={noOp}
      onUndo={noOp}
    />,
  );
  assert.match(feApplied, /FE Civil Study and Review Plan/);
  assert.equal(countMatches(feApplied, />FE Civil Study</g), 2);
  assert.equal(countMatches(feApplied, />FE Civil Review</g), 1);
  assert.match(feApplied, /3 sessions · 4 hours total/);
  assert.doesNotMatch(feApplied, />Undo</);
  assert.match(feApplied, /Undo is unavailable/);

  const receiptWithoutSavedRows = renderSummary({
    automationReceipt: {
      actionType: "plan_applied",
      availableActions: ["undo", "view"],
      createdAt: "2026-07-06T18:00:00.000Z",
      decisionRecordId: "decision-without-rows",
      id: "receipt-without-rows",
      itemCount: 9,
      summary: "9 changes applied.",
      title: "Unverified plan",
      userId: "user-1",
    },
    pendingIds: [],
  });
  assert.doesNotMatch(receiptWithoutSavedRows, /View Weekly Plan|View Calendar|>Undo</);

  const weeklyItems = suggestions.slice(0, 3).map((suggestion, index) => ({
    ...suggestion,
    projectName: `Weekly item ${index + 1}`,
    title: `Weekly item ${index + 1}`,
  }));
  const week = renderSummary({
    planSeries: null,
    planSuggestions: weeklyItems,
    pendingIds: weeklyItems.map((suggestion) => suggestion.id),
  });
  assert.match(week, /Proposed week/);
  assert.match(week, /3 items · 3 hours planned/);
  assert.match(week, /Weekly item 1/);
  assert.match(week, /Review week/);
  assert.match(week, /Apply plan/);

  const routineSuggestions = suggestions.slice(0, 3).map((suggestion) => ({
    ...suggestion,
    projectName: "Workout",
    title: "Workout",
  }));
  const routine = renderSummary({
    planSeries: { ...series, title: "Workout routine", totalOccurrences: 3 },
    planSuggestions: routineSuggestions,
    pendingIds: routineSuggestions.map((suggestion) => suggestion.id),
  });
  assert.match(routine, /Workout routine/);
  assert.match(routine, /Sunday · Wednesday · Friday/);
  assert.match(routine, /1 hour · Repeats weekly/);
  assert.match(routine, /Review routine/);

  const linkedSuggestions: AssistantSuggestion[] = [
    {
      ...suggestions[0],
      description: "End work at 1:30 PM",
      title: "End work early",
      type: "schedule_exception",
    },
    {
      ...suggestions[1],
      description: "Add MSA work at 2:30 PM",
      title: "Add MSA work",
      type: "suggested_weekly_block",
    },
  ];
  const linked = renderSummary({
    planSeries: null,
    planSuggestions: linkedSuggestions,
    pendingIds: linkedSuggestions.map((suggestion) => suggestion.id),
  });
  assert.match(linked, /Today’s adjusted plan/);
  assert.match(linked, /2 related changes/);
  assert.match(linked, /End work at 1:30 PM/);
  assert.match(linked, /Apply both/);
}

function runPresentationKindCases() {
  const cases: Array<[PlanPresentationKind, AssistantSuggestion[], RecurringSeriesProposal | null, number, number]> = [
    ["single_item", suggestions.slice(0, 1), null, 0, 1],
    ["recurring_series", suggestions, series, 0, 9],
    [
      "multi_item_week",
      suggestions.slice(0, 3).map((suggestion, index) => ({
        ...suggestion,
        projectName: `Weekly item ${index + 1}`,
        title: `Weekly item ${index + 1}`,
      })),
      null,
      0,
      3,
    ],
    [
      "routine",
      suggestions.slice(0, 3).map((suggestion) => ({
        ...suggestion,
        projectName: "Workout",
        title: "Workout",
      })),
      { ...series, title: "Workout routine" },
      0,
      3,
    ],
    [
      "linked_changes",
      [
        { ...suggestions[0], title: "End work early", type: "schedule_exception" },
        { ...suggestions[1], title: "Add MSA work", type: "suggested_weekly_block" },
      ],
      null,
      0,
      2,
    ],
    ["applied_result", suggestions, series, 9, 0],
  ];

  cases.forEach(([expected, planSuggestions, planSeries, appliedCount, pendingCount]) => {
    assert.equal(
      getPlanPresentationKind({
        appliedCount,
        pendingCount,
        series: planSeries,
        suggestions: planSuggestions,
      }),
      expected,
    );
  });
}

function runReviewCases() {
  const allSelected = renderReview();
  assert.equal(countMatches(allSelected, /type="checkbox"/g), 9);
  assert.match(allSelected, /Apply all 9/);
  assert.match(allSelected, /Sunday, July 5/);
  assert.match(allSelected, /Friday, July 24/);

  const twoSelected = renderReview({
    selectedIds: [suggestions[0].id, suggestions[1].id],
  });
  assert.match(twoSelected, /Apply selected \(2\)/);

  const applied = renderReview({
    appliedIds: suggestions.map((suggestion) => suggestion.id),
    pendingIds: [],
    selectedIds: [],
  });
  assert.match(applied, /Applied · 9 sessions · 9 hours/);
  assert.doesNotMatch(applied, /Apply all|Apply selected|Remove occurrence/);
}

function createClarificationState() {
  const context = {
    appliedRecords: [],
    batchId: null,
    candidateWindows: [],
    confirmationStatus: "awaiting_duration",
    extractedItems: [],
    intent: "create_multiple_time_blocks",
    lastUpdatedAt: "2026-07-06T12:00:00.000Z",
    maximumDurationMinutes: null,
    pendingQuestion: "How long should “Planning item” take?",
    pendingProposal: null,
    pendingProposals: [],
    pendingWorkException: null,
    purpose: "Prepare for halaqah",
    requestedDurationMinutes: null,
    requestedSessionCount: 3,
    selectedDate: null,
    selectedWindowEnd: null,
    selectedWindowId: null,
    selectedWindowStart: null,
    state: "awaiting_duration",
    workflowId: "workflow-1",
  } as AssistantSchedulingContext;
  const workflow = {
    appliedProposalIds: [],
    completionStatus: "nothing_created",
    context,
    extractedItems: [],
    intent: "create_multiple_time_blocks",
    lastUpdatedAt: context.lastUpdatedAt,
    missingFields: ["durationMinutes"],
    pendingProposalIds: [],
    persistenceStatus: "persisted",
    proposalIds: [],
    selectedCandidateIds: [],
    state: "awaiting_clarification",
    threadId: "thread-1",
    userId: "user-1",
    workflowId: "workflow-1",
  } as SchedulingWorkflowContext;
  return { context, workflow };
}

function runClarificationGuardCases() {
  assert.equal(
    getSafeClarificationQuestion({
      activityTitle: "Sealed Nectar reading",
      question: "How long should “Planning item” take?",
    }),
    "How long should each Sealed Nectar reading session be?",
  );
  assert.equal(
    getSafeClarificationQuestion({
      question: "How long should ‘Item’ take?",
    }),
    "How long should each session be?",
  );
  assert.doesNotMatch(
    sanitizeAssistantUserFacingText("How long should “Planning item” take?"),
    /Planning item/,
  );

  const { context, workflow } = createClarificationState();
  const shared = {
    activeWorkflow: workflow,
    context,
    hasSubstantiveUserMessage: true,
    isSubmitting: false,
  };
  assert.equal(
    shouldRenderAssistantClarification({
      ...shared,
      latestMessageWorkflowId: "workflow-1",
    }),
    true,
  );
  assert.equal(
    shouldRenderAssistantClarification({
      ...shared,
      latestMessageWorkflowId: "old-workflow",
    }),
    false,
  );
  assert.equal(
    shouldRenderAssistantClarification({
      ...shared,
      context: { ...context, requestedDurationMinutes: 60 },
      latestMessageWorkflowId: "workflow-1",
    }),
    false,
  );
  assert.equal(
    shouldRenderAssistantClarification({
      ...shared,
      activeWorkflow: {
        ...workflow,
        pendingProposalIds: ["proposal-1"],
        state: "proposal_ready",
      },
      latestMessageWorkflowId: "workflow-1",
    }),
    false,
  );
}

function runWorkspaceSourceCases() {
  const assistantPage = readFileSync(
    new URL("../components/assistant/assistant-page.tsx", import.meta.url),
    "utf8",
  );
  const planRoute = readFileSync(
    new URL("../app/api/assistant/plan/route.ts", import.meta.url),
    "utf8",
  );
  const contextPanel = readFileSync(
    new URL("../components/assistant/assistant-context-panel.tsx", import.meta.url),
    "utf8",
  );
  const summary = readFileSync(
    new URL("../components/assistant/assistant-plan-summary.tsx", import.meta.url),
    "utf8",
  );
  const reviewPage = readFileSync(
    new URL("../components/assistant/assistant-review-page.tsx", import.meta.url),
    "utf8",
  );
  const reviewRoute = readFileSync(
    new URL("../app/assistant/review/[proposalBatchId]/page.tsx", import.meta.url),
    "utf8",
  );
  const proposalApi = readFileSync(
    new URL("../app/api/assistant/proposals/route.ts", import.meta.url),
    "utf8",
  );
  const undoRoute = readFileSync(
    new URL("../app/api/assistant/undo/route.ts", import.meta.url),
    "utf8",
  );

  assert.equal(countMatches(assistantPage, /overflow-y-auto/g), 2);
  assert.match(assistantPage, /View schedule context/);
  assert.match(assistantPage, /resolveAssistantWorkflowStatus/);
  assert.match(
    assistantPage,
    /context\.requestKind === "bounded_multi_session_plan"[\s\S]{0,120}context\.state === "needs_clarification"[\s\S]{0,80}return \[\]/,
    "Bounded plan relaxation questions do not render generic opening or session-pattern choices",
  );
  assert.doesNotMatch(assistantPage, /function getWorkflowStatus/);
  assert.match(assistantPage, /getCanonicalApplyResult\(message\.response\)/);
  assert.match(assistantPage, /reconcileMessagesAfterApply/);
  assert.match(assistantPage, /reconcileCanonicalPlanAfterMutation/);
  assert.match(assistantPage, /isConversationOnlyAssistantResponseMode/);
  assert.match(
    assistantPage,
    /I couldn’t verify any saved changes, so no success confirmation was recorded/,
  );
  assert.match(planRoute, /mode: "status_answer"/);
  assert.match(planRoute, /Here’s what I scheduled/);
  assert.match(planRoute, /detailsOnly: isAssistantAppliedDetailsQuestion\(prompt\)/);
  assert.match(planRoute, /undo_decision_recovered_from_workflow/);
  assert.equal(isConversationOnlyAssistantResponseMode("status_answer"), true);
  assert.equal(isConversationOnlyAssistantResponseMode("social_reply"), true);
  assert.equal(isConversationOnlyAssistantResponseMode("auto_applied"), false);
  assert.doesNotMatch(assistantPage, /appliedProposalIds=\{activeWorkflow/);
  assert.doesNotMatch(assistantPage, /updateSchedulingContextAfterApply/);
  assert.match(assistantPage, /open=\{isScheduleContextOpen\}/);
  assert.doesNotMatch(assistantPage, /lg:grid-cols-\[[^\]]*context/i);
  assert.doesNotMatch(contextPanel, /Pending review/i);
  assert.match(contextPanel, /if \(!open\) return null/);
  assert.match(contextPanel, /aria-modal="true"/);
  assert.doesNotMatch(summary, /overflow-y-auto|overflow-y-scroll|max-h-\[/);
  assert.match(summary, /applyResult\.applied/);
  assert.match(summary, /applyResult\?\.undoAvailable/);
  assert.doesNotMatch(summary, /automationReceipt\.availableActions\.includes\("undo"\)/);
  assert.doesNotMatch(reviewPage, /overflow-y-auto|overflow-y-scroll|max-h-\[/);
  assert.match(reviewPage, /proposalIds: suggestions\.map/);
  assert.match(reviewPage, /action: "update"/);
  assert.match(reviewPage, /action: "reject"/);
  assert.match(reviewPage, /reloadReviewAfterMutation/);
  assert.match(reviewPage, /final server state could not be confirmed/);
  assert.match(reviewRoute, /proposalBatchId/);
  assert.match(proposalApi, /loadAssistantWorkflowByBatchId/);
  assert.match(proposalApi, /authResult\.userId/);
  assert.match(undoRoute, /undo_committed_reload_failed/);
  assert.match(undoRoute, /reloadWarning/);
  assert.doesNotMatch(
    undoRoute,
    /blocks were reversed, but I couldn’t reload[\s\S]{0,240}status: 500/,
  );
}

runCompactSummaryCases();
runPresentationKindCases();
runReviewCases();
runClarificationGuardCases();
runWorkspaceSourceCases();

console.log("Assistant UI tests passed: 49 focused cases");
