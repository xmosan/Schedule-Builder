import type {
  AssistantApplyResult,
  AssistantPlanReviewResponse,
} from "@/lib/assistant";
import type { AssistantSchedulingContext } from "@/lib/assistant-schedule-analysis";

export type PersistedAssistantMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
  response?: AssistantPlanReviewResponse;
};

export type PersistedAssistantActionState = {
  editing: boolean;
  message?: string;
  result?: AssistantApplyResult;
  status:
    | "pending"
    | "dismissing"
    | "removed"
    | "applying"
    | "applied"
    | "error";
};

export type AssistantConversationSnapshot = {
  acknowledgedNoticeIds: string[];
  actionStates: Record<string, PersistedAssistantActionState>;
  activeSchedulingContext: AssistantSchedulingContext | null;
  dismissedNoticeIds: string[];
  messages: PersistedAssistantMessage[];
  openReviewMessages: Record<string, boolean>;
  threadId: string;
  updatedAt: string;
  version: 1;
};

export const assistantConversationStorageKeyBase =
  "schedule-builder:assistant-conversation";

export function getAssistantConversationStorageKey(userId: string) {
  return `${assistantConversationStorageKeyBase}:${userId}`;
}

export function createAssistantThreadId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyAssistantConversation(): AssistantConversationSnapshot {
  return {
    acknowledgedNoticeIds: [],
    actionStates: {},
    activeSchedulingContext: null,
    dismissedNoticeIds: [],
    messages: [],
    openReviewMessages: {},
    threadId: createAssistantThreadId(),
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

export function parseAssistantConversationSnapshot(
  value: unknown,
): AssistantConversationSnapshot | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<AssistantConversationSnapshot>;

  if (
    candidate.version !== 1 ||
    typeof candidate.threadId !== "string" ||
    !candidate.threadId ||
    !Array.isArray(candidate.messages) ||
    typeof candidate.actionStates !== "object" ||
    candidate.actionStates === null ||
    typeof candidate.openReviewMessages !== "object" ||
    candidate.openReviewMessages === null
  ) {
    return null;
  }

  const messages = candidate.messages
    .filter(
      (message): message is PersistedAssistantMessage =>
        typeof message === "object" &&
        message !== null &&
        typeof message.id === "string" &&
        (message.role === "assistant" || message.role === "user") &&
        typeof message.content === "string",
    )
    .slice(-100);

  return {
    acknowledgedNoticeIds: Array.isArray(candidate.acknowledgedNoticeIds)
      ? candidate.acknowledgedNoticeIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    actionStates: candidate.actionStates as Record<
      string,
      PersistedAssistantActionState
    >,
    activeSchedulingContext: candidate.activeSchedulingContext ?? null,
    dismissedNoticeIds: Array.isArray(candidate.dismissedNoticeIds)
      ? candidate.dismissedNoticeIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    messages,
    openReviewMessages: candidate.openReviewMessages as Record<string, boolean>,
    threadId: candidate.threadId,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
    version: 1,
  };
}

export function readLocalAssistantConversation(userId: string) {
  try {
    const raw = window.localStorage.getItem(
      getAssistantConversationStorageKey(userId),
    );

    return raw
      ? parseAssistantConversationSnapshot(JSON.parse(raw) as unknown)
      : null;
  } catch {
    return null;
  }
}

export function writeLocalAssistantConversation(
  userId: string,
  snapshot: AssistantConversationSnapshot,
) {
  window.localStorage.setItem(
    getAssistantConversationStorageKey(userId),
    JSON.stringify(snapshot),
  );
}

export function clearLocalAssistantConversation(userId: string) {
  window.localStorage.removeItem(getAssistantConversationStorageKey(userId));
}
