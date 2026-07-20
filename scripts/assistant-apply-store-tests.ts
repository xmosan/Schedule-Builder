import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createApplyWorkflowResult,
  validateApplyWorkflowResult,
  type AppliedWorkflowRecord,
} from "../lib/assistant-apply-result";
import {
  claimAuthoritativeApplyAttempt,
  persistAuthoritativeApplyResult,
  reconcileAuthoritativeApplyResult,
} from "../lib/assistant-apply-store";

const timestamp = "2026-07-20T17:00:00.000Z";

function savedRecord({
  blockId,
  date,
  durationMinutes,
  startTime,
  title,
  updatedAt = timestamp,
}: {
  blockId: string;
  date: string;
  durationMinutes: number;
  startTime: string;
  title: string;
  updatedAt?: string;
}) {
  return {
    blockId,
    estimatedHours: durationMinutes / 60,
    plannedTask: title,
    projectName: title,
    scheduledDate: date,
    seriesId: null,
    startTime,
    updatedAt,
  };
}

function mappedRecord({
  blockId,
  date,
  durationMinutes,
  endTime,
  proposalId,
  recordExists = true,
  recordMatchesVersion = true,
  saved,
  startTime,
  title,
}: {
  blockId: string;
  date: string;
  durationMinutes: number;
  endTime: string;
  proposalId: string;
  recordExists?: boolean;
  recordMatchesVersion?: boolean;
  saved: ReturnType<typeof savedRecord> | null;
  startTime: string;
  title: string;
}) {
  return {
    date,
    durationMinutes,
    endsAt: `${date}T${endTime}:00.000Z`,
    endTime,
    proposalId,
    recordExists,
    recordId: blockId,
    recordMatchesVersion,
    recordType: "weekly_plan_block",
    savedRecord: saved,
    startsAt: `${date}T${startTime}:00.000Z`,
    startTime,
    status: "active",
    title,
    version: timestamp,
  };
}

function baseResult() {
  return {
    actionReceiptId: "receipt-1",
    appliedProposalIds: ["p1", "p2", "p3"],
    attemptedAt: timestamp,
    attemptId: "attempt-1",
    authoritativeStatus: "applied",
    automationGrantId: "grant-1",
    automationMode: "auto_apply",
    decisionAutomationMode: "auto_applied",
    decisionStatus: "applied",
    decisionTargetRecordIds: ["b1", "b2", "b3"],
    evaluatedAt: timestamp,
    externallySyncedRecordCount: 0,
    failed: [],
    finalizedAt: timestamp,
    idempotencyKey: "apply:wf-1:p1,p2,p3",
    integrityStatus: "consistent",
    liveRecordCount: 3,
    mappedRecordCount: 3,
    nothingChanged: false,
    originalAppliedProposalIds: ["p1", "p2", "p3"],
    outcome: "applied",
    pendingProposalIds: [],
    planningDecisionId: "decision-1",
    proposalBatchId: "batch-1",
    recordedUndoAvailable: true,
    requestedProposalIds: ["p1", "p2", "p3"],
    reversibleUntil: "2026-07-21T17:00:00.000Z",
    targetMappingMatches: true,
    undoAvailable: true,
    updatedAt: timestamp,
    userId: "user-1",
    versionMatchCount: 3,
    warningCode: null,
    workflowId: "wf-1",
  };
}

const changedSavedRecord = savedRecord({
  blockId: "b2",
  date: "2026-07-22",
  durationMinutes: 60,
  startTime: "19:00:00",
  title: "FE Civil Review",
  updatedAt: "2026-07-20T18:00:00.000Z",
});
const partial = reconcileAuthoritativeApplyResult(
  {
    ...baseResult(),
    applied: [
      mappedRecord({
        blockId: "b1",
        date: "2026-07-21",
        durationMinutes: 90,
        endTime: "19:30",
        proposalId: "p1",
        saved: savedRecord({
          blockId: "b1",
          date: "2026-07-21",
          durationMinutes: 90,
          startTime: "18:00:00",
          title: "FE Civil Study",
        }),
        startTime: "18:00",
        title: "FE Civil Study",
      }),
      mappedRecord({
        blockId: "b2",
        date: "2026-07-21",
        durationMinutes: 90,
        endTime: "20:30",
        proposalId: "p2",
        recordMatchesVersion: false,
        saved: changedSavedRecord,
        startTime: "19:00",
        title: "Stale title",
      }),
    ],
    authoritativeStatus: "applied",
    failed: [
      {
        code: "saved_record_missing",
        proposalId: "p3",
        safeMessage: "The saved Weekly Plan record no longer exists.",
      },
    ],
    failedProposalIds: ["p3"],
    integrityStatus: "missing_saved_records",
    liveRecordCount: 2,
    outcome: "applied",
    undoAvailable: false,
    undoUnavailableReason: "A saved record is missing.",
    versionMatchCount: 1,
    warningCode: "saved_records_missing",
  },
  "user-1",
);
assert.ok(partial);
assert.equal(partial.result.authoritativeStatus, "partially_applied");
assert.equal(partial.result.outcome, "partially_applied");
assert.equal(partial.result.nothingChanged, false);
assert.deepEqual(
  partial.result.applied.map((record) => record.proposalId),
  ["p1", "p2"],
);
assert.equal(partial.result.applied[1].title, "FE Civil Review");
assert.equal(partial.result.applied[1].date, "2026-07-22");
assert.equal(partial.result.applied[1].startTime, "19:00");
assert.equal(partial.result.applied[1].endTime, "20:00");
assert.equal(partial.result.applied[1].durationMinutes, 60);
assert.deepEqual(partial.result.failed.map((failure) => failure.proposalId), ["p3"]);
assert.equal(partial.result.undoAvailable, false);
assert.deepEqual(validateApplyWorkflowResult(partial.result), []);

const allMissing = reconcileAuthoritativeApplyResult(
  {
    ...baseResult(),
    applied: [
      mappedRecord({
        blockId: "b1",
        date: "2026-07-21",
        durationMinutes: 90,
        endTime: "19:30",
        proposalId: "p1",
        recordExists: false,
        saved: null,
        startTime: "18:00",
        title: "FE Civil Study",
      }),
      mappedRecord({
        blockId: "b2",
        date: "2026-07-22",
        durationMinutes: 90,
        endTime: "19:30",
        proposalId: "p2",
        recordExists: false,
        saved: null,
        startTime: "18:00",
        title: "FE Civil Study",
      }),
      mappedRecord({
        blockId: "b3",
        date: "2026-07-23",
        durationMinutes: 60,
        endTime: "19:00",
        proposalId: "p3",
        recordExists: false,
        saved: null,
        startTime: "18:00",
        title: "FE Civil Review",
      }),
    ],
    integrityStatus: "missing_saved_records",
    liveRecordCount: 0,
    undoAvailable: false,
    versionMatchCount: 0,
  },
  "user-1",
);
assert.ok(allMissing);
assert.equal(allMissing.result.applied.length, 0);
assert.equal(allMissing.result.failed.length, 3);
assert.equal(allMissing.result.authoritativeStatus, "failed");
assert.equal(allMissing.result.outcome, "failed_after_write");
assert.equal(allMissing.result.nothingChanged, true);
assert.equal(allMissing.result.undoAvailable, false);
assert.deepEqual(validateApplyWorkflowResult(allMissing.result), []);

const changedOnly = reconcileAuthoritativeApplyResult(
  {
    ...baseResult(),
    applied: [
      mappedRecord({
        blockId: "b1",
        date: "2026-07-21",
        durationMinutes: 90,
        endTime: "19:30",
        proposalId: "p1",
        saved: savedRecord({
          blockId: "b1",
          date: "2026-07-21",
          durationMinutes: 90,
          startTime: "18:00:00",
          title: "FE Civil Study",
        }),
        startTime: "18:00",
        title: "FE Civil Study",
      }),
      mappedRecord({
        blockId: "b2",
        date: "2026-07-21",
        durationMinutes: 90,
        endTime: "20:30",
        proposalId: "p2",
        recordMatchesVersion: false,
        saved: changedSavedRecord,
        startTime: "19:00",
        title: "Stale title",
      }),
      mappedRecord({
        blockId: "b3",
        date: "2026-07-23",
        durationMinutes: 60,
        endTime: "19:00",
        proposalId: "p3",
        saved: savedRecord({
          blockId: "b3",
          date: "2026-07-23",
          durationMinutes: 60,
          startTime: "18:00:00",
          title: "FE Civil Review",
        }),
        startTime: "18:00",
        title: "FE Civil Review",
      }),
    ],
    integrityStatus: "saved_records_changed",
    undoAvailable: false,
    undoUnavailableReason: "A saved record changed.",
    versionMatchCount: 2,
  },
  "user-1",
);
assert.ok(changedOnly);
assert.equal(changedOnly.result.authoritativeStatus, "applied_with_warning");
assert.equal(changedOnly.result.outcome, "applied");
assert.equal(changedOnly.result.warningCode, "saved_records_changed");
assert.equal(changedOnly.result.applied[1].title, "FE Civil Review");
assert.equal(changedOnly.result.undoAvailable, false);
assert.deepEqual(validateApplyWorkflowResult(changedOnly.result), []);

async function runConcurrencyRegression() {
const concurrencyRecords: AppliedWorkflowRecord[] = [
  {
    date: "2026-07-21",
    durationMinutes: 90,
    endsAt: "2026-07-21T19:30:00.000Z",
    endTime: "19:30",
    proposalId: "p1",
    recordId: "assistant:p1",
    recordType: "weekly_plan_block",
    startsAt: "2026-07-21T18:00:00.000Z",
    startTime: "18:00",
    title: "FE Civil Study",
    version: timestamp,
  },
  {
    date: "2026-07-22",
    durationMinutes: 90,
    endsAt: "2026-07-22T19:30:00.000Z",
    endTime: "19:30",
    proposalId: "p2",
    recordId: "assistant:p2",
    recordType: "weekly_plan_block",
    startsAt: "2026-07-22T18:00:00.000Z",
    startTime: "18:00",
    title: "FE Civil Study",
    version: timestamp,
  },
  {
    date: "2026-07-25",
    durationMinutes: 60,
    endsAt: "2026-07-25T15:00:00.000Z",
    endTime: "15:00",
    proposalId: "p3",
    recordId: "assistant:p3",
    recordType: "weekly_plan_block",
    startsAt: "2026-07-25T14:00:00.000Z",
    startTime: "14:00",
    title: "FE Civil Review",
    version: timestamp,
  },
];
const concurrencyApplyResult = createApplyWorkflowResult({
  applied: concurrencyRecords,
  attemptedAt: timestamp,
  automationMode: "manual_batch_apply",
  proposalBatchId: "batch-1",
  requestedProposalIds: ["p1", "p2", "p3"],
  undoAvailable: false,
  workflowId: "wf-1",
});
const concurrencyServerResult = {
  ...baseResult(),
  actionReceiptId: null,
  applied: [
    mappedRecord({
      blockId: "assistant:p1",
      date: "2026-07-21",
      durationMinutes: 90,
      endTime: "19:30",
      proposalId: "p1",
      saved: savedRecord({
        blockId: "assistant:p1",
        date: "2026-07-21",
        durationMinutes: 90,
        startTime: "18:00:00",
        title: "FE Civil Study",
      }),
      startTime: "18:00",
      title: "FE Civil Study",
    }),
    mappedRecord({
      blockId: "assistant:p2",
      date: "2026-07-22",
      durationMinutes: 90,
      endTime: "19:30",
      proposalId: "p2",
      saved: savedRecord({
        blockId: "assistant:p2",
        date: "2026-07-22",
        durationMinutes: 90,
        startTime: "18:00:00",
        title: "FE Civil Study",
      }),
      startTime: "18:00",
      title: "FE Civil Study",
    }),
    mappedRecord({
      blockId: "assistant:p3",
      date: "2026-07-25",
      durationMinutes: 60,
      endTime: "15:00",
      proposalId: "p3",
      saved: savedRecord({
        blockId: "assistant:p3",
        date: "2026-07-25",
        durationMinutes: 60,
        startTime: "14:00:00",
        title: "FE Civil Review",
      }),
      startTime: "14:00",
      title: "FE Civil Review",
    }),
  ],
  automationGrantId: null,
  automationMode: "manual_batch_apply",
  decisionAutomationMode: null,
  decisionStatus: null,
  decisionTargetRecordIds: [],
  idempotencyKey: concurrencyApplyResult.idempotencyKey,
  planningDecisionId: null,
  recordedUndoAvailable: false,
  reversibleUntil: null,
  targetMappingMatches: false,
  undoAvailable: false,
  undoUnavailableReason: "Manual applies are not reversible here.",
};
let claimOwner: string | null = null;
let finalized = false;
const fakeConcurrentSupabase = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_assistant_apply_attempt") {
      const claim = (args.p_claim ?? {}) as Record<string, unknown>;
      const token = String(claim.claim_token ?? "");
      await Promise.resolve();
      if (finalized) {
        return {
          data: {
            attemptId: "attempt-1",
            result: concurrencyServerResult,
            status: "finalized",
          },
          error: null,
        };
      }
      if (!claimOwner) {
        claimOwner = token;
        return {
          data: {
            attemptId: "attempt-1",
            claimExpiresAt: "2026-07-20T17:05:00.000Z",
            status: "claimed",
          },
          error: null,
        };
      }
      return {
        data: {
          attemptId: "attempt-1",
          claimExpiresAt: "2026-07-20T17:05:00.000Z",
          status: "in_progress",
        },
        error: null,
      };
    }
    if (name === "persist_assistant_apply_result") {
      const attempt = (args.p_attempt ?? {}) as Record<string, unknown>;
      if (!finalized && attempt.claim_token !== claimOwner) {
        return { data: null, error: { message: "claim owned by another request" } };
      }
      finalized = true;
      return { data: concurrencyServerResult, error: null };
    }
    return { data: null, error: { message: `Unexpected RPC ${name}` } };
  },
} as unknown as SupabaseClient;
const claimInput = {
  attemptId: "attempt-1",
  automationMode: "manual_batch_apply" as const,
  idempotencyKey: concurrencyApplyResult.idempotencyKey,
  proposalBatchId: "batch-1",
  requestedProposalIds: ["p1", "p2", "p3"],
  timezone: "America/Detroit",
  userId: "user-1",
  workflowId: "wf-1",
};
const [firstClaim, secondClaim] = await Promise.all([
  claimAuthoritativeApplyAttempt(fakeConcurrentSupabase, {
    ...claimInput,
    claimToken: "claim-a",
  }),
  claimAuthoritativeApplyAttempt(fakeConcurrentSupabase, {
    ...claimInput,
    claimToken: "claim-b",
  }),
]);
assert.deepEqual(
  [firstClaim.data?.status, secondClaim.data?.status].sort(),
  ["claimed", "in_progress"],
  "Concurrent callers yield exactly one pre-write claim",
);
const ownerToken = firstClaim.data?.status === "claimed" ? "claim-a" : "claim-b";
const loserToken = ownerToken === "claim-a" ? "claim-b" : "claim-a";
const finalizedByOwner = await persistAuthoritativeApplyResult(
  fakeConcurrentSupabase,
  {
    attemptId: "attempt-1",
    claimToken: ownerToken,
    result: concurrencyApplyResult as typeof concurrencyApplyResult & {
      proposalBatchId: string;
    },
    timezone: "America/Detroit",
    userId: "user-1",
  },
);
assert.equal(finalizedByOwner.data?.result.authoritativeStatus, "applied");
assert.equal(finalizedByOwner.data?.result.applied.length, 3);
const staleFailure = createApplyWorkflowResult({
  attemptedAt: timestamp,
  automationMode: "manual_batch_apply",
  failed: ["p1", "p2", "p3"].map((proposalId) => ({
    code: "stale_worker_failure",
    proposalId,
    safeMessage: "A stale worker reported failure.",
  })),
  proposalBatchId: "batch-1",
  requestedProposalIds: ["p1", "p2", "p3"],
  workflowId: "wf-1",
});
const staleFinalization = await persistAuthoritativeApplyResult(
  fakeConcurrentSupabase,
  {
    attemptId: "attempt-1",
    claimToken: loserToken,
    result: staleFailure as typeof staleFailure & { proposalBatchId: string },
    timezone: "America/Detroit",
    userId: "user-1",
  },
);
assert.equal(
  staleFinalization.data?.result.authoritativeStatus,
  "applied",
  "A stale failed claimant cannot overwrite a finalized success",
);
assert.equal(staleFinalization.data?.result.applied.length, 3);
}

const integrityMigration = readFileSync(
  path.join(process.cwd(), "supabase/assistant-apply-integrity.sql"),
  "utf8",
);
assert.match(integrityMigration, /claim_status text not null default 'finalized'/);
assert.match(integrityMigration, /claim_assistant_apply_attempt\(p_claim jsonb\)/);
assert.match(integrityMigration, /pg_advisory_xact_lock/);
assert.ok(
  (integrityMigration.match(/:assistant-workflow:/g) ?? []).length >= 3,
  "Claim, finalization, and Undo must share a workflow-scoped advisory lock",
);
assert.match(
  integrityMigration,
  /existing_attempt\.claim_status = 'finalized'[\s\S]*return public\.get_assistant_apply_result/,
  "A finalized result is immutable even if a stale claimant reaches the finalizer",
);
assert.match(
  integrityMigration,
  /update public\.assistant_proposals proposal[\s\S]*saved_record_id = records\.record_id/,
  "Ledger finalization owns the canonical proposal update",
);
assert.match(
  integrityMigration,
  /update public\.assistant_workflows[\s\S]*applied_proposal_ids = workflow_applied_ids[\s\S]*pending_proposal_ids = workflow_pending_ids/,
  "Ledger finalization owns the canonical workflow arrays",
);
assert.match(
  integrityMigration,
  /cardinality\(workflow_applied_ids\) > 0[\s\S]*cardinality\(workflow_pending_ids\) > 0[\s\S]*then 'partially_applied'/,
  "Applying a subset cannot hide the remaining pending proposals",
);
const applyRoute = readFileSync(
  path.join(process.cwd(), "app/api/assistant/apply/route.ts"),
  "utf8",
);
const claimIndex = applyRoute.indexOf("claimAuthoritativeApplyAttempt(");
const writeLoopIndex = applyRoute.indexOf("for (const item of suggestions)");
const crossMidnightGuardIndex = applyRoute.indexOf(
  "cross_midnight_apply_unsupported",
);
const ledgerFinalizationIndex = applyRoute.indexOf(
  "persistAuthoritativeApplyResult(",
  writeLoopIndex,
);
assert.ok(claimIndex > 0 && writeLoopIndex > claimIndex);
assert.ok(
  crossMidnightGuardIndex > 0 && crossMidnightGuardIndex < claimIndex,
  "Cross-midnight proposals must fail before a claim or Weekly Plan write",
);
assert.match(applyRoute, /apply_integrity_schema_unavailable[\s\S]*Nothing was changed/);
assert.match(applyRoute, /unsupported_authoritative_record_type/);
assert.match(applyRoute, /const preliminaryWorkflow = workflowResult\.data/);
assert.doesNotMatch(
  applyRoute.slice(writeLoopIndex, ledgerFinalizationIndex),
  /updateAssistantProposalResults|persistAssistantWorkflow/,
  "No legacy workflow writer may mutate reserved proposals before ledger finalization",
);
const undoFunction = integrityMigration.slice(
  integrityMigration.lastIndexOf(
    "create or replace function public.undo_assistant_decision",
  ),
);
const persistFunction = integrityMigration.slice(
  integrityMigration.indexOf(
    "create or replace function public.persist_assistant_apply_result",
  ),
  integrityMigration.lastIndexOf(
    "create or replace function public.undo_assistant_decision",
  ),
);
assert.match(
  persistFunction,
  /\(block\.scheduled_date \+ block\.start_time\) at time zone timezone_value/,
);
assert.doesNotMatch(persistFunction, /\(item->>'starts_at'\)::timestamptz/);
assert.doesNotMatch(persistFunction, /\(item->>'ends_at'\)::timestamptz/);
assert.match(undoFunction, /from public\.assistant_applied_records mapping/);
assert.match(undoFunction, /block\.updated_at = mapping\.record_version/);
assert.match(undoFunction, /google_calendar_synced_events/);
assert.match(undoFunction, /block_id = any\(mapped_record_ids\)/);
assert.doesNotMatch(
  undoFunction,
  /delete from public\.weekly_plan_blocks[\s\S]{0,180}decision_row\.target_record_ids/,
);
assert.match(
  undoFunction,
  /update public\.assistant_applied_records[\s\S]*set status = 'undone'/,
);
assert.match(
  undoFunction,
  /update public\.assistant_apply_attempts[\s\S]*undone_at = undo_time/,
);
assert.match(
  undoFunction,
  /update public\.assistant_workflows[\s\S]*state = next_workflow_state/,
);
assert.match(
  undoFunction,
  /proposal_id = any\(mapped_proposal_ids\)[\s\S]*remaining_applied_proposal_ids/,
);
assert.match(
  undoFunction,
  /set approval_status = 'rejected',[\s\S]*apply_attempt_id = null/,
  "Undo must clear the finalized proposal linkage when it removes mapped records",
);
assert.match(
  undoFunction,
  /update public\.assistant_planning_decisions[\s\S]*status = 'undone'/,
);
assert.match(undoFunction, /action_type = 'action_undone'/);
assert.match(undoFunction, /legacy_snapshot_path := true/);

const planRoute = readFileSync(
  path.join(process.cwd(), "app/api/assistant/plan/route.ts"),
  "utf8",
);
assert.match(
  planRoute,
  /if \(refreshedWorkflowResult\.data && recoveredResult\)/,
  "A finalized zero-write result must remain authoritative after response loss",
);
assert.doesNotMatch(
  planRoute,
  /if \(refreshedWorkflowResult\.data && recoveredResult\?\.applied\.length\)/,
);
assert.match(
  planRoute,
  /if \(loaded\.workflow\.state === "applying"\) return null/,
  "Refresh must not infer an applied result while a claim is in progress",
);
assert.match(
  planRoute,
  /refreshedWorkflowResult\.data\?\.workflow\.state === "applying"[\s\S]*automatic_apply_response_pending_reconciliation/,
  "A lost apply response must preserve the server's in-progress state instead of inventing review-only truth",
);

runConcurrencyRegression()
  .then(() => {
    console.log("Assistant apply-store reconciliation tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
