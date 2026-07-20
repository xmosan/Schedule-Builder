export type ApplyWorkflowOutcome =
  | "not_attempted"
  | "review_required"
  | "applied"
  | "partially_applied"
  | "failed_before_write"
  | "failed_after_write";

export type ApplyAutomationMode =
  | "manual_review"
  | "manual_batch_apply"
  | "auto_apply";

export type AuthoritativeApplyStatus =
  | "ready_for_review"
  | "applied"
  | "applied_with_warning"
  | "partially_applied"
  | "failed";

export type AppliedWorkflowRecord = {
  date: string;
  durationMinutes: number;
  endsAt: string;
  endTime: string;
  proposalId: string;
  recordId: string;
  recordType:
    | "weekly_plan_block"
    | "scheduled_item"
    | "project"
    | "schedule_exception";
  startsAt: string;
  startTime: string;
  title: string;
  version?: string;
};

export type FailedWorkflowRecord = {
  code: string;
  proposalId: string;
  safeMessage: string;
};

export type ApplyWorkflowResult = {
  actionReceiptId?: string;
  applied: AppliedWorkflowRecord[];
  attemptedAt: string;
  authoritativeStatus: AuthoritativeApplyStatus;
  automationGrantId?: string;
  automationMode: ApplyAutomationMode;
  failed: FailedWorkflowRecord[];
  idempotencyKey: string;
  nothingChanged: boolean;
  outcome: ApplyWorkflowOutcome;
  pendingProposalIds: string[];
  planningDecisionId?: string;
  proposalBatchId?: string;
  requestedProposalIds: string[];
  undoAvailable: boolean;
  undoUnavailableReason?: string;
  warningCode?: string;
  workflowId: string;
};

export type ApplyResponseMode =
  | "review_required"
  | "applied"
  | "applied_with_warning"
  | "partially_applied"
  | "failed";

export type ApplyResponsePlan = {
  activityTitle: string;
  exactAppliedRecords: AppliedWorkflowRecord[];
  failedCount: number;
  maySayApplied: boolean;
  maySayNothingChanged: boolean;
  maySayReadyForReview: boolean;
  mode: ApplyResponseMode;
  pendingCount: number;
  primaryMessage: string;
  undoAvailable: boolean;
};

type CreateApplyWorkflowResultInput = {
  actionReceiptId?: string;
  applied?: AppliedWorkflowRecord[];
  attemptedAt?: string;
  authoritativeStatus?: AuthoritativeApplyStatus;
  automationGrantId?: string;
  automationMode: ApplyAutomationMode;
  failed?: FailedWorkflowRecord[];
  idempotencyKey?: string;
  outcome?: ApplyWorkflowOutcome;
  pendingProposalIds?: string[];
  planningDecisionId?: string;
  proposalBatchId?: string;
  requestedProposalIds: string[];
  undoAvailable?: boolean;
  undoUnavailableReason?: string;
  warningCode?: string;
  workflowId: string;
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function getAssistantProposalRecordId(proposalId: string) {
  return `assistant:${proposalId}`;
}

export function getApplyIdempotencyKey(
  workflowId: string,
  proposalIds: string[],
) {
  return `apply:${workflowId}:${unique(proposalIds).sort().join(",")}`;
}

function defaultOutcome({
  appliedCount,
  failedCount,
  pendingCount,
}: {
  appliedCount: number;
  failedCount: number;
  pendingCount: number;
}): ApplyWorkflowOutcome {
  if (appliedCount > 0 && (failedCount > 0 || pendingCount > 0)) {
    return "partially_applied";
  }
  if (appliedCount > 0) return "applied";
  if (pendingCount > 0) return "review_required";
  return "failed_before_write";
}

function defaultStatus({
  appliedCount,
  failedCount,
  pendingCount,
  warningCode,
}: {
  appliedCount: number;
  failedCount: number;
  pendingCount: number;
  warningCode?: string;
}): AuthoritativeApplyStatus {
  if (appliedCount > 0 && (failedCount > 0 || pendingCount > 0)) {
    return "partially_applied";
  }
  if (appliedCount > 0) {
    return warningCode ? "applied_with_warning" : "applied";
  }
  if (pendingCount > 0) return "ready_for_review";
  return "failed";
}

export function createApplyWorkflowResult(
  input: CreateApplyWorkflowResultInput,
): ApplyWorkflowResult {
  const applied = input.applied ?? [];
  const failed = input.failed ?? [];
  const pendingProposalIds = unique(input.pendingProposalIds ?? []);
  const requestedProposalIds = unique(input.requestedProposalIds);
  const authoritativeStatus =
    input.authoritativeStatus ??
    defaultStatus({
      appliedCount: applied.length,
      failedCount: failed.length,
      pendingCount: pendingProposalIds.length,
      warningCode: input.warningCode,
    });
  const outcome =
    input.outcome ??
    defaultOutcome({
      appliedCount: applied.length,
      failedCount: failed.length,
      pendingCount: pendingProposalIds.length,
    });
  const nothingChanged = applied.length === 0;
  const result: ApplyWorkflowResult = {
    ...(input.actionReceiptId ? { actionReceiptId: input.actionReceiptId } : {}),
    applied,
    attemptedAt: input.attemptedAt ?? new Date().toISOString(),
    authoritativeStatus,
    ...(input.automationGrantId
      ? { automationGrantId: input.automationGrantId }
      : {}),
    automationMode: input.automationMode,
    failed,
    idempotencyKey:
      input.idempotencyKey ??
      getApplyIdempotencyKey(input.workflowId, requestedProposalIds),
    nothingChanged,
    outcome,
    pendingProposalIds,
    ...(input.planningDecisionId
      ? { planningDecisionId: input.planningDecisionId }
      : {}),
    ...(input.proposalBatchId
      ? { proposalBatchId: input.proposalBatchId }
      : {}),
    requestedProposalIds,
    undoAvailable: Boolean(input.undoAvailable),
    ...(input.undoUnavailableReason
      ? { undoUnavailableReason: input.undoUnavailableReason }
      : {}),
    ...(input.warningCode ? { warningCode: input.warningCode } : {}),
    workflowId: input.workflowId,
  };

  const problems = validateApplyWorkflowResult(result);
  if (problems.length > 0) {
    throw new Error(`Invalid authoritative apply result: ${problems.join(", ")}`);
  }
  return result;
}

export function validateApplyWorkflowResult(result: ApplyWorkflowResult) {
  const problems: string[] = [];
  const requested = new Set(result.requestedProposalIds);
  const appliedIds = new Set(result.applied.map((record) => record.proposalId));
  const failedIds = new Set(result.failed.map((failure) => failure.proposalId));
  const pendingIds = new Set(result.pendingProposalIds);

  if (requested.size === 0) {
    problems.push("requested_proposals_empty");
  }
  if (requested.size !== result.requestedProposalIds.length) {
    problems.push("duplicate_requested_proposal");
  }
  if (appliedIds.size !== result.applied.length) {
    problems.push("duplicate_applied_proposal");
  }
  if (failedIds.size !== result.failed.length) {
    problems.push("duplicate_failed_proposal");
  }
  if (pendingIds.size !== result.pendingProposalIds.length) {
    problems.push("duplicate_pending_proposal");
  }

  if (result.applied.length > 0 && result.nothingChanged) {
    problems.push("applied_records_with_nothing_changed");
  }
  if (result.applied.length === 0 && !result.nothingChanged) {
    problems.push("nothing_changed_false_without_applied_records");
  }
  const isIncompleteSuccess =
    result.applied.length !== requested.size ||
    failedIds.size > 0 ||
    pendingIds.size > 0;
  if (result.authoritativeStatus === "applied" && isIncompleteSuccess) {
    problems.push("applied_status_without_complete_success");
  }
  if (
    result.authoritativeStatus === "applied_with_warning" &&
    isIncompleteSuccess
  ) {
    problems.push("warning_status_without_complete_success");
  }
  if (
    result.authoritativeStatus === "ready_for_review" &&
    result.applied.length > 0
  ) {
    problems.push("review_status_with_applied_records");
  }
  if (
    result.authoritativeStatus === "partially_applied" &&
    (result.applied.length === 0 || (failedIds.size === 0 && pendingIds.size === 0))
  ) {
    problems.push("partial_status_without_partial_result");
  }
  if (result.authoritativeStatus === "failed" && result.applied.length > 0) {
    problems.push("failed_status_with_applied_records");
  }
  if (result.outcome === "review_required" && result.authoritativeStatus !== "ready_for_review") {
    problems.push("review_outcome_without_review_status");
  }
  if (
    result.outcome === "applied" &&
    result.authoritativeStatus !== "applied" &&
    result.authoritativeStatus !== "applied_with_warning"
  ) {
    problems.push("applied_outcome_without_complete_status");
  }
  if (
    result.outcome === "partially_applied" &&
    result.authoritativeStatus !== "partially_applied"
  ) {
    problems.push("partial_outcome_without_partial_status");
  }
  if (
    result.outcome === "failed_before_write" &&
    (result.authoritativeStatus !== "failed" || result.applied.length > 0)
  ) {
    problems.push("prewrite_failure_with_applied_result");
  }
  if (
    result.outcome === "failed_after_write" &&
    !(
      (result.applied.length > 0 &&
        (result.authoritativeStatus === "applied_with_warning" ||
          result.authoritativeStatus === "partially_applied")) ||
      // A later reconciliation can prove that records written by this attempt
      // were deleted or undone. In that case the live result has no applied
      // records even though the historical outcome remains failed-after-write.
      (result.applied.length === 0 && result.authoritativeStatus === "failed")
    )
  ) {
    problems.push("postwrite_failure_without_postwrite_status");
  }
  if (result.outcome === "not_attempted" && result.applied.length > 0) {
    problems.push("not_attempted_with_applied_records");
  }
  if (result.undoAvailable && !result.planningDecisionId) {
    problems.push("undo_without_planning_decision");
  }
  if (result.undoAvailable && result.applied.length === 0) {
    problems.push("undo_without_applied_records");
  }
  if (result.undoAvailable && result.automationMode !== "auto_apply") {
    problems.push("undo_without_automatic_apply");
  }
  if (
    result.undoAvailable &&
    !["applied", "applied_with_warning", "partially_applied"].includes(
      result.authoritativeStatus,
    )
  ) {
    problems.push("undo_without_applied_status");
  }
  if (result.undoAvailable && result.undoUnavailableReason) {
    problems.push("undo_available_with_unavailable_reason");
  }
  if (
    [...appliedIds].some((id) => failedIds.has(id) || pendingIds.has(id)) ||
    [...failedIds].some((id) => pendingIds.has(id))
  ) {
    problems.push("proposal_in_multiple_result_buckets");
  }
  if (
    [...appliedIds, ...failedIds, ...pendingIds].some((id) => !requested.has(id))
  ) {
    problems.push("result_contains_unrequested_proposal");
  }
  if (
    new Set([...appliedIds, ...failedIds, ...pendingIds]).size !== requested.size
  ) {
    problems.push("requested_proposal_without_result");
  }
  return problems;
}

export function normalizeApplyWorkflowResult(
  value: unknown,
): ApplyWorkflowResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<ApplyWorkflowResult>;
  const outcomes: ApplyWorkflowOutcome[] = [
    "not_attempted",
    "review_required",
    "applied",
    "partially_applied",
    "failed_before_write",
    "failed_after_write",
  ];
  const modes: ApplyAutomationMode[] = [
    "manual_review",
    "manual_batch_apply",
    "auto_apply",
  ];
  const statuses: AuthoritativeApplyStatus[] = [
    "ready_for_review",
    "applied",
    "applied_with_warning",
    "partially_applied",
    "failed",
  ];
  if (
    typeof candidate.workflowId !== "string" ||
    typeof candidate.idempotencyKey !== "string" ||
    typeof candidate.attemptedAt !== "string" ||
    typeof candidate.nothingChanged !== "boolean" ||
    typeof candidate.undoAvailable !== "boolean" ||
    !outcomes.includes(candidate.outcome as ApplyWorkflowOutcome) ||
    !modes.includes(candidate.automationMode as ApplyAutomationMode) ||
    !statuses.includes(candidate.authoritativeStatus as AuthoritativeApplyStatus) ||
    !Array.isArray(candidate.requestedProposalIds) ||
    !Array.isArray(candidate.pendingProposalIds) ||
    !Array.isArray(candidate.applied) ||
    !Array.isArray(candidate.failed)
  ) {
    return null;
  }
  const result = candidate as ApplyWorkflowResult;
  const validRecords = result.applied.every(
    (record) =>
      record &&
      ["weekly_plan_block", "scheduled_item", "project", "schedule_exception"].includes(
        record.recordType,
      ) &&
      typeof record.proposalId === "string" &&
      typeof record.recordId === "string" &&
      typeof record.title === "string" &&
      typeof record.date === "string" &&
      typeof record.startTime === "string" &&
      typeof record.endTime === "string" &&
      typeof record.startsAt === "string" &&
      typeof record.endsAt === "string" &&
      typeof record.durationMinutes === "number",
  );
  const validFailures = result.failed.every(
    (failure) =>
      failure &&
      typeof failure.proposalId === "string" &&
      typeof failure.code === "string" &&
      typeof failure.safeMessage === "string",
  );
  return validRecords && validFailures && validateApplyWorkflowResult(result).length === 0
    ? result
    : null;
}

function commonWords(titles: string[]) {
  if (titles.length === 0) return [];
  const words = titles.map((title) => title.trim().split(/\s+/));
  const result: string[] = [];
  for (let index = 0; index < words[0].length; index += 1) {
    const word = words[0][index];
    if (words.every((parts) => parts[index]?.toLowerCase() === word.toLowerCase())) {
      result.push(word);
    } else {
      break;
    }
  }
  return result;
}

export function getAppliedPlanTitle(
  records: AppliedWorkflowRecord[],
  fallback = "Schedule",
) {
  const titles = unique(records.map((record) => record.title.trim()));
  if (titles.length === 0) return `${fallback} Plan`;
  if (titles.length === 1) return `${titles[0]} Plan`;
  const prefix = commonWords(titles).join(" ").trim();
  const suffixes = unique(
    titles.map((title) => title.slice(prefix.length).trim()).filter(Boolean),
  );
  if (prefix && suffixes.length > 0 && suffixes.length <= 3) {
    return `${prefix} ${suffixes.join(" and ")} Plan`;
  }
  return `${fallback} Plan`;
}

function formatClock(value: string) {
  const [hoursValue, minutesValue] = value.split(":").map(Number);
  if (!Number.isFinite(hoursValue) || !Number.isFinite(minutesValue)) return value;
  const period = hoursValue >= 12 ? "PM" : "AM";
  const hours = hoursValue % 12 || 12;
  return `${hours}:${String(minutesValue).padStart(2, "0")} ${period}`;
}

function formatAppliedRecordLine(record: AppliedWorkflowRecord) {
  if (!record.date || !record.startTime || !record.endTime) return record.title;
  const date = new Date(`${record.date}T12:00:00`);
  const day = Number.isNaN(date.getTime())
    ? record.date
    : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  return `${day} · ${record.title} · ${formatClock(record.startTime)}–${formatClock(
    record.endTime,
  )}`;
}

export function createApplyResponsePlan({
  activityTitle,
  result,
}: {
  activityTitle: string;
  result: ApplyWorkflowResult;
}): ApplyResponsePlan {
  const exactLines = result.applied.map(formatAppliedRecordLine);
  const appliedCount = result.applied.length;
  const pendingCount = result.pendingProposalIds.length;
  const failedCount = result.failed.length;
  let mode: ApplyResponseMode;
  let primaryMessage: string;

  if (result.authoritativeStatus === "ready_for_review") {
    mode = "review_required";
    primaryMessage = `I built the ${activityTitle} plan, but I couldn’t safely apply it automatically. Nothing changed.\n\n${pendingCount} ${pendingCount === 1 ? "session is" : "sessions are"} ready for review.`;
  } else if (result.authoritativeStatus === "applied_with_warning") {
    mode = "applied_with_warning";
    const warningDetail =
      result.warningCode === "receipt_persistence_failed"
        ? "create the usual automation receipt"
        : "finish the usual automation record";
    primaryMessage = `I added the ${appliedCount} ${activityTitle} session${
      appliedCount === 1 ? "" : "s"
    }, but I couldn’t ${warningDetail}. The session${
      appliedCount === 1 ? " is" : "s are"
    } on your Weekly Plan.${
      result.undoAvailable
        ? ""
        : " Undo is temporarily unavailable."
    }${exactLines.length ? `\n\n${exactLines.join("\n")}` : ""}`;
  } else if (result.authoritativeStatus === "partially_applied") {
    mode = "partially_applied";
    const firstFailure = result.failed[0]?.safeMessage;
    primaryMessage = `Partly. ${appliedCount} session${
      appliedCount === 1 ? " was" : "s were"
    } added. ${failedCount + pendingCount} could not be applied.${
      firstFailure ? ` ${firstFailure}` : ""
    }${exactLines.length ? `\n\n${exactLines.join("\n")}` : ""}`;
  } else if (result.authoritativeStatus === "applied") {
    mode = "applied";
    primaryMessage = `Yes. ${appliedCount} ${activityTitle} session${
      appliedCount === 1 ? " was" : "s were"
    } added:${
      exactLines.length ? `\n\n${exactLines.join("\n")}` : ""
    }`;
  } else {
    mode = "failed";
    primaryMessage = `I couldn’t add the ${activityTitle} sessions. Nothing changed.`;
  }

  return {
    activityTitle,
    exactAppliedRecords: result.applied,
    failedCount,
    maySayApplied: appliedCount > 0,
    maySayNothingChanged: result.nothingChanged,
    maySayReadyForReview: appliedCount === 0 && pendingCount > 0,
    mode,
    pendingCount,
    primaryMessage,
    undoAvailable: result.undoAvailable,
  };
}

const nothingChangedPattern =
  /\b(?:nothing (?:was )?(?:applied|added|scheduled|changed)|no changes? (?:were )?(?:applied|saved))\b/i;
const appliedLanguagePattern =
  /\b(?:plan applied|changes? applied|scheduled|added|on your (?:weekly plan|schedule)|all changes? applied)\b/i;
const reviewLanguagePattern = /\b(?:waiting for review|ready for review|awaiting approval)\b/i;

export function validateApplyResponseText(
  text: string,
  result: ApplyWorkflowResult,
) {
  const problems: string[] = [];
  if (result.applied.length > 0 && nothingChangedPattern.test(text)) {
    problems.push("nothing_changed_after_write");
  }
  if (result.applied.length === 0 && appliedLanguagePattern.test(text)) {
    problems.push("applied_language_without_records");
  }
  if (
    result.authoritativeStatus === "applied" &&
    reviewLanguagePattern.test(text)
  ) {
    problems.push("review_language_after_full_apply");
  }
  if (
    result.authoritativeStatus === "ready_for_review" &&
    /\b(?:plan applied|changes? applied)\b/i.test(text)
  ) {
    problems.push("applied_status_during_review");
  }
  return { problems, valid: problems.length === 0 };
}
