import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeApplyWorkflowResult,
  validateApplyWorkflowResult,
  type AppliedWorkflowRecord,
  type ApplyWorkflowResult,
  type FailedWorkflowRecord,
} from "@/lib/assistant-apply-result";

export type ApplyResultIntegrityStatus =
  | "consistent"
  | "needs_reconciliation"
  | "missing_saved_records"
  | "saved_records_changed"
  | "undone";

export type ServerValidatedUndoEligibility = {
  available: boolean;
  evaluatedAt: string;
  reason?: string;
  reversibleUntil?: string;
};

export type AuthoritativeApplyDiagnostics = {
  decisionAutomationMode?: string;
  decisionReversedAt?: string;
  decisionStatus?: string;
  decisionTargetRecordIds: string[];
  externallySyncedRecordCount: number;
  liveRecordCount: number;
  mappedRecordCount: number;
  recordedUndoAvailable: boolean;
  targetMappingMatches: boolean;
  versionMatchCount: number;
};

export type ReconciledApplyWorkflowResult = {
  attemptId: string;
  diagnostics: AuthoritativeApplyDiagnostics;
  finalizedAt?: string;
  integrityStatus: ApplyResultIntegrityStatus;
  result: ApplyWorkflowResult;
  undoEligibility: ServerValidatedUndoEligibility;
  updatedAt: string;
  userId: string;
};

export type PersistAuthoritativeApplyResultInput = {
  attemptId: string;
  claimToken: string;
  result: ApplyWorkflowResult & { proposalBatchId: string };
  timezone: string;
  userId: string;
};

export type ClaimAuthoritativeApplyAttemptInput = {
  attemptId: string;
  automationGrantId?: string;
  automationMode: ApplyWorkflowResult["automationMode"];
  claimToken: string;
  idempotencyKey: string;
  proposalBatchId: string;
  requestedProposalIds: string[];
  timezone: string;
  userId: string;
  workflowId: string;
};

export type AuthoritativeApplyClaimResult =
  | {
      attemptId: string;
      claimExpiresAt: string;
      status: "claimed" | "in_progress";
    }
  | {
      attemptId: string;
      authoritativeResult: ReconciledApplyWorkflowResult;
      status: "finalized";
    };

export type ApplyStoreResult<T> = {
  data: T | null;
  error: unknown | null;
};

export function getAuthoritativeApplyAttemptId(
  result: Pick<ApplyWorkflowResult, "idempotencyKey">,
) {
  return `attempt:${result.idempotencyKey}`;
}

const integrityStatuses: ApplyResultIntegrityStatus[] = [
  "consistent",
  "needs_reconciliation",
  "missing_saved_records",
  "saved_records_changed",
  "undone",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function getStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function normalizeClock(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(?:[01]\d|2[0-3]):[0-5]\d/);
  return match?.[0] ?? null;
}

function addMinutesToDateTime(
  date: string,
  startTime: string,
  durationMinutes: number,
) {
  const start = new Date(`${date}T${startTime}:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    endsAt: end.toISOString(),
    endTime: `${String(end.getUTCHours()).padStart(2, "0")}:${String(
      end.getUTCMinutes(),
    ).padStart(2, "0")}`,
    startsAt: start.toISOString(),
  };
}

function normalizeAppliedRecord(value: unknown): AppliedWorkflowRecord | null {
  if (!isObject(value)) return null;
  const durationMinutes = value.durationMinutes;
  if (
    value.recordType !== "weekly_plan_block" ||
    typeof value.proposalId !== "string" ||
    typeof value.recordId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.date !== "string" ||
    typeof value.startTime !== "string" ||
    typeof value.endTime !== "string" ||
    typeof value.startsAt !== "string" ||
    typeof value.endsAt !== "string" ||
    typeof durationMinutes !== "number"
  ) {
    return null;
  }
  return {
    date: value.date,
    durationMinutes,
    endsAt: value.endsAt,
    endTime: value.endTime,
    proposalId: value.proposalId,
    recordId: value.recordId,
    recordType: "weekly_plan_block",
    startsAt: value.startsAt,
    startTime: value.startTime,
    title: value.title,
    ...(getOptionalString(value.version)
      ? { version: getOptionalString(value.version) }
      : {}),
  };
}

function normalizeLiveAppliedRecord(value: unknown): {
  changed: boolean;
  failure?: FailedWorkflowRecord;
  record?: AppliedWorkflowRecord;
} {
  if (!isObject(value)) {
    return { changed: false };
  }
  const proposalId = getOptionalString(value.proposalId);
  const mappedRecord = normalizeAppliedRecord(value);
  const mappingStatus = getOptionalString(value.status);
  if (!proposalId) return { changed: false };
  if (value.recordExists === false || mappingStatus === "missing") {
    return {
      changed: false,
      failure: {
        code: "saved_record_missing",
        proposalId,
        safeMessage: "The saved Weekly Plan record no longer exists.",
      },
    };
  }
  if (mappingStatus === "undone") {
    return {
      changed: false,
      failure: {
        code: "saved_record_undone",
        proposalId,
        safeMessage: "The saved Weekly Plan record was undone.",
      },
    };
  }

  const changed = value.recordMatchesVersion === false;
  if (!changed) {
    return mappedRecord
      ? { changed: false, record: mappedRecord }
      : {
          changed: false,
          failure: {
            code: "saved_record_invalid",
            proposalId,
            safeMessage: "The saved Weekly Plan record could not be verified.",
          },
        };
  }

  const savedRecord = value.savedRecord;
  if (!isObject(savedRecord)) {
    return {
      changed: true,
      failure: {
        code: "saved_record_changed_without_snapshot",
        proposalId,
        safeMessage: "The changed Weekly Plan record could not be verified.",
      },
    };
  }
  const title = getOptionalString(savedRecord.projectName);
  const date = getOptionalString(savedRecord.scheduledDate);
  const startTime = normalizeClock(savedRecord.startTime);
  const estimatedHours = savedRecord.estimatedHours;
  const recordId = getOptionalString(savedRecord.blockId);
  const version = getOptionalString(savedRecord.updatedAt);
  const durationMinutes =
    typeof estimatedHours === "number" && Number.isFinite(estimatedHours)
      ? Math.round(estimatedHours * 60)
      : 0;
  // Current RPC versions derive the mapped fields and savedRecord from the
  // same locked Weekly Plan row. Preserve their timezone-aware instant when
  // they agree. The reconstruction below remains for older responses whose
  // mapped fields were a stale snapshot.
  if (
    mappedRecord &&
    title === mappedRecord.title &&
    date === mappedRecord.date &&
    startTime === mappedRecord.startTime &&
    durationMinutes === mappedRecord.durationMinutes
  ) {
    return { changed: true, record: mappedRecord };
  }
  const range =
    date && startTime && durationMinutes > 0
      ? addMinutesToDateTime(date, startTime, durationMinutes)
      : null;
  if (
    !title ||
    !date ||
    !startTime ||
    !recordId ||
    !version ||
    !range ||
    !isValidDate(date)
  ) {
    return {
      changed: true,
      failure: {
        code: "saved_record_no_longer_timed",
        proposalId,
        safeMessage: "The changed Weekly Plan record is no longer a valid timed block.",
      },
    };
  }
  return {
    changed: true,
    record: {
      date,
      durationMinutes,
      endsAt: range.endsAt,
      endTime: range.endTime,
      proposalId,
      recordId,
      recordType: "weekly_plan_block",
      startsAt: range.startsAt,
      startTime,
      title,
      version,
    },
  };
}

function normalizeFailure(value: unknown): FailedWorkflowRecord | null {
  if (
    !isObject(value) ||
    typeof value.code !== "string" ||
    typeof value.proposalId !== "string" ||
    typeof value.safeMessage !== "string"
  ) {
    return null;
  }
  return {
    code: value.code,
    proposalId: value.proposalId,
    safeMessage: value.safeMessage,
  };
}

export function reconcileAuthoritativeApplyResult(
  value: unknown,
  expectedUserId: string,
): ReconciledApplyWorkflowResult | null {
  if (!isObject(value)) return null;
  const attemptId = getOptionalString(value.attemptId);
  const userId = getOptionalString(value.userId);
  const updatedAt = getOptionalString(value.updatedAt);
  const evaluatedAt = getOptionalString(value.evaluatedAt);
  const integrityStatus = value.integrityStatus;
  const requestedProposalIds = getStringArray(value.requestedProposalIds);
  const pendingProposalIds = getStringArray(value.pendingProposalIds);
  const storedAppliedProposalIds =
    getStringArray(value.originalAppliedProposalIds) ??
    getStringArray(value.appliedProposalIds) ??
    (Array.isArray(value.applied)
      ? value.applied.flatMap((record) =>
          isObject(record) && typeof record.proposalId === "string"
            ? [record.proposalId]
            : [],
        )
      : []);
  const storedFailures = Array.isArray(value.failed)
    ? value.failed.map(normalizeFailure)
    : null;
  if (
    !attemptId ||
    !userId ||
    userId !== expectedUserId ||
    !updatedAt ||
    !evaluatedAt ||
    !integrityStatuses.includes(integrityStatus as ApplyResultIntegrityStatus) ||
    !requestedProposalIds ||
    !pendingProposalIds ||
    !storedFailures ||
    storedFailures.some((failure) => failure === null) ||
    !Array.isArray(value.applied)
  ) {
    return null;
  }

  const requestedSet = new Set(requestedProposalIds);
  if (
    new Set(requestedProposalIds).size !== requestedProposalIds.length ||
    [...storedAppliedProposalIds, ...pendingProposalIds].some(
      (proposalId) => !requestedSet.has(proposalId),
    ) ||
    storedFailures.some(
      (failure) => failure && !requestedSet.has(failure.proposalId),
    )
  ) {
    return null;
  }

  const applied: AppliedWorkflowRecord[] = [];
  const failureByProposalId = new Map<string, FailedWorkflowRecord>(
    (storedFailures as FailedWorkflowRecord[]).map((failure) => [
      failure.proposalId,
      failure,
    ]),
  );
  const reconciliationFailureIds = new Set<string>();
  let changedRecordCount = 0;
  value.applied.forEach((recordValue) => {
    const normalized = normalizeLiveAppliedRecord(recordValue);
    if (normalized.record) {
      applied.push(normalized.record);
      if (normalized.changed) changedRecordCount += 1;
      failureByProposalId.delete(normalized.record.proposalId);
    } else if (normalized.failure) {
      failureByProposalId.set(normalized.failure.proposalId, normalized.failure);
      reconciliationFailureIds.add(normalized.failure.proposalId);
    }
  });
  const appliedIds = new Set(applied.map((record) => record.proposalId));
  const pendingIds = new Set(pendingProposalIds);
  storedAppliedProposalIds.forEach((proposalId) => {
    if (
      !appliedIds.has(proposalId) &&
      !failureByProposalId.has(proposalId) &&
      !pendingIds.has(proposalId)
    ) {
      failureByProposalId.set(proposalId, {
        code: "saved_record_mapping_missing",
        proposalId,
        safeMessage: "The saved Weekly Plan record mapping is missing.",
      });
      reconciliationFailureIds.add(proposalId);
    }
  });
  requestedProposalIds.forEach((proposalId) => {
    if (
      !appliedIds.has(proposalId) &&
      !failureByProposalId.has(proposalId) &&
      !pendingIds.has(proposalId)
    ) {
      failureByProposalId.set(proposalId, {
        code: "authoritative_result_incomplete",
        proposalId,
        safeMessage: "The proposal result could not be verified.",
      });
      reconciliationFailureIds.add(proposalId);
    }
  });
  const failed = [...failureByProposalId.values()].filter(
    (failure) => !appliedIds.has(failure.proposalId),
  );
  const effectivePendingProposalIds = pendingProposalIds.filter(
    (proposalId) =>
      !appliedIds.has(proposalId) && !failureByProposalId.has(proposalId),
  );
  const hasReconciliationFailure = reconciliationFailureIds.size > 0;
  const warningCode =
    hasReconciliationFailure
      ? "saved_records_missing"
      : changedRecordCount > 0
        ? "saved_records_changed"
        : getOptionalString(value.warningCode);
  const authoritativeStatus =
    applied.length > 0 && (failed.length > 0 || effectivePendingProposalIds.length > 0)
      ? "partially_applied"
      : applied.length > 0
        ? warningCode
          ? "applied_with_warning"
          : "applied"
        : failed.length === 0 && effectivePendingProposalIds.length > 0
          ? "ready_for_review"
          : "failed";
  const outcome =
    authoritativeStatus === "partially_applied"
      ? "partially_applied"
      : authoritativeStatus === "ready_for_review"
        ? "review_required"
        : applied.length > 0
          ? "applied"
          : storedAppliedProposalIds.length > 0
            ? "failed_after_write"
            : "failed_before_write";
  const undoAvailable =
    value.undoAvailable === true &&
    integrityStatus === "consistent" &&
    !hasReconciliationFailure &&
    changedRecordCount === 0;
  const undoUnavailableReason = undoAvailable
    ? undefined
    : hasReconciliationFailure
      ? "Undo is unavailable because one or more saved records are missing."
      : changedRecordCount > 0
        ? "Undo is unavailable because one or more saved records changed."
        : getOptionalString(value.undoUnavailableReason);

  const resultValue: Record<string, unknown> = {
    applied,
    attemptedAt: value.attemptedAt,
    authoritativeStatus,
    automationMode: value.automationMode,
    failed,
    idempotencyKey: value.idempotencyKey,
    nothingChanged: applied.length === 0,
    outcome,
    pendingProposalIds: effectivePendingProposalIds,
    requestedProposalIds,
    undoAvailable,
    workflowId: value.workflowId,
  };
  const optionalResultStrings = [
    ["actionReceiptId", value.actionReceiptId],
    ["automationGrantId", value.automationGrantId],
    ["planningDecisionId", value.planningDecisionId],
    ["proposalBatchId", value.proposalBatchId],
    ["undoUnavailableReason", undoUnavailableReason],
    ["warningCode", warningCode],
  ] as const;
  optionalResultStrings.forEach(([key, item]) => {
    const normalized = getOptionalString(item);
    if (normalized) resultValue[key] = normalized;
  });
  const result = normalizeApplyWorkflowResult(resultValue);
  const decisionTargetRecordIds = getStringArray(value.decisionTargetRecordIds);
  const mappedRecordCount = getNonnegativeInteger(value.mappedRecordCount);
  const liveRecordCount = getNonnegativeInteger(value.liveRecordCount);
  const versionMatchCount = getNonnegativeInteger(value.versionMatchCount);
  const externallySyncedRecordCount = getNonnegativeInteger(
    value.externallySyncedRecordCount,
  );
  if (
    !result ||
    !decisionTargetRecordIds ||
    mappedRecordCount === null ||
    liveRecordCount === null ||
    versionMatchCount === null ||
    externallySyncedRecordCount === null ||
    typeof value.recordedUndoAvailable !== "boolean" ||
    typeof value.targetMappingMatches !== "boolean"
  ) {
    return null;
  }

  const undoEligibility: ServerValidatedUndoEligibility = {
    available:
      undoAvailable &&
      integrityStatus === "consistent" &&
      mappedRecordCount === result.applied.length &&
      liveRecordCount === mappedRecordCount &&
      versionMatchCount === mappedRecordCount &&
      externallySyncedRecordCount === 0 &&
      value.targetMappingMatches,
    evaluatedAt,
    ...(getOptionalString(value.undoUnavailableReason)
      ? { reason: getOptionalString(value.undoUnavailableReason) }
      : {}),
    ...(getOptionalString(value.reversibleUntil)
      ? { reversibleUntil: getOptionalString(value.reversibleUntil) }
      : {}),
  };
  if (!undoEligibility.available && !undoEligibility.reason) {
    undoEligibility.reason = "Undo could not be safely validated.";
  }

  return {
    attemptId,
    diagnostics: {
      ...(getOptionalString(value.decisionAutomationMode)
        ? { decisionAutomationMode: getOptionalString(value.decisionAutomationMode) }
        : {}),
      ...(getOptionalString(value.decisionReversedAt)
        ? { decisionReversedAt: getOptionalString(value.decisionReversedAt) }
        : {}),
      ...(getOptionalString(value.decisionStatus)
        ? { decisionStatus: getOptionalString(value.decisionStatus) }
        : {}),
      decisionTargetRecordIds,
      externallySyncedRecordCount,
      liveRecordCount,
      mappedRecordCount,
      recordedUndoAvailable: value.recordedUndoAvailable,
      targetMappingMatches: value.targetMappingMatches,
      versionMatchCount,
    },
    ...(getOptionalString(value.finalizedAt)
      ? { finalizedAt: getOptionalString(value.finalizedAt) }
      : {}),
    integrityStatus: integrityStatus as ApplyResultIntegrityStatus,
    result: {
      ...result,
      undoAvailable: undoEligibility.available,
      ...(undoEligibility.reason
        ? { undoUnavailableReason: undoEligibility.reason }
        : {}),
    },
    undoEligibility,
    updatedAt,
    userId,
  };
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidClock(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validatePersistenceInput(input: PersistAuthoritativeApplyResultInput) {
  const problems = validateApplyWorkflowResult(input.result);
  if (!input.attemptId.trim()) problems.push("missing_attempt_id");
  if (!input.claimToken.trim()) problems.push("missing_claim_token");
  if (!input.timezone.trim()) problems.push("missing_timezone");
  if (!input.userId.trim()) problems.push("missing_user_id");
  if (!input.result.proposalBatchId.trim()) problems.push("missing_proposal_batch_id");
  if (
    new Set(input.result.applied.map((record) => record.proposalId)).size !==
    input.result.applied.length
  ) {
    problems.push("duplicate_applied_proposal_mapping");
  }
  if (
    new Set(input.result.applied.map((record) => record.recordId)).size !==
    input.result.applied.length
  ) {
    problems.push("duplicate_applied_record_mapping");
  }
  input.result.applied.forEach((record) => {
    // The integrity migration currently reconciles only Weekly Plan rows. New
    // record types need an equivalent table-specific verifier before they can
    // be admitted to this authoritative ledger.
    if (record.recordType !== "weekly_plan_block") {
      problems.push(`unsupported_record_type:${record.proposalId}`);
    }
    if (!isValidDate(record.date)) problems.push(`invalid_record_date:${record.proposalId}`);
    if (!isValidClock(record.startTime) || !isValidClock(record.endTime)) {
      problems.push(`invalid_record_time:${record.proposalId}`);
    }
    const start = Date.parse(record.startsAt);
    const end = Date.parse(record.endsAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      Math.round((end - start) / 60_000) !== record.durationMinutes
    ) {
      problems.push(`invalid_record_range:${record.proposalId}`);
    }
  });
  return problems;
}

function toAttemptPayload(input: PersistAuthoritativeApplyResultInput) {
  const { result } = input;
  return {
    action_receipt_id: result.actionReceiptId ?? null,
    applied_proposal_ids: result.applied.map((record) => record.proposalId),
    attempted_at: result.attemptedAt,
    attempt_id: input.attemptId,
    claim_token: input.claimToken,
    authoritative_status: result.authoritativeStatus,
    automation_grant_id: result.automationGrantId ?? null,
    automation_mode: result.automationMode,
    failed_proposal_ids: result.failed.map((failure) => failure.proposalId),
    failure_details: result.failed,
    idempotency_key: result.idempotencyKey,
    nothing_changed: result.nothingChanged,
    outcome: result.outcome,
    pending_proposal_ids: result.pendingProposalIds,
    planning_decision_id: result.planningDecisionId ?? null,
    proposal_batch_id: result.proposalBatchId,
    requested_proposal_ids: result.requestedProposalIds,
    timezone: input.timezone,
    undo_available: result.undoAvailable,
    undo_unavailable_reason: result.undoUnavailableReason ?? null,
    user_id: input.userId,
    warning_code: result.warningCode ?? null,
    workflow_id: result.workflowId,
  };
}

function toRecordPayload(record: AppliedWorkflowRecord) {
  return {
    date: record.date,
    duration_minutes: record.durationMinutes,
    ends_at: record.endsAt,
    end_time: record.endTime,
    proposal_id: record.proposalId,
    record_id: record.recordId,
    record_type: record.recordType,
    record_version: record.version,
    starts_at: record.startsAt,
    start_time: record.startTime,
    title: record.title,
  };
}

function parseRpcResult(
  value: unknown,
  userId: string,
): ApplyStoreResult<ReconciledApplyWorkflowResult> {
  if (value === null) return { data: null, error: null };
  const parsed = reconcileAuthoritativeApplyResult(value, userId);
  return parsed
    ? { data: parsed, error: null }
    : {
        data: null,
        error: new Error("The authoritative apply result failed validation."),
      };
}

function parseClaimResult(
  value: unknown,
  input: ClaimAuthoritativeApplyAttemptInput,
): ApplyStoreResult<AuthoritativeApplyClaimResult> {
  if (!isObject(value)) {
    return { data: null, error: new Error("The apply claim response is invalid.") };
  }
  const status = getOptionalString(value.status);
  const attemptId = getOptionalString(value.attemptId);
  if (!attemptId || attemptId !== input.attemptId) {
    return { data: null, error: new Error("The apply claim identity is invalid.") };
  }
  if (status === "finalized") {
    const authoritativeResult = reconcileAuthoritativeApplyResult(
      value.result,
      input.userId,
    );
    return authoritativeResult
      ? {
          data: { attemptId, authoritativeResult, status: "finalized" },
          error: null,
        }
      : {
          data: null,
          error: new Error("The finalized apply claim failed validation."),
        };
  }
  const claimExpiresAt = getOptionalString(value.claimExpiresAt);
  if ((status === "claimed" || status === "in_progress") && claimExpiresAt) {
    return { data: { attemptId, claimExpiresAt, status }, error: null };
  }
  return { data: null, error: new Error("The apply claim state is invalid.") };
}

export async function claimAuthoritativeApplyAttempt(
  supabase: SupabaseClient,
  input: ClaimAuthoritativeApplyAttemptInput,
): Promise<ApplyStoreResult<AuthoritativeApplyClaimResult>> {
  const requestedProposalIds = [
    ...new Set(input.requestedProposalIds.filter(Boolean)),
  ];
  if (
    !input.attemptId.trim() ||
    !input.claimToken.trim() ||
    !input.idempotencyKey.trim() ||
    !input.proposalBatchId.trim() ||
    !input.timezone.trim() ||
    !input.userId.trim() ||
    !input.workflowId.trim() ||
    requestedProposalIds.length === 0 ||
    requestedProposalIds.length !== input.requestedProposalIds.length
  ) {
    return { data: null, error: new Error("The apply claim input is invalid.") };
  }
  const response = await supabase.rpc("claim_assistant_apply_attempt", {
    p_claim: {
      attempt_id: input.attemptId,
      automation_grant_id: input.automationGrantId ?? null,
      automation_mode: input.automationMode,
      claim_token: input.claimToken,
      idempotency_key: input.idempotencyKey,
      proposal_batch_id: input.proposalBatchId,
      requested_proposal_ids: requestedProposalIds,
      timezone: input.timezone,
      user_id: input.userId,
      workflow_id: input.workflowId,
    },
  });
  if (response.error) return { data: null, error: response.error };
  return parseClaimResult(response.data, input);
}

export async function releaseAuthoritativeApplyClaim(
  supabase: SupabaseClient,
  attemptId: string,
  claimToken: string,
): Promise<ApplyStoreResult<boolean>> {
  if (!attemptId.trim() || !claimToken.trim()) {
    return { data: null, error: new Error("The apply claim release is invalid.") };
  }
  const response = await supabase.rpc("release_assistant_apply_claim", {
    p_attempt_id: attemptId,
    p_claim_token: claimToken,
  });
  if (response.error) return { data: null, error: response.error };
  return typeof response.data === "boolean"
    ? { data: response.data, error: null }
    : { data: null, error: new Error("The apply claim release failed validation.") };
}

export async function persistAuthoritativeApplyResult(
  supabase: SupabaseClient,
  input: PersistAuthoritativeApplyResultInput,
): Promise<ApplyStoreResult<ReconciledApplyWorkflowResult>> {
  const problems = validatePersistenceInput(input);
  if (problems.length > 0) {
    return {
      data: null,
      error: new Error(`Invalid apply persistence input: ${problems.join(", ")}`),
    };
  }
  const response = await supabase.rpc("persist_assistant_apply_result", {
    p_attempt: toAttemptPayload(input),
    p_records: input.result.applied.map(toRecordPayload),
  });
  if (response.error) return { data: null, error: response.error };
  return parseRpcResult(response.data, input.userId);
}

export async function loadAuthoritativeApplyResultByAttempt(
  supabase: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<ApplyStoreResult<ReconciledApplyWorkflowResult>> {
  const response = await supabase.rpc("get_assistant_apply_result", {
    p_attempt_id: attemptId,
  });
  if (response.error) return { data: null, error: response.error };
  return parseRpcResult(response.data, userId);
}

export async function loadAuthoritativeApplyResultByIdempotencyKey(
  supabase: SupabaseClient,
  userId: string,
  idempotencyKey: string,
): Promise<ApplyStoreResult<ReconciledApplyWorkflowResult>> {
  const response = await supabase.rpc(
    "get_assistant_apply_result_by_idempotency_key",
    { p_idempotency_key: idempotencyKey },
  );
  if (response.error) return { data: null, error: response.error };
  return parseRpcResult(response.data, userId);
}

export async function loadLatestAuthoritativeApplyResult(
  supabase: SupabaseClient,
  userId: string,
  workflowId: string,
): Promise<ApplyStoreResult<ReconciledApplyWorkflowResult>> {
  const response = await supabase.rpc("get_latest_assistant_apply_result", {
    p_workflow_id: workflowId,
  });
  if (response.error) return { data: null, error: response.error };
  return parseRpcResult(response.data, userId);
}

export async function loadAuthoritativeApplyResultsForWorkflow(
  supabase: SupabaseClient,
  userId: string,
  workflowId: string,
): Promise<ApplyStoreResult<ReconciledApplyWorkflowResult[]>> {
  const response = await supabase.rpc("get_assistant_workflow_apply_results", {
    p_workflow_id: workflowId,
  });
  if (response.error) return { data: null, error: response.error };
  if (!Array.isArray(response.data)) {
    return {
      data: null,
      error: new Error("The authoritative workflow apply results are invalid."),
    };
  }
  const parsed = response.data.map((value) =>
    reconcileAuthoritativeApplyResult(value, userId),
  );
  return parsed.some((value) => value === null)
    ? {
        data: null,
        error: new Error("An authoritative workflow apply result is invalid."),
      }
    : {
        data: parsed as ReconciledApplyWorkflowResult[],
        error: null,
      };
}

export function getServerValidatedUndoEligibility(
  authoritativeResult: ReconciledApplyWorkflowResult,
) {
  return authoritativeResult.undoEligibility;
}

export function isMissingAssistantApplyIntegritySchema(error: unknown) {
  if (!isObject(error)) return false;
  const code = getOptionalString(error.code);
  const message = getOptionalString(error.message) ?? "";
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    /assistant_(?:apply_attempts|applied_records)|(?:persist|get)_assistant_(?:apply_result|workflow_apply_results)/i.test(
      message,
    )
  );
}
