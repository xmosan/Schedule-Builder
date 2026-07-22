import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createApplyResponsePlan,
  createApplyWorkflowResult,
  getAppliedPlanTitle,
  getAssistantProposalRecordId,
  normalizeApplyWorkflowResult,
  validateApplyResponseText,
  validateApplyWorkflowResult,
  type AppliedWorkflowRecord,
  type ApplyWorkflowResult,
} from "../lib/assistant-apply-result";

const workflowId = "workflow-fe-civil-authoritative-result";
const batchId = "batch-fe-civil-authoritative-result";
const proposalIds = [
  `${workflowId}-proposal-1`,
  `${workflowId}-proposal-2`,
  `${workflowId}-proposal-3`,
];

function addMinutes(startTime: string, durationMinutes: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function createRecord({
  date,
  durationMinutes,
  proposalId,
  startTime,
  title,
}: {
  date: string;
  durationMinutes: number;
  proposalId: string;
  startTime: string;
  title: string;
}): AppliedWorkflowRecord {
  const endTime = addMinutes(startTime, durationMinutes);
  return {
    date,
    durationMinutes,
    endsAt: `${date}T${endTime}:00`,
    endTime,
    proposalId,
    recordId: getAssistantProposalRecordId(proposalId),
    recordType: "weekly_plan_block",
    startsAt: `${date}T${startTime}:00`,
    startTime,
    title,
    version: `version-${proposalId}`,
  };
}

const feCivilRecords = [
  createRecord({
    date: "2026-07-20",
    durationMinutes: 90,
    proposalId: proposalIds[0],
    startTime: "18:00",
    title: "FE Civil Study",
  }),
  createRecord({
    date: "2026-07-22",
    durationMinutes: 90,
    proposalId: proposalIds[1],
    startTime: "18:00",
    title: "FE Civil Study",
  }),
  createRecord({
    date: "2026-07-25",
    durationMinutes: 60,
    proposalId: proposalIds[2],
    startTime: "14:00",
    title: "FE Civil Review",
  }),
];

const fullSuccess = createApplyWorkflowResult({
  actionReceiptId: "receipt-fe-civil",
  applied: feCivilRecords,
  attemptedAt: "2026-07-20T15:00:00.000Z",
  automationGrantId: "grant-fe-civil",
  automationMode: "auto_apply",
  planningDecisionId: "decision-fe-civil",
  proposalBatchId: batchId,
  requestedProposalIds: proposalIds,
  undoAvailable: true,
  workflowId,
});

assert.equal(fullSuccess.outcome, "applied");
assert.equal(fullSuccess.authoritativeStatus, "applied");
assert.equal(fullSuccess.nothingChanged, false);
assert.deepEqual(
  fullSuccess.applied.map((record) => record.title),
  ["FE Civil Study", "FE Civil Study", "FE Civil Review"],
  "The applied receipt preserves Study, Study, and Review as distinct titles",
);
assert.deepEqual(
  fullSuccess.applied.map((record) => record.durationMinutes),
  [90, 90, 60],
  "The authoritative result preserves mixed durations",
);
assert.equal(
  getAppliedPlanTitle(fullSuccess.applied),
  "FE Civil Study and Review Plan",
  "The parent title includes both Study and Review",
);

const fullSuccessPlan = createApplyResponsePlan({
  activityTitle: "FE Civil",
  result: fullSuccess,
});
assert.equal(fullSuccessPlan.mode, "applied");
assert.equal(fullSuccessPlan.exactAppliedRecords.length, 3);
assert.equal(fullSuccessPlan.maySayApplied, true);
assert.equal(fullSuccessPlan.maySayNothingChanged, false);
assert.equal(fullSuccessPlan.maySayReadyForReview, false);
assert.equal(fullSuccessPlan.undoAvailable, true);
assert.match(fullSuccessPlan.primaryMessage, /^Yes\. 3 FE Civil sessions were added:/);
assert.match(
  fullSuccessPlan.primaryMessage,
  /Mon · FE Civil Study · 6:00 PM–7:30 PM/,
);
assert.match(
  fullSuccessPlan.primaryMessage,
  /Wed · FE Civil Study · 6:00 PM–7:30 PM/,
);
assert.match(
  fullSuccessPlan.primaryMessage,
  /Sat · FE Civil Review · 2:00 PM–3:00 PM/,
);
assert.equal(
  validateApplyResponseText(fullSuccessPlan.primaryMessage, fullSuccess).valid,
  true,
);

const personalBlockRecords = [
  createRecord({
    date: "2026-07-07",
    durationMinutes: 90,
    proposalId: "personal-project-work",
    startTime: "18:00",
    title: "Project work session",
  }),
  createRecord({
    date: "2026-07-09",
    durationMinutes: 60,
    proposalId: "personal-workout",
    startTime: "18:00",
    title: "Workout",
  }),
  createRecord({
    date: "2026-07-12",
    durationMinutes: 45,
    proposalId: "personal-grocery-trip",
    startTime: "18:00",
    title: "Grocery trip",
  }),
];
const personalBlocksSuccess = createApplyWorkflowResult({
  actionReceiptId: "receipt-personal-blocks",
  applied: personalBlockRecords,
  attemptedAt: "2026-07-07T16:00:00.000Z",
  automationGrantId: "grant-personal-blocks",
  automationMode: "auto_apply",
  planningDecisionId: "decision-personal-blocks",
  requestedProposalIds: personalBlockRecords.map(
    (record) => record.proposalId,
  ),
  undoAvailable: true,
  workflowId: "workflow-personal-blocks",
});
const personalBlocksPlan = createApplyResponsePlan({
  activityTitle: "Personal Blocks",
  result: personalBlocksSuccess,
});
assert.match(
  personalBlocksPlan.primaryMessage,
  /^Yes\. 3 personal blocks were added:/,
);
assert.match(
  personalBlocksPlan.primaryMessage,
  /Tue · Project work session · 6:00 PM–7:30 PM/,
);
assert.match(
  personalBlocksPlan.primaryMessage,
  /Thu · Workout · 6:00 PM–7:00 PM/,
);
assert.match(
  personalBlocksPlan.primaryMessage,
  /Sun · Grocery trip · 6:00 PM–6:45 PM/,
);

const grantFailure = createApplyWorkflowResult({
  attemptedAt: "2026-07-20T15:00:00.000Z",
  authoritativeStatus: "ready_for_review",
  automationGrantId: "grant-fe-civil",
  automationMode: "auto_apply",
  outcome: "review_required",
  pendingProposalIds: proposalIds,
  proposalBatchId: batchId,
  requestedProposalIds: proposalIds,
  undoAvailable: false,
  undoUnavailableReason: "No automatic schedule change was authorized or applied.",
  warningCode: "automation_grant_persistence_failed",
  workflowId,
});
const grantFailurePlan = createApplyResponsePlan({
  activityTitle: "FE Civil",
  result: grantFailure,
});
assert.equal(grantFailure.applied.length, 0);
assert.equal(grantFailure.nothingChanged, true);
assert.equal(grantFailure.authoritativeStatus, "ready_for_review");
assert.equal(grantFailurePlan.mode, "review_required");
assert.equal(grantFailurePlan.maySayApplied, false);
assert.equal(grantFailurePlan.maySayNothingChanged, true);
assert.equal(grantFailurePlan.maySayReadyForReview, true);
assert.equal(grantFailurePlan.pendingCount, 3);
assert.equal(grantFailurePlan.undoAvailable, false);
assert.match(grantFailurePlan.primaryMessage, /Nothing changed\./);
assert.match(grantFailurePlan.primaryMessage, /3 sessions are ready for review\./);
assert.equal(
  validateApplyResponseText(grantFailurePlan.primaryMessage, grantFailure).valid,
  true,
);

const contradictorySuccessText =
  "Nothing was applied. FE Civil Study added. 3 changes applied.";
assert.deepEqual(
  validateApplyResponseText(contradictorySuccessText, fullSuccess).problems,
  ["nothing_changed_after_write"],
  "Applied records forbid nothing-changed language",
);
assert.ok(
  validateApplyResponseText(contradictorySuccessText, grantFailure).problems.includes(
    "applied_language_without_records",
  ),
  "A review-only result forbids applied-card language",
);
assert.deepEqual(
  validateApplyResponseText(
    "The plan is waiting for review.",
    fullSuccess,
  ).problems,
  ["review_language_after_full_apply"],
);

const partialResult = createApplyWorkflowResult({
  applied: feCivilRecords.slice(0, 2),
  attemptedAt: "2026-07-20T15:00:00.000Z",
  automationGrantId: "grant-fe-civil",
  automationMode: "auto_apply",
  failed: [
    {
      code: "time_became_unavailable",
      proposalId: proposalIds[2],
      safeMessage: "The Saturday review time became unavailable.",
    },
  ],
  planningDecisionId: "decision-fe-civil-partial",
  proposalBatchId: batchId,
  requestedProposalIds: proposalIds,
  undoAvailable: true,
  workflowId,
});
const partialPlan = createApplyResponsePlan({
  activityTitle: "FE Civil",
  result: partialResult,
});
assert.equal(partialResult.outcome, "partially_applied");
assert.equal(partialResult.authoritativeStatus, "partially_applied");
assert.equal(partialResult.nothingChanged, false);
assert.equal(partialPlan.mode, "partially_applied");
assert.equal(partialPlan.exactAppliedRecords.length, 2);
assert.equal(partialPlan.maySayApplied, true);
assert.equal(partialPlan.maySayNothingChanged, false);
assert.match(
  partialPlan.primaryMessage,
  /^Partly\. 2 sessions were added\. 1 could not be applied\./,
);
assert.doesNotMatch(partialPlan.primaryMessage, /3 changes applied|all changes applied/i);
assert.equal(validateApplyResponseText(partialPlan.primaryMessage, partialResult).valid, true);

const receiptWarning = createApplyWorkflowResult({
  applied: feCivilRecords,
  attemptedAt: "2026-07-20T15:00:00.000Z",
  automationGrantId: "grant-fe-civil",
  automationMode: "auto_apply",
  planningDecisionId: "decision-fe-civil-warning",
  proposalBatchId: batchId,
  requestedProposalIds: proposalIds,
  undoAvailable: true,
  warningCode: "receipt_persistence_failed",
  workflowId,
});
const warningPlan = createApplyResponsePlan({
  activityTitle: "FE Civil",
  result: receiptWarning,
});
assert.equal(receiptWarning.authoritativeStatus, "applied_with_warning");
assert.equal(receiptWarning.nothingChanged, false);
assert.equal(warningPlan.mode, "applied_with_warning");
assert.equal(warningPlan.undoAvailable, true);
assert.match(warningPlan.primaryMessage, /couldn’t create the usual automation receipt/);
assert.match(warningPlan.primaryMessage, /sessions are on your Weekly Plan/);
assert.doesNotMatch(warningPlan.primaryMessage, /nothing (?:was )?(?:applied|changed)/i);
assert.equal(validateApplyResponseText(warningPlan.primaryMessage, receiptWarning).valid, true);

assert.equal(
  getAssistantProposalRecordId(proposalIds[0]),
  getAssistantProposalRecordId(proposalIds[0]),
  "Retrying the same proposal produces the same record ID",
);
assert.notEqual(
  getAssistantProposalRecordId(proposalIds[0]),
  getAssistantProposalRecordId(proposalIds[1]),
  "Different proposals do not share a record ID",
);
const reorderedAttempt = createApplyWorkflowResult({
  applied: feCivilRecords,
  attemptedAt: "2026-07-20T15:05:00.000Z",
  automationMode: "auto_apply",
  planningDecisionId: "decision-fe-civil-retry",
  requestedProposalIds: [...proposalIds].reverse(),
  undoAvailable: true,
  workflowId,
});
assert.equal(
  reorderedAttempt.idempotencyKey,
  fullSuccess.idempotencyKey,
  "The apply-attempt key is independent of proposal ordering",
);

assert.throws(
  () =>
    createApplyWorkflowResult({
      authoritativeStatus: "applied",
      automationMode: "auto_apply",
      pendingProposalIds: proposalIds,
      requestedProposalIds: proposalIds,
      workflowId,
    }),
  /applied_status_without_complete_success/,
);
assert.throws(
  () =>
    createApplyWorkflowResult({
      automationMode: "auto_apply",
      pendingProposalIds: proposalIds,
      requestedProposalIds: proposalIds,
      undoAvailable: true,
      workflowId,
    }),
  /undo_without_planning_decision/,
);
const invalidContradiction: ApplyWorkflowResult = {
  ...fullSuccess,
  nothingChanged: true,
};
assert.ok(
  validateApplyWorkflowResult(invalidContradiction).includes(
    "applied_records_with_nothing_changed",
  ),
);
assert.equal(normalizeApplyWorkflowResult(invalidContradiction), null);

const applyRoute = readFileSync(
  new URL("../app/api/assistant/apply/route.ts", import.meta.url),
  "utf8",
);
const planRoute = readFileSync(
  new URL("../app/api/assistant/plan/route.ts", import.meta.url),
  "utf8",
);
assert.match(applyRoute, /return getAssistantProposalRecordId\(suggestionId\)/);
assert.match(applyRoute, /existingProposalBlock/);
assert.doesNotMatch(
  applyRoute,
  /randomUUID\(\)/,
  "Weekly Plan record identity must be stable across retries",
);
assert.match(applyRoute, /createApplyWorkflowResult/);
assert.match(applyRoute, /createApplyResponsePlan/);
assert.match(applyRoute, /applyResult,/);
assert.match(applyRoute, /applyResponsePlan,/);
assert.match(planRoute, /warningCode: "automation_grant_persistence_failed"/);
assert.match(planRoute, /authoritativeStatus: "ready_for_review"/);
assert.match(planRoute, /workflowStatus: "ready_for_review"/);
assert.doesNotMatch(
  planRoute,
  /I built the plan, but I couldn’t record the automation permission safely\. Nothing was applied/,
  "The legacy contradictory grant-failure copy is no longer a separate truth source",
);

console.log("Assistant authoritative apply-result tests passed");
