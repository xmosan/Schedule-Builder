import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyAssistantActionRisk,
  decideAssistantAutomation,
  extractAutomationGrant,
  isAssistantAppliedDetailsQuestion,
  isAssistantSocialReply,
  isAssistantUndoRequest,
  resolveAssistantWorkflowStatus,
  shouldAskClarification,
} from "../lib/assistant-automation";
import {
  advanceAssistantSchedulingConversation,
  type AssistantScheduleAnalysisInput,
} from "../lib/assistant-schedule-analysis";
import { extractSemanticPlanningRequest } from "../lib/assistant-semantics";
import { validateAssistantCompletionLanguage } from "../lib/assistant-intelligence";
import type { SchedulingWorkflowContext } from "../lib/assistant-workflow";

const prompt =
  "Starting this week, help me read The Sealed Nectar for 3 hours per week in three 1-hour sessions. I prefer evenings before 9 PM, but not immediately after work. Today I am leaving work at 1:30 PM instead of 5:00 PM. Find the best plan for this week. You may automatically schedule anything that fits these rules without conflicts; otherwise ask me one clear question. Keep your response brief.";

const semantic = extractSemanticPlanningRequest({
  prompt,
  workflowId: "workflow-live",
});
const grant = extractAutomationGrant({
  prompt,
  semanticRequest: semantic,
  sourceMessageId: "message-live",
  userId: "user-live",
  weekStartDate: "2026-07-06",
});

assert.ok(grant, "Explicit automation language creates a grant");
assert.equal(grant.scope, "current_week");
assert.deepEqual(grant.allowedActions, ["create_time_block_series"]);
assert.equal(grant.guardrails.maximumOccurrences, 3);
assert.equal(grant.guardrails.maximumSessionMinutes, 60);
assert.equal(grant.guardrails.maximumWeeklyMinutes, 180);
assert.equal(grant.guardrails.earliestTime, "17:00");
assert.equal(grant.guardrails.latestTime, "21:00");
assert.equal(grant.guardrails.minimumBufferAfterWorkMinutes, 60);
assert.equal(grant.allowedActions.includes("move_flexible_block"), false);
assert.equal(grant.allowedActions.some((action) => /google/i.test(action)), false);
assert.equal(
  extractAutomationGrant({
    prompt: "Do this automatically every week from now on.",
    semanticRequest: semantic,
    sourceMessageId: "message-routine",
    userId: "user-live",
    weekStartDate: "2026-07-06",
  }),
  null,
  "Indefinite routine permission is not enabled by a current-request grant",
);
assert.equal(isAssistantSocialReply("Thank you."), true);
assert.equal(isAssistantAppliedDetailsQuestion("What did you schedule?"), true);
assert.equal(isAssistantUndoRequest("Undo that."), true);
assert.equal(
  validateAssistantCompletionLanguage(
    "The reading plan is drafted and ready for review.",
    "records_applied",
  ).mismatch,
  true,
);

assert.equal(semantic.scheduleInstructions.desiredFrequency?.count, 3);
assert.equal(semantic.scheduleInstructions.sessionDurationMinutes, 60);
assert.equal(semantic.scheduleInstructions.weeklyMinutes, 180);
assert.equal(semantic.scheduleInstructions.planningHorizon?.count, 1);
assert.equal(semantic.weeklyGoal?.recommendedPattern.status, "accepted");
assert.equal(semantic.missingFields.length, 0);
assert.equal(
  shouldAskClarification("pattern_confirmation", semantic, "idle"),
  false,
);

const input: AssistantScheduleAnalysisInput = {
  automationGrant: grant,
  currentDate: "2026-07-06",
  importedCalendarEvents: [],
  projects: [],
  scheduleExceptions: [],
  scheduledItems: [],
  timezone: "America/Detroit",
  weekStartDate: "2026-07-06",
  weeklyPlanBlocks: [],
  workShifts: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
  ].map((day, index) => ({
    day: day as "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday",
    endTime: "17:00",
    id: `shift-${index}`,
    location: "",
    notes: "",
    recurring: true,
    startTime: "09:00",
  })),
};

const turn = advanceAssistantSchedulingConversation({ input, prompt });
assert.ok(turn, "The complete request enters the deterministic scheduler");
assert.equal(turn.context.state, "awaiting_apply");
assert.equal(turn.context.pendingQuestion, null);
assert.equal(turn.context.requestedSessionCount, 3);
assert.equal(turn.context.requestedDurationMinutes, 60);
assert.equal(turn.context.pendingProposals.length, 3);
assert.equal(turn.context.extractedItems[0]?.missingFields.length, 0);
assert.equal(turn.context.temporaryScheduleContext?.date, "2026-07-06");
assert.equal(turn.context.temporaryScheduleContext?.overrideEndTime, "13:30");
assert.equal(
  turn.context.temporaryScheduleContext?.affectedCandidateCalculation,
  true,
);
assert.equal(input.scheduleExceptions?.length, 0, "The temporary context is not persisted");
assert.equal(input.workShifts[0].endTime, "17:00", "The recurring shift is unchanged");

const proposalSuggestions = turn.context.pendingProposals.map((proposal, index) => ({
  confidence: 1,
  conflictWarnings: [],
  day: turn.context.candidateWindows.find((window) => window.date === proposal.date)?.day,
  description: proposal.details,
  estimatedHours: 1,
  id: proposal.id ?? `proposal-${index}`,
  itemDate: proposal.date,
  projectName: proposal.title,
  rationale: "Validated",
  severity: "important" as const,
  startTime: proposal.startTime,
  summary: proposal.details,
  title: proposal.title,
  type: "suggested_weekly_block" as const,
  workflowId: turn.context.workflowId,
}));
proposalSuggestions.forEach((suggestion) => {
  const [hours, minutes] = (suggestion.startTime ?? "00:00").split(":").map(Number);
  assert.ok(hours * 60 + minutes >= 17 * 60);
  assert.ok(hours * 60 + minutes + 60 <= 21 * 60);
});
assert.equal(proposalSuggestions[0].itemDate, "2026-07-06");
assert.equal(proposalSuggestions[0].startTime, "17:00");

const decision = decideAssistantAutomation({
  grant: turn.context.automationGrant ?? null,
  sourceDataComplete: true,
  suggestions: proposalSuggestions,
  workflowId: turn.context.workflowId,
});
assert.equal(decision.outcome, "auto_apply");
assert.equal(decision.riskLevel, "low_risk_reversible");

assert.equal(
  decideAssistantAutomation({
    grant: turn.context.automationGrant ?? null,
    sourceDataComplete: true,
    suggestions: proposalSuggestions,
    workflowId: "unrelated-workflow",
  }).outcome,
  "create_review_batch",
  "Current-request permission does not carry to another workflow",
);
assert.equal(
  classifyAssistantActionRisk([{ type: "delete_time_block" }]),
  "high_impact",
);
assert.equal(
  classifyAssistantActionRisk([{ type: "update_work_shift" }]),
  "high_impact",
);
assert.equal(
  classifyAssistantActionRisk([{ type: "google_calendar" }]),
  "prohibited",
);

const workflow = {
  appliedProposalIds: [],
  completionStatus: "nothing_created",
  context: turn.context,
  extractedItems: turn.context.extractedItems,
  intent: "create_multiple_time_blocks",
  lastUpdatedAt: new Date().toISOString(),
  missingFields: [],
  pendingProposalIds: [],
  persistenceStatus: "persisted",
  proposalIds: [],
  selectedCandidateIds: [],
  state: "awaiting_clarification",
  threadId: "thread-live",
  userId: "user-live",
  workflowId: turn.context.workflowId,
} as SchedulingWorkflowContext;
assert.notEqual(
  resolveAssistantWorkflowStatus({ workflow }),
  "waiting_for_details",
  "Waiting for details requires a real missing field",
);
assert.equal(
  resolveAssistantWorkflowStatus({
    workflow: {
      ...workflow,
      appliedProposalIds: proposalSuggestions.map((suggestion) => suggestion.id),
      completionStatus: "records_applied",
      state: "applied",
    },
  }),
  "applied",
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
const migration = readFileSync(
  new URL("../supabase/assistant-automation.sql", import.meta.url),
  "utf8",
);
assert.match(planRoute, /\/api\/assistant\/apply/);
assert.match(applyRoute, /loadAutomationGrantById/);
assert.match(applyRoute, /persistPlanningDecision/);
assert.match(applyRoute, /persistActionReceipt/);
assert.match(applyRoute, /state: "applying" as const/);
assert.match(undoRoute, /undo_assistant_decision/);
assert.match(migration, /block\.updated_at = \(expected->>'updated_at'\)::timestamptz/);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
assert.doesNotMatch(applyRoute, /sync-blocks|google_calendar_synced_events/);

console.log("Assistant automation tests passed");
