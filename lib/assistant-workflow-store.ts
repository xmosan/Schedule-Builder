import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantSuggestion } from "@/lib/assistant";
import { normalizeAssistantSchedulingContext } from "@/lib/assistant-schedule-analysis";
import type { ExtractedPlanningItem } from "@/lib/assistant-intelligence";
import {
  proposalApprovalStatuses,
  schedulingWorkflowStates,
  deriveAssistantWorkflowAfterProposalUpdates,
  getCanonicalActionType,
  getProposalBatchStatus,
  validateMutationSuggestion,
  type CanonicalAssistantProposal,
  type ProposalResultUpdate,
  type ProposalBatch,
  type SchedulingWorkflowContext,
} from "@/lib/assistant-workflow";

type WorkflowRow = {
  applied_proposal_ids: string[] | null;
  completion_status: SchedulingWorkflowContext["completionStatus"];
  context: unknown;
  extracted_items: unknown;
  intent: SchedulingWorkflowContext["intent"];
  last_updated_at: string;
  missing_fields: string[] | null;
  pending_proposal_ids: string[] | null;
  persistence_status: SchedulingWorkflowContext["persistenceStatus"];
  proposal_ids: string[] | null;
  selected_candidate_ids: string[] | null;
  state: SchedulingWorkflowContext["state"];
  thread_id: string;
  user_id: string;
  workflow_id: string;
};

type ProposalRow = {
  action_type: CanonicalAssistantProposal["actionType"];
  approval_status: CanonicalAssistantProposal["approvalStatus"];
  batch_id: string | null;
  conflict_status: CanonicalAssistantProposal["conflictStatus"];
  created_at: string;
  payload: unknown;
  proposal_id: string;
  saved_record_id: string | null;
  time_block: unknown;
  updated_at: string;
  workflow_id: string;
};

type BatchRow = {
  batch_id: string;
  proposal_ids: string[];
  status: ProposalBatch["status"];
  title: string;
  workflow_id: string;
};

export type LoadedAssistantWorkflow = {
  batch: ProposalBatch | null;
  proposals: CanonicalAssistantProposal[];
  workflow: SchedulingWorkflowContext;
};

export function isMissingAssistantWorkflowSchema(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42P01" ||
    candidate.code === "PGRST202" ||
    candidate.code === "PGRST205" ||
    /assistant_(?:workflows|proposals|proposal_batches)|persist_assistant_workflow/i.test(
      candidate.message ?? "",
    )
  );
}

function parseWorkflowRow(row: WorkflowRow): SchedulingWorkflowContext | null {
  if (
    !row.workflow_id ||
    !row.thread_id ||
    !row.user_id ||
    !schedulingWorkflowStates.includes(row.state)
  ) {
    return null;
  }

  return {
    appliedProposalIds: row.applied_proposal_ids ?? [],
    completionStatus: row.completion_status,
    context: normalizeAssistantSchedulingContext(row.context),
    extractedItems: Array.isArray(row.extracted_items)
      ? (row.extracted_items as ExtractedPlanningItem[])
      : [],
    intent: row.intent,
    lastUpdatedAt: row.last_updated_at,
    missingFields: row.missing_fields ?? [],
    pendingProposalIds: row.pending_proposal_ids ?? [],
    persistenceStatus: row.persistence_status,
    proposalIds: row.proposal_ids ?? [],
    selectedCandidateIds: row.selected_candidate_ids ?? [],
    state: row.state,
    threadId: row.thread_id,
    userId: row.user_id,
    workflowId: row.workflow_id,
  };
}

function parseProposalRow(row: ProposalRow): CanonicalAssistantProposal | null {
  const suggestion = row.payload as AssistantSuggestion;
  if (
    !row.proposal_id ||
    !row.workflow_id ||
    !proposalApprovalStatuses.includes(row.approval_status) ||
    typeof row.payload !== "object" ||
    row.payload === null ||
    validateMutationSuggestion(suggestion) ||
    suggestion.id !== row.proposal_id ||
    suggestion.workflowId !== row.workflow_id ||
    getCanonicalActionType(suggestion) !== row.action_type
  ) {
    return null;
  }

  return {
    actionType: row.action_type,
    approvalStatus: row.approval_status,
    batchId: row.batch_id,
    conflictStatus: row.conflict_status,
    createdAt: row.created_at,
    id: row.proposal_id,
    savedRecordId: row.saved_record_id,
    suggestion,
    timeBlock:
      typeof row.time_block === "object" && row.time_block !== null
        ? (row.time_block as CanonicalAssistantProposal["timeBlock"])
        : null,
    updatedAt: row.updated_at,
    workflowId: row.workflow_id,
  };
}

function parseBatchRow(row: BatchRow | null): ProposalBatch | null {
  return row
    ? {
        id: row.batch_id,
        proposalIds: row.proposal_ids ?? [],
        status: row.status,
        title: row.title,
        workflowId: row.workflow_id,
      }
    : null;
}

export async function loadAssistantWorkflow(
  supabase: SupabaseClient,
  userId: string,
  threadId: string,
): Promise<{ data: LoadedAssistantWorkflow | null; error: unknown | null }> {
  const workflowResult = await supabase
    .from("assistant_workflows")
    .select(
      "workflow_id, thread_id, user_id, state, intent, extracted_items, missing_fields, selected_candidate_ids, proposal_ids, pending_proposal_ids, applied_proposal_ids, completion_status, persistence_status, context, last_updated_at",
    )
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("last_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (workflowResult.error) return { data: null, error: workflowResult.error };
  if (!workflowResult.data) return { data: null, error: null };

  const workflow = parseWorkflowRow(workflowResult.data as WorkflowRow);
  if (!workflow) return { data: null, error: new Error("Stored workflow is invalid.") };

  const [proposalResult, batchResult] = await Promise.all([
    supabase
      .from("assistant_proposals")
      .select(
        "proposal_id, workflow_id, batch_id, action_type, approval_status, conflict_status, saved_record_id, payload, time_block, created_at, updated_at",
      )
      .eq("user_id", userId)
      .eq("workflow_id", workflow.workflowId)
      .order("created_at", { ascending: true }),
    supabase
      .from("assistant_proposal_batches")
      .select("batch_id, workflow_id, title, proposal_ids, status")
      .eq("user_id", userId)
      .eq("workflow_id", workflow.workflowId)
      .maybeSingle(),
  ]);

  if (proposalResult.error || batchResult.error) {
    return { data: null, error: proposalResult.error ?? batchResult.error };
  }

  const proposals = (proposalResult.data ?? [])
    .map((row) => parseProposalRow(row as ProposalRow))
    .filter((proposal): proposal is CanonicalAssistantProposal => Boolean(proposal));

  return {
    data: {
      batch: parseBatchRow((batchResult.data as BatchRow | null) ?? null),
      proposals,
      workflow,
    },
    error: null,
  };
}

export async function loadAssistantWorkflowById(
  supabase: SupabaseClient,
  userId: string,
  workflowId: string,
) {
  const result = await supabase
    .from("assistant_workflows")
    .select("thread_id")
    .eq("user_id", userId)
    .eq("workflow_id", workflowId)
    .maybeSingle();
  if (result.error) return { data: null, error: result.error };
  if (!result.data?.thread_id) return { data: null, error: null };
  return loadAssistantWorkflow(supabase, userId, result.data.thread_id);
}

export async function persistAssistantWorkflow(
  supabase: SupabaseClient,
  workflow: SchedulingWorkflowContext,
  proposals: CanonicalAssistantProposal[],
  batch: ProposalBatch | null,
) {
  const workflowPayload = {
    applied_proposal_ids: workflow.appliedProposalIds,
    completion_status: workflow.completionStatus,
    context: workflow.context,
    extracted_items: workflow.extractedItems,
    intent: workflow.intent,
    last_updated_at: workflow.lastUpdatedAt,
    missing_fields: workflow.missingFields,
    pending_proposal_ids: workflow.pendingProposalIds,
    persistence_status: "persisted",
    proposal_ids: workflow.proposalIds,
    selected_candidate_ids: workflow.selectedCandidateIds,
    state: workflow.state,
    thread_id: workflow.threadId,
    user_id: workflow.userId,
    workflow_id: workflow.workflowId,
  };
  const proposalPayload = proposals.map((proposal) => ({
    action_type: proposal.actionType,
    approval_status: proposal.approvalStatus,
    batch_id: proposal.batchId,
    conflict_status: proposal.conflictStatus,
    created_at: proposal.createdAt,
    payload: proposal.suggestion,
    proposal_id: proposal.id,
    saved_record_id: proposal.savedRecordId,
    time_block: proposal.timeBlock,
    updated_at: proposal.updatedAt,
    user_id: workflow.userId,
    workflow_id: proposal.workflowId,
  }));
  const batchPayload = batch
    ? {
        batch_id: batch.id,
        proposal_ids: batch.proposalIds,
        status: batch.status,
        title: batch.title,
        user_id: workflow.userId,
        workflow_id: batch.workflowId,
      }
    : null;
  const result = await supabase.rpc("persist_assistant_workflow", {
    p_batch: batchPayload,
    p_proposals: proposalPayload,
    p_workflow: workflowPayload,
  });

  if (result.error) return { data: null, error: result.error };
  return loadAssistantWorkflow(supabase, workflow.userId, workflow.threadId);
}

export async function updateAssistantProposalResults(
  supabase: SupabaseClient,
  workflow: SchedulingWorkflowContext,
  updates: ProposalResultUpdate[],
) {
  const now = new Date().toISOString();
  const loaded = await loadAssistantWorkflow(
    supabase,
    workflow.userId,
    workflow.threadId,
  );
  if (loaded.error || !loaded.data) return loaded;

  const next = deriveAssistantWorkflowAfterProposalUpdates(
    loaded.data.workflow,
    loaded.data.proposals,
    updates,
    now,
  );
  const nextBatch = loaded.data.batch
    ? {
        ...loaded.data.batch,
        status: getProposalBatchStatus(next.workflow),
      }
    : null;

  return persistAssistantWorkflow(
    supabase,
    next.workflow,
    next.proposals,
    nextBatch,
  );
}
