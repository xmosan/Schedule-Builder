import type { AssistantSchedulingContext } from "@/lib/assistant-schedule-analysis";
import type { SchedulingWorkflowContext } from "@/lib/assistant-workflow";

const unsafePlaceholderPattern =
  /\b(?:planning item|untitled item|unknown activity|new task)\b|[“‘"'`]\s*item\s*[”’"'`]|^item$/i;

export function isUnsafeAssistantLabel(value?: string | null) {
  return Boolean(value && unsafePlaceholderPattern.test(value.trim()));
}

export function sanitizeAssistantUserFacingText(value: string) {
  return value
    .replace(/[“‘"'`](?:Planning item|Untitled item|Unknown activity|New task|Item)[”’"'`]/gi, "this session")
    .replace(/\b(?:Planning item|Untitled item|Unknown activity|New task)\b/gi, "this session");
}

export function getSafeAssistantLabel(
  value?: string | null,
  fallback = "Scheduled session",
) {
  if (!value?.trim() || isUnsafeAssistantLabel(value)) return fallback;
  return sanitizeAssistantUserFacingText(value.trim());
}

export function getSafeClarificationQuestion({
  activityTitle,
  question,
}: {
  activityTitle?: string | null;
  question?: string | null;
}) {
  if (!question?.trim()) return null;
  if (!isUnsafeAssistantLabel(question)) return question.trim();

  const safeTitle =
    activityTitle && !isUnsafeAssistantLabel(activityTitle)
      ? activityTitle.trim()
      : null;

  return safeTitle
    ? `How long should each ${safeTitle} session be?`
    : "How long should each session be?";
}

export function shouldRenderAssistantClarification({
  activeWorkflow,
  context,
  hasSubstantiveUserMessage,
  isSubmitting,
  latestMessageWorkflowId,
}: {
  activeWorkflow: SchedulingWorkflowContext | null;
  context: AssistantSchedulingContext | null;
  hasSubstantiveUserMessage: boolean;
  isSubmitting: boolean;
  latestMessageWorkflowId?: string | null;
}) {
  if (!activeWorkflow || !context || !hasSubstantiveUserMessage || isSubmitting) {
    return false;
  }

  if (
    activeWorkflow.workflowId !== context.workflowId ||
    latestMessageWorkflowId !== activeWorkflow.workflowId ||
    activeWorkflow.state !== "awaiting_clarification" ||
    activeWorkflow.pendingProposalIds.length > 0 ||
    context.pendingProposals.length > 0 ||
    context.pendingProposal ||
    context.state === "proposal_ready" ||
    context.state === "awaiting_apply" ||
    context.state === "applied"
  ) {
    return false;
  }

  if (
    (context.state === "awaiting_duration" ||
      context.state === "awaiting_session_details") &&
    context.requestedDurationMinutes !== null
  ) {
    return false;
  }

  return (
    activeWorkflow.missingFields.length > 0 &&
    Boolean(context.pendingQuestion?.trim())
  );
}
