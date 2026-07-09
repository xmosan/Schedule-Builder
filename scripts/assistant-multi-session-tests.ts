import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCompleteCandidatePlans,
  classifySchedulingRequestKind,
  extractMultiSessionPlanningRequest,
  getIsoDateInTimezone,
  resolveRelativeDate,
  validateSessionDurations,
} from "../lib/assistant-multi-session";
import {
  decideAssistantAutomation,
  extractAutomationGrant,
  isAssistantAppliedDetailsQuestion,
} from "../lib/assistant-automation";
import {
  advanceAssistantSchedulingConversation,
  type AssistantScheduleAnalysisInput,
} from "../lib/assistant-schedule-analysis";
import { extractSemanticPlanningRequest } from "../lib/assistant-semantics";
import { createCanonicalProposal } from "../lib/assistant-workflow";
import { getPlanPresentationKind } from "../lib/assistant-plan-presentation";

const prompt =
  "Starting this week, schedule two 90-minute FE Civil study sessions and one 60-minute review session on three different days. Prefer evenings between 6:00 and 9:00 PM, do not place anything immediately after work, and keep Friday evening free. Tomorrow I am leaving work at 2:30 PM instead of 5:00 PM. You may automatically add the sessions if they fit these rules without conflicts; otherwise ask me one clear question. Keep your response brief.";
const workflowId = "workflow-fe-civil";
const currentDate = "2026-07-07";
const weekStartDate = "2026-07-06";
const timezone = "America/Detroit";
const resolvedAt = "2026-07-07T16:00:00.000Z";

assert.equal(
  classifySchedulingRequestKind(prompt),
  "bounded_multi_session_plan",
  "Mixed-duration multi-session requests have a dedicated route",
);
assert.equal(
  classifySchedulingRequestKind("Schedule a 60-minute dentist appointment"),
  "single_item_schedule",
  "Normal one-item requests keep the existing single-item route",
);

const request = extractMultiSessionPlanningRequest({
  currentDate,
  prompt,
  resolvedAt,
  timezone,
  weekStartDate,
  workflowId,
});
assert.ok(request, "The exact production request is extracted deterministically");
assert.equal(request.requestKind, "bounded_multi_session_plan");
assert.equal(request.title, "FE Civil Study Plan");
assert.equal(request.sessions.length, 3);
assert.deepEqual(
  request.sessions.map((session) => session.durationMinutes),
  [90, 90, 60],
  "Mixed durations remain attached to individual sessions",
);
assert.deepEqual(
  request.sessions.map((session) => session.activityTitle),
  ["FE Civil Study", "FE Civil Study", "FE Civil Review"],
);
assert.equal(request.sessions[2].activityType, "review");
assert.equal(request.globalConstraints.requireDifferentDays, true);
assert.deepEqual(request.preferences.preferredTimeRanges, [
  { end: "21:00", start: "18:00" },
]);
assert.equal(request.preferences.afterWorkBufferMinutes, 30);
assert.equal(request.planningHorizon.startDate, "2026-07-07");
assert.equal(request.planningHorizon.endDate, "2026-07-12");
assert.equal(validateSessionDurations(request.sessions).valid, true);
assert.equal(request.missingFields.length, 0);

const override = request.temporaryAvailabilityOverrides[0];
assert.ok(override);
assert.equal(override.date, "2026-07-08");
assert.equal(override.effectiveEnd, "14:30");
assert.equal(override.replaces.originalEnd, "17:00");
assert.equal(override.scope, "current_workflow");
assert.equal(override.resolvedRelativeDate.originalText.toLowerCase(), "tomorrow");
assert.equal(
  request.globalConstraints.excludedDateRanges?.[0]?.startsAt,
  "2026-07-10T17:00:00",
  "Friday evening uses the deterministic application daypart",
);

assert.equal(
  getIsoDateInTimezone(new Date("2026-07-08T03:30:00.000Z"), timezone),
  "2026-07-07",
  "The user timezone, not UTC, controls the request date",
);
assert.equal(
  resolveRelativeDate({
    currentDate: "2026-11-01",
    originalText: "tomorrow",
    resolvedAt: "2026-11-01T04:30:00.000Z",
    timezone,
  })?.resolvedDate,
  "2026-11-02",
  "Relative dates stay calendar-correct across DST transitions",
);
assert.equal(
  resolveRelativeDate({
    currentDate,
    originalText: "this Friday",
    resolvedAt,
    timezone,
  })?.resolvedDate,
  "2026-07-10",
);
assert.equal(
  resolveRelativeDate({
    currentDate,
    originalText: "next Friday",
    resolvedAt,
    timezone,
  })?.resolvedDate,
  "2026-07-17",
);

const semantic = extractSemanticPlanningRequest({ prompt, workflowId });
const grant = extractAutomationGrant({
  multiSessionRequest: request,
  prompt,
  semanticRequest: semantic,
  sourceMessageId: "message-fe-civil",
  userId: "user-fe-civil",
  weekStartDate,
});
assert.ok(grant, "Explicit current-request automation permission is preserved");
assert.deepEqual(grant.allowedActions, ["create_time_block_series"]);
assert.equal(grant.activityTitle, "FE Civil");
assert.equal(grant.guardrails.maximumOccurrences, 3);
assert.equal(grant.guardrails.maximumSessionMinutes, 90);
assert.equal(grant.guardrails.maximumWeeklyMinutes, 240);
assert.equal(grant.guardrails.earliestTime, "18:00");
assert.equal(grant.guardrails.latestTime, "21:00");
assert.equal(grant.guardrails.minimumBufferAfterWorkMinutes, 30);
assert.deepEqual(grant.guardrails.excludedDays, [5]);
assert.equal(grant.guardrails.requireDifferentDays, true);
assert.equal(grant.allowedActions.some((action) => /google/i.test(action)), false);

const input: AssistantScheduleAnalysisInput = {
  automationGrant: grant,
  currentDate,
  importedCalendarEvents: [],
  projects: [],
  scheduleExceptions: [],
  scheduledItems: [],
  timezone,
  weekStartDate,
  weeklyPlanBlocks: [],
  workShifts: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(
    (day, index) => ({
      day: day as "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday",
      endTime: "17:00",
      id: `shift-${index}`,
      location: "",
      notes: "",
      recurring: true,
      startTime: "09:00",
    }),
  ),
};

const turn = advanceAssistantSchedulingConversation({ input, prompt });
assert.ok(turn, "The exact request enters the deterministic scheduler");
assert.equal(turn.context.requestKind, "bounded_multi_session_plan");
assert.equal(turn.context.intent, "create_multiple_time_blocks");
assert.equal(turn.context.state, "awaiting_apply");
assert.equal(turn.context.confirmationStatus, "ready_for_review");
assert.equal(turn.context.pendingQuestion, null);
assert.equal(turn.context.requestedSessionCount, 3);
assert.equal(
  turn.context.requestedDurationMinutes,
  null,
  "A mixed-duration plan is never flattened into one global duration",
);
assert.ok((turn.context.candidatePlanCount ?? 0) > 1);
assert.equal(turn.context.pendingProposals.length, 3);
assert.deepEqual(
  turn.context.pendingProposals.map((proposal) => proposal.durationMinutes),
  [90, 90, 60],
);
assert.equal(new Set(turn.context.pendingProposals.map((proposal) => proposal.date)).size, 3);
assert.equal(
  turn.context.pendingProposals.some((proposal) => proposal.date === "2026-07-10"),
  false,
  "The selected plan preserves Friday evening",
);
turn.context.pendingProposals.forEach((proposal) => {
  assert.ok(proposal.startTime >= "18:00");
  assert.ok(proposal.selectedWindowEnd <= "21:00");
});
assert.equal(turn.context.temporaryScheduleContext?.date, "2026-07-08");
assert.equal(turn.context.temporaryScheduleContext?.overrideEndTime, "14:30");
assert.equal(turn.context.temporaryScheduleContext?.relatedWorkShiftId, "shift-2");
assert.equal(input.scheduleExceptions?.length, 0);
assert.ok(input.workShifts.every((shift) => shift.endTime === "17:00"));
assert.doesNotMatch(turn.message, /strongest opening|choose an opening|how much time/i);

const suggestions = turn.context.pendingProposals.map((proposal, index) => ({
  confidence: 1,
  conflictWarnings: [],
  day: turn.context.candidateWindows.find((window) => window.date === proposal.date)?.day,
  description: proposal.details,
  estimatedHours: (proposal.durationMinutes ?? 0) / 60,
  id: proposal.id ?? `proposal-${index}`,
  itemDate: proposal.date,
  projectName: proposal.title,
  rationale: "Validated deterministic candidate plan.",
  severity: "important" as const,
  startTime: proposal.startTime,
  summary: proposal.details,
  title: proposal.title,
  type: "suggested_weekly_block" as const,
  workflowId: turn.context.workflowId,
}));
assert.equal(
  getPlanPresentationKind({
    appliedCount: 0,
    pendingCount: suggestions.length,
    series: null,
    suggestions,
  }),
  "multi_item_week",
  "The compact UI treats mixed sessions as a complete multi-item plan",
);
assert.ok(suggestions.every((suggestion) => createCanonicalProposal(suggestion)));

const decision = decideAssistantAutomation({
  grant: turn.context.automationGrant ?? null,
  sourceDataComplete: true,
  suggestions,
  workflowId: turn.context.workflowId,
});
assert.equal(decision.outcome, "auto_apply");
assert.equal(decision.validation.scopeMatched, true);
assert.equal(
  decideAssistantAutomation({
    grant: turn.context.automationGrant ?? null,
    sourceDataComplete: false,
    suggestions,
    workflowId: turn.context.workflowId,
  }).outcome,
  "create_review_batch",
  "Incomplete source data prevents automatic application",
);
assert.equal(
  decideAssistantAutomation({
    grant: turn.context.automationGrant ?? null,
    sourceDataComplete: true,
    suggestions: suggestions.map((suggestion, index) => ({
      ...suggestion,
      itemDate: index === 2 ? suggestions[0].itemDate : suggestion.itemDate,
    })),
    workflowId: turn.context.workflowId,
  }).outcome,
  "create_review_batch",
  "The automation guard rejects a plan that reuses a day",
);
assert.equal(isAssistantAppliedDetailsQuestion("What exactly did you schedule?"), true);

const emptyCandidates = new Map(
  request.sessions.map((session) => [session.id, []]),
);
assert.equal(
  buildCompleteCandidatePlans({ candidatesBySession: emptyCandidates, request })
    .selectedPlan,
  null,
  "An isolated or incomplete opening set cannot become a final plan",
);

const planRoute = readFileSync(
  new URL("../app/api/assistant/plan/route.ts", import.meta.url),
  "utf8",
);
const applyRoute = readFileSync(
  new URL("../app/api/assistant/apply/route.ts", import.meta.url),
  "utf8",
);
const undoRoute = readFileSync(
  new URL("../app/api/assistant/undo/route.ts", import.meta.url),
  "utf8",
);
assert.match(planRoute, /extractMultiSessionPlanningRequest/);
assert.match(planRoute, /\/api\/assistant\/apply/);
assert.match(applyRoute, /persistAssistantWorkflow/);
assert.match(applyRoute, /temporaryScheduleContext/);
assert.match(applyRoute, /persistActionReceipt/);
assert.match(undoRoute, /undo_assistant_decision/);
assert.doesNotMatch(applyRoute, /google_calendar_synced_events/);

console.log("Assistant bounded multi-session tests passed");
