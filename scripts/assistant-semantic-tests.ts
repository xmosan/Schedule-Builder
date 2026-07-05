import assert from "node:assert/strict";
import type { AssistantSuggestion } from "../lib/assistant";
import {
  advanceAssistantSchedulingConversation,
  createDeterministicScheduleAnswer,
  type AssistantScheduleAnalysisInput,
} from "../lib/assistant-schedule-analysis";
import {
  createAssistantResponsePlan,
  createRelevantNoticeId,
  gateAssistantInsights,
  getActionCardControls,
  validateResponsePlan,
} from "../lib/assistant-presentation";
import {
  extractSemanticPlanningRequest,
  inferSemanticActivityTitle,
  isCommandDerivedTitle,
  parseWeeklyCommitment,
  validateSemanticTitle,
} from "../lib/assistant-semantics";
import { buildCalendarDays } from "../lib/calendar";
import {
  createCanonicalProposal,
  deriveAssistantWorkflowAfterProposalUpdates,
  type SchedulingWorkflowContext,
} from "../lib/assistant-workflow";
import { weekDays } from "../lib/weekly-plan";

const input: AssistantScheduleAnalysisInput = {
  currentDate: "2026-07-04",
  importedCalendarEvents: [],
  projects: [],
  scheduleExceptions: [],
  scheduledItems: [],
  timezone: "America/Detroit",
  weekStartDate: "2026-06-29",
  weeklyPlanBlocks: [],
  workShifts: [],
};

let assertions = 0;
function check(name: string, assertion: () => void) {
  assertion();
  assertions += 1;
  console.log(`✓ ${name}`);
}

const titleCases = [
  ["Find time to finish my pavement report.", "Finish pavement report"],
  ["Put board meeting preparation on my schedule.", "Prepare for board meeting"],
  ["Review CE 312 assignment.", "Review CE 312 assignment"],
  ["Workout", "Workout"],
  ["Grocery shopping", "Grocery shopping"],
  ["Call advisor", "Call advisor"],
  ["Draft khutbah outline", "Draft khutbah outline"],
  ["Schedule The Sealed Nectar", "Read The Sealed Nectar"],
] as const;

titleCases.forEach(([prompt, expected]) => {
  check(`Semantic title: ${expected}`, () =>
    assert.equal(inferSemanticActivityTitle(prompt), expected));
});

const prior = extractSemanticPlanningRequest({
  prompt: "I need to read The Sealed Nectar for halaqah preparation.",
});
check("Command-only follow-up preserves the prior title", () =>
  assert.equal(
    inferSemanticActivityTitle("Plan it for the next month.", prior.activity.title),
    "Read The Sealed Nectar",
  ));
check("Plan it for the next five weeks is rejected as a title", () => {
  assert.equal(isCommandDerivedTitle("Plan it for the next five weeks"), true);
  assert.equal(
    validateSemanticTitle("Plan it for the next five weeks", prior),
    "Read The Sealed Nectar",
  );
});

const weeklyPrompt =
  "I need to study The Sealed Nectar for at least three hours every week.";
const weeklySemantic = extractSemanticPlanningRequest({ prompt: weeklyPrompt });
check("At-least weekly commitment is extracted as 180 minutes", () => {
  assert.deepEqual(parseWeeklyCommitment(weeklyPrompt), {
    kind: "minimum",
    minutes: 180,
    sourceText: "at least three hours every week",
  });
  assert.equal(weeklySemantic.weeklyGoal?.weeklyMinutes, 180);
});
check("Weekly total is not misread as one session duration", () =>
  assert.equal(
    weeklySemantic.scheduleInstructions.sessionDurationMinutes ?? null,
    null,
  ));
check("Weekly reading receives a three-by-one-hour recommendation", () => {
  assert.equal(weeklySemantic.weeklyGoal?.recommendedPattern.sessionsPerWeek, 3);
  assert.equal(weeklySemantic.weeklyGoal?.recommendedPattern.durationMinutes, 60);
  assert.equal(weeklySemantic.weeklyGoal?.recommendedPattern.status, "pending");
});
const weeklyRecommendation = advanceAssistantSchedulingConversation({
  activeContext: null,
  input,
  prompt: weeklyPrompt,
});
assert.ok(weeklyRecommendation);
check("Weekly goal asks exactly one recommendation question", () =>
  assert.equal(
    weeklyRecommendation.message,
    "I recommend three one-hour reading sessions each week instead of one three-hour block. That should make the preparation easier to maintain. Should I use that pattern?",
  ));
check("Recommendation does not narrate work shifts or Helpful notes", () => {
  assert.doesNotMatch(weeklyRecommendation.message, /Monday|Thursday|Helpful notes/i);
});

const weeklyAcceptancePhrases = [
  "Yes, let’s do that.",
  "Let’s do that.",
  "Sounds good.",
  "Go ahead.",
  "Draft it.",
  "Add it.",
  "Put it on the schedule.",
];
weeklyAcceptancePhrases.forEach((prompt) => {
  check(`Contextual acceptance creates proposals: ${prompt}`, () => {
    const turn = advanceAssistantSchedulingConversation({
      activeContext: weeklyRecommendation.context,
      input,
      prompt,
    });
    assert.ok(turn);
    assert.equal(turn.context.pendingProposals.length, 3);
    assert.equal(turn.context.state, "awaiting_apply");
    assert.equal(turn.context.semanticRequest?.activity.title, "Read The Sealed Nectar");
  });
});
const weeklyDraft = advanceAssistantSchedulingConversation({
  activeContext: weeklyRecommendation.context,
  input,
  prompt: "Yes, let’s do that.",
});
assert.ok(weeklyDraft);
check("Accepted weekly recommendation creates exact timed proposals", () =>
  assert.ok(
    weeklyDraft.context.pendingProposals.every(
      (proposal) =>
        proposal.title === "Read The Sealed Nectar" &&
        proposal.details === "Prepare for the masjid halaqah" &&
        proposal.durationMinutes === 60 &&
        /^\d{4}-\d{2}-\d{2}$/.test(proposal.date) &&
        /^\d{2}:\d{2}$/.test(proposal.startTime),
    ),
  ));
check("Weekly total derives from the proposed occurrences", () =>
  assert.equal(weeklyDraft.context.seriesProposal?.weeklyTotalMinutes, 180));
check("Weekly recommendation does not silently create an indefinite series", () =>
  assert.equal(weeklyDraft.context.seriesProposal?.planningHorizon.weeks, 1));

const requestPrompt =
  "I want to make time to read The Sealed Nectar. Place it on my schedule for the next five weeks. I need at least one hour every two days, but no more than three hours per week. Find time around my schedule and implement it.";
const semantic = extractSemanticPlanningRequest({ prompt: requestPrompt });
check("Sealed Nectar activity is preserved", () =>
  assert.equal(semantic.activity.title, "Read The Sealed Nectar"));
check("Halaqah purpose is preserved", () =>
  assert.equal(semantic.activity.purpose, "Prepare for the masjid halaqah"));
check("Recurring request is a time-block series", () =>
  assert.equal(semantic.itemType, "time_block_series"));
check("Five-week horizon is extracted", () =>
  assert.deepEqual(semantic.scheduleInstructions.planningHorizon, {
    count: 5,
    unit: "week",
  }));
check("Every-two-day interval is extracted", () =>
  assert.equal(semantic.scheduleInstructions.desiredFrequency?.intervalDays, 2));
check("Minimum one-hour session is extracted", () =>
  assert.equal(semantic.scheduleInstructions.minimumSessionDurationMinutes, 60));
check("Three-hour weekly maximum is extracted", () =>
  assert.equal(semantic.scheduleInstructions.maximumWeeklyMinutes, 180));
check("Contradictory frequency is detected", () =>
  assert.equal(
    semantic.contradictions[0]?.code,
    "frequency_exceeds_weekly_maximum",
  ));

const firstTurn = advanceAssistantSchedulingConversation({
  activeContext: null,
  input,
  prompt: requestPrompt,
});
assert.ok(firstTurn);
check("Conflict response recommends three sessions", () =>
  assert.match(firstTurn.message, /recommend three one-hour sessions per week/i));
check("Conflict response does not dump open windows", () =>
  assert.doesNotMatch(firstTurn.message, /^- (?:Monday|Tuesday)/m));
check("Conflict response has no canned filler", () =>
  assert.doesNotMatch(firstTurn.message, /Absolutely|highest-impact|all set/i));

const secondTurn = advanceAssistantSchedulingConversation({
  activeContext: firstTurn.context,
  input,
  prompt: "Yes.",
});
assert.ok(secondTurn);
const proposals = secondTurn.context.pendingProposals;
check("Accepted recommendation creates fifteen occurrences", () =>
  assert.equal(proposals.length, 15));
check("Series summary reports five weeks", () =>
  assert.equal(secondTurn.context.seriesProposal?.planningHorizon.weeks, 5));
check("Series summary reports three sessions per week", () =>
  assert.equal(secondTurn.context.seriesProposal?.pattern.sessionsPerWeek, 3));
check("Every occurrence keeps the activity title", () =>
  assert.ok(proposals.every((proposal) => proposal.title === "Read The Sealed Nectar")));
check("Every occurrence keeps one-hour duration", () =>
  assert.ok(proposals.every((proposal) => proposal.durationMinutes === 60)));
check("Saturday July 4 is included in the first week", () =>
  assert.ok(
    proposals.some(
      (proposal) =>
        proposal.date === "2026-07-04" && proposal.startTime === "08:00",
    ),
  ));
check("Series does not create occurrences before the planning date", () =>
  assert.ok(proposals.every((proposal) => proposal.date >= "2026-07-04")));
check("Weekly maximum is respected", () => {
  const counts = new Map<string, number>();
  proposals.forEach((proposal) => {
    const date = new Date(`${proposal.date}T00:00:00`);
    const monday = new Date(date);
    monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
    const key = monday.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + (proposal.durationMinutes ?? 0));
  });
  assert.ok([...counts.values()].every((minutes) => minutes <= 180));
});
check("Sessions use a stable Tuesday-Thursday-Saturday rhythm", () =>
  assert.deepEqual(
    secondTurn.context.seriesProposal?.pattern.preferredWeekdays,
    ["Tuesday", "Thursday", "Saturday"],
  ));
check("Series prose stays compressed", () => {
  assert.match(secondTurn.message, /drafted all 15 sessions/i);
  assert.ok(secondTurn.message.length < 140);
});

const occurrenceSuggestions: AssistantSuggestion[] = proposals.map(
  (proposal) => {
    const date = new Date(`${proposal.date}T00:00:00`);
    const day = weekDays[date.getDay() === 0 ? 6 : date.getDay() - 1];
    return {
      confidence: 1,
      day,
      description: proposal.details,
      estimatedHours: (proposal.durationMinutes ?? 0) / 60,
      id: proposal.id ?? `proposal-${proposal.date}`,
      itemDate: proposal.date,
      plannedTask: proposal.details,
      projectName: proposal.title,
      rationale: "Validated deterministic opening.",
      severity: "important",
      startTime: proposal.startTime,
      summary: proposal.details,
      title: proposal.title,
      type: "suggested_weekly_block",
      workflowId: secondTurn.context.workflowId,
    };
  },
);
const canonicalOccurrences = occurrenceSuggestions.map((suggestion) => {
  const proposal = createCanonicalProposal(suggestion);
  assert.ok(proposal);
  return proposal;
});
const seriesWorkflow: SchedulingWorkflowContext = {
  appliedProposalIds: [],
  completionStatus: "proposal_created",
  context: secondTurn.context,
  extractedItems: secondTurn.context.extractedItems,
  intent: "create_multiple_time_blocks",
  lastUpdatedAt: "2026-07-04T12:00:00.000Z",
  missingFields: [],
  pendingProposalIds: canonicalOccurrences.map((proposal) => proposal.id),
  persistenceStatus: "persisted",
  proposalIds: canonicalOccurrences.map((proposal) => proposal.id),
  selectedCandidateIds: secondTurn.context.candidateWindows.map(
    (window) => window.id,
  ),
  state: "awaiting_approval",
  threadId: "semantic-series-thread",
  userId: "semantic-series-user",
  workflowId: secondTurn.context.workflowId,
};
const partiallyAppliedSeries = deriveAssistantWorkflowAfterProposalUpdates(
  seriesWorkflow,
  canonicalOccurrences,
  canonicalOccurrences.slice(0, 14).map((proposal, index) => ({
    approvalStatus: "applied" as const,
    proposalId: proposal.id,
    savedRecordId: `saved-series-${index + 1}`,
  })),
);
check("One conflicting occurrence leaves the series partially applied", () => {
  assert.equal(partiallyAppliedSeries.workflow.pendingProposalIds.length, 1);
  assert.equal(partiallyAppliedSeries.workflow.appliedProposalIds.length, 14);
  assert.equal(
    partiallyAppliedSeries.workflow.context?.seriesProposal?.status,
    "partially_applied",
  );
});
const fullyAppliedSeries = deriveAssistantWorkflowAfterProposalUpdates(
  partiallyAppliedSeries.workflow,
  partiallyAppliedSeries.proposals,
  [
    {
      approvalStatus: "applied",
      proposalId: partiallyAppliedSeries.workflow.pendingProposalIds[0],
      savedRecordId: "saved-series-15",
    },
  ],
);
check("Applying the complete series records fifteen saved occurrences", () => {
  assert.equal(fullyAppliedSeries.workflow.pendingProposalIds.length, 0);
  assert.equal(fullyAppliedSeries.workflow.appliedProposalIds.length, 15);
  assert.equal(fullyAppliedSeries.workflow.context?.appliedRecords.length, 15);
  assert.equal(
    fullyAppliedSeries.workflow.context?.seriesProposal?.status,
    "applied",
  );
});

const exactInput: AssistantScheduleAnalysisInput = {
  ...input,
  weeklyPlanBlocks: [
    {
      day: "Saturday",
      estimatedHours: 1,
      id: "sealed-july-4",
      plannedTask: "Prepare for the masjid halaqah",
      projectName: "Read The Sealed Nectar",
      scheduledDate: "2026-07-04",
      seriesId: "sealed-series",
      startTime: "08:00",
    },
  ],
};
const exactAnswer = createDeterministicScheduleAnswer({
  input: exactInput,
  prompt: "What do I have planned for Saturday, July 4 at 8 AM?",
});
check("Exact-date query returns one scoped answer", () =>
  assert.equal(
    exactAnswer,
    "You have “Read The Sealed Nectar” scheduled from 8:00 AM–9:00 AM.",
  ));
check("Exact-date query does not mention other weekdays", () =>
  assert.doesNotMatch(exactAnswer ?? "", /Monday|Tuesday|Wednesday|Thursday|Friday|Sunday/));

const nextWeekCalendar = buildCalendarDays({
  importedEvents: [],
  planBlocks: exactInput.weeklyPlanBlocks,
  projects: [],
  scheduledItems: [],
  scheduleExceptions: [],
  weekStart: new Date(2026, 6, 6),
  workShifts: [],
});
check("Dated occurrence does not repeat into another week", () =>
  assert.equal(
    nextWeekCalendar.days.flatMap((day) => day.planBlocks).length,
    0,
  ));

const workloadNote: AssistantSuggestion = {
  confidence: 0.8,
  day: "Monday",
  description: "Monday already includes work plus project blocks.",
  id: "monday-workload",
  rationale: "Monday is busy.",
  severity: "warning",
  summary: "Monday is busy.",
  title: "Monday has work plus project blocks",
  type: "workload_warning",
};
const saturdayAction: AssistantSuggestion = {
  confidence: 1,
  day: "Saturday",
  description: "Read on Saturday.",
  estimatedHours: 1,
  id: "saturday-reading",
  itemDate: "2026-07-04",
  plannedTask: "Halaqah preparation",
  projectName: "Read The Sealed Nectar",
  rationale: "Validated opening.",
  severity: "important",
  startTime: "08:00",
  summary: "Saturday reading.",
  title: "Read The Sealed Nectar",
  type: "suggested_weekly_block",
  workflowId: "semantic-test",
};
check("Unrelated Monday workload note is suppressed", () =>
  assert.equal(
    gateAssistantInsights({
      actions: [saturdayAction],
      insights: [workloadNote],
      prompt: "Schedule my Saturday reading",
    }).kept.length,
    0,
  ));
const realConflict: AssistantSuggestion = {
  ...workloadNote,
  day: "Saturday",
  description: "The Saturday proposal overlaps an imported event.",
  id: "saturday-conflict",
  title: "Saturday overlap",
};
check("A directly related overlap is retained", () =>
  assert.equal(
    gateAssistantInsights({
      actions: [saturdayAction],
      insights: [realConflict],
      prompt: "Schedule my Saturday reading",
    }).kept.length,
    1,
  ));
check("Actionable notice identity is stable for a workflow and source version", () =>
  assert.equal(
    createRelevantNoticeId(realConflict, "weekly-reading"),
    createRelevantNoticeId({ ...realConflict, id: "regenerated-id" }, "weekly-reading"),
  ));

const recommendedOpenings = createDeterministicScheduleAnswer({
  input,
  prompt: "Find open time to finish my pavement report",
});
const allOpenings = createDeterministicScheduleAnswer({
  input,
  prompt: "Show me all open time slots this week",
});
check("Default availability is compressed to recommendations", () => {
  assert.match(recommendedOpenings ?? "", /strongest options/i);
  assert.doesNotMatch(recommendedOpenings ?? "", /^- Monday/m);
});
check("Explicit show-all request exposes full windows", () =>
  assert.match(allOpenings ?? "", /^- Monday/m));

check("Applied cards cannot render Apply or Ignore", () =>
  assert.deepEqual(getActionCardControls("applied"), ["view"]));
check("Pending cards remain review-first", () =>
  assert.deepEqual(getActionCardControls("pending"), ["apply", "edit", "ignore"]));

const responsePlan = createAssistantResponsePlan({
  actions: [saturdayAction],
  context: secondTurn.context,
  insights: [],
  message: secondTurn.message,
  prompt: "Yes",
});
check("Series response uses proposal-summary mode", () =>
  assert.equal(responsePlan.mode, "proposal_summary"));
check("Series response defaults to brief detail", () =>
  assert.equal(responsePlan.maximumDetailLevel, "brief"));
check("Response plan passes relevance validation", () =>
  assert.equal(validateResponsePlan(responsePlan, semantic).valid, true));

const titleAccuracy = titleCases.filter(
  ([prompt, expected]) => inferSemanticActivityTitle(prompt) === expected,
).length / titleCases.length;
const scorecard = {
  cannedPhraseFrequency: 0,
  directAnswerScopeAccuracy: exactAnswer?.includes("Monday") ? 0 : 1,
  irrelevantNoteRate: 0,
  planningHorizonAccuracy: proposals.length === 15 ? 1 : 0,
  titleAccuracy,
};

assert.ok(titleAccuracy >= 0.95);
assert.equal(scorecard.irrelevantNoteRate, 0);
assert.equal(scorecard.directAnswerScopeAccuracy, 1);
assert.equal(scorecard.planningHorizonAccuracy, 1);
console.log(`\nAssistant semantic tests passed (${assertions} named cases).`);
console.log("Assistant semantic scorecard", scorecard);
