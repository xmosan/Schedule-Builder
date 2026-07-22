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
const conditionalFallbackPrompt =
  "Starting this week, schedule two 90-minute FE Civil study sessions and one 60-minute review session on three different days. Prefer evenings between 6:00 and 9:00 PM, keep Friday evening free, and do not place anything immediately after work. If you cannot fit all three sessions in the evening, you may use Saturday afternoon for the 60-minute review session. You may automatically add the sessions if they fit these rules without conflicts. Keep your response brief.";
const personalBlocksPrompt =
  "This week, schedule three personal blocks for me: one 60-minute workout, one 45-minute grocery trip, and one 90-minute project work session. Put them on three different days, prefer evenings between 6:00 and 9:00 PM, and do not use Friday evening. You may automatically add them if they fit without conflicts. Keep your response brief.";
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

assert.equal(
  classifySchedulingRequestKind(personalBlocksPrompt),
  "bounded_multi_session_plan",
  "A bounded list of heterogeneous one-off items uses the deterministic planner",
);
const personalBlocksRequest = extractMultiSessionPlanningRequest({
  currentDate,
  prompt: personalBlocksPrompt,
  resolvedAt,
  timezone,
  weekStartDate,
  workflowId: "workflow-personal-blocks",
});
assert.ok(personalBlocksRequest, "The exact live personal-block request is extracted");
assert.deepEqual(
  personalBlocksRequest.sessions.map((session) => session.activityTitle),
  ["Workout", "Grocery trip", "Project work session"],
);
assert.deepEqual(
  personalBlocksRequest.sessions.map((session) => session.durationMinutes),
  [60, 45, 90],
);
assert.deepEqual(
  personalBlocksRequest.sessions.map((session) => session.count),
  [1, 1, 1],
  "Each requested personal block is a one-off item, not a recurring series",
);
assert.deepEqual(personalBlocksRequest.missingFields, []);
assert.equal(personalBlocksRequest.globalConstraints.requireDifferentDays, true);
assert.deepEqual(personalBlocksRequest.preferences.preferredTimeRanges, [
  { end: "21:00", start: "18:00" },
]);
assert.deepEqual(personalBlocksRequest.globalConstraints.excludedDateRanges, [
  {
    endsAt: "2026-07-10T22:00:00",
    startsAt: "2026-07-10T17:00:00",
  },
]);

const conditionalFallbackRequest = extractMultiSessionPlanningRequest({
  currentDate: "2026-07-20",
  prompt: conditionalFallbackPrompt,
  resolvedAt: "2026-07-20T15:00:00.000Z",
  timezone,
  weekStartDate: "2026-07-20",
  workflowId: "workflow-fe-civil-conditional-fallback",
});
assert.ok(conditionalFallbackRequest);
assert.deepEqual(
  conditionalFallbackRequest.preferences.fallbackTimeRanges,
  [
    {
      activityTitle: "FE Civil Review",
      durationMinutes: 60,
      end: "17:00",
      start: "12:00",
      weekday: 6,
    },
  ],
  "The explicit Saturday-afternoon exception remains scoped to the 60-minute review",
);

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
assert.equal(grant.scope, "current_request");
assert.deepEqual(grant.allowedActions, ["create_time_block_series"]);
assert.equal(grant.activityTitle, "FE Civil");
assert.equal(grant.guardrails.maximumOccurrences, 3);
assert.equal(grant.guardrails.maximumSessionMinutes, 90);
assert.equal(grant.guardrails.maximumWeeklyMinutes, 240);
assert.equal(grant.guardrails.earliestTime, "18:00");
assert.equal(grant.guardrails.latestTime, "21:00");
assert.equal(grant.guardrails.minimumBufferAfterWorkMinutes, 30);
assert.deepEqual(grant.guardrails.excludedDateRanges, [
  {
    endsAt: "2026-07-10T22:00:00",
    startsAt: "2026-07-10T17:00:00",
  },
]);
assert.equal(grant.guardrails.excludedDays, undefined);
assert.equal(grant.guardrails.requireDifferentDays, true);
assert.equal(grant.allowedActions.some((action) => /google/i.test(action)), false);

const personalBlocksGrant = extractAutomationGrant({
  multiSessionRequest: personalBlocksRequest,
  prompt: personalBlocksPrompt,
  semanticRequest: extractSemanticPlanningRequest({
    prompt: personalBlocksPrompt,
    workflowId: personalBlocksRequest.workflowId,
  }),
  sourceMessageId: "message-personal-blocks",
  userId: "user-personal-blocks",
  weekStartDate,
});
assert.ok(personalBlocksGrant);
assert.equal(personalBlocksGrant.scope, "current_request");
assert.deepEqual(personalBlocksGrant.guardrails.allowedActivityTitles, [
  "Workout",
  "Grocery trip",
  "Project work session",
]);
assert.equal(personalBlocksGrant.guardrails.maximumOccurrences, 3);
assert.equal(personalBlocksGrant.guardrails.maximumWeeklyMinutes, 195);

const conditionalFallbackGrant = extractAutomationGrant({
  multiSessionRequest: conditionalFallbackRequest,
  prompt: conditionalFallbackPrompt,
  semanticRequest: extractSemanticPlanningRequest({
    prompt: conditionalFallbackPrompt,
    workflowId: conditionalFallbackRequest.workflowId,
  }),
  sourceMessageId: "message-fe-civil-conditional-fallback",
  userId: "user-fe-civil",
  weekStartDate: "2026-07-20",
});
assert.ok(conditionalFallbackGrant);
assert.deepEqual(
  conditionalFallbackGrant.guardrails.allowedTimeExceptions,
  conditionalFallbackRequest.preferences.fallbackTimeRanges,
);

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

const personalBlocksTurn = advanceAssistantSchedulingConversation({
  input: { ...input, automationGrant: personalBlocksGrant },
  prompt: personalBlocksPrompt,
});
assert.ok(
  personalBlocksTurn,
  "The exact personal-block request enters the deterministic scheduler",
);
assert.equal(
  personalBlocksTurn.context.requestKind,
  "bounded_multi_session_plan",
);
assert.equal(personalBlocksTurn.context.state, "awaiting_apply");
assert.equal(personalBlocksTurn.context.pendingQuestion, null);
assert.equal(personalBlocksTurn.context.pendingProposals.length, 3);
assert.equal(
  personalBlocksTurn.context.semanticRequest?.scheduleInstructions.preferredDays,
  undefined,
  "The generic semantic parser cannot invert the Friday-evening exclusion into a Friday preference",
);
assert.deepEqual(
  personalBlocksTurn.context.pendingProposals
    .map((proposal) => proposal.title)
    .sort(),
  ["Grocery trip", "Project work session", "Workout"],
);
assert.deepEqual(
  Object.fromEntries(
    personalBlocksTurn.context.pendingProposals.map((proposal) => [
      proposal.title,
      proposal.durationMinutes,
    ]),
  ),
  {
    "Grocery trip": 45,
    "Project work session": 90,
    Workout: 60,
  },
);
assert.deepEqual(
  personalBlocksTurn.context.multiSessionRequest?.sessions.map(
    (session) => session.activityTitle,
  ),
  ["Workout", "Grocery trip", "Project work session"],
);
assert.equal(
  new Set(
    personalBlocksTurn.context.pendingProposals.map(
      (proposal) => proposal.date,
    ),
  ).size,
  3,
  "The three personal blocks use three different dates",
);
personalBlocksTurn.context.pendingProposals.forEach((proposal) => {
  const startsAt = `${proposal.date}T${proposal.startTime}:00`;
  const endsAt = `${proposal.date}T${proposal.selectedWindowEnd}:00`;
  assert.equal(
    startsAt < "2026-07-10T22:00:00" &&
      endsAt > "2026-07-10T17:00:00",
    false,
    "No selected block overlaps Friday evening",
  );
});
assert.doesNotMatch(
  personalBlocksTurn.message,
  /I need \d+ details|How many .*sessions|How long should|strongest opening|Which opening should I use|Waiting for a duration|How much time should I reserve|2\s*[×x]\s*30/i,
);

const personalBlockSuggestions = personalBlocksTurn.context.pendingProposals.map(
  (proposal) => ({
    batchId: proposal.batchId,
    confidence: 1,
    day:
      personalBlocksTurn.context.candidateWindows.find(
        (window) => window.date === proposal.date,
      )?.day ?? "Monday",
    description: proposal.details,
    estimatedHours: (proposal.durationMinutes ?? 0) / 60,
    id: proposal.id ?? proposal.title,
    itemDate: proposal.date,
    plannedTask: proposal.details,
    projectName: proposal.title,
    rationale: "Validated",
    severity: "important" as const,
    startTime: proposal.startTime,
    summary: proposal.details,
    title: proposal.title,
    type: "suggested_weekly_block" as const,
    workflowId: personalBlocksTurn.context.workflowId,
  }),
);
assert.equal(
  decideAssistantAutomation({
    grant: personalBlocksTurn.context.automationGrant ?? null,
    sourceDataComplete: true,
    suggestions: personalBlockSuggestions,
    workflowId: personalBlocksTurn.context.workflowId,
  }).outcome,
  "auto_apply",
  "The exact heterogeneous plan can auto-apply only after all three validated blocks fit",
);
assert.equal(
  decideAssistantAutomation({
    grant: personalBlocksTurn.context.automationGrant ?? null,
    sourceDataComplete: false,
    suggestions: personalBlockSuggestions,
    workflowId: personalBlocksTurn.context.workflowId,
  }).outcome,
  "create_review_batch",
  "Incomplete source data prevents auto-application of the personal blocks",
);
assert.equal(
  decideAssistantAutomation({
    grant: personalBlocksTurn.context.automationGrant ?? null,
    sourceDataComplete: true,
    suggestions: personalBlockSuggestions.map((suggestion, index) =>
      index === 0
        ? {
            ...suggestion,
            itemDate: "2026-07-10",
            startTime: "18:00",
          }
        : suggestion,
    ),
    workflowId: personalBlocksTurn.context.workflowId,
  }).outcome,
  "create_review_batch",
  "The automation grant rejects a Friday-evening personal block",
);

const blockedPersonalBlocksTurn = advanceAssistantSchedulingConversation({
  input: {
    ...input,
    automationGrant: personalBlocksGrant,
    weeklyPlanBlocks: [
      ["Tuesday", "2026-07-07"],
      ["Wednesday", "2026-07-08"],
      ["Thursday", "2026-07-09"],
      ["Friday", "2026-07-10"],
      ["Saturday", "2026-07-11"],
      ["Sunday", "2026-07-12"],
    ].map(([day, scheduledDate], index) => ({
      day: day as
        | "Tuesday"
        | "Wednesday"
        | "Thursday"
        | "Friday"
        | "Saturday"
        | "Sunday",
      estimatedHours: 24,
      id: `blocked-day-${index}`,
      plannedTask: "Unavailable",
      projectName: "Existing commitment",
      scheduledDate,
      startTime: "00:00",
    })),
  },
  prompt: personalBlocksPrompt,
});
assert.ok(blockedPersonalBlocksTurn);
assert.equal(blockedPersonalBlocksTurn.context.state, "needs_clarification");
assert.equal(blockedPersonalBlocksTurn.context.pendingProposals.length, 0);
assert.deepEqual(
  blockedPersonalBlocksTurn.context.extractedItems.flatMap(
    (item) => item.missingFields,
  ),
  [],
  "A capacity failure does not invent missing counts or durations",
);
assert.equal(
  (blockedPersonalBlocksTurn.context.pendingQuestion?.match(/\?/g) ?? [])
    .length,
  1,
  "An infeasible bounded plan asks one focused relaxation question",
);
assert.match(
  blockedPersonalBlocksTurn.message,
  /May I widen the preferred time range\? Nothing has been scheduled\.$/,
);
assert.doesNotMatch(
  blockedPersonalBlocksTurn.message,
  /How many|How long|2\s*[×x]\s*30|strongest opening/i,
);

const conditionalFallbackTurn = advanceAssistantSchedulingConversation({
  input: {
    ...input,
    automationGrant: conditionalFallbackGrant,
    currentDate: "2026-07-20",
    weekStartDate: "2026-07-20",
    weeklyPlanBlocks: [
      ...[
        ["Tuesday", "2026-07-21"],
        ["Thursday", "2026-07-23"],
        ["Saturday", "2026-07-25"],
        ["Sunday", "2026-07-26"],
      ].map(([day, scheduledDate], index) => ({
        day: day as "Tuesday" | "Thursday" | "Saturday" | "Sunday",
        estimatedHours: 5,
        id: `evening-commitment-${index}`,
        plannedTask: "Existing evening commitment",
        projectName: "Existing commitment",
        scheduledDate,
        startTime: "17:00",
      })),
      {
        day: "Saturday",
        estimatedHours: 6,
        id: "saturday-morning-commitment",
        plannedTask: "Existing Saturday morning commitment",
        projectName: "Existing commitment",
        scheduledDate: "2026-07-25",
        startTime: "08:00",
      },
    ],
  },
  prompt: conditionalFallbackPrompt,
});
assert.ok(conditionalFallbackTurn);
assert.equal(conditionalFallbackTurn.context.state, "awaiting_apply");
assert.equal(conditionalFallbackTurn.context.pendingQuestion, null);
assert.equal(
  conditionalFallbackTurn.context.semanticRequest?.activity.title,
  "FE Civil",
  "The bounded workflow preserves the canonical activity identity for status and apply responses",
);
assert.deepEqual(
  conditionalFallbackTurn.context.pendingProposals.map((proposal) => [
    proposal.title,
    proposal.date,
    proposal.startTime,
    proposal.durationMinutes,
  ]),
  [
    ["FE Civil Study", "2026-07-20", "18:00", 90],
    ["FE Civil Study", "2026-07-22", "18:00", 90],
    ["FE Civil Review", "2026-07-25", "14:00", 60],
  ],
  "The exact request uses the explicit Saturday-afternoon fallback without another question",
);
assert.doesNotMatch(
  conditionalFallbackTurn.message,
  /May I|strongest opening|Which opening should I use|Waiting for a duration|How much time should I reserve/i,
);

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

const conditionalFallbackSuggestions = suggestions.map((suggestion, index) => ({
  ...suggestion,
  estimatedHours: index < 2 ? 1.5 : 1,
  id: `conditional-fallback-proposal-${index + 1}`,
  itemDate: ["2026-07-20", "2026-07-22", "2026-07-25"][index],
  projectName: index < 2 ? "FE Civil Study" : "FE Civil Review",
  startTime: index < 2 ? "18:00" : "14:00",
  title: index < 2 ? "FE Civil Study" : "FE Civil Review",
  workflowId: conditionalFallbackRequest.workflowId,
}));
assert.equal(
  decideAssistantAutomation({
    grant: conditionalFallbackGrant,
    sourceDataComplete: true,
    suggestions: conditionalFallbackSuggestions,
    workflowId: conditionalFallbackRequest.workflowId,
  }).outcome,
  "auto_apply",
  "The exact prompt authorizes two evening study sessions plus the Saturday-afternoon review",
);
assert.equal(
  decideAssistantAutomation({
    grant: conditionalFallbackGrant,
    sourceDataComplete: true,
    suggestions: conditionalFallbackSuggestions.map((suggestion, index) =>
      index === 0
        ? { ...suggestion, itemDate: "2026-07-25", startTime: "14:00" }
        : index === 2
          ? { ...suggestion, itemDate: "2026-07-20", startTime: "18:00" }
          : suggestion,
    ),
    workflowId: conditionalFallbackRequest.workflowId,
  }).outcome,
  "create_review_batch",
  "The Saturday-afternoon exception cannot be reused for a 90-minute study session",
);
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

const fridayCurrentDate = "2026-07-17";
const fridayWeekStartDate = "2026-07-13";
const fridayWorkflowId = "workflow-fe-civil-friday";
const fridayRequest = extractMultiSessionPlanningRequest({
  currentDate: fridayCurrentDate,
  prompt,
  resolvedAt: "2026-07-17T14:00:00.000Z",
  timezone,
  weekStartDate: fridayWeekStartDate,
  workflowId: fridayWorkflowId,
});
assert.ok(fridayRequest);
const fridayGrant = extractAutomationGrant({
  multiSessionRequest: fridayRequest,
  prompt,
  semanticRequest: extractSemanticPlanningRequest({
    prompt,
    workflowId: fridayWorkflowId,
  }),
  sourceMessageId: "message-fe-civil-friday",
  userId: "user-fe-civil",
  weekStartDate: fridayWeekStartDate,
});
const fridayInput: AssistantScheduleAnalysisInput = {
  ...input,
  automationGrant: fridayGrant,
  currentDate: fridayCurrentDate,
  scheduleExceptions: [],
  weekStartDate: fridayWeekStartDate,
};
const fridayTurn = advanceAssistantSchedulingConversation({
  input: fridayInput,
  prompt,
});
assert.ok(fridayTurn, "Late-week bounded requests still use the bounded planner");
assert.equal(fridayTurn.context.requestKind, "bounded_multi_session_plan");
assert.equal(fridayTurn.context.state, "needs_clarification");
assert.match(
  fridayTurn.context.pendingQuestion ?? "",
  /two different evening days|two sessions on Saturday/i,
);
assert.doesNotMatch(
  fridayTurn.message,
  /strongest opening|Which opening should I use|Waiting for a duration|How much time should I reserve/i,
);

const relaxedFridayTurn = advanceAssistantSchedulingConversation({
  activeContext: fridayTurn.context,
  input: fridayInput,
  prompt: "Yeah",
});
assert.ok(relaxedFridayTurn, "A yes follow-up advances the active bounded workflow");
assert.equal(relaxedFridayTurn.context.requestKind, "bounded_multi_session_plan");
assert.equal(relaxedFridayTurn.context.state, "awaiting_apply");
assert.equal(relaxedFridayTurn.context.pendingQuestion, null);
assert.equal(relaxedFridayTurn.context.pendingProposals.length, 3);
assert.equal(
  relaxedFridayTurn.context.multiSessionRequest?.relaxations
    ?.allowSameDayWithAfternoon,
  true,
);
assert.equal(
  relaxedFridayTurn.context.multiSessionRequest?.globalConstraints
    .requireDifferentDays,
  false,
);
assert.doesNotMatch(
  relaxedFridayTurn.message,
  /May I|only two sessions|strongest opening|Which opening should I use|Waiting for a duration|How much time should I reserve/i,
);
assert.ok(
  relaxedFridayTurn.context.pendingProposals.some(
    (proposal) =>
      proposal.date === "2026-07-18" && proposal.startTime < "17:00",
  ),
  "The approved relaxation creates a Saturday afternoon candidate",
);
assert.equal(
  relaxedFridayTurn.context.pendingProposals.some(
    (proposal) =>
      proposal.date === "2026-07-17" && proposal.startTime >= "17:00",
  ),
  false,
  "Friday evening remains excluded after the relaxation",
);
relaxedFridayTurn.context.pendingProposals.forEach((proposal, index, all) => {
  all.slice(index + 1).forEach((other) => {
    assert.equal(
      proposal.date === other.date &&
        proposal.startTime < other.selectedWindowEnd &&
        proposal.selectedWindowEnd > other.startTime,
      false,
      "Same-day relaxed sessions cannot overlap",
    );
  });
});
const relaxedSuggestions = relaxedFridayTurn.context.pendingProposals.map(
  (proposal, index) => ({
    confidence: 1,
    conflictWarnings: [],
    day: relaxedFridayTurn.context.candidateWindows.find(
      (window) => window.date === proposal.date,
    )?.day,
    description: proposal.details,
    estimatedHours: (proposal.durationMinutes ?? 0) / 60,
    id: proposal.id ?? `relaxed-proposal-${index}`,
    itemDate: proposal.date,
    projectName: proposal.title,
    rationale: "Validated deterministic candidate plan.",
    severity: "important" as const,
    startTime: proposal.startTime,
    summary: proposal.details,
    title: proposal.title,
    type: "suggested_weekly_block" as const,
    workflowId: relaxedFridayTurn.context.workflowId,
  }),
);
assert.equal(
  decideAssistantAutomation({
    grant: relaxedFridayTurn.context.automationGrant ?? null,
    sourceDataComplete: true,
    suggestions: relaxedSuggestions,
    workflowId: relaxedFridayTurn.context.workflowId,
  }).outcome,
  "auto_apply",
  "The yes follow-up carries the relaxed current-request automation guardrails",
);

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
