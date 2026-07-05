import type { AssistantSuggestion } from "@/lib/assistant";
import type { AssistantSchedulingContext } from "@/lib/assistant-schedule-analysis";
import type {
  AssistantCompletionStatus,
  AssistantIntent,
  ExtractedPlanningItem,
} from "@/lib/assistant-intelligence";
import { parseStartTimeToMinutes, weekDays } from "@/lib/weekly-plan";
import { isCommandDerivedTitle } from "@/lib/assistant-semantics";

export const schedulingWorkflowStates = [
  "idle",
  "understanding_request",
  "awaiting_clarification",
  "calculating_availability",
  "proposal_ready",
  "awaiting_approval",
  "applying",
  "applied",
  "failed",
] as const;

export type SchedulingWorkflowState = (typeof schedulingWorkflowStates)[number];

export const proposalApprovalStatuses = [
  "pending",
  "approved",
  "rejected",
  "applied",
] as const;

export type ProposalApprovalStatus = (typeof proposalApprovalStatuses)[number];
export type ProposalConflictStatus = "clear" | "conflict" | "needs_revalidation";
export type ProposalPersistenceStatus = "not_required" | "persisted" | "failed";

export type TimeBlockProposal = {
  actionType: "create_time_block";
  approvalStatus: ProposalApprovalStatus;
  conflictStatus: ProposalConflictStatus;
  date: string;
  details?: string;
  durationMinutes: number;
  endTime: string;
  id: string;
  purpose?: string;
  relatedProjectId?: string;
  startTime: string;
  title: string;
  workflowId: string;
};

export type CanonicalAssistantProposal = {
  actionType:
    | "create_time_block"
    | "create_scheduled_item"
    | "create_project"
    | "update_project"
    | "update_next_action"
    | "update_schedule_exception";
  approvalStatus: ProposalApprovalStatus;
  batchId: string | null;
  conflictStatus: ProposalConflictStatus;
  createdAt: string;
  id: string;
  savedRecordId: string | null;
  suggestion: AssistantSuggestion;
  timeBlock: TimeBlockProposal | null;
  updatedAt: string;
  workflowId: string;
};

export type ProposalBatch = {
  id: string;
  proposalIds: string[];
  status: "pending" | "partially_applied" | "applied" | "rejected";
  title: string;
  workflowId: string;
};

export type SchedulingWorkflowContext = {
  appliedProposalIds: string[];
  completionStatus: AssistantCompletionStatus;
  context: AssistantSchedulingContext | null;
  extractedItems: ExtractedPlanningItem[];
  intent: AssistantIntent;
  lastUpdatedAt: string;
  missingFields: string[];
  pendingProposalIds: string[];
  persistenceStatus: ProposalPersistenceStatus;
  proposalIds: string[];
  selectedCandidateIds: string[];
  state: SchedulingWorkflowState;
  threadId: string;
  userId: string;
  workflowId: string;
};

export type ProposalResultUpdate = {
  approvalStatus: ProposalApprovalStatus;
  proposalId: string;
  savedRecordId?: string | null;
};

const actionableTypes = new Set<AssistantSuggestion["type"]>([
  "new_project",
  "update_project",
  "suggested_scheduled_item",
  "suggested_weekly_block",
  "suggested_next_action",
  "schedule_exception",
]);

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

export function isAssistantMutationSuggestion(
  suggestion: AssistantSuggestion,
) {
  return actionableTypes.has(suggestion.type);
}

export function getCanonicalActionType(
  suggestion: AssistantSuggestion,
): CanonicalAssistantProposal["actionType"] | null {
  switch (suggestion.type) {
    case "suggested_weekly_block":
      return "create_time_block";
    case "suggested_scheduled_item":
      return "create_scheduled_item";
    case "new_project":
      return "create_project";
    case "update_project":
      return "update_project";
    case "suggested_next_action":
      return "update_next_action";
    case "schedule_exception":
      return "update_schedule_exception";
    default:
      return null;
  }
}

export function validateMutationSuggestion(suggestion: AssistantSuggestion) {
  const actionType = getCanonicalActionType(suggestion);
  if (!actionType) return "Analysis notes cannot be persisted as proposals.";
  if (typeof suggestion.id !== "string" || !suggestion.id.trim()) {
    return "Proposal ID is required.";
  }
  if (typeof suggestion.title !== "string" || !suggestion.title.trim()) {
    return "Proposal title is required.";
  }
  if (
    typeof suggestion.workflowId !== "string" ||
    !suggestion.workflowId.trim()
  ) {
    return "Workflow ID is required.";
  }

  if (suggestion.type === "suggested_weekly_block") {
    if (
      typeof suggestion.projectName !== "string" ||
      !suggestion.projectName.trim()
    ) {
      return "Time-block title is required.";
    }
    if (isCommandDerivedTitle(suggestion.projectName)) {
      return "Time-block title must describe the activity, not the scheduling command.";
    }
    if (
      typeof suggestion.itemDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(suggestion.itemDate)
    ) {
      return "Time-block date is required.";
    }
    if (!suggestion.day || !weekDays.includes(suggestion.day)) {
      return "Time-block weekday is required.";
    }
    if (typeof suggestion.startTime !== "string" || !suggestion.startTime) {
      return "Timed proposals require a start time.";
    }
    if (
      typeof suggestion.estimatedHours !== "number" ||
      !Number.isFinite(suggestion.estimatedHours) ||
      suggestion.estimatedHours <= 0
    ) {
      return "Time-block duration is required.";
    }
    if (parseStartTimeToMinutes(suggestion.startTime) === null) {
      return "Time-block start time is invalid.";
    }
  }

  if (suggestion.type === "suggested_scheduled_item") {
    if (
      typeof suggestion.itemDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(suggestion.itemDate)
    ) {
      return "Scheduled-item date is required.";
    }
    if (
      typeof suggestion.estimatedHours !== "number" ||
      !Number.isFinite(suggestion.estimatedHours) ||
      suggestion.estimatedHours <= 0
    ) {
      return "Scheduled-item duration is required.";
    }
  }

  return null;
}

export function createCanonicalProposal(
  suggestion: AssistantSuggestion,
  now = new Date().toISOString(),
): CanonicalAssistantProposal | null {
  const validationError = validateMutationSuggestion(suggestion);
  const actionType = getCanonicalActionType(suggestion);
  if (validationError || !actionType || !suggestion.workflowId) return null;

  const timeBlock =
    suggestion.type === "suggested_weekly_block" &&
    suggestion.itemDate &&
    suggestion.startTime &&
    suggestion.estimatedHours
      ? (() => {
          const startMinutes = parseStartTimeToMinutes(suggestion.startTime);
          if (startMinutes === null) return null;
          return {
            actionType: "create_time_block" as const,
            approvalStatus: "pending" as const,
            conflictStatus: "clear" as const,
            date: suggestion.itemDate,
            details: suggestion.plannedTask,
            durationMinutes: Math.round(suggestion.estimatedHours * 60),
            endTime: minutesToTime(
              startMinutes + Math.round(suggestion.estimatedHours * 60),
            ),
            id: suggestion.id,
            purpose: suggestion.plannedTask,
            startTime: suggestion.startTime,
            title: suggestion.projectName ?? suggestion.title,
            workflowId: suggestion.workflowId,
          } satisfies TimeBlockProposal;
        })()
      : null;

  return {
    actionType,
    approvalStatus: "pending",
    batchId: suggestion.batchId ?? null,
    conflictStatus: "clear",
    createdAt: now,
    id: suggestion.id,
    savedRecordId: null,
    suggestion,
    timeBlock,
    updatedAt: now,
    workflowId: suggestion.workflowId,
  };
}

export function getCanonicalWorkflowState(
  context: AssistantSchedulingContext | null,
  proposalCount: number,
): SchedulingWorkflowState {
  if (!context) return "idle";
  if (context.state === "failed") return "failed";
  if (context.state === "applied") return "applied";
  if (context.state === "calculating_availability") {
    return "calculating_availability";
  }
  if (
    context.state === "awaiting_duration" ||
    context.state === "awaiting_session_details" ||
    context.state === "awaiting_title" ||
    context.state === "awaiting_window_selection" ||
    context.state === "needs_clarification"
  ) {
    return "awaiting_clarification";
  }
  if (proposalCount > 0 || context.state === "awaiting_apply") {
    return "awaiting_approval";
  }
  return "understanding_request";
}

export function createProposalBatch(
  workflowId: string,
  proposals: CanonicalAssistantProposal[],
  title: string,
): ProposalBatch | null {
  if (proposals.length === 0) return null;
  const batchId =
    proposals.find((proposal) => proposal.batchId)?.batchId ??
    `batch-${workflowId}`;
  return {
    id: batchId,
    proposalIds: proposals.map((proposal) => proposal.id),
    status: "pending",
    title,
    workflowId,
  };
}

export function getCanonicalPendingProposals(
  workflow: SchedulingWorkflowContext,
  proposals: CanonicalAssistantProposal[],
) {
  const pendingIds = new Set(workflow.pendingProposalIds);
  return proposals.filter(
    (proposal) =>
      proposal.workflowId === workflow.workflowId &&
      proposal.approvalStatus === "pending" &&
      pendingIds.has(proposal.id),
  );
}

export function deriveAssistantWorkflowAfterProposalUpdates(
  workflow: SchedulingWorkflowContext,
  proposals: CanonicalAssistantProposal[],
  updates: ProposalResultUpdate[],
  now = new Date().toISOString(),
) {
  const updateById = new Map(
    updates.map((update) => [update.proposalId, update]),
  );
  const updatedProposals = proposals.map((proposal) => {
    const update = updateById.get(proposal.id);
    return update
      ? {
          ...proposal,
          approvalStatus: update.approvalStatus,
          savedRecordId: update.savedRecordId ?? null,
          updatedAt: now,
        }
      : proposal;
  });
  const appliedProposalIds = updatedProposals
    .filter((proposal) => proposal.approvalStatus === "applied")
    .map((proposal) => proposal.id);
  const pendingProposalIds = updatedProposals
    .filter((proposal) => proposal.approvalStatus === "pending")
    .map((proposal) => proposal.id);
  const hasAppliedProposals = appliedProposalIds.length > 0;
  const hasPendingProposals = pendingProposalIds.length > 0;
  const nextWorkflow: SchedulingWorkflowContext = {
    ...workflow,
    appliedProposalIds,
    completionStatus: hasAppliedProposals
      ? "records_applied"
      : hasPendingProposals
        ? "proposal_created"
        : "nothing_created",
    context:
      workflow.context && (hasAppliedProposals || hasPendingProposals)
        ? {
            ...workflow.context,
            appliedRecords: updatedProposals.flatMap((proposal) => {
              const timeBlock = proposal.timeBlock;
              return proposal.approvalStatus === "applied" &&
                proposal.savedRecordId &&
                timeBlock
                ? [
                    {
                      date: timeBlock.date,
                      endTime: timeBlock.endTime,
                      id: proposal.savedRecordId,
                      proposalId: proposal.id,
                      startTime: timeBlock.startTime,
                      title: timeBlock.title,
                    },
                  ]
                : [];
            }),
            lastUpdatedAt: now,
            seriesProposal: workflow.context.seriesProposal
              ? {
                  ...workflow.context.seriesProposal,
                  status:
                    !hasPendingProposals && hasAppliedProposals
                      ? "applied"
                      : hasAppliedProposals
                        ? "partially_applied"
                        : "pending",
                }
              : null,
            state:
              !hasPendingProposals && hasAppliedProposals
                ? "applied"
                : "awaiting_apply",
          }
        : null,
    lastUpdatedAt: now,
    pendingProposalIds,
    state:
      !hasPendingProposals && hasAppliedProposals
        ? "applied"
        : hasPendingProposals
          ? "awaiting_approval"
          : "idle",
  };

  return { proposals: updatedProposals, workflow: nextWorkflow };
}

export function getProposalBatchStatus(
  workflow: SchedulingWorkflowContext,
): ProposalBatch["status"] {
  if (
    workflow.pendingProposalIds.length === 0 &&
    workflow.appliedProposalIds.length > 0
  ) {
    return "applied";
  }
  if (workflow.pendingProposalIds.length === 0) return "rejected";
  if (workflow.appliedProposalIds.length > 0) return "partially_applied";
  return "pending";
}
