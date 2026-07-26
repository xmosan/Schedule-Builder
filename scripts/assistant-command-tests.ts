import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PlanningDecisionRecord } from "../lib/assistant-automation";
import {
  createAssistantActionHistoryMessage,
  formatAssistantActionRecord,
  getAssistantActionSnapshotRecords,
  looksLikeAssistantCommandOrHistoryQuestion,
  normalizeAssistantCommand,
} from "../lib/assistant-command";
import type { SchedulingWorkflowContext } from "../lib/assistant-workflow";

const records = [
  {
    block_id: "block-workout",
    estimated_hours: 1,
    project_name: "Workout",
    scheduled_date: "2026-07-23",
    start_time: "20:00:00",
  },
  {
    block_id: "block-project",
    estimated_hours: 1.5,
    project_name: "Project work session",
    scheduled_date: "2026-07-25",
    start_time: "18:00:00",
  },
  {
    block_id: "block-grocery",
    estimated_hours: 0.75,
    project_name: "Grocery trip",
    scheduled_date: "2026-07-26",
    start_time: "19:00:00",
  },
];

const appliedAction: PlanningDecisionRecord = {
  actionType: "create_time_block_series",
  afterState: { records },
  automationMode: "auto_applied",
  constraintsUsed: [],
  createdAt: "2026-07-22T18:00:00.000Z",
  id: "decision-applied",
  preferencesUsed: [],
  proposalIds: ["proposal-1", "proposal-2", "proposal-3"],
  reasonCodes: [],
  reversibleUntil: "2026-07-23T18:00:00.000Z",
  scheduleExceptionIds: [],
  status: "applied",
  targetRecordIds: records.map((record) => record.block_id),
  userId: "user-1",
  workflowId: "workflow-1",
};

const undoneAction: PlanningDecisionRecord = {
  ...appliedAction,
  reversedAt: "2026-07-22T18:05:00.000Z",
  status: "undone",
};

const workflow: SchedulingWorkflowContext = {
  appliedProposalIds: appliedAction.proposalIds,
  completionStatus: "records_applied",
  context: null,
  extractedItems: [],
  intent: "create_multiple_time_blocks",
  lastUpdatedAt: "2026-07-22T18:00:00.000Z",
  missingFields: [],
  pendingProposalIds: [],
  persistenceStatus: "persisted",
  proposalIds: appliedAction.proposalIds,
  selectedCandidateIds: [],
  state: "applied",
  threadId: "thread-1",
  userId: "user-1",
  workflowId: "workflow-1",
};

const undoPhrases = [
  "undo that",
  "Undo that",
  "UNDO THAT",
  "undo it",
  "undo this",
  "Can you undo it please?",
  "please undo that",
  "remove those",
  "remove them",
  "take those off",
  "take those off my schedule",
  "delete those blocks",
  "delete what you added",
  "cancel that schedule",
  "never mind, remove them",
  "revert that",
  "reverse that",
  "get rid of those blocks",
];

for (const phrase of undoPhrases) {
  assert.equal(
    looksLikeAssistantCommandOrHistoryQuestion(phrase),
    true,
    `${phrase} enters command-history lookup`,
  );
  assert.equal(
    normalizeAssistantCommand({
      activeWorkflow: workflow,
      latestAssistantAction: appliedAction,
      latestReversibleAction: appliedAction,
      message: phrase,
    }),
    "undo_latest_reversible_action",
    `${phrase} normalizes to Undo`,
  );
}

for (const unsafePhrase of [
  "delete all my work shifts",
  "remove my Friday work shift",
  "undo all my work shifts",
]) {
  assert.notEqual(
    normalizeAssistantCommand({
      activeWorkflow: workflow,
      latestAssistantAction: appliedAction,
      latestReversibleAction: appliedAction,
      message: unsafePhrase,
    }),
    "undo_latest_reversible_action",
    `${unsafePhrase} cannot consume a reversible Assistant action`,
  );
}

assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "Remove those",
  }),
  "status_last_undone",
  "A repeated removal command reports the already-undone action",
);
assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "What exactly did you undo?",
  }),
  "status_last_undone",
);
for (const phrase of [
  "What did you remove?",
  "What did you take off?",
  "What did you just delete?",
  "Did you undo it?",
]) {
  assert.equal(
    normalizeAssistantCommand({
      activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
      latestAssistantAction: undoneAction,
      latestReversibleAction: null,
      message: phrase,
    }),
    "status_last_undone",
    `${phrase} reads the undone action history`,
  );
}
assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "What exactly did you schedule?",
  }),
  "status_last_scheduled",
);
assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "Is it still on my schedule?",
  }),
  "status_latest_action",
);
assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "What happened?",
  }),
  "status_latest_action",
);
assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "What did you just change?",
  }),
  "status_latest_action",
);
assert.equal(
  normalizeAssistantCommand({
    activeWorkflow: { ...workflow, appliedProposalIds: [], state: "undone" },
    latestAssistantAction: undoneAction,
    latestReversibleAction: null,
    message: "Thank you",
  }),
  "social_reply",
);

const snapshots = getAssistantActionSnapshotRecords(undoneAction);
assert.equal(snapshots.length, 3);
assert.deepEqual(
  snapshots.map(({ durationMinutes, title }) => [title, durationMinutes]),
  [
    ["Workout", 60],
    ["Project work session", 90],
    ["Grocery trip", 45],
  ],
);
assert.equal(
  formatAssistantActionRecord(snapshots[0]),
  "- Thu, Jul 23 · Workout · 8:00 PM–9:00 PM",
);

const undoneMessage = createAssistantActionHistoryMessage({
  intent: "status_last_undone",
  latestAction: undoneAction,
});
assert.match(undoneMessage, /^I undid these 3 blocks:/);
assert.match(undoneMessage, /Thu, Jul 23 · Workout · 8:00 PM–9:00 PM/);
assert.match(
  undoneMessage,
  /Sat, Jul 25 · Project work session · 6:00 PM–7:30 PM/,
);
assert.match(undoneMessage, /Sun, Jul 26 · Grocery trip · 7:00 PM–7:45 PM/);
assert.doesNotMatch(undoneMessage, /Use that pattern|recommend/i);

const scheduledAfterUndoMessage = createAssistantActionHistoryMessage({
  intent: "status_last_scheduled",
  latestAction: undoneAction,
});
assert.match(
  scheduledAfterUndoMessage,
  /^I had scheduled these 3 blocks, but they were later undone:/,
);

const planRoute = readFileSync(
  new URL("../app/api/assistant/plan/route.ts", import.meta.url),
  "utf8",
);
const undoRoute = readFileSync(
  new URL("../app/api/assistant/undo/route.ts", import.meta.url),
  "utf8",
);
assert.match(planRoute, /loadAssistantActionHistoryForCommand/);
assert.match(planRoute, /normalizeAssistantCommand/);
assert.match(planRoute, /commandIntent === "undo_latest_reversible_action"/);
assert.match(planRoute, /commandIntent === "status_last_undone"/);
assert.match(planRoute, /mode: "status_answer"/);
assert.match(undoRoute, /undo_assistant_decision/);
assert.match(undoRoute, /formatAssistantActionRecord/);
assert.doesNotMatch(undoRoute, /google_calendar|canvas|d2l|ics/i);

console.log("Assistant command tests passed");
