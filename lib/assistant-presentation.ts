import type { AssistantSuggestion } from "@/lib/assistant";
import type { AssistantSchedulingContext } from "@/lib/assistant-schedule-analysis";
import type { SemanticPlanningRequest } from "@/lib/assistant-semantics";
import type { AssistantWorkflowStatus } from "@/lib/assistant-automation";

export type AssistantResponseMode =
  | "direct_answer"
  | "clarification"
  | "recommendation"
  | "proposal_summary"
  | "applied_confirmation"
  | "auto_applied"
  | "partially_applied"
  | "status_answer"
  | "undo_result"
  | "social_reply"
  | "warning"
  | "failure";

export type RelevantNotice = {
  id: string;
  message: string;
  requiresDecision: boolean;
};

export function createRelevantNoticeId(
  insight: AssistantSuggestion,
  workflowId = "general",
  sourceVersion = "v1",
) {
  const affectedDate = insight.itemDate ?? insight.exceptionDate ?? insight.day ?? "undated";
  const affectedItem = insight.projectName ?? insight.title;
  const stableIdentity = `${affectedDate}:${affectedItem}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
  return `notice:${workflowId}:${insight.type}:${stableIdentity || "general"}:${sourceVersion}`;
}

export type AssistantResponsePlan = {
  activityReference?: string;
  allowAppliedLanguage: boolean;
  allowDraftLanguage: boolean;
  appliedRecordCount: number;
  automationDecision?: {
    mode: "manual_review" | "batch_approval" | "auto_applied";
    reasonCodes: string[];
  };
  failedCount: number;
  maximumDetailLevel: "brief" | "standard" | "expanded";
  mode: AssistantResponseMode;
  needsAttentionItems: RelevantNotice[];
  primaryMessage: string;
  pendingProposalCount: number;
  proposalIds?: string[];
  showAlternatives: boolean;
  showNeedsAttention: boolean;
  workflowStatus?: AssistantWorkflowStatus;
};

export function isConversationOnlyAssistantResponseMode(
  mode?: AssistantResponseMode | null,
) {
  return mode === "social_reply" || mode === "status_answer";
}

const cannedPhrasePattern =
  /\b(?:absolutely|keep this focused|highest-impact next steps|you(?:'re| are) all set|ask for another plan|why this helps|your week stays realistic instead of crowded)\b/i;

function sharesProposalContext(
  notice: AssistantSuggestion,
  actions: AssistantSuggestion[],
) {
  return actions.some(
    (action) =>
      (notice.day && action.day === notice.day) ||
      (notice.projectName &&
        action.projectName?.toLowerCase() === notice.projectName.toLowerCase()),
  );
}

export function gateAssistantInsights({
  actions,
  insights,
  prompt,
}: {
  actions: AssistantSuggestion[];
  insights: AssistantSuggestion[];
  prompt: string;
}) {
  const explicitlyRequestsAnalysis =
    /\b(?:conflict|overlap|warning|risk|problem|overload|why|show.*notes?)\b/i.test(
      prompt,
    );
  const kept = insights.filter((insight) => {
    const text = `${insight.title} ${insight.description} ${insight.summary}`;
    const decisionRelevant =
      /\b(?:overlap|conflict|cannot|couldn.t|failed|deadline|impossible|needs? (?:your|a) (?:decision|choice)|exceed)\b/i.test(
        text,
      );
    if (!decisionRelevant) return false;
    return explicitlyRequestsAnalysis || sharesProposalContext(insight, actions);
  });

  return {
    kept,
    suppressed: insights.filter(
      (insight) => !kept.some((candidate) => candidate.id === insight.id),
    ),
  };
}

function getMode(context: AssistantSchedulingContext | null | undefined) {
  if (!context) return "direct_answer" as const;
  if (context.state === "failed") return "failure" as const;
  if (context.state === "awaiting_apply") return "proposal_summary" as const;
  if (context.state === "applied") return "applied_confirmation" as const;
  if (
    context.state === "awaiting_duration" ||
    context.state === "awaiting_session_details" ||
    context.state === "awaiting_window_selection" ||
    context.state === "needs_clarification"
  ) {
    return context.semanticRequest?.contradictions.some(
      (conflict) => !conflict.resolved,
    ) ||
      context.semanticRequest?.weeklyGoal?.recommendedPattern.status ===
        "pending"
      ? ("recommendation" as const)
      : ("clarification" as const);
  }
  return "direct_answer" as const;
}

function safePrimaryMessage(
  message: string,
  mode: AssistantResponseMode,
  context?: AssistantSchedulingContext | null,
) {
  if (!cannedPhrasePattern.test(message)) return message.trim();
  if (context?.pendingQuestion) return context.pendingQuestion;
  if (mode === "proposal_summary" && context?.seriesProposal) {
    return `I drafted ${context.seriesProposal.totalOccurrences} ${
      context.semanticRequest?.activity.title ?? "requested"
    } sessions for review.`;
  }
  return "Tell me what you want to plan, and I’ll help with the next decision.";
}

export function createAssistantResponsePlan({
  actions,
  context,
  insights,
  message,
  prompt,
}: {
  actions: AssistantSuggestion[];
  context?: AssistantSchedulingContext | null;
  insights: AssistantSuggestion[];
  message: string;
  prompt: string;
}): AssistantResponsePlan {
  const mode = getMode(context);
  const notices = gateAssistantInsights({ actions, insights, prompt }).kept.map(
    (insight) => ({
      id: createRelevantNoticeId(insight, context?.workflowId),
      message: insight.description,
      requiresDecision: true,
    }),
  );
  const asksForAllOptions =
    /\b(?:show|list|see)\s+(?:me\s+)?(?:all|every)(?:\s+\w+){0,3}\s+(?:openings?|options?|slots?|windows?)\b/i.test(
      prompt,
    );

  return {
    activityReference: context?.semanticRequest?.activity.title,
    allowAppliedLanguage: context?.state === "applied",
    allowDraftLanguage: context?.state === "awaiting_apply",
    appliedRecordCount: context?.appliedRecords.length ?? 0,
    automationDecision: context?.automationDecision
      ? {
          mode:
            context.automationDecision.outcome === "auto_apply"
              ? "auto_applied"
              : "manual_review",
          reasonCodes: context.automationDecision.reasonCodes,
        }
      : undefined,
    failedCount: 0,
    maximumDetailLevel: asksForAllOptions
      ? "expanded"
      : context?.seriesProposal
        ? "brief"
        : "standard",
    mode,
    needsAttentionItems: notices,
    primaryMessage: safePrimaryMessage(message, mode, context),
    pendingProposalCount: context?.pendingProposals.length ?? 0,
    proposalIds: actions.map((action) => action.id),
    showAlternatives: asksForAllOptions,
    showNeedsAttention: notices.length > 0,
  };
}

export function validateResponsePlan(
  plan: AssistantResponsePlan,
  semantic?: SemanticPlanningRequest | null,
) {
  const problems: string[] = [];
  if (cannedPhrasePattern.test(plan.primaryMessage)) problems.push("canned_phrase");
  if (
    semantic?.activity.title &&
    plan.mode !== "direct_answer" &&
    /\b(?:the item|project work|highest-impact)\b/i.test(plan.primaryMessage)
  ) {
    problems.push("lost_activity_reference");
  }
  if (plan.needsAttentionItems.some((item) => !item.requiresDecision)) {
    problems.push("irrelevant_notice");
  }
  return { problems, valid: problems.length === 0 };
}

export function getActionCardControls(
  status: "pending" | "approved" | "applying" | "applied" | "rejected" | "failed",
) {
  switch (status) {
    case "pending":
    case "approved":
      return ["apply", "edit", "ignore"] as const;
    case "applying":
      return ["progress"] as const;
    case "applied":
      return ["view"] as const;
    case "failed":
      return ["retry", "edit", "cancel"] as const;
    case "rejected":
      return [] as const;
  }
}
