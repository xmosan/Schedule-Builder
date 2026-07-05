import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  addScheduledItemConflictWarningsToSuggestions,
  assistantPlanningSuggestionTypes,
  createCalendarConflictSuggestions,
  createAssistantPlanningContext,
  createContextOnlyAssistantResponse,
  createFallbackAssistantResponse,
  filterAssistantSuggestions,
  getAssistantCurrentWeekStartInput,
  getRelevantImportedCalendarEvents,
  isGreetingPrompt,
  isVaguePrompt,
  normalizeAssistantSuggestions,
  shouldGenerateAssistantActionCards,
  type AssistantContextStatus,
  type AssistantGoogleSyncRow,
  type AssistantPlanReviewResponse,
  type AssistantPlanningContext,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import type { PlannerProfile, PlannerType } from "@/lib/onboarding";
import { getScheduleExceptionLoadStatus } from "@/lib/schedule-exceptions";
import {
  advanceAssistantSchedulingConversation,
  createAssistantScheduleAnalysisSnapshot,
  hasDeterministicScheduleQuestionIntent,
  type AssistantSchedulingContext,
} from "@/lib/assistant-schedule-analysis";
import {
  assistantIntents,
  assistantTurnOutcomes,
  classifyAssistantIntent,
  createAssistantTurnResult,
  createConsolidatedClarification,
  extractPlanningItems,
  isAssistantStatusQuestion,
  isExplicitMutationRequest,
  isExplicitSchedulingRequest,
  validateAssistantCompletionLanguage,
  type AssistantTurnOutcome,
} from "@/lib/assistant-intelligence";
import {
  createCanonicalProposal,
  createProposalBatch,
  getCanonicalPendingProposals,
  getCanonicalWorkflowState,
  isAssistantMutationSuggestion,
  type SchedulingWorkflowContext,
} from "@/lib/assistant-workflow";
import {
  isMissingAssistantWorkflowSchema,
  loadAssistantWorkflow,
  persistAssistantWorkflow,
  type LoadedAssistantWorkflow,
} from "@/lib/assistant-workflow-store";
import {
  createAssistantResponsePlan,
  gateAssistantInsights,
  validateResponsePlan,
} from "@/lib/assistant-presentation";
import {
  fetchPlannerProfileForUser,
  fetchImportedCalendarEventsForUser,
  fetchProjectsForUser,
  fetchScheduledItemsForUser,
  fetchScheduleExceptionsForUser,
  fetchWorkShiftsForUser,
  fetchWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";

export const dynamic = "force-dynamic";

const maxPromptLength = 12000;
const maxRecentMessages = 8;
const maxRecentMessageLength = 1200;
const defaultOpenAiModel = "gpt-4o-mini";
let openAiClient: OpenAI | null = null;

function getAssistantModel() {
  return (
    process.env.OPENAI_ASSISTANT_MODEL?.trim() ||
    process.env.AI_MODEL?.trim() ||
    defaultOpenAiModel
  );
}

type AssistantChatHistoryItem = {
  role: "assistant" | "user";
  content: string;
};

type AssistantStreamEvent =
  | { type: "message_delta"; delta: string }
  | { type: "final"; response: AssistantPlanReviewResponse }
  | { type: "error"; error: string };

function formatTimeInputLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function addMinutesToTimeInput(value: string, durationMinutes: number) {
  const [hours, minutes] = value.split(":").map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function finalizeAssistantResponse({
  contextStatus,
  planningContext,
  prompt,
  response,
}: {
  contextStatus?: AssistantContextStatus;
  planningContext: AssistantPlanningContext;
  prompt: string;
  response: AssistantPlanReviewResponse;
}): AssistantPlanReviewResponse {
  const schedulingContext = response.schedulingContext;
  const extractedItems =
    schedulingContext?.extractedItems?.length
      ? schedulingContext.extractedItems
      : extractPlanningItems(prompt, planningContext.projects);
  const missingFields = [
    ...new Set(extractedItems.flatMap((item) => item.missingFields)),
  ];
  const suggestions =
    isExplicitMutationRequest(prompt) &&
    !schedulingContext &&
    missingFields.length > 0
      ? response.suggestions.filter(
          (suggestion) => !isAssistantMutationSuggestion(suggestion),
        )
      : response.suggestions;
  const actionable = suggestions.filter(isAssistantMutationSuggestion);
  const ungatedInsights = suggestions.filter(
    (suggestion) => !isAssistantMutationSuggestion(suggestion),
  );
  const insightGate = gateAssistantInsights({
    actions: actionable,
    insights: ungatedInsights,
    prompt,
  });
  const insights = insightGate.kept;
  const completionStatus =
    schedulingContext?.state === "applied" && schedulingContext.appliedRecords.length > 0
      ? ("records_applied" as const)
      : actionable.length > 0 || schedulingContext?.state === "awaiting_apply"
        ? ("proposal_created" as const)
        : ("nothing_created" as const);
  const intent = schedulingContext
    ? schedulingContext.intent === "create_multiple_time_blocks"
      ? ("create_multiple_time_blocks" as const)
      : schedulingContext.intent === "multi_action_request"
        ? ("multi_action_request" as const)
        : schedulingContext.intent === "find_open_time"
          ? ("find_open_time" as const)
          : ("create_time_block" as const)
    : classifyAssistantIntent(prompt, extractedItems);
  const workflowState = schedulingContext?.state ?? "idle";
  let outcome: AssistantTurnOutcome = "direct_answer";

  if (intent === "sync_question") outcome = "sync_guidance";
  else if (intent === "status_question" && completionStatus === "nothing_created") {
    outcome = "cannot_confirm";
  } else if (completionStatus === "records_applied") outcome = "apply_succeeded";
  else if (schedulingContext?.state === "awaiting_apply") outcome = "proposal_pending_review";
  else if (actionable.length > 0) outcome = "proposal_ready";
  else if (
    schedulingContext?.state === "awaiting_duration" ||
    schedulingContext?.state === "awaiting_session_details" ||
    schedulingContext?.state === "needs_clarification"
  ) {
    outcome = "clarification_required";
  } else if (schedulingContext?.state === "awaiting_window_selection") {
    outcome = "candidate_selection_required";
  } else if (/\b(?:review|analy[sz]e|overload|priority)\b/i.test(prompt)) {
    outcome = "analysis";
  }

  let responseText = response.message;
  if (
    isExplicitMutationRequest(prompt) &&
    completionStatus === "nothing_created" &&
    !schedulingContext &&
    missingFields.length > 0
  ) {
    responseText =
      createConsolidatedClarification(extractedItems) ??
      "I can draft that. How long should the block be?";
    outcome = "clarification_required";
  }

  if (isAssistantStatusQuestion(prompt) && !schedulingContext) {
    responseText =
      "No. I found no persisted proposal or applied record for this conversation.";
  }

  const responsePlan = createAssistantResponsePlan({
    actions: actionable,
    context: schedulingContext,
    insights,
    message: responseText,
    prompt,
  });
  const responseValidation = validateResponsePlan(
    responsePlan,
    schedulingContext?.semanticRequest,
  );
  responseText = responsePlan.primaryMessage;
  const guarded = validateAssistantCompletionLanguage(responseText, completionStatus);
  if (insightGate.suppressed.length > 0 || !responseValidation.valid) {
    logAssistantDiagnostic("response_relevance_validated", {
      fallbackPath: responseValidation.problems.join(",") || "none",
      proposalCount: actionable.length,
      responseValidation: responseValidation.valid ? "passed" : "replaced",
      suppressedNoteCount: insightGate.suppressed.length,
    });
  }
  const turnResult = createAssistantTurnResult({
    completionStatus,
    contextStatus,
    extractedItems,
    intent,
    missingFields,
    outcome,
    proposalIds: actionable.map((suggestion) => suggestion.id),
    responseText: guarded.responseText,
    selectedCandidateId: schedulingContext?.selectedWindowId,
    uncertaintyNotes: response.dataWarning ? [response.dataWarning] : [],
    workflowState,
  });

  return {
    ...response,
    actions: actionable,
    assistantMessage: guarded.responseText,
    insights,
    message: guarded.responseText,
    responsePlan: {
      ...responsePlan,
      primaryMessage: guarded.responseText,
    },
    suggestions: insights,
    turnResult,
  };
}

type AssistantDiagnostic = {
  activityTitle?: string;
  candidateCount?: number;
  extractedItemCount?: number;
  fallbackPath?: string;
  intent?: string;
  itemType?: string;
  missingFields?: string[];
  nextState?: string;
  persistenceResult?: string;
  previousState?: string;
  proposalCount?: number;
  purpose?: string;
  recurrence?: string;
  responseLength?: number;
  responseValidation?: string;
  suppressedNoteCount?: number;
  planningHorizon?: string;
  constraintConflictCount?: number;
  proposalSeriesCount?: number;
  threadId?: string | null;
  workflowId?: string | null;
};

function logAssistantDiagnostic(event: string, diagnostic: AssistantDiagnostic) {
  console.info("assistant_workflow", { event, ...diagnostic });
}

function createWorkflowPersistenceFailureResponse({
  response,
  threadId,
  userId,
}: {
  response: AssistantPlanReviewResponse;
  threadId: string;
  userId: string;
}): AssistantPlanReviewResponse {
  const context = response.schedulingContext ?? null;
  const workflow: SchedulingWorkflowContext = {
    appliedProposalIds: [],
    completionStatus: "nothing_created",
    context,
    extractedItems: response.turnResult?.extractedItems ?? [],
    intent: response.turnResult?.intent ?? "general_conversation",
    lastUpdatedAt: new Date().toISOString(),
    missingFields: response.turnResult?.missingFields ?? [],
    pendingProposalIds: [],
    persistenceStatus: "failed",
    proposalIds: [],
    selectedCandidateIds: [],
    state: "failed",
    threadId,
    userId,
    workflowId: context?.workflowId ?? `workflow-${Date.now()}-failed`,
  };
  const message = response.actions.length > 0
    ? "I found possible times, but I could not save the proposals for review. Nothing has been scheduled."
    : "I couldn’t save this planning workflow. Nothing has been scheduled. Please try again.";

  return {
    ...response,
    actions: [],
    assistantMessage: message,
    canonicalProposals: [],
    message,
    proposalBatch: null,
    suggestions: response.insights ?? response.suggestions,
    turnResult: response.turnResult
      ? {
          ...response.turnResult,
          completionStatus: "nothing_created",
          outcome: "apply_failed",
          proposalIds: [],
          responseText: message,
          workflowState: "failed",
        }
      : undefined,
    workflow,
  };
}

async function persistCanonicalWorkflowResponse({
  previous,
  response,
  supabase,
  threadId,
  userId,
}: {
  previous: LoadedAssistantWorkflow | null;
  response: AssistantPlanReviewResponse;
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
}) {
  const context = response.schedulingContext ?? null;
  const shouldPersist = Boolean(context || response.actions.length > 0 || previous);
  if (!shouldPersist) return response;

  const now = new Date().toISOString();
  const workflowId =
    context?.workflowId ??
    response.actions.find((action) => action.workflowId)?.workflowId ??
    previous?.workflow.workflowId ??
    `workflow-${Date.now()}`;
  const actionCandidates = response.actions.map((action) => ({
    ...action,
    workflowId,
  }));
  const canonicalProposals = actionCandidates.map((action) =>
    createCanonicalProposal(action, now),
  );

  if (canonicalProposals.some((proposal) => !proposal)) {
    logAssistantDiagnostic("proposal_validation_failed", {
      intent: response.turnResult?.intent,
      proposalCount: actionCandidates.length,
      threadId,
      workflowId,
    });
    return createWorkflowPersistenceFailureResponse({ response, threadId, userId });
  }

  const proposals = canonicalProposals.filter(
    (proposal): proposal is NonNullable<typeof proposal> => Boolean(proposal),
  );
  const priorApplied = previous?.proposals.filter(
    (proposal) => proposal.approvalStatus === "applied",
  ) ?? [];
  const priorPending = previous?.proposals.filter(
    (proposal) => proposal.approvalStatus === "pending",
  ) ?? [];
  const proposalsToPersist =
    proposals.length === 0 && context?.state === "awaiting_apply"
      ? priorPending
      : proposals;
  const combinedProposals = [
    ...priorApplied.filter(
      (applied) => !proposalsToPersist.some((proposal) => proposal.id === applied.id),
    ),
    ...proposalsToPersist,
  ];
  const pendingProposalIds = proposalsToPersist.map((proposal) => proposal.id);
  const appliedProposalIds = priorApplied.map((proposal) => proposal.id);
  const allProposalIds = combinedProposals.map((proposal) => proposal.id);
  const workflow: SchedulingWorkflowContext = {
    appliedProposalIds,
    completionStatus:
      pendingProposalIds.length > 0
        ? "proposal_created"
        : appliedProposalIds.length > 0
          ? "records_applied"
          : "nothing_created",
    context,
    extractedItems:
      response.turnResult?.extractedItems ?? context?.extractedItems ?? [],
    intent: response.turnResult?.intent ?? previous?.workflow.intent ?? "general_conversation",
    lastUpdatedAt: now,
    missingFields: response.turnResult?.missingFields ?? [],
    pendingProposalIds,
    persistenceStatus: "persisted",
    proposalIds: allProposalIds,
    selectedCandidateIds: context
      ? [
          ...new Set(
            context.pendingProposals.flatMap((proposal) => {
              const startMinutes = proposal.startTime
                .split(":")
                .map(Number)
                .reduce((hours, minutes) => hours * 60 + minutes);
              const matchingWindow = context.candidateWindows.find(
                (window) =>
                  window.date === proposal.date &&
                  startMinutes >= window.startMinutes &&
                  startMinutes + (proposal.durationMinutes ?? 0) <=
                    window.endMinutes,
              );
              return matchingWindow ? [matchingWindow.id] : [];
            }),
          ),
        ]
      : [],
    state: getCanonicalWorkflowState(context, pendingProposalIds.length),
    threadId,
    userId,
    workflowId,
  };
  const batch = createProposalBatch(
    workflowId,
    proposalsToPersist,
    context?.purpose ?? response.turnResult?.extractedItems[0]?.title ?? "Planning changes",
  );
  const persisted = await persistAssistantWorkflow(
    supabase,
    workflow,
    combinedProposals,
    batch,
  );

  if (persisted.error || !persisted.data) {
    logAssistantDiagnostic("workflow_persistence_failed", {
      candidateCount: context?.candidateWindows.length ?? 0,
      extractedItemCount: workflow.extractedItems.length,
      intent: workflow.intent,
      missingFields: workflow.missingFields,
      nextState: workflow.state,
      persistenceResult: isMissingAssistantWorkflowSchema(persisted.error)
        ? "schema_missing"
        : "error",
      previousState: previous?.workflow.state ?? "none",
      proposalCount: proposals.length,
      threadId,
      workflowId,
    });
    return createWorkflowPersistenceFailureResponse({ response, threadId, userId });
  }

  const loaded = persisted.data;
  const pendingProposals = getCanonicalPendingProposals(
    loaded.workflow,
    loaded.proposals,
  );
  const completionStatus = loaded.workflow.completionStatus;
  const guarded = validateAssistantCompletionLanguage(response.message, completionStatus);
  logAssistantDiagnostic("workflow_persisted", {
    activityTitle: loaded.workflow.context?.semanticRequest?.activity.title,
    candidateCount: loaded.workflow.context?.candidateWindows.length ?? 0,
    constraintConflictCount:
      loaded.workflow.context?.semanticRequest?.contradictions.length ?? 0,
    extractedItemCount: loaded.workflow.extractedItems.length,
    intent: loaded.workflow.intent,
    itemType: loaded.workflow.context?.semanticRequest?.itemType,
    missingFields: loaded.workflow.missingFields,
    nextState: loaded.workflow.state,
    persistenceResult: "persisted",
    previousState: previous?.workflow.state ?? "none",
    proposalCount: pendingProposals.length,
    proposalSeriesCount:
      loaded.workflow.context?.seriesProposal?.totalOccurrences ?? 0,
    purpose: loaded.workflow.context?.semanticRequest?.activity.purpose,
    recurrence: loaded.workflow.context?.semanticRequest?.scheduleInstructions
      .desiredFrequency
      ? JSON.stringify(
          loaded.workflow.context.semanticRequest.scheduleInstructions
            .desiredFrequency,
        )
      : undefined,
    planningHorizon: loaded.workflow.context?.semanticRequest
      ?.scheduleInstructions.planningHorizon
      ? JSON.stringify(
          loaded.workflow.context.semanticRequest.scheduleInstructions
            .planningHorizon,
        )
      : undefined,
    responseLength: guarded.responseText.length,
    responseValidation: guarded.mismatch ? "replaced" : "passed",
    threadId,
    workflowId,
  });

  return {
    ...response,
    actions: pendingProposals.map((proposal) => proposal.suggestion),
    assistantMessage: guarded.responseText,
    canonicalProposals: loaded.proposals,
    message: guarded.responseText,
    proposalBatch: loaded.batch,
    schedulingContext: loaded.workflow.context,
    turnResult: response.turnResult
      ? {
          ...response.turnResult,
          completionStatus,
          proposalIds: loaded.workflow.proposalIds,
          responseText: guarded.responseText,
          workflowState: loaded.workflow.state,
        }
      : undefined,
    workflow: loaded.workflow,
  } satisfies AssistantPlanReviewResponse;
}

function createAuthoritativeStatusResponse({
  baseResponse,
  loaded,
  planningContext,
}: {
  baseResponse: AssistantPlanReviewResponse;
  loaded: LoadedAssistantWorkflow;
  planningContext: AssistantPlanningContext;
}): AssistantPlanReviewResponse {
  const savedBlockIds = new Set(
    planningContext.weeklyPlanBlocks.map((block) => block.id),
  );
  const applied = loaded.proposals.filter(
    (proposal) =>
      proposal.approvalStatus === "applied" &&
      Boolean(proposal.savedRecordId) &&
      (proposal.actionType !== "create_time_block" ||
        savedBlockIds.has(proposal.savedRecordId ?? "")),
  );
  const pending = getCanonicalPendingProposals(
    loaded.workflow,
    loaded.proposals,
  );
  const title =
    loaded.workflow.context?.semanticRequest?.activity.title ??
    loaded.workflow.extractedItems[0]?.title ??
    loaded.workflow.context?.purpose ??
    "The requested item";
  let message: string;
  const series = loaded.workflow.context?.seriesProposal;

  if (applied.length > 0 && pending.length === 0) {
    const lines = applied
      .map((proposal) => proposal.timeBlock)
      .filter((proposal): proposal is NonNullable<typeof proposal> => Boolean(proposal))
      .map(
        (proposal) =>
          `- ${proposal.date}, ${formatTimeInputLabel(
            proposal.startTime,
          )}–${formatTimeInputLabel(proposal.endTime)}`,
      );
    message = series && applied.length > 5
      ? `Yes. ${applied.length} ${title} sessions were added across ${series.planningHorizon.weeks} weeks.`
      : `Yes. ${applied.length} ${title} session${
          applied.length === 1 ? " was" : "s were"
        } added${lines.length > 0 ? `:\n\n${lines.join("\n")}` : "."}`;
  } else if (applied.length > 0 && pending.length > 0) {
    message = `Partly. ${applied.length} session${
      applied.length === 1 ? " was" : "s were"
    } added, and ${pending.length} ${pending.length === 1 ? "is" : "are"} still awaiting approval.`;
  } else if (pending.length > 0) {
    message = `Not yet. ${pending.length === 1 ? `The ${title} session is` : `The ${pending.length} ${title} sessions are`} waiting for your approval.`;
  } else {
    const missing = loaded.workflow.missingFields;
    message = `No. ${title} has not been added yet.${
      missing.length > 0
        ? ` I still need ${missing.join(" and ").replace("frequency", "the number of sessions").replace("duration", "the session length")}.`
        : " No saved proposal or applied record matches this workflow."
    }`;
  }

  const guarded = validateAssistantCompletionLanguage(
    message,
    loaded.workflow.completionStatus,
  );
  const turnResult = createAssistantTurnResult({
    completionStatus: loaded.workflow.completionStatus,
    contextStatus: baseResponse.contextStatus,
    extractedItems: loaded.workflow.extractedItems,
    intent: "status_question",
    missingFields: loaded.workflow.missingFields,
    outcome:
      applied.length > 0 && pending.length === 0
        ? "apply_succeeded"
        : pending.length > 0
          ? "proposal_pending_review"
          : "cannot_confirm",
    proposalIds: loaded.workflow.proposalIds,
    responseText: guarded.responseText,
    uncertaintyNotes: baseResponse.dataWarning ? [baseResponse.dataWarning] : [],
    workflowState: loaded.workflow.state,
  });

  logAssistantDiagnostic("status_answered", {
    intent: "status_question",
    nextState: loaded.workflow.state,
    persistenceResult: "loaded",
    proposalCount: pending.length,
    responseValidation: guarded.mismatch ? "replaced" : "passed",
    threadId: loaded.workflow.threadId,
    workflowId: loaded.workflow.workflowId,
  });

  return {
    ...baseResponse,
    actions: [],
    assistantMessage: guarded.responseText,
    canonicalProposals: loaded.proposals,
    insights: [],
    message: guarded.responseText,
    proposalBatch: loaded.batch,
    schedulingContext: loaded.workflow.context,
    suggestions: [],
    turnResult,
    workflow: loaded.workflow,
  };
}

const assistantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: {
      type: "string",
      description:
        "A friendly plain-language assistant reply. It should explain the planning ideas conversationally and remind the user that they choose what to apply.",
    },
    suggestions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: assistantPlanningSuggestionTypes,
          },
          title: { type: "string" },
          description: { type: "string" },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          rationale: { type: "string" },
          severity: {
            type: "string",
            enum: ["info", "warning", "important"],
          },
          projectName: { type: "string" },
          newProjectName: { type: "string" },
          category: {
            type: "string",
            enum: ["Must-do", "Growth", "Maintenance", ""],
          },
          priority: {
            type: "string",
            enum: ["High", "Medium", "Low", ""],
          },
          deadline: { type: "string" },
          itemType: {
            type: "string",
            enum: ["task", "appointment", ""],
          },
          itemDate: { type: "string" },
          startTime: { type: "string" },
          location: { type: "string" },
          conflictWarnings: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
          },
          day: {
            type: "string",
            enum: [
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
              "",
            ],
          },
          estimatedHours: { type: "number" },
          exceptionDate: { type: "string" },
          exceptionType: {
            type: "string",
            enum: [
              "modify_shift",
              "cancel_shift",
              "extra_shift",
              "blocked_time",
              "available_override",
              "",
            ],
          },
          originalEndTime: { type: "string" },
          originalStartTime: { type: "string" },
          overrideEndTime: { type: "string" },
          overrideStartTime: { type: "string" },
          plannedTask: { type: "string" },
          proposedNextAction: { type: "string" },
          relatedWorkShiftId: { type: "string" },
          weeklyHours: { type: "number" },
        },
        required: [
          "id",
          "type",
          "title",
          "description",
          "confidence",
          "rationale",
          "severity",
          "projectName",
          "newProjectName",
          "category",
          "priority",
          "deadline",
          "itemType",
          "itemDate",
          "startTime",
          "location",
          "conflictWarnings",
          "day",
          "estimatedHours",
          "exceptionDate",
          "exceptionType",
          "originalEndTime",
          "originalStartTime",
          "overrideEndTime",
          "overrideStartTime",
          "plannedTask",
          "proposedNextAction",
          "relatedWorkShiftId",
          "weeklyHours",
        ],
      },
    },
    turn: {
      type: "object",
      additionalProperties: false,
      properties: {
        responseText: { type: "string" },
        intent: {
          type: "string",
          enum: assistantIntents,
        },
        outcome: {
          type: "string",
          enum: assistantTurnOutcomes,
        },
        workflowTransition: {
          type: "string",
          enum: ["none", "ask_clarification", "propose_actions"],
        },
        workflowState: { type: "string" },
        extractedItems: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              title: { type: "string" },
              durationMinutes: { type: "number" },
              frequencyCount: { type: "number" },
              missingFields: { type: "array", items: { type: "string" } },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: [
              "id",
              "type",
              "title",
              "durationMinutes",
              "frequencyCount",
              "missingFields",
              "confidence",
            ],
          },
        },
        missingFields: {
          type: "array",
          items: {
            type: "string",
          },
        },
        proposalIds: { type: "array", items: { type: "string" } },
        completionStatus: {
          type: "string",
          enum: ["nothing_created", "proposal_created", "records_applied"],
        },
        selectedCandidateId: { type: "string" },
        sourceCompleteness: {
          type: "object",
          additionalProperties: false,
          properties: {
            projectsLoaded: { type: "boolean" },
            weeklyPlanLoaded: { type: "boolean" },
            workScheduleLoaded: { type: "boolean" },
            scheduleExceptionsLoaded: { type: "boolean" },
            googleCalendarLoaded: { type: "boolean" },
            importedCalendarsLoaded: { type: "boolean" },
          },
          required: [
            "projectsLoaded",
            "weeklyPlanLoaded",
            "workScheduleLoaded",
            "scheduleExceptionsLoaded",
            "googleCalendarLoaded",
            "importedCalendarsLoaded",
          ],
        },
        uncertaintyNotes: { type: "array", items: { type: "string" } },
        actionCardReady: { type: "boolean" },
      },
      required: [
        "responseText",
        "intent",
        "outcome",
        "workflowTransition",
        "workflowState",
        "extractedItems",
        "missingFields",
        "proposalIds",
        "completionStatus",
        "selectedCandidateId",
        "sourceCompleteness",
        "uncertaintyNotes",
        "actionCardReady",
      ],
    },
  },
  required: ["message", "suggestions", "turn"],
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Assistant planning is unavailable right now.";
}

function getSafeAssistantErrorMessage() {
  return "I couldn’t load the full schedule. Try again or continue with the available information.";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function getOpenAiClient(apiKey: string) {
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey });
  }

  return openAiClient;
}

function normalizeRecentMessages(value: unknown): AssistantChatHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const candidate = item as Partial<AssistantChatHistoryItem>;

      if (
        (candidate.role !== "assistant" && candidate.role !== "user") ||
        typeof candidate.content !== "string" ||
        !candidate.content.trim()
      ) {
        return null;
      }

      return {
        role: candidate.role,
        content: candidate.content.trim().slice(0, maxRecentMessageLength),
      };
    })
    .filter((item): item is AssistantChatHistoryItem => item !== null)
    .slice(-maxRecentMessages);
}

function normalizeTimezone(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const timezone = value.trim();

  if (!timezone || timezone.length > 80 || /[^A-Za-z0-9_+\-/.]/.test(timezone)) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return undefined;
  }
}

function createNdjsonStream(
  executor: (send: (event: AssistantStreamEvent) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: AssistantStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          await executor(send);
        } catch (error) {
          console.error("Assistant stream failed", error);
          send({
            type: "error",
            error: getSafeAssistantErrorMessage(),
          });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

function splitTextForFallbackStream(message: string) {
  return message.match(/.{1,28}(?:\s|$)/g) ?? [message];
}

async function streamFallbackMessage(
  message: string,
  send: (event: AssistantStreamEvent) => void,
) {
  for (const chunk of splitTextForFallbackStream(message)) {
    send({ type: "message_delta", delta: chunk });
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

async function getAuthenticatedUser(
  request: NextRequest,
): Promise<{ supabase: SupabaseClient; userId: string } | NextResponse> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in before using Planning Assistant." },
      { status: 401 },
    );
  }

  try {
    const supabase = createAuthenticatedSupabaseClient(accessToken);
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data.user) {
      if (error) {
        console.error("Assistant session verification failed", error);
      }
      return NextResponse.json(
        { error: "Session could not be verified. Please sign in again." },
        { status: 401 },
      );
    }

    return {
      supabase,
      userId: data.user.id,
    };
  } catch (error) {
    console.error("Assistant authentication setup failed", error);
    return NextResponse.json(
      { error: getSafeAssistantErrorMessage() },
      { status: 500 },
    );
  }
}

async function loadPlanningContext(
  supabase: SupabaseClient,
  userId: string,
  timezone?: string,
) {
  const syncWeekStartDate = getAssistantCurrentWeekStartInput();
  const [
    profileResult,
    projectsResult,
    weeklyPlanResult,
    workShiftsResult,
    importedEventsResult,
    scheduledItemsResult,
    scheduleExceptionsResult,
    googleSyncConnectionResult,
    googleSyncRowsResult,
  ] = await Promise.all([
    fetchPlannerProfileForUser(supabase, userId),
    fetchProjectsForUser(supabase, userId),
    fetchWeeklyPlanBlocksForUser(supabase, userId),
    fetchWorkShiftsForUser(supabase, userId),
    fetchImportedCalendarEventsForUser(supabase, userId),
    fetchScheduledItemsForUser(supabase, userId),
    fetchScheduleExceptionsForUser(supabase, userId),
    supabase
      .from("google_calendar_connections")
      .select("status, last_synced_at, sync_enabled, sync_calendar_name")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("google_calendar_synced_events")
      .select(
        "weekly_plan_block_id, sync_status, google_event_html_link, synced_title, block_snapshot",
      )
      .eq("user_id", userId)
      .eq("week_start_date", syncWeekStartDate),
  ]);
  const loadErrors = [
    profileResult.error,
    projectsResult.error,
    weeklyPlanResult.error,
    workShiftsResult.error,
    importedEventsResult.error,
    scheduledItemsResult.error,
    scheduleExceptionsResult.error,
    googleSyncConnectionResult.error,
    googleSyncRowsResult.error,
  ].filter(Boolean);

  if (loadErrors.length > 0) {
    console.error(
      "Assistant planning context loaded partially",
      loadErrors.map((error) => getErrorMessage(error)),
    );
  }

  const profile = profileResult.error == null ? profileResult.data : null;
  const scheduleExceptionLoad = getScheduleExceptionLoadStatus(
    scheduleExceptionsResult.data,
    scheduleExceptionsResult.error,
  );
  const plannerType: PlannerType | "Unknown" = profile
    ? profile.plannerType
    : "Unknown";
  const googleSyncRows: AssistantGoogleSyncRow[] =
    googleSyncRowsResult.error == null
      ? ((googleSyncRowsResult.data ?? []).map((row) => ({
          blockSnapshot: row.block_snapshot,
          googleEventHtmlLink: row.google_event_html_link,
          syncStatus:
            row.sync_status === "needs_attention"
              ? ("needs_attention" as const)
              : ("synced" as const),
          syncedTitle: row.synced_title,
          weeklyPlanBlockId: row.weekly_plan_block_id,
        })) satisfies AssistantGoogleSyncRow[])
      : [];
  const importedEvents =
    importedEventsResult.error == null ? importedEventsResult.data : [];
  const relevantImportedEvents = getRelevantImportedCalendarEvents(importedEvents);
  const googleConnection =
    googleSyncConnectionResult.error == null
      ? googleSyncConnectionResult.data
      : null;
  const latestImportedAt = importedEvents.reduce<string | null>(
    (latest, event) =>
      !latest || event.importedAt > latest ? event.importedAt : latest,
    null,
  );
  const refreshedAt = new Date().toISOString();
  const contextStatus: AssistantContextStatus = {
    externalCalendars: importedEventsResult.error
      ? {
          detail: "Couldn’t load · Retry",
          state: "failed",
        }
      : relevantImportedEvents.length > 0
        ? {
            detail: `${relevantImportedEvents.length} upcoming event${relevantImportedEvents.length === 1 ? "" : "s"} loaded`,
            lastUpdatedAt: googleConnection?.last_synced_at ?? latestImportedAt,
            state: "available",
          }
        : googleSyncConnectionResult.error
          ? {
              detail: "Couldn’t verify connection · Retry",
              state: "failed",
            }
          : googleConnection?.status === "connected" || importedEvents.length > 0
            ? {
                detail: "Connected · 0 events this week",
                lastUpdatedAt: googleConnection?.last_synced_at ?? latestImportedAt,
                state: "empty",
              }
            : {
                detail: "Not connected",
                state: "not_connected",
              },
    googleCalendar: googleSyncConnectionResult.error
      ? { detail: "Couldn’t verify connection · Retry", state: "failed" }
      : googleConnection?.status === "connected"
        ? {
            detail: "Connected",
            lastUpdatedAt: googleConnection.last_synced_at,
            state: "available",
          }
        : { detail: "Not connected", state: "not_connected" },
    importedCalendars: importedEventsResult.error
      ? { detail: "Couldn’t load · Retry", state: "failed" }
      : relevantImportedEvents.length > 0
        ? {
            detail: `${relevantImportedEvents.length} event${relevantImportedEvents.length === 1 ? "" : "s"} loaded`,
            lastUpdatedAt: latestImportedAt,
            state: "available",
          }
        : { detail: "No imported events", state: "empty" },
    projects: projectsResult.error
      ? { detail: "Couldn’t load · Retry", state: "failed" }
      : projectsResult.data.length > 0
        ? {
            detail: `${projectsResult.data.length} project${projectsResult.data.length === 1 ? "" : "s"} loaded`,
            state: "available",
          }
        : { detail: "No projects", state: "empty" },
    refreshedAt,
    scheduleExceptions: scheduleExceptionLoad.contextStatus,
    weeklyPlan: weeklyPlanResult.error
      ? {
          detail: "Couldn’t load · Retry",
          state: "failed",
        }
      : weeklyPlanResult.data.length > 0
        ? {
            detail: `${weeklyPlanResult.data.length} time block${weeklyPlanResult.data.length === 1 ? "" : "s"} this week`,
            state: "available",
          }
        : {
            detail: "No time blocks this week",
            state: "empty",
          },
    workSchedule: workShiftsResult.error
      ? {
          detail: "Couldn’t load · Retry",
          state: "failed",
        }
      : workShiftsResult.data.length > 0
        ? {
            detail: `${workShiftsResult.data.length} shift${workShiftsResult.data.length === 1 ? "" : "s"} loaded`,
            state: "available",
          }
        : {
            detail: "No shifts added",
            state: "empty",
          },
  };

  return {
    context: createAssistantPlanningContext(
      projectsResult.error == null ? projectsResult.data : [],
      weeklyPlanResult.error == null ? weeklyPlanResult.data : [],
      plannerType,
      workShiftsResult.error == null ? workShiftsResult.data : [],
      relevantImportedEvents,
      googleSyncRows,
      {
        syncCalendarName:
          googleSyncConnectionResult.error == null
            ? googleSyncConnectionResult.data?.sync_calendar_name
            : null,
        syncEnabled:
          googleSyncConnectionResult.error == null
            ? Boolean(googleSyncConnectionResult.data?.sync_enabled)
            : false,
        scheduledItems:
          scheduledItemsResult.error == null ? scheduledItemsResult.data : [],
        scheduleExceptions:
          scheduleExceptionsResult.error == null
            ? scheduleExceptionsResult.data
            : [],
        timezone,
        weekStartDate: syncWeekStartDate,
      },
    ),
    contextStatus,
    profile,
    warning:
      loadErrors.length > 0
        ? scheduleExceptionLoad.warning ??
          "Some schedule sources did not load. Suggestions may be incomplete."
        : null,
  };
}

function createAiPrompt(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
  recentMessages: AssistantChatHistoryItem[] = [],
) {
  const scheduleAnalysis = createAssistantScheduleAnalysisSnapshot({
    importedCalendarEvents: context.importedCalendarEvents,
    scheduleExceptions: context.scheduleExceptions,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  });

  return [
    "You are Schedule Builder's friendly planning assistant.",
    "Return JSON only matching the provided schema.",
    "Classify the latest turn in the structured turn contract: intent, outcome, workflowState, extractedItems, missingFields, proposalIds, completionStatus, sourceCompleteness, uncertaintyNotes, and actionCardReady.",
    "Use 0 for unknown numeric extraction fields and an empty string for an unknown selectedCandidateId. Application code will independently validate and override this model interpretation.",
    "Set actionCardReady true only for a clear planning_change request with every required field needed by the proposed action.",
    "Do not calculate availability, conflicts, or open windows. Use only the deterministic schedule data provided below.",
    "If a required field is missing, use workflowTransition ask_clarification, list the missing field, set actionCardReady false, and return zero suggestions.",
    "Return a short, natural plain-language message first, then only the strongest reviewable planning suggestions.",
    "Sound like a helpful planning coach, not a system report.",
    "Do not repeat the same opening phrase every time.",
    "If the user is only greeting you, reply conversationally and return zero suggestions.",
    "If the user request is vague, ask one useful follow-up question and return zero or one suggestion.",
    "If the user asks a general question, answer briefly first before proposing schedule changes.",
    "Do not create suggestion cards for every response.",
    "Return zero suggestions for direct questions, analysis/review requests, Google sync status questions, and open-time searches unless the user clearly asks to change the plan.",
    "Only generate suggestion cards when the user clearly asks to create, add, move, update, schedule, plan, or generate blocks/projects.",
    "For 'find open time' requests, recommend the strongest one or two patterns. List every opening only when the user explicitly asks for all openings. Return zero suggestions unless they asked to create blocks.",
    "Limit suggestions to 2-4 high-quality items by default.",
    "Return at most 2 warning-style suggestions.",
    "Avoid duplicate or near-duplicate cards.",
    "Separate insights in the message from actions in the suggestions.",
    "Do not claim anything was saved.",
    "The app can create new projects, update project next actions, and create weekly blocks only after the user applies a reviewed action card.",
    "The app can also create exact-date standalone tasks and appointments only after the user applies a reviewed action card.",
    "The app can create date-specific work-schedule exceptions only after the user applies a reviewed action card. Never edit the recurring shift for a one-day change.",
    "The app can also update existing project fields after review: name, category, priority, deadline, next action, and weekly hours.",
    "If the user asks you to create, add, draft, or save a project, return a new_project suggestion card. Do not say you cannot create or save it; say you drafted it for review and the user can apply it.",
    "Do not create a new_project card unless the user explicitly asks for a project, goal, initiative, class, course, or work project.",
    "If the user asks to add a normal task, appointment, errand, reminder, or personal calendar item tied to an exact date, return a suggested_scheduled_item card. Do not create a project.",
    "Use suggested_weekly_block only for week-oriented time blocks tied to Monday through Sunday planning.",
    "For suggested_scheduled_item cards, title is the task or appointment title. plannedTask is the description/details. itemDate must be YYYY-MM-DD. itemType must be task or appointment. startTime must be HH:MM or empty.",
    "Appointments require itemDate, startTime, and estimatedHours. If a requested appointment is missing any of those, ask a clarifying question and return zero suggestions.",
    "Tasks require itemDate, title, and estimatedHours. Tasks may be flexible with empty startTime.",
    "Use the current server date for relative dates. If a date is ambiguous, ask a clarifying question and return zero suggestions.",
    "If the user asks to change, edit, move, confirm, or update a project deadline, due date, priority, category, weekly hours, next action, or name, return an update_project suggestion card. Do not return an informational deadline warning for a requested project edit.",
    "For update_project cards, projectName must be the existing project to update. Include only the new values in deadline, category, priority, proposedNextAction, weeklyHours, or newProjectName. Leave unused fields empty or 0.",
    "If the user says to confirm a drafted change, remind them they still need to click the apply/update button unless the action card has already been applied. Never say the change is confirmed or completed before apply.",
    "Do not create Google Calendar events.",
    "Do not mark projects done.",
    "Do not delete anything.",
    "Do not suggest destructive overwrites.",
    "Prefer additive weekly plan suggestions for active projects.",
    "Use the work schedule as blocked time. Avoid suggesting weekly project time blocks during work shifts.",
    "Use imported calendar events as commitments and blocked time. Avoid suggesting weekly project time blocks during imported event times.",
    "Use onboarding profile as soft context: students may need study blocks and D2L import, workers may need work-shift-aware planning, organization leaders may need event prep time, and general planners may need broad prioritization.",
    "Do not force onboarding assumptions. Mention them only when they make the answer more useful.",
    "Google Calendar sync is manual and one-way. Never claim you synced blocks, sent events to Google Calendar, or updated Google Calendar.",
    "If the user asks to sync to Google Calendar, explain what is ready and tell them to review the Weekly Plan page and click Sync selected themselves.",
    "Use Google sync context to answer questions about ready blocks, synced blocks, blocks needing start times, blocks needing attention, overnight blocks, and conflicts.",
    "Some weekly time blocks have start times. If a timed weekly block overlaps a saved work shift, return a workload_warning that says it may overlap a saved work shift.",
    "If a timed weekly block overlaps an imported calendar event, return a workload_warning that says it may overlap an imported calendar event.",
    "When suggesting new weekly blocks, prefer evenings, Friday, Saturday, Sunday, or flexible blocks when weekday work shifts make daytime unavailable.",
    "If the user asks to plan the week, find open time, or balance work and school, mention saved work shifts and imported calendar commitments naturally when they exist.",
    "Exact-dated deadlines can be placed on the calendar. Vague deadlines need exact dates and should not be placed on a month grid.",
    "Allowed suggestion types only: new_project, update_project, suggested_scheduled_item, suggested_weekly_block, suggested_next_action, schedule_exception, workload_warning, missing_deadline_warning, unclear_project_warning.",
    "Every suggestion must include id, type, title, description, confidence, rationale, and severity.",
    "For optional fields that do not apply, return an empty string, 0, or an empty array for conflictWarnings.",
    "For new_project cards, include projectName, category, priority, deadline, proposedNextAction, and weeklyHours.",
    "For update_project cards, include projectName and the proposed changed fields.",
    "For suggested_scheduled_item cards, include itemType, title, plannedTask, itemDate, startTime, estimatedHours, location, and conflictWarnings.",
    "For suggested_weekly_block cards, include projectName, day, estimatedHours, and plannedTask. projectName may be an existing project name or a standalone task/appointment title.",
    "For suggested_next_action cards, include projectName and proposedNextAction.",
    "For schedule_exception cards, include exceptionType, exceptionDate, relatedWorkShiftId, originalStartTime, originalEndTime, overrideStartTime, and overrideEndTime.",
    "",
    "Recent conversation:",
    JSON.stringify(recentMessages),
    "",
    `User request: ${prompt}`,
    `Current server date: ${new Date().toISOString().slice(0, 10)}`,
    `User timezone: ${context.timezone}`,
    "",
    "Onboarding profile:",
    JSON.stringify(
      profile
        ? {
            plannerType: profile.plannerType,
            planningGoals: profile.planningGoals,
            desiredIntegrations: profile.desiredIntegrations,
            scheduleIntensity: profile.scheduleIntensity,
            onboardingCompleted: profile.onboardingCompleted,
          }
        : {
            plannerType: context.plannerType,
            planningGoals: [],
            desiredIntegrations: [],
            scheduleIntensity: "Unknown",
            onboardingCompleted: false,
          },
    ),
    "",
    `Active projects: ${context.activeProjectsCount}`,
    `Planned weekly project hours: ${context.plannedWeeklyHours}`,
    `Weekly time blocks: ${context.weeklyBlocksCount}`,
    `Weekly block hours: ${context.totalWeeklyBlockHours}`,
    `Work shifts: ${context.workShiftsCount}`,
    `Work schedule hours: ${context.workScheduleHours}`,
    `Work schedule summary: ${context.workScheduleSummary ?? "None saved"}`,
    `Imported calendar events: ${context.importedEventsCount}`,
    `Imported event conflicts: ${context.importedEventConflictCount}`,
    `Calendar conflicts: ${context.calendarConflictCount}`,
    `Manual sync destination created: ${context.googleSync.syncEnabled}`,
    `Google sync calendar: ${context.googleSync.syncCalendarName ?? "Schedule Builder"}`,
    `Google sync ready blocks: ${context.googleSyncReadyCount}`,
    `Google sync already synced blocks: ${context.googleSyncSyncedCount}`,
    `Google sync needs start time blocks: ${context.googleSyncNeedsTimeCount}`,
    `Google sync needs attention blocks: ${context.googleSyncNeedsAttentionCount}`,
    `Google sync overnight blocks: ${context.googleSyncOvernightCount}`,
    `Exact-dated deadlines: ${context.deadlinesWithDatesCount}`,
    `Deadlines needing dates: ${context.deadlinesNeedingDatesCount}`,
    "",
    "Projects:",
    JSON.stringify(
      context.projects.map((project) => ({
        name: project.name,
        category: project.category,
        priority: project.priority,
        deadline: project.deadline,
        nextAction: project.nextAction,
        weeklyHours: project.weeklyHours,
        completed: project.completed,
      })),
    ),
    "",
    "Weekly time blocks:",
    JSON.stringify(
      context.weeklyPlanBlocks.map((block) => ({
        day: block.day,
        projectName: block.projectName,
        plannedTask: block.plannedTask,
        estimatedHours: block.estimatedHours,
        startTime: block.startTime ?? null,
      })),
    ),
    "",
    "Scheduled tasks and appointments:",
    JSON.stringify(
      context.scheduledItems.map((item) => ({
        itemType: item.itemType,
        title: item.title,
        description: item.description,
        itemDate: item.itemDate,
        startTime: item.startTime ?? null,
        estimatedHours: item.estimatedHours,
        location: item.location,
      })),
    ),
    "",
    "Work shifts:",
    JSON.stringify(
      context.workShifts.map((shift) => ({
        day: shift.day,
        startTime: shift.startTime,
        endTime: shift.endTime,
        location: shift.location,
        notes: shift.notes,
        recurring: shift.recurring,
      })),
    ),
    "",
    "Visible calendar conflicts:",
    JSON.stringify(
      context.calendarConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        workShift: conflict.shiftRangeLabel,
      })),
    ),
    "",
    "Imported calendar events:",
    JSON.stringify(
      context.importedCalendarEvents.map((event) => ({
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        source: event.source,
      })),
    ),
    "",
    "Imported event conflicts:",
    JSON.stringify(
      context.importedEventConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        importedEventTitle: conflict.event.title,
        importedEventTime: conflict.eventRangeLabel,
      })),
    ),
    "",
    "Google Calendar sync context:",
    JSON.stringify({
      syncEnabled: context.googleSync.syncEnabled,
      syncCalendarName: context.googleSync.syncCalendarName,
      currentWeekStart: context.googleSync.currentWeekStart,
      readyBlocks: context.googleSync.readyBlocks,
      syncedBlocks: context.googleSync.syncedBlocks,
      needsTimeBlocks: context.googleSync.needsTimeBlocks,
      needsAttentionBlocks: context.googleSync.needsAttentionBlocks,
      overnightBlocks: context.googleSync.overnightBlocks,
      conflictBlocks: context.googleSync.conflictBlocks,
      removedSyncedEvents: context.googleSync.removedSyncedEvents,
    }),
    "",
    "Normalized schedule timeline for availability checks:",
    JSON.stringify(scheduleAnalysis.normalizedCommitments),
    "",
    "Deterministic open windows this week:",
    JSON.stringify(scheduleAnalysis.openWindows),
    "",
    "All-day schedule notes:",
    JSON.stringify(scheduleAnalysis.allDayItems),
    "",
    "Exact project deadlines:",
    JSON.stringify(context.deadlinesWithDates),
    "",
    "Deadlines needing exact dates:",
    JSON.stringify(context.deadlinesNeedingDates),
  ].join("\n");
}

function createAssistantMessagePrompt(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
  recentMessages: AssistantChatHistoryItem[],
) {
  const scheduleAnalysis = createAssistantScheduleAnalysisSnapshot({
    importedCalendarEvents: context.importedCalendarEvents,
    scheduleExceptions: context.scheduleExceptions,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  });

  return [
    "You are Schedule Builder's conversational planning assistant.",
    "Write only the assistant message text. Do not return JSON.",
    "Be natural, specific, and concise. Aim for 2-5 short sentences.",
    "Pay attention to the latest user message and the recent conversation.",
    "If the user greets you, reply warmly and ask what they want to plan. Do not give a full report.",
    "If the user is vague, ask one helpful follow-up question instead of inventing a full schedule.",
    "If the user asks a normal question, answer it first.",
    "If the user asks for analysis, sync status, or open time, answer directly and do not promise action cards.",
    "Only mention review cards when the user clearly asks to create, add, move, update, schedule, plan, or generate blocks/projects.",
    "For 'find open time' requests, recommend the strongest one or two patterns. Show every opening only when the user explicitly asks for all options.",
    "For questions about tasks or appointments, answer from scheduledItems context and do not create cards unless the user asks to add or schedule something.",
    "If the user asks to add an exact-date task, appointment, reminder, or errand, say you can draft it for review. Never say it was saved.",
    "If work shifts exist, treat them as blocked time and reference them naturally for planning requests.",
    "If imported calendar events exist, treat them as blocked commitments and reference them naturally for planning/open-time requests.",
    "Use onboarding profile as soft context without being pushy. Student means study/class language can help; Professional means work-shift-aware planning can help; Organization leader means prep time and conflicts can help; General planning should stay broad.",
    "If timed weekly blocks overlap work shifts, mention the conflict clearly without moving anything.",
    "If timed weekly blocks overlap imported calendar events, mention the conflict clearly without moving anything.",
    "Google Calendar sync is manual and one-way. Never say you synced, sent, updated, or deleted Google Calendar events.",
    "If the user asks about Google Calendar sync, explain the sync readiness from context and direct them back to the Weekly Plan page to select blocks and click Sync selected.",
    "Mention blocks that need start times, blocks needing attention, overnight blocks, and conflicts when they matter.",
    "Avoid repeating the same opening wording from prior assistant messages.",
    "Never claim anything was saved or changed.",
    "The app can create projects, update next actions, and add weekly blocks only after the user applies a reviewed action card.",
    "The app can create exact-date tasks and appointments only after the user applies a reviewed action card.",
    "The app can update project deadlines, priority, category, weekly hours, next action, and name only after the user applies a reviewed action card.",
    "If the user asks to create or save a project, say you drafted it for review. Do not say you cannot create or save it from here.",
    "If the user asks to confirm a project edit, say the edit is ready to apply in the review card. Do not say it is confirmed, saved, completed, or changed unless the user clicked apply.",
    "Never say you created calendar events.",
    "",
    "Recent conversation:",
    JSON.stringify(recentMessages),
    "",
    `Latest user message: ${prompt}`,
    "",
    "Schedule context:",
    JSON.stringify({
      plannerType: profile?.plannerType ?? context.plannerType,
      timezone: context.timezone,
      activeProjectsCount: context.activeProjectsCount,
      plannedWeeklyHours: context.plannedWeeklyHours,
      weeklyBlocksCount: context.weeklyBlocksCount,
      weeklyBlockHours: context.totalWeeklyBlockHours,
      workShiftsCount: context.workShiftsCount,
      workScheduleHours: context.workScheduleHours,
      workScheduleSummary: context.workScheduleSummary,
      importedEventsCount: context.importedEventsCount,
      importedEventConflictCount: context.importedEventConflictCount,
      calendarConflictCount: context.calendarConflictCount,
      googleSync: context.googleSync,
      googleSyncReadyCount: context.googleSyncReadyCount,
      googleSyncSyncedCount: context.googleSyncSyncedCount,
      googleSyncNeedsTimeCount: context.googleSyncNeedsTimeCount,
      googleSyncNeedsAttentionCount: context.googleSyncNeedsAttentionCount,
      googleSyncOvernightCount: context.googleSyncOvernightCount,
      deadlinesWithDates: context.deadlinesWithDates,
      deadlinesNeedingDates: context.deadlinesNeedingDates,
      projects: context.projects.map((project) => ({
        name: project.name,
        category: project.category,
        priority: project.priority,
        deadline: project.deadline,
        nextAction: project.nextAction,
        weeklyHours: project.weeklyHours,
        completed: project.completed,
      })),
      weeklyPlanBlocks: context.weeklyPlanBlocks.map((block) => ({
        day: block.day,
        projectName: block.projectName,
        plannedTask: block.plannedTask,
        estimatedHours: block.estimatedHours,
        startTime: block.startTime ?? null,
      })),
      scheduledItems: context.scheduledItems.map((item) => ({
        itemType: item.itemType,
        title: item.title,
        description: item.description,
        itemDate: item.itemDate,
        startTime: item.startTime ?? null,
        estimatedHours: item.estimatedHours,
        location: item.location,
      })),
      workShifts: context.workShifts.map((shift) => ({
        day: shift.day,
        startTime: shift.startTime,
        endTime: shift.endTime,
        recurring: shift.recurring,
      })),
      importedCalendarEvents: context.importedCalendarEvents.map((event) => ({
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        source: event.source,
      })),
      calendarConflicts: context.calendarConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        workShift: conflict.shiftRangeLabel,
      })),
      importedEventConflicts: context.importedEventConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        importedEventTitle: conflict.event.title,
        importedEventTime: conflict.eventRangeLabel,
      })),
      normalizedScheduleTimeline: scheduleAnalysis.normalizedCommitments,
      deterministicOpenWindows: scheduleAnalysis.openWindows,
      allDayScheduleNotes: scheduleAnalysis.allDayItems,
    }),
  ].join("\n");
}

function preserveFallbackCriticalSuggestions(
  aiSuggestions: AssistantPlanReviewResponse["suggestions"],
  fallbackSuggestions: AssistantPlanReviewResponse["suggestions"],
) {
  const fallbackCriticalSuggestions = fallbackSuggestions.filter(
    (suggestion) =>
      suggestion.type === "update_project" ||
      suggestion.type === "suggested_scheduled_item",
  );

  if (fallbackCriticalSuggestions.length === 0) {
    return aiSuggestions;
  }

  const missingFallbackSuggestions = fallbackCriticalSuggestions.filter(
    (fallbackSuggestion) =>
      !aiSuggestions.some((suggestion) => suggestion.type === fallbackSuggestion.type),
  );

  return missingFallbackSuggestions.length > 0
    ? filterAssistantSuggestions([...missingFallbackSuggestions, ...aiSuggestions])
    : aiSuggestions;
}

async function createOpenAiSuggestions(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
  recentMessages: AssistantChatHistoryItem[] = [],
): Promise<Pick<AssistantPlanReviewResponse, "message" | "suggestions">> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const client = getOpenAiClient(apiKey);
  const response = await client.responses.create({
    model: getAssistantModel(),
    instructions:
      "You generate safe, structured planning suggestions for a project scheduling app. Output JSON only and never suggest destructive actions.",
    input: createAiPrompt(prompt, context, profile, recentMessages),
    max_output_tokens: 1400,
    text: {
      format: {
        type: "json_schema",
        name: "schedule_builder_plan_review",
        schema: assistantResponseJsonSchema,
        strict: true,
      },
    },
  });
  const outputText = response.output_text;

  if (!outputText) {
    throw new Error("OpenAI returned an empty response.");
  }

  const parsed = JSON.parse(outputText) as {
    message?: unknown;
    suggestions?: unknown;
    turn?: {
      actionCardReady?: unknown;
      responseText?: unknown;
    };
  };
  const actionCardReady = parsed.turn?.actionCardReady === true;
  const suggestions = addScheduledItemConflictWarningsToSuggestions(
    normalizeAssistantSuggestions(
      actionCardReady ? parsed.suggestions : [],
      assistantPlanningSuggestionTypes as readonly AssistantSuggestionType[],
    ),
    context,
  );
  const filteredSuggestions = filterAssistantSuggestions([
    ...createCalendarConflictSuggestions(context),
    ...suggestions,
  ]);

  return {
    message:
      typeof parsed.turn?.responseText === "string" &&
      parsed.turn.responseText.trim()
        ? parsed.turn.responseText.trim()
        : typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : filteredSuggestions.length > 0
          ? "Here’s the focused version I’d start with. Review the suggestions and only apply the ones that fit."
          : "I can help with that. Tell me what feels most urgent or what kind of plan you want to build, and I’ll keep the next step simple.",
    suggestions: filteredSuggestions,
  };
}

async function streamOpenAiAssistantMessage({
  context,
  profile,
  prompt,
  recentMessages,
  send,
}: {
  context: AssistantPlanningContext;
  profile: PlannerProfile | null;
  prompt: string;
  recentMessages: AssistantChatHistoryItem[];
  send: (event: AssistantStreamEvent) => void;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const client = getOpenAiClient(apiKey);
  const stream = await client.responses.create({
    model: getAssistantModel(),
    instructions:
      "You are a friendly planning coach inside Schedule Builder. Stream plain conversational text only.",
    input: createAssistantMessagePrompt(prompt, context, profile, recentMessages),
    max_output_tokens: 500,
    stream: true,
  });
  let message = "";

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      message += event.delta;
      send({ type: "message_delta", delta: event.delta });
    }

    if (event.type === "response.failed") {
      throw new Error(
        event.response.error?.message ?? "OpenAI could not finish the response.",
      );
    }

    if (event.type === "response.incomplete") {
      throw new Error("OpenAI response was incomplete.");
    }
  }

  return message.trim();
}

export async function GET(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { context, contextStatus, warning } = await loadPlanningContext(
    authResult.supabase,
    authResult.userId,
  );
  const response = createContextOnlyAssistantResponse(context);
  const threadId = request.nextUrl.searchParams.get("threadId")?.slice(0, 80) ?? null;
  const workflowResult = threadId
    ? await loadAssistantWorkflow(
        authResult.supabase,
        authResult.userId,
        threadId,
      )
    : { data: null, error: null };
  const loaded = workflowResult.data;
  const pendingActions = loaded
    ? getCanonicalPendingProposals(loaded.workflow, loaded.proposals)
        .map((proposal) => proposal.suggestion)
    : [];

  return NextResponse.json({
    ...response,
    actions: pendingActions,
    assistantMessage: response.message,
    canonicalProposals: loaded?.proposals ?? [],
    contextStatus,
    dataWarning: warning,
    message: response.message,
    proposalBatch: loaded?.batch ?? null,
    schedulingContext: loaded?.workflow.context ?? null,
    suggestions: [],
    workflow: loaded?.workflow ?? null,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = (await request.json().catch(() => ({}))) as {
    activeSchedulingContext?: unknown;
    prompt?: unknown;
    recentMessages?: unknown;
    threadId?: unknown;
    timezone?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const recentMessages = normalizeRecentMessages(body.recentMessages);
  const timezone = normalizeTimezone(body.timezone);
  let activeSchedulingContext: AssistantSchedulingContext | null = null;
  let loadedWorkflow: LoadedAssistantWorkflow | null = null;
  const threadId =
    typeof body.threadId === "string" && body.threadId.length <= 80
      ? body.threadId
      : null;

  if (!prompt) {
    return NextResponse.json(
      { error: "Describe what you want help planning." },
      { status: 400 },
    );
  }

  if (prompt.length > maxPromptLength) {
    return NextResponse.json(
      { error: `Keep the prompt under ${maxPromptLength} characters.` },
      { status: 400 },
    );
  }

  const { context, contextStatus, profile, warning } = await loadPlanningContext(
    authResult.supabase,
    authResult.userId,
    timezone,
  );
  if (threadId) {
    const workflowResult = await loadAssistantWorkflow(
      authResult.supabase,
      authResult.userId,
      threadId,
    );
    if (workflowResult.data) {
      loadedWorkflow = workflowResult.data;
      activeSchedulingContext = workflowResult.data.workflow.context;
    } else if (workflowResult.error && !isMissingAssistantWorkflowSchema(workflowResult.error)) {
      console.error("Assistant workflow could not be loaded", workflowResult.error);
    }
  }

  if (
    loadedWorkflow?.workflow.state === "applied" &&
    !isAssistantStatusQuestion(prompt)
  ) {
    activeSchedulingContext = null;
    loadedWorkflow = null;
  }
  const baseResponse = createContextOnlyAssistantResponse(context);
  const baseWithWarning: AssistantPlanReviewResponse = {
    ...baseResponse,
    assistantMessage: baseResponse.message,
    contextStatus,
    dataWarning: warning,
    message: baseResponse.message,
  };

  if (isAssistantStatusQuestion(prompt)) {
    const response = loadedWorkflow
      ? createAuthoritativeStatusResponse({
          baseResponse: baseWithWarning,
          loaded: loadedWorkflow,
          planningContext: context,
        })
      : finalizeAssistantResponse({
          contextStatus,
          planningContext: context,
          prompt,
          response: {
            ...baseWithWarning,
            actions: [],
            assistantMessage:
              "No. I found no persisted proposal or applied record for this conversation.",
            message:
              "No. I found no persisted proposal or applied record for this conversation.",
            suggestions: [],
          },
        });

    return createNdjsonStream(async (send) => {
      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
    });
  }

  const scheduleInput = {
    importedCalendarEvents: context.importedCalendarEvents,
    projects: context.projects,
    scheduleExceptions: context.scheduleExceptions,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  };
  const schedulingTurn = advanceAssistantSchedulingConversation({
    activeContext: activeSchedulingContext,
    input: scheduleInput,
    loadWarning: null,
    prompt,
    recentMessages,
  });

  if (schedulingTurn) {
    const proposals = schedulingTurn.context.pendingProposals.map((proposal) => ({
      ...proposal,
      sourceConversationId: threadId,
    }));
    const proposal =
      proposals[0] ??
      (schedulingTurn.proposal
        ? { ...schedulingTurn.proposal, sourceConversationId: threadId }
        : null);
    const schedulingContext = {
      ...schedulingTurn.context,
      pendingProposal: proposal,
      pendingProposals: proposals.length > 0 ? proposals : proposal ? [proposal] : [],
    };
    const timeBlockSuggestions = schedulingContext.pendingProposals.flatMap(
      (pendingProposal) => {
        const selectedWindow = schedulingContext.candidateWindows.find(
          (window) => {
            const [hours, minutes] = pendingProposal.startTime.split(":").map(Number);
            const proposalStart = hours * 60 + minutes;
            return (
              window.date === pendingProposal.date &&
              proposalStart >= window.startMinutes &&
              proposalStart + (pendingProposal.durationMinutes ?? 0) <= window.endMinutes
            );
          },
        );

        if (
          pendingProposal.status !== "ready_for_review" ||
          !pendingProposal.durationMinutes ||
          !selectedWindow
        ) {
          return [];
        }

        return [
          {
            id:
              pendingProposal.id ??
              `time-block-${pendingProposal.date}-${pendingProposal.startTime}`,
            type: "suggested_weekly_block" as const,
            title: pendingProposal.title,
            description: `${new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              weekday: "long",
              year: "numeric",
            }).format(new Date(`${pendingProposal.date}T00:00:00`))} · ${
              formatTimeInputLabel(pendingProposal.startTime)
            }–${formatTimeInputLabel(
              addMinutesToTimeInput(
                pendingProposal.startTime,
                pendingProposal.durationMinutes,
              ),
            )}.`,
            confidence: 0.98,
            summary: pendingProposal.details,
            rationale:
              "This uses an exact opening and duration validated against the loaded schedule.",
            severity: "important" as const,
            projectName: pendingProposal.title,
            plannedTask: pendingProposal.details,
            day: selectedWindow.day,
            itemDate: pendingProposal.date,
            startTime: pendingProposal.startTime,
            estimatedHours: pendingProposal.durationMinutes / 60,
            batchId: pendingProposal.batchId,
            workflowId: schedulingContext.workflowId,
            conflictWarnings: [] as string[],
          },
        ];
      },
    );
    const workException = schedulingContext.pendingWorkException;
    const suggestions = [
      ...(workException && timeBlockSuggestions.length > 0
        ? [
            {
              id: `schedule-exception-${workException.date}-${workException.relatedWorkShiftId}`,
              type: "schedule_exception" as const,
              title: "Update today’s work shift",
              description: `End work at ${workException.overrideEndTime} on ${workException.date}. This applies to this date only.`,
              confidence: 1,
              summary: "Create a one-day exception without changing the recurring shift.",
              rationale:
                "The later time block depends on today’s work shift ending early.",
              severity: "important" as const,
              exceptionDate: workException.date,
              exceptionType: workException.exceptionType,
              originalEndTime: workException.originalEndTime,
              originalStartTime: workException.originalStartTime,
              overrideEndTime: workException.overrideEndTime,
              overrideStartTime: workException.overrideStartTime,
              relatedWorkShiftId: workException.relatedWorkShiftId,
              workflowId: schedulingContext.workflowId,
              conflictWarnings: [] as string[],
            },
          ]
        : []),
      ...timeBlockSuggestions,
    ];
    const finalizedResponse = finalizeAssistantResponse({
      contextStatus,
      planningContext: context,
      prompt,
      response: {
        actions: suggestions,
        assistantMessage: schedulingTurn.message,
        context: baseWithWarning.context,
        contextStatus,
        dataWarning: warning,
        message: schedulingTurn.message,
        schedulingContext,
        source: "fallback",
        suggestions,
      },
    });
    const response = threadId
      ? await persistCanonicalWorkflowResponse({
          previous: loadedWorkflow,
          response: finalizedResponse,
          supabase: authResult.supabase,
          threadId,
          userId: authResult.userId,
        })
      : createWorkflowPersistenceFailureResponse({
          response: finalizedResponse,
          threadId: "missing-thread",
          userId: authResult.userId,
        });

    return createNdjsonStream(async (send) => {
      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
    });
  }

  const extractedItems = extractPlanningItems(prompt, context.projects);
  const multiItemClarification =
    extractedItems.length > 1
      ? createConsolidatedClarification(extractedItems)
      : null;

  if (multiItemClarification) {
    const response = finalizeAssistantResponse({
      contextStatus,
      planningContext: context,
      prompt,
      response: {
        actions: [],
        assistantMessage: multiItemClarification,
        context: baseWithWarning.context,
        contextStatus,
        dataWarning: warning,
        message: multiItemClarification,
        source: "fallback",
        suggestions: [],
      },
    });

    return createNdjsonStream(async (send) => {
      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
    });
  }

  if (activeSchedulingContext || isExplicitSchedulingRequest(prompt)) {
    const activeItems =
      activeSchedulingContext?.extractedItems?.length
        ? activeSchedulingContext.extractedItems
        : extractedItems;
    const clarification = createConsolidatedClarification(activeItems);
    const message = clarification
      ? clarification
      : "I couldn’t finish building that plan. Nothing has been scheduled. Please try again.";
    logAssistantDiagnostic("deterministic_workflow_fallback", {
      candidateCount: activeSchedulingContext?.candidateWindows.length ?? 0,
      extractedItemCount: activeItems.length,
      fallbackPath: clarification ? "clarification" : "failure",
      intent: loadedWorkflow?.workflow.intent ?? classifyAssistantIntent(prompt, activeItems),
      missingFields: activeItems.flatMap((item) => item.missingFields),
      nextState: activeSchedulingContext?.state ?? "failed",
      previousState: loadedWorkflow?.workflow.state ?? "none",
      proposalCount: loadedWorkflow?.workflow.pendingProposalIds.length ?? 0,
      threadId,
      workflowId: activeSchedulingContext?.workflowId ?? null,
    });
    const finalizedResponse = finalizeAssistantResponse({
      contextStatus,
      planningContext: context,
      prompt,
      response: {
        actions: [],
        assistantMessage: message,
        context: baseWithWarning.context,
        contextStatus,
        dataWarning: warning,
        message,
        schedulingContext: activeSchedulingContext,
        source: "fallback",
        suggestions: [],
      },
    });
    const response = threadId
      ? await persistCanonicalWorkflowResponse({
          previous: loadedWorkflow,
          response: finalizedResponse,
          supabase: authResult.supabase,
          threadId,
          userId: authResult.userId,
        })
      : createWorkflowPersistenceFailureResponse({
          response: finalizedResponse,
          threadId: "missing-thread",
          userId: authResult.userId,
        });

    return createNdjsonStream(async (send) => {
      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
    });
  }

  const fallbackResponse = createFallbackAssistantResponse(
    context,
    prompt,
    recentMessages,
  );
  const fallbackWithWarning: AssistantPlanReviewResponse = {
    ...fallbackResponse,
    assistantMessage: fallbackResponse.message,
    contextStatus,
    dataWarning: warning,
    message: fallbackResponse.message,
  };

  return createNdjsonStream(async (send) => {
    if (
      isGreetingPrompt(prompt) ||
      isVaguePrompt(prompt) ||
      (fallbackWithWarning.suggestions.length > 0 &&
        !shouldGenerateAssistantActionCards(prompt)) ||
      (hasDeterministicScheduleQuestionIntent(prompt) &&
        !shouldGenerateAssistantActionCards(prompt)) ||
      !process.env.OPENAI_API_KEY
    ) {
      logAssistantDiagnostic("generic_fallback_triggered", {
        extractedItemCount: extractedItems.length,
        fallbackPath: !process.env.OPENAI_API_KEY
          ? "openai_unavailable"
          : "deterministic_general_response",
        intent: classifyAssistantIntent(prompt, extractedItems),
        proposalCount: 0,
        threadId,
        workflowId: null,
      });
      const response = finalizeAssistantResponse({
        contextStatus,
        planningContext: context,
        prompt,
        response: fallbackWithWarning,
      });
      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
      return;
    }

    try {
      const aiResponse = await createOpenAiSuggestions(
        prompt,
        context,
        profile,
        recentMessages,
      );
      const shouldGenerateSuggestions = shouldGenerateAssistantActionCards(prompt);
      const suggestions = shouldGenerateSuggestions
        ? preserveFallbackCriticalSuggestions(
            aiResponse.suggestions,
            fallbackResponse.suggestions,
          )
        : [];
      const finalizedResponse = finalizeAssistantResponse({
        contextStatus,
        planningContext: context,
        prompt,
        response: {
          actions: suggestions,
          assistantMessage: aiResponse.message,
          context: fallbackResponse.context,
          contextStatus,
          dataWarning: warning,
          message: aiResponse.message,
          source: "ai",
          suggestions,
        },
      });
      const response =
        finalizedResponse.actions.length > 0
          ? threadId
            ? await persistCanonicalWorkflowResponse({
                previous: loadedWorkflow,
                response: finalizedResponse,
                supabase: authResult.supabase,
                threadId,
                userId: authResult.userId,
              })
            : createWorkflowPersistenceFailureResponse({
                response: finalizedResponse,
                threadId: "missing-thread",
                userId: authResult.userId,
              })
          : finalizedResponse;

      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
    } catch (error) {
      console.error("Assistant model response failed; using fallback", error);
      logAssistantDiagnostic("generic_fallback_triggered", {
        extractedItemCount: extractedItems.length,
        fallbackPath: "model_error",
        intent: classifyAssistantIntent(prompt, extractedItems),
        proposalCount: 0,
        threadId,
        workflowId: loadedWorkflow?.workflow.workflowId ?? null,
      });
      const fallbackWithError = finalizeAssistantResponse({
        contextStatus,
        planningContext: context,
        prompt,
        response: {
        ...fallbackWithWarning,
          assistantMessage: fallbackWithWarning.message,
          message: fallbackWithWarning.message,
        },
      });

      await streamFallbackMessage(fallbackWithError.message, send);
      send({ type: "final", response: fallbackWithError });
    }
  });
}
