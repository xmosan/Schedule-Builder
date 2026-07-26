import type { AssistantSuggestion } from "@/lib/assistant";
import type { SemanticPlanningRequest } from "@/lib/assistant-semantics";
import type { SchedulingWorkflowContext } from "@/lib/assistant-workflow";
import type { MultiSessionPlanningRequest } from "@/lib/assistant-multi-session";

export type AutomationScope =
  | "current_request"
  | "current_week"
  | "current_series"
  | "routine_occurrences";

export type AutomatableAction =
  | "create_time_block"
  | "create_time_block_series"
  | "move_flexible_block"
  | "repair_routine_occurrence";

export type AutomationGrant = {
  activityTitle?: string;
  allowedActions: AutomatableAction[];
  expiresAt?: string;
  guardrails: {
    allowedActivityTitles?: string[];
    allowedDays?: number[];
    allowedTimeExceptions?: Array<{
      activityTitle: string;
      durationMinutes?: number;
      end: string;
      start: string;
      weekday: number;
    }>;
    earliestTime?: string;
    excludedDateRanges?: Array<{ endsAt: string; startsAt: string }>;
    excludedDays?: number[];
    latestTime?: string;
    maximumOccurrences?: number;
    maximumSessionMinutes?: number;
    maximumWeeklyMinutes?: number;
    minimumBufferAfterWorkMinutes?: number;
    planningEndDate?: string;
    planningStartDate?: string;
    preferredTimeRanges?: Array<{ end: string; start: string }>;
    requireDifferentDays?: boolean;
    requireDeterministicAvailability: boolean;
    requireNoConflicts: boolean;
    requireReversibleAction: boolean;
  };
  id: string;
  relatedProjectId?: string;
  scope: AutomationScope;
  sourceMessageId: string;
  status: "active" | "consumed" | "revoked" | "expired";
  userId: string;
  workflowId: string;
};

export type ActionRiskLevel =
  | "read_only"
  | "low_risk_reversible"
  | "moderate_batch"
  | "high_impact"
  | "prohibited";

export type AutomationDecision = {
  grantId?: string;
  outcome:
    | "answer_only"
    | "ask_clarification"
    | "create_review_batch"
    | "auto_apply"
    | "fail_safely";
  reasonCodes: string[];
  riskLevel: ActionRiskLevel;
  validation: {
    guardrailsSatisfied: boolean;
    noConflicts: boolean;
    reversible: boolean;
    scopeMatched: boolean;
    serverAuthVerified: boolean;
    sourceDataComplete: boolean;
  };
  workflowId: string;
};

export type AssistantWorkflowStatus =
  | "ready"
  | "understanding_request"
  | "waiting_for_details"
  | "building_plan"
  | "ready_for_review"
  | "applying"
  | "partially_applied"
  | "applied"
  | "applied_with_warning"
  | "failed"
  | "canceled"
  | "undone";

export type CompactActionReceipt = {
  actionType:
    | "plan_applied"
    | "plan_adjusted"
    | "action_failed"
    | "action_undone";
  availableActions: Array<"undo" | "view" | "mark_complete" | "snooze">;
  createdAt: string;
  decisionRecordId?: string;
  id: string;
  itemCount: number;
  nextOccurrenceAt?: string;
  primaryTime?: string;
  summary: string;
  title: string;
  userId: string;
};

export type PlanningDecisionRecord = {
  actionType: string;
  afterState?: unknown;
  automationMode: "manual_review" | "batch_approval" | "auto_applied";
  beforeState?: unknown;
  constraintsUsed: string[];
  createdAt: string;
  grantId?: string;
  id: string;
  preferencesUsed: string[];
  proposalIds: string[];
  reasonCodes: string[];
  reversibleUntil?: string;
  reversedAt?: string;
  scheduleExceptionIds?: string[];
  status: "pending" | "applied" | "partially_applied" | "failed" | "undone";
  targetRecordIds: string[];
  userId: string;
  workflowId: string;
};

export type TemporaryScheduleContext = {
  affectedCandidateCalculation: boolean;
  date: string;
  originalEndTime: string;
  overrideEndTime: string;
  relatedWorkShiftId?: string;
  source: "user_message";
};

const automationPermissionPattern =
  /\b(?:you may|you can|feel free to|please)\s+(?:automatically\s+)?(?:schedule|add|apply|place|book)\b|\bautomatically\s+(?:schedule|add|apply|place|book)\b/i;
const prohibitedAutomationPattern =
  /\b(?:google calendar|canvas|d2l|brightspace|ics|invite attendees?|cancel meeting)\b/i;
const indefiniteAutomationPattern =
  /\b(?:do|handle|schedule|apply)\b.{0,30}\bautomatically\s+every\s+week\b|\bfrom now on\b|\balways automate\b/i;

function parseClockTime(hourValue: string, minuteValue: string | undefined, period: string) {
  let hours = Number(hourValue);
  const minutes = Number(minuteValue ?? 0);
  if (hours === 12) hours = 0;
  if (/^p/i.test(period)) hours += 12;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getCurrentWeekRange(weekStartDate: string) {
  return { endDate: addDays(weekStartDate, 6), startDate: weekStartDate };
}

function getLatestTime(prompt: string) {
  const match = prompt.match(
    /\bbefore\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  return match ? parseClockTime(match[1], match[2], match[3]) : undefined;
}

export function extractAutomationGrant({
  multiSessionRequest,
  prompt,
  semanticRequest,
  sourceMessageId,
  userId,
  weekStartDate,
}: {
  multiSessionRequest?: MultiSessionPlanningRequest | null;
  prompt: string;
  semanticRequest: SemanticPlanningRequest;
  sourceMessageId: string;
  userId: string;
  weekStartDate: string;
}): AutomationGrant | null {
  if (
    !automationPermissionPattern.test(prompt) ||
    prohibitedAutomationPattern.test(prompt) ||
    indefiniteAutomationPattern.test(prompt)
  ) {
    return null;
  }

  const count =
    multiSessionRequest?.sessions.length ??
    semanticRequest.scheduleInstructions.desiredFrequency?.count;
  const duration = multiSessionRequest
    ? Math.max(
        ...multiSessionRequest.sessions.map((session) => session.durationMinutes),
      )
    : semanticRequest.scheduleInstructions.sessionDurationMinutes;
  const weeklyMinutes = multiSessionRequest
    ? multiSessionRequest.sessions.reduce(
        (total, session) => total + session.durationMinutes,
        0,
      )
    : semanticRequest.scheduleInstructions.weeklyMinutes;
  const weekRange = getCurrentWeekRange(weekStartDate);
  const structuredPreferredRange =
    multiSessionRequest?.preferences.preferredTimeRanges?.[0];
  const latestTime = structuredPreferredRange?.end ?? getLatestTime(prompt);
  const prefersEvenings = /\bevenings?\b/i.test(prompt);
  const requiresWorkBuffer =
    Boolean(multiSessionRequest?.preferences.afterWorkBufferMinutes) ||
    /\b(?:not|do not|don['’]t)\b[^.!?]{0,60}\bimmediately after work\b/i.test(
      prompt,
    );
  const scope: AutomationScope = multiSessionRequest
    ? "current_request"
    : /\bthis week|starting this week\b/i.test(prompt)
      ? "current_week"
      : "current_request";

  return {
    activityTitle:
      multiSessionRequest?.title.replace(/\s+(?:Study\s+)?Plan$/i, "") ||
      semanticRequest.activity.title,
    allowedActions: [
      count && count > 1 ? "create_time_block_series" : "create_time_block",
    ],
    expiresAt: `${addDays(weekRange.endDate, 1)}T00:00:00.000Z`,
    guardrails: {
      ...(multiSessionRequest?.sessions.length
        ? {
            allowedActivityTitles: [
              ...new Set(
                multiSessionRequest.sessions.map(
                  (session) => session.activityTitle,
                ),
              ),
            ],
          }
        : {}),
      ...(structuredPreferredRange?.start
        ? { earliestTime: structuredPreferredRange.start }
        : prefersEvenings
          ? { earliestTime: "17:00" }
          : {}),
      ...(multiSessionRequest?.globalConstraints.excludedDateRanges?.length
        ? {
            excludedDateRanges:
              multiSessionRequest.globalConstraints.excludedDateRanges,
          }
        : {}),
      ...(multiSessionRequest?.globalConstraints.requireDifferentDays
        ? { requireDifferentDays: true }
        : {}),
      ...(multiSessionRequest?.preferences.fallbackTimeRanges?.length
        ? {
            allowedTimeExceptions:
              multiSessionRequest.preferences.fallbackTimeRanges,
          }
        : {}),
      ...(latestTime ? { latestTime } : {}),
      ...(count ? { maximumOccurrences: count } : {}),
      ...(duration ? { maximumSessionMinutes: duration } : {}),
      ...(weeklyMinutes ? { maximumWeeklyMinutes: weeklyMinutes } : {}),
      ...(requiresWorkBuffer
        ? {
            minimumBufferAfterWorkMinutes:
              multiSessionRequest?.preferences.afterWorkBufferMinutes ?? 30,
          }
        : {}),
      planningEndDate:
        multiSessionRequest?.planningHorizon.endDate ?? weekRange.endDate,
      planningStartDate:
        multiSessionRequest?.planningHorizon.startDate ?? weekRange.startDate,
      ...(structuredPreferredRange
        ? { preferredTimeRanges: [structuredPreferredRange] }
        : prefersEvenings && latestTime
        ? { preferredTimeRanges: [{ end: latestTime, start: "17:00" }] }
        : {}),
      requireDeterministicAvailability: true,
      requireNoConflicts: true,
      requireReversibleAction: true,
    },
    id: `grant-${semanticRequest.workflowId}`,
    relatedProjectId: semanticRequest.relatedProject?.id,
    scope,
    sourceMessageId,
    status: "active",
    userId,
    workflowId: semanticRequest.workflowId,
  };
}

export function classifyAssistantActionRisk(
  suggestions: Array<{ type: string }>,
): ActionRiskLevel {
  if (suggestions.length === 0) return "read_only";
  if (
    suggestions.some((suggestion) =>
      ["google_calendar", "external_event", "canvas_event", "ics_event"].includes(
        suggestion.type,
      ),
    )
  ) {
    return "prohibited";
  }
  if (
    suggestions.some((suggestion) =>
      [
        "schedule_exception",
        "update_project",
        "update_work_shift",
        "delete_time_block",
        "delete_scheduled_item",
      ].includes(suggestion.type),
    )
  ) {
    return "high_impact";
  }
  if (
    suggestions.every((suggestion) => suggestion.type === "suggested_weekly_block")
  ) {
    return suggestions.length <= 7
      ? "low_risk_reversible"
      : "moderate_batch";
  }
  return "moderate_batch";
}

export function shouldAskClarification(
  missingField: string,
  semanticRequest: SemanticPlanningRequest,
  workflowState: string,
) {
  if (
    ["proposal_ready", "awaiting_apply", "awaiting_approval", "applied"].includes(
      workflowState,
    )
  ) {
    return false;
  }
  if (
    missingField === "frequency" &&
    semanticRequest.scheduleInstructions.desiredFrequency?.count
  ) {
    return false;
  }
  if (
    ["duration", "session_pattern", "pattern_confirmation"].includes(
      missingField,
    ) &&
    semanticRequest.scheduleInstructions.sessionDurationMinutes &&
    semanticRequest.scheduleInstructions.desiredFrequency?.count &&
    semanticRequest.weeklyGoal?.recommendedPattern.status === "accepted"
  ) {
    return false;
  }
  if (
    missingField === "planning_horizon" &&
    semanticRequest.scheduleInstructions.planningHorizon
  ) {
    return false;
  }
  return true;
}

function timeToMinutes(value?: string) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function decideAssistantAutomation({
  grant,
  sourceDataComplete,
  suggestions,
  workflowId,
}: {
  grant: AutomationGrant | null;
  sourceDataComplete: boolean;
  suggestions: AssistantSuggestion[];
  workflowId: string;
}): AutomationDecision {
  const riskLevel = classifyAssistantActionRisk(suggestions);
  const totalMinutes = suggestions.reduce(
    (total, suggestion) =>
      total + Math.round((suggestion.estimatedHours ?? 0) * 60),
    0,
  );
  const requiredAction =
    suggestions.length > 1 ? "create_time_block_series" : "create_time_block";
  const suggestionDates = suggestions.flatMap((suggestion) =>
    suggestion.itemDate ? [suggestion.itemDate] : [],
  );
  const scopeMatched = Boolean(
    grant &&
      grant.status === "active" &&
      grant.workflowId === workflowId &&
      grant.allowedActions.includes(requiredAction) &&
      suggestions.every((suggestion) => {
        const title = suggestion.projectName || suggestion.title;
        const normalizedTitle = normalizeTitle(title);
        const duration = Math.round((suggestion.estimatedHours ?? 0) * 60);
        const start = timeToMinutes(suggestion.startTime);
        const latest = timeToMinutes(grant.guardrails.latestTime);
        const earliest = timeToMinutes(grant.guardrails.earliestTime);
        const date = suggestion.itemDate;
        const allowedActivityTitles =
          grant.guardrails.allowedActivityTitles?.map(normalizeTitle) ?? [];
        const activityTitleMatched =
          allowedActivityTitles.length > 0
            ? allowedActivityTitles.includes(normalizedTitle)
            : normalizedTitle.includes(
                normalizeTitle(grant.activityTitle ?? title),
              );
        const excludedDateRangeMatched = Boolean(
          grant.guardrails.excludedDateRanges?.some((range) => {
            if (!date || start === null) return true;
            const startsAt = `${date}T${suggestion.startTime}:00`;
            const endsAt = `${date}T${String(Math.floor((start + duration) / 60)).padStart(2, "0")}:${String((start + duration) % 60).padStart(2, "0")}:00`;
            return startsAt < range.endsAt && endsAt > range.startsAt;
          }),
        );
        const primaryTimeRangeSatisfied =
          start === null ||
          ((earliest === null || start >= earliest) &&
            (latest === null || start + duration <= latest));
        const allowedTimeException =
          date && start !== null
            ? grant.guardrails.allowedTimeExceptions?.some((exception) => {
                const exceptionStart = timeToMinutes(exception.start);
                const exceptionEnd = timeToMinutes(exception.end);
                return (
                  new Date(`${date}T12:00:00Z`).getUTCDay() ===
                    exception.weekday &&
                  normalizeTitle(title) ===
                    normalizeTitle(exception.activityTitle) &&
                  (!exception.durationMinutes ||
                    duration === exception.durationMinutes) &&
                  exceptionStart !== null &&
                  exceptionEnd !== null &&
                  start >= exceptionStart &&
                  start + duration <= exceptionEnd
                );
              }) ?? false
            : false;
        return (
          activityTitleMatched &&
          !excludedDateRangeMatched &&
          (!date || !grant.guardrails.planningStartDate || date >= grant.guardrails.planningStartDate) &&
          (!date || !grant.guardrails.planningEndDate || date <= grant.guardrails.planningEndDate) &&
          (!date ||
            !grant.guardrails.excludedDays?.includes(
              new Date(`${date}T12:00:00Z`).getUTCDay(),
            )) &&
          (!grant.guardrails.maximumSessionMinutes || duration <= grant.guardrails.maximumSessionMinutes) &&
          (primaryTimeRangeSatisfied || allowedTimeException)
        );
      }) &&
      (!grant.guardrails.maximumOccurrences ||
        suggestions.length <= grant.guardrails.maximumOccurrences) &&
      (!grant.guardrails.maximumWeeklyMinutes ||
        totalMinutes <= grant.guardrails.maximumWeeklyMinutes) &&
      (!grant.guardrails.requireDifferentDays ||
        new Set(suggestionDates).size === suggestions.length),
  );
  const noConflicts = suggestions.every(
    (suggestion) => (suggestion.conflictWarnings?.length ?? 0) === 0,
  );
  const reversible = suggestions.every(
    (suggestion) => suggestion.type === "suggested_weekly_block",
  );
  const guardrailsSatisfied = scopeMatched && noConflicts && reversible;
  const canAutoApply =
    Boolean(grant) &&
    riskLevel === "low_risk_reversible" &&
    sourceDataComplete &&
    guardrailsSatisfied;
  const reasonCodes = canAutoApply
    ? [
        "explicit_current_request_permission",
        "personal_schedule_builder_blocks_only",
        "deterministic_candidates_validated",
        "reversible_action",
      ]
    : [
        ...(!grant ? ["automation_permission_missing"] : []),
        ...(riskLevel !== "low_risk_reversible" ? [`risk_${riskLevel}`] : []),
        ...(!scopeMatched ? ["automation_scope_mismatch"] : []),
        ...(!noConflicts ? ["candidate_conflict"] : []),
        ...(!sourceDataComplete ? ["source_data_incomplete"] : []),
      ];

  return {
    grantId: grant?.id,
    outcome: canAutoApply ? "auto_apply" : "create_review_batch",
    reasonCodes,
    riskLevel,
    validation: {
      guardrailsSatisfied,
      noConflicts,
      reversible,
      scopeMatched,
      serverAuthVerified: true,
      sourceDataComplete,
    },
    workflowId,
  };
}

export function resolveAssistantWorkflowStatus({
  isApplying = false,
  isBuilding = false,
  workflow,
}: {
  isApplying?: boolean;
  isBuilding?: boolean;
  workflow: SchedulingWorkflowContext | null;
}): AssistantWorkflowStatus {
  if (isApplying || workflow?.state === "applying") return "applying";
  if (isBuilding || workflow?.state === "calculating_availability") {
    return "building_plan";
  }
  if (!workflow) return "ready";
  if (workflow.state === "canceled" || workflow.state === "undone") {
    return "undone";
  }
  if (workflow.state === "failed") return "failed";
  if (workflow.state === "applied_with_warning") return "applied_with_warning";
  if (workflow.state === "partially_applied") return "partially_applied";
  if (
    workflow.appliedProposalIds.length > 0 &&
    workflow.pendingProposalIds.length > 0
  ) {
    return "partially_applied";
  }
  if (
    workflow.completionStatus === "records_applied" &&
    workflow.pendingProposalIds.length === 0
  ) {
    return "applied";
  }
  if (workflow.pendingProposalIds.length > 0) return "ready_for_review";
  if (
    workflow.state === "awaiting_clarification" &&
    workflow.missingFields.length > 0 &&
    workflow.context?.pendingQuestion
  ) {
    return "waiting_for_details";
  }
  if (workflow.state === "understanding_request") return "understanding_request";
  return "ready";
}

export function getAssistantWorkflowStatusLabel(status: AssistantWorkflowStatus) {
  return {
    applied: "Plan applied",
    applied_with_warning: "Plan applied with a warning",
    applying: "Applying",
    building_plan: "Building your plan",
    canceled: "Automated plan undone",
    failed: "Couldn’t finish this planning step",
    partially_applied: "Plan partly applied",
    ready: "Ready for a request",
    ready_for_review: "Ready for review",
    understanding_request: "Understanding your request",
    waiting_for_details: "Waiting for details",
    undone: "Automated plan undone",
  }[status];
}

export function isAssistantSocialReply(prompt: string) {
  return /^(?:thank(?:s| you)(?: so much)?|appreciate it|great|perfect)[.!\s]*$/i.test(
    prompt.trim(),
  );
}

export function isAssistantAppliedDetailsQuestion(prompt: string) {
  return /\b(?:what (?:exactly )?did you (?:add|schedule|create)|where did you put|which (?:times?|sessions?) did you (?:add|schedule))\b/i.test(
    prompt,
  );
}
