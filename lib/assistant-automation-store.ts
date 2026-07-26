import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AutomationGrant,
  CompactActionReceipt,
  PlanningDecisionRecord,
} from "@/lib/assistant-automation";

type StoreResult<T> = { data: T | null; error: unknown | null };
const assistantActionHistoryLookbackMs = 7 * 24 * 60 * 60 * 1000;

function mapPlanningDecisionRow(row: Record<string, unknown>) {
  return {
    actionType: row.action_type,
    afterState: row.after_state,
    automationMode: row.automation_mode,
    beforeState: row.before_state,
    constraintsUsed: row.constraints_used ?? [],
    createdAt: row.created_at,
    grantId: row.grant_id ?? undefined,
    id: row.decision_id,
    preferencesUsed: row.preferences_used ?? [],
    proposalIds: row.proposal_ids ?? [],
    reasonCodes: row.reason_codes ?? [],
    reversibleUntil: row.reversible_until ?? undefined,
    reversedAt: row.reversed_at ?? undefined,
    scheduleExceptionIds: row.schedule_exception_ids ?? [],
    status: row.status,
    targetRecordIds: row.target_record_ids ?? [],
    userId: row.user_id,
    workflowId: row.workflow_id,
  } as PlanningDecisionRecord;
}

export async function persistAutomationGrant(
  supabase: SupabaseClient,
  grant: AutomationGrant,
): Promise<StoreResult<AutomationGrant>> {
  const result = await supabase
    .from("assistant_automation_grants")
    .upsert(
      {
        activity_title: grant.activityTitle ?? null,
        allowed_actions: grant.allowedActions,
        expires_at: grant.expiresAt ?? null,
        grant_id: grant.id,
        guardrails: grant.guardrails,
        related_project_id: grant.relatedProjectId ?? null,
        scope: grant.scope,
        source_message_id: grant.sourceMessageId,
        status: grant.status,
        user_id: grant.userId,
        workflow_id: grant.workflowId,
      },
      { onConflict: "grant_id" },
    )
    .select("grant_id")
    .single();

  return result.error
    ? { data: null, error: result.error }
    : { data: grant, error: null };
}

export async function loadAutomationGrantById(
  supabase: SupabaseClient,
  userId: string,
  grantId: string,
): Promise<StoreResult<AutomationGrant>> {
  const result = await supabase
    .from("assistant_automation_grants")
    .select(
      "grant_id, workflow_id, user_id, source_message_id, scope, allowed_actions, activity_title, related_project_id, guardrails, expires_at, status",
    )
    .eq("grant_id", grantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }
  const row = result.data;
  return {
    data: {
      activityTitle: row.activity_title ?? undefined,
      allowedActions: row.allowed_actions,
      expiresAt: row.expires_at ?? undefined,
      guardrails: row.guardrails,
      id: row.grant_id,
      relatedProjectId: row.related_project_id ?? undefined,
      scope: row.scope,
      sourceMessageId: row.source_message_id,
      status: row.status,
      userId: row.user_id,
      workflowId: row.workflow_id,
    } as AutomationGrant,
    error: null,
  };
}

export async function updateAutomationGrantStatus(
  supabase: SupabaseClient,
  userId: string,
  grantId: string,
  status: AutomationGrant["status"],
) {
  const result = await supabase
    .from("assistant_automation_grants")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("grant_id", grantId)
    .eq("user_id", userId);
  return { error: result.error };
}

export async function persistPlanningDecision(
  supabase: SupabaseClient,
  decision: PlanningDecisionRecord,
): Promise<StoreResult<PlanningDecisionRecord>> {
  const result = await supabase
    .from("assistant_planning_decisions")
    .upsert(
      {
        action_type: decision.actionType,
        after_state: decision.afterState ?? null,
        automation_mode: decision.automationMode,
        before_state: decision.beforeState ?? null,
        constraints_used: decision.constraintsUsed,
        created_at: decision.createdAt,
        decision_id: decision.id,
        grant_id: decision.grantId ?? null,
        preferences_used: decision.preferencesUsed,
        proposal_ids: decision.proposalIds,
        reason_codes: decision.reasonCodes,
        reversible_until: decision.reversibleUntil ?? null,
        reversed_at: decision.reversedAt ?? null,
        schedule_exception_ids: decision.scheduleExceptionIds ?? [],
        status: decision.status,
        target_record_ids: decision.targetRecordIds,
        user_id: decision.userId,
        workflow_id: decision.workflowId,
      },
      { onConflict: "decision_id" },
    )
    .select("decision_id")
    .single();
  return result.error
    ? { data: null, error: result.error }
    : { data: decision, error: null };
}

export async function persistActionReceipt(
  supabase: SupabaseClient,
  receipt: CompactActionReceipt,
): Promise<StoreResult<CompactActionReceipt>> {
  const result = await supabase
    .from("assistant_action_receipts")
    .upsert(
      {
        action_type: receipt.actionType,
        available_actions: receipt.availableActions,
        created_at: receipt.createdAt,
        decision_record_id: receipt.decisionRecordId ?? null,
        item_count: receipt.itemCount,
        next_occurrence_at: receipt.nextOccurrenceAt ?? null,
        primary_time: receipt.primaryTime ?? null,
        receipt_id: receipt.id,
        summary: receipt.summary,
        title: receipt.title,
        user_id: receipt.userId,
      },
      { onConflict: "receipt_id" },
    )
    .select("receipt_id")
    .single();
  return result.error
    ? { data: null, error: result.error }
    : { data: receipt, error: null };
}

export async function loadLatestReversibleDecision(
  supabase: SupabaseClient,
  userId: string,
  workflowId?: string,
) {
  let query = supabase
    .from("assistant_planning_decisions")
    .select(
      "decision_id, workflow_id, user_id, action_type, automation_mode, grant_id, proposal_ids, target_record_ids, reason_codes, preferences_used, constraints_used, schedule_exception_ids, before_state, after_state, status, reversible_until, reversed_at, created_at",
    )
    .eq("user_id", userId)
    .in("status", ["applied", "partially_applied"])
    .is("reversed_at", null)
    .gt("reversible_until", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (workflowId) query = query.eq("workflow_id", workflowId);
  const result = await query.maybeSingle();
  if (result.error || !result.data) return { data: null, error: result.error };
  return {
    data: mapPlanningDecisionRow(result.data),
    error: null,
  };
}

export async function loadLatestAssistantDecision(
  supabase: SupabaseClient,
  userId: string,
  workflowId?: string,
  options?: { recentOnly?: boolean },
) {
  let query = supabase
    .from("assistant_planning_decisions")
    .select(
      "decision_id, workflow_id, user_id, action_type, automation_mode, grant_id, proposal_ids, target_record_ids, reason_codes, preferences_used, constraints_used, schedule_exception_ids, before_state, after_state, status, reversible_until, reversed_at, created_at",
    )
    .eq("user_id", userId)
    .in("status", ["applied", "partially_applied", "undone"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (workflowId) query = query.eq("workflow_id", workflowId);
  if (options?.recentOnly) {
    query = query.gte(
      "created_at",
      new Date(Date.now() - assistantActionHistoryLookbackMs).toISOString(),
    );
  }
  const result = await query.maybeSingle();
  if (result.error || !result.data) return { data: null, error: result.error };
  return {
    data: mapPlanningDecisionRow(result.data),
    error: null,
  };
}

export async function loadAssistantActionHistoryForCommand(
  supabase: SupabaseClient,
  userId: string,
  workflowId?: string,
) {
  const [workflowLatest, workflowReversible] = workflowId
    ? await Promise.all([
        loadLatestAssistantDecision(supabase, userId, workflowId),
        loadLatestReversibleDecision(supabase, userId, workflowId),
      ])
    : [
        { data: null, error: null },
        { data: null, error: null },
      ];

  if (workflowLatest.data || workflowLatest.error || workflowReversible.error) {
    return {
      latestAssistantAction: workflowLatest.data,
      latestReversibleAction: workflowReversible.data,
      error: workflowLatest.error ?? workflowReversible.error,
      scope: "workflow" as const,
    };
  }

  const [recentLatest, recentReversible] = await Promise.all([
    loadLatestAssistantDecision(supabase, userId, undefined, {
      recentOnly: true,
    }),
    loadLatestReversibleDecision(supabase, userId),
  ]);
  const latestReversibleAction =
    recentReversible.data &&
    new Date(recentReversible.data.createdAt).getTime() >=
      Date.now() - assistantActionHistoryLookbackMs
      ? recentReversible.data
      : null;
  return {
    latestAssistantAction: recentLatest.data,
    latestReversibleAction,
    error: recentLatest.error ?? recentReversible.error,
    scope: "recent_user" as const,
  };
}

export async function loadReceiptForDecision(
  supabase: SupabaseClient,
  userId: string,
  decisionId: string,
) {
  const result = await supabase
    .from("assistant_action_receipts")
    .select(
      "receipt_id, user_id, title, summary, action_type, item_count, primary_time, next_occurrence_at, available_actions, decision_record_id, created_at",
    )
    .eq("user_id", userId)
    .eq("decision_record_id", decisionId)
    .maybeSingle();
  if (result.error || !result.data) return { data: null, error: result.error };
  const row = result.data;
  return {
    data: {
      actionType: row.action_type,
      availableActions: row.available_actions ?? [],
      createdAt: row.created_at,
      decisionRecordId: row.decision_record_id ?? undefined,
      id: row.receipt_id,
      itemCount: row.item_count,
      nextOccurrenceAt: row.next_occurrence_at ?? undefined,
      primaryTime: row.primary_time ?? undefined,
      summary: row.summary,
      title: row.title,
      userId: row.user_id,
    } as CompactActionReceipt,
    error: null,
  };
}
