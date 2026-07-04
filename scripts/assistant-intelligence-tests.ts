import assert from "node:assert/strict";
import {
  classifyAssistantIntent,
  createConsolidatedClarification,
  extractPlanningItems,
  isAssistantStatusQuestion,
  isExplicitMutationRequest,
  isExplicitSchedulingRequest,
  matchProjectsForText,
  parseExplicitDurationMinutes,
  parseRequestedSessionCount,
  validateAssistantCompletionLanguage,
} from "../lib/assistant-intelligence";
import {
  advanceAssistantSchedulingConversation,
  createDeterministicScheduleAnswer,
  type AssistantScheduleAnalysisInput,
  type AssistantSchedulingConversationTurn,
} from "../lib/assistant-schedule-analysis";
import type { Project } from "../lib/projects";
import type { AssistantSuggestion } from "../lib/assistant";
import {
  createCanonicalProposal,
  deriveAssistantWorkflowAfterProposalUpdates,
  getCanonicalPendingProposals,
  getProposalBatchStatus,
  validateMutationSuggestion,
  type SchedulingWorkflowContext,
} from "../lib/assistant-workflow";

const input: AssistantScheduleAnalysisInput = {
  importedCalendarEvents: [],
  projects: [],
  scheduleExceptions: [],
  scheduledItems: [],
  timezone: "America/Detroit",
  weekStartDate: "2026-06-29",
  weeklyPlanBlocks: [],
  workShifts: [],
};

let caseCount = 0;
function check(name: string, assertion: () => void) {
  assertion();
  caseCount += 1;
  console.log(`✓ ${name}`);
}

function advance(
  prompt: string,
  previous?: AssistantSchedulingConversationTurn | null,
  scheduleInput = input,
) {
  const turn = advanceAssistantSchedulingConversation({
    activeContext: previous?.context ?? null,
    input: scheduleInput,
    prompt,
  });
  assert.ok(turn, `Expected workflow turn for: ${prompt}`);
  return turn;
}

const sealedPrompt =
  "I need to start preparing for weekly halaqahs at the South Side masjid. Find me some time throughout the week to read The Sealed Nectar.";
const sealedItems = extractPlanningItems(sealedPrompt);
const sealedInitial = advance(sealedPrompt);
const sealedMissingStatus = advance("Is it on the schedule?", sealedInitial);
const sealedStillMissing = advance("Okay, put it on the schedule", sealedInitial);
const sealedReady = advance("Three sessions, 45 minutes each", sealedStillMissing);
const sealedPendingStatus = advance("Is it on the schedule?", sealedReady);
const sealedRecalculated = advance("Recalculate with different times", sealedReady);
const appliedContext = {
  ...sealedReady.context,
  appliedRecords: sealedReady.context.pendingProposals.map((proposal, index) => ({
    date: proposal.date,
    endTime: `${String(Number(proposal.startTime.slice(0, 2))).padStart(2, "0")}:${String(
      Number(proposal.startTime.slice(3, 5)) + 45,
    ).padStart(2, "0")}`,
    id: `saved-${index + 1}`,
    proposalId: proposal.id ?? `proposal-${index + 1}`,
    startTime: proposal.startTime,
    title: proposal.title,
  })),
  state: "applied" as const,
};
const sealedAppliedStatus = advanceAssistantSchedulingConversation({
  activeContext: appliedContext,
  input,
  prompt: "Did you add it?",
});
assert.ok(sealedAppliedStatus);

check("Sealed Nectar extracts one item", () => assert.equal(sealedItems.length, 1));
check("Sealed Nectar keeps a meaningful title", () =>
  assert.equal(sealedItems[0].title, "Read The Sealed Nectar"));
check("Sealed Nectar is religious preparation", () =>
  assert.equal(sealedItems[0].type, "religious_preparation"));
check("Sealed Nectar purpose is preserved", () =>
  assert.match(sealedItems[0].purpose ?? "", /South Side masjid halaqahs/i));
check("Throughout the week is recurring", () =>
  assert.equal(sealedItems[0].frequency?.recurring, true));
check("Recurring extraction reports missing frequency", () =>
  assert.ok(sealedItems[0].missingFields.includes("frequency")));
check("Recurring extraction reports missing duration", () =>
  assert.ok(sealedItems[0].missingFields.includes("duration")));
check("Recurring request asks one consolidated question", () =>
  assert.match(sealedInitial.message, /How many reading sessions.*how long/i));
check("Recurring request enters session-detail state", () =>
  assert.equal(sealedInitial.context.state, "awaiting_session_details"));
check("Status before a proposal starts No", () =>
  assert.match(sealedMissingStatus.message, /^No\./));
check("Put it on schedule preserves missing-detail workflow", () =>
  assert.equal(sealedStillMissing.context.state, "awaiting_session_details"));
check("Put it on schedule never claims completion", () =>
  assert.doesNotMatch(sealedStillMissing.message, /all set|scheduled|added/i));
check("Three sessions preserves frequency", () =>
  assert.equal(sealedReady.context.requestedSessionCount, 3));
check("45 minutes preserves duration", () =>
  assert.equal(sealedReady.context.requestedDurationMinutes, 45));
check("Three reviewable proposals are created", () =>
  assert.equal(sealedReady.context.pendingProposals.length, 3));
check("Recurring proposals remain unapplied", () =>
  assert.equal(sealedReady.context.appliedRecords.length, 0));
check("Recurring proposals use exact timed starts", () =>
  assert.ok(sealedReady.context.pendingProposals.every((proposal) => /^\d{2}:\d{2}$/.test(proposal.startTime))));
check("Recurring proposals preserve duration", () =>
  assert.ok(sealedReady.context.pendingProposals.every((proposal) => proposal.durationMinutes === 45)));
check("Recurring proposals preserve activity title", () =>
  assert.ok(sealedReady.context.pendingProposals.every((proposal) => proposal.title === "Read The Sealed Nectar")));
check("Recurring proposals are distributed across dates", () =>
  assert.equal(new Set(sealedReady.context.pendingProposals.map((proposal) => proposal.date)).size, 3));
check("Recalculate returns a fresh reviewable batch", () => {
  assert.equal(sealedRecalculated.context.pendingProposals.length, 3);
  assert.notDeepEqual(
    sealedRecalculated.context.pendingProposals.map((proposal) => `${proposal.date}-${proposal.startTime}`),
    sealedReady.context.pendingProposals.map((proposal) => `${proposal.date}-${proposal.startTime}`),
  );
});
check("Pending status starts Not yet", () => assert.match(sealedPendingStatus.message, /^Not yet\./));
check("Applied status starts Yes", () => assert.match(sealedAppliedStatus.message, /^Yes\./));
check("Applied status lists saved records", () => assert.match(sealedAppliedStatus.message, /saved-|Read The Sealed Nectar|2026-/));

const liveProductionPrompt =
  "Give me some slots to work on the halaqah for the masjid. I need to find time to read The Sealed Nectar.";
const liveInitial = advance(liveProductionPrompt);
const liveContinued = advance("Put it on the schedule.", liveInitial);
const liveReady = advance("Three sessions, 45 minutes.", liveContinued);
check("Exact production wording starts a workflow", () =>
  assert.equal(isExplicitSchedulingRequest(liveProductionPrompt), true));
check("Exact production wording preserves Sealed Nectar", () =>
  assert.equal(liveInitial.context.extractedItems[0]?.title, "Read The Sealed Nectar"));
check("Exact production wording preserves halaqah purpose", () =>
  assert.equal(liveInitial.context.extractedItems[0]?.purpose, "Prepare for the masjid halaqah"));
check("Plural slots creates a multi-session workflow", () =>
  assert.equal(liveInitial.context.intent, "create_multiple_time_blocks"));
check("Exact production wording asks frequency and duration", () =>
  assert.equal(
    liveInitial.message,
    "How many reading sessions would you like this week, and how long should each session be?",
  ));
check("Put it on schedule keeps the exact activity", () =>
  assert.equal(liveContinued.context.extractedItems[0]?.title, "Read The Sealed Nectar"));
check("Exact production flow creates three actions", () =>
  assert.equal(liveReady.context.pendingProposals.length, 3));

const countOnly = advance("Three times", liveInitial);
const durationAfterCount = advance("45 minutes", countOnly);
check("Three times fills frequency without inventing duration", () => {
  assert.equal(countOnly.context.requestedSessionCount, 3);
  assert.equal(countOnly.context.requestedDurationMinutes, null);
});
check("45 minutes completes the active workflow", () => {
  assert.equal(durationAfterCount.context.requestedSessionCount, 3);
  assert.equal(durationAfterCount.context.requestedDurationMinutes, 45);
  assert.equal(durationAfterCount.context.pendingProposals.length, 3);
});

const workflowId = liveReady.context.workflowId;
const workflowSuggestions: AssistantSuggestion[] = liveReady.context.pendingProposals.map(
  (proposal) => {
    const day = liveReady.context.candidateWindows.find(
      (window) => window.date === proposal.date,
    )?.day;
    assert.ok(day);
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
      workflowId,
    };
  },
);
const canonicalProposals = workflowSuggestions.map((suggestion) =>
  createCanonicalProposal(suggestion, "2026-07-04T12:00:00.000Z"),
);
check("All three time-block actions pass strict proposal validation", () =>
  assert.ok(canonicalProposals.every(Boolean)));
check("Canonical proposals include exact date, time, and duration", () =>
  assert.ok(
    canonicalProposals.every(
      (proposal) =>
        proposal?.timeBlock?.date &&
        /^\d{2}:\d{2}$/.test(proposal.timeBlock.startTime) &&
        proposal.timeBlock.durationMinutes === 45,
    ),
  ));
const canonicalWorkflow: SchedulingWorkflowContext = {
  appliedProposalIds: [],
  completionStatus: "proposal_created",
  context: liveReady.context,
  extractedItems: liveReady.context.extractedItems,
  intent: "create_multiple_time_blocks",
  lastUpdatedAt: "2026-07-04T12:00:00.000Z",
  missingFields: [],
  pendingProposalIds: workflowSuggestions.map((suggestion) => suggestion.id),
  persistenceStatus: "persisted",
  proposalIds: workflowSuggestions.map((suggestion) => suggestion.id),
  selectedCandidateIds: liveReady.context.candidateWindows.map((window) => window.id),
  state: "awaiting_approval",
  threadId: "thread-regression",
  userId: "user-regression",
  workflowId,
};
check("Canonical pending count equals persisted workflow count", () =>
  assert.equal(
    getCanonicalPendingProposals(
      canonicalWorkflow,
      canonicalProposals.filter((proposal) => proposal !== null),
    ).length,
    canonicalWorkflow.pendingProposalIds.length,
  ));
check("A proposal from another workflow cannot enter the review queue", () => {
  const foreign = canonicalProposals[0];
  assert.ok(foreign);
  assert.equal(
    getCanonicalPendingProposals(canonicalWorkflow, [
      { ...foreign, workflowId: "foreign-workflow" },
    ]).length,
    0,
  );
});
const observation = {
  confidence: 1,
  description: "Monday has work plus project blocks.",
  id: "observation",
  rationale: "Informational only.",
  severity: "warning",
  summary: "Monday is busy.",
  title: "Monday has work plus project blocks",
  type: "workload_warning",
  workflowId,
} satisfies AssistantSuggestion;
check("Analysis notes cannot enter the proposal schema", () =>
  assert.match(validateMutationSuggestion(observation), /cannot be persisted/i));
check("Analysis notes cannot become canonical proposals", () =>
  assert.equal(createCanonicalProposal(observation), null));
check("An untimed block cannot enter the proposal schema", () => {
  const untimed = { ...workflowSuggestions[0], startTime: undefined };
  assert.match(validateMutationSuggestion(untimed), /start time/i);
});
const persistedProposals = canonicalProposals.filter(
  (proposal) => proposal !== null,
);
const partiallyApplied = deriveAssistantWorkflowAfterProposalUpdates(
  canonicalWorkflow,
  persistedProposals,
  persistedProposals.slice(0, 2).map((proposal, index) => ({
    approvalStatus: "applied" as const,
    proposalId: proposal.id,
    savedRecordId: `saved-reading-${index + 1}`,
  })),
  "2026-07-04T13:00:00.000Z",
);
check("Partial apply leaves one canonical proposal pending", () => {
  assert.equal(partiallyApplied.workflow.appliedProposalIds.length, 2);
  assert.equal(partiallyApplied.workflow.pendingProposalIds.length, 1);
  assert.equal(getProposalBatchStatus(partiallyApplied.workflow), "partially_applied");
});
const fullyApplied = deriveAssistantWorkflowAfterProposalUpdates(
  partiallyApplied.workflow,
  partiallyApplied.proposals,
  [
    {
      approvalStatus: "applied",
      proposalId: partiallyApplied.workflow.pendingProposalIds[0],
      savedRecordId: "saved-reading-3",
    },
  ],
  "2026-07-04T14:00:00.000Z",
);
check("Apply all produces authoritative applied state", () => {
  assert.equal(fullyApplied.workflow.pendingProposalIds.length, 0);
  assert.equal(fullyApplied.workflow.appliedProposalIds.length, 3);
  assert.equal(fullyApplied.workflow.context?.appliedRecords.length, 3);
  assert.equal(fullyApplied.workflow.completionStatus, "records_applied");
  assert.equal(fullyApplied.workflow.state, "applied");
  assert.equal(getProposalBatchStatus(fullyApplied.workflow), "applied");
});
const allRejected = deriveAssistantWorkflowAfterProposalUpdates(
  canonicalWorkflow,
  persistedProposals,
  persistedProposals.map((proposal) => ({
    approvalStatus: "rejected" as const,
    proposalId: proposal.id,
  })),
  "2026-07-04T15:00:00.000Z",
);
check("Rejecting every proposal clears the canonical review queue", () => {
  assert.equal(allRejected.workflow.pendingProposalIds.length, 0);
  assert.equal(allRejected.workflow.completionStatus, "nothing_created");
  assert.equal(allRejected.workflow.state, "idle");
  assert.equal(getProposalBatchStatus(allRejected.workflow), "rejected");
});

const partialStatus = advanceAssistantSchedulingConversation({
  activeContext: {
    ...sealedReady.context,
    appliedRecords: [appliedContext.appliedRecords[0]],
  },
  input,
  prompt: "Was that saved?",
});
assert.ok(partialStatus);
check("Partial batch status starts Partly", () => assert.match(partialStatus.message, /^Partly\./));

check("Status phrasing is recognized", () => assert.equal(isAssistantStatusQuestion("Is it on the schedule?"), true));
check("Session-created status phrasing is recognized", () =>
  assert.equal(isAssistantStatusQuestion("Did those sessions get created?"), true));
check("Activity-specific status phrasing is recognized", () =>
  assert.equal(isAssistantStatusQuestion("Is the reading scheduled?"), true));
check("Put it on schedule is explicit mutation", () => assert.equal(isExplicitMutationRequest("Put it on the schedule"), true));
check("Add it to my week is explicit mutation", () => assert.equal(isExplicitMutationRequest("Add it to my week"), true));
check("Recurring explicit request gets batch intent", () =>
  assert.equal(classifyAssistantIntent("Schedule it throughout the week", sealedItems), "create_multiple_time_blocks"));
check("Three-times parser returns three", () => assert.equal(parseRequestedSessionCount("three times this week"), 3));
check("Every-weekday parser returns five", () => assert.equal(parseRequestedSessionCount("every weekday"), 5));
check("Workout count parser returns two", () => assert.equal(parseRequestedSessionCount("two workouts"), 2));
check("Duration parser does not invent a duration", () => assert.equal(parseExplicitDurationMinutes("schedule reading"), null));
check("Duration parser preserves 45 minutes", () => assert.equal(parseExplicitDurationMinutes("45 minutes each"), 45));

check("Truth guard blocks all-set with nothing created", () => {
  const result = validateAssistantCompletionLanguage("You're all set.", "nothing_created");
  assert.equal(result.mismatch, true);
  assert.match(result.responseText, /not been scheduled/i);
});
check("Truth guard blocks scheduled before apply", () =>
  assert.equal(validateAssistantCompletionLanguage("It's scheduled.", "proposal_created").mismatch, true));
check("Truth guard permits proposal language", () =>
  assert.equal(validateAssistantCompletionLanguage("I drafted three sessions. Nothing has been added yet.", "proposal_created").mismatch, false));
check("Truth guard permits server-backed success", () =>
  assert.equal(validateAssistantCompletionLanguage("Added three reading sessions.", "records_applied").mismatch, false));

const projects: Project[] = [
  {
    category: "Growth",
    completed: false,
    deadline: "",
    id: 1,
    name: "Muslim Student Association",
    nextAction: "Finalize MSA individual board meeting plan",
    priority: "High",
    weeklyHours: 3,
  },
  {
    category: "Maintenance",
    completed: false,
    deadline: "",
    id: 2,
    name: "Vendor follow-up",
    nextAction: "Email MSA event vendor",
    priority: "Medium",
    weeklyHours: 1,
  },
];
check("Project matcher searches next actions", () =>
  assert.equal(matchProjectsForText(projects, "board meetings")[0]?.project.id, 1));
check("Project matcher ranks clear MSA match", () =>
  assert.ok((matchProjectsForText(projects, "MSA board meeting")[0]?.confidence ?? 0) >= 0.7));

const multiPrompt =
  "I have an assignment due Thursday, a work report due Friday, MSA preparation, groceries, and two workouts. Plan them around my week.";
const multiItems = extractPlanningItems(multiPrompt, projects);
check("Multi-item request extracts all five items", () => assert.equal(multiItems.length, 5));
check("Multi-item request extracts assignment", () => assert.ok(multiItems.some((item) => item.type === "assignment")));
check("Multi-item request extracts work report", () => assert.ok(multiItems.some((item) => item.title === "Work report")));
check("Multi-item request extracts MSA preparation", () => assert.ok(multiItems.some((item) => item.title === "MSA preparation")));
check("Multi-item request extracts groceries", () => assert.ok(multiItems.some((item) => item.type === "errand")));
check("Multi-item request preserves two workouts", () =>
  assert.equal(multiItems.find((item) => item.type === "workout")?.frequency?.count, 2));
check("Multi-item clarification is consolidated", () =>
  assert.match(createConsolidatedClarification(multiItems) ?? "", /^I need \d+ details:/));

const multiInitial = advance(multiPrompt, null, { ...input, projects });
const multiReady = advance(
  "2 hours, 90 minutes, 1 hour, 30 minutes, and 45 minutes",
  multiInitial,
  { ...input, projects },
);
check("Multi-item workflow persists interpreted items", () =>
  assert.equal(multiInitial.context.extractedItems.length, 5));
check("Multi-item workflow asks one clarification turn", () =>
  assert.equal(multiInitial.context.state, "awaiting_session_details"));
check("Multi-item follow-up creates assignment, report, MSA, groceries, and workouts", () =>
  assert.equal(multiReady.context.pendingProposals.length, 6));
check("Multi-item proposals do not overlap", () => {
  const keys = multiReady.context.pendingProposals.map(
    (proposal) => `${proposal.date}-${proposal.startTime}`,
  );
  assert.equal(new Set(keys).size, keys.length);
});

const pastedItems = extractPlanningItems(
  "Tasks from email:\n- Finish assignment due Thursday\n- Buy groceries\n- Read The Sealed Nectar throughout the week",
);
check("Pasted task list extracts three planning items", () => assert.equal(pastedItems.length, 3));
check("Pasted external suggestions remain item details", () =>
  assert.ok(pastedItems.every((item) => typeof item.details === "string" && item.details.length > 0)));

const beforeFriday = createDeterministicScheduleAnswer({
  input,
  prompt: "Find open time before Friday",
});
check("Before Friday excludes Friday", () => assert.doesNotMatch(beforeFriday ?? "", /Friday:/i));

const clearConflict = createDeterministicScheduleAnswer({
  input,
  prompt: "Are there conflicts Monday after 5?",
});
check("Conflict polarity says No when clear", () => assert.match(clearConflict ?? "", /^No\b/));
check("Displayed open-window count matches lines", () => {
  const answer = createDeterministicScheduleAnswer({ input, prompt: "Find open time Monday through Wednesday" }) ?? "";
  const count = Number(answer.match(/I found (\d+) useful/)?.[1] ?? 0);
  const lines = answer.split("\n").filter((line) => /^- /.test(line)).length;
  assert.equal(count, lines);
});

assert.ok(caseCount >= 42, `Expected at least 42 regression cases, got ${caseCount}`);
console.log(`\nAssistant intelligence tests passed (${caseCount} named regression cases).`);
