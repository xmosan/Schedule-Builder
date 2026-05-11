"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type AssistantApplyResponse,
  type AssistantContextSummary,
  type AssistantPlanReviewResponse,
  type AssistantSuggestion,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { weekDays, type WeekDay } from "@/lib/weekly-plan";
import { cn } from "@/lib/utils";

type AssistantStatus = "loading" | "ready" | "signed_out" | "error";
type ChatRole = "assistant" | "user";
type ActionStatus = "pending" | "ignored" | "applying" | "applied" | "error";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  response?: AssistantPlanReviewResponse;
};

type ActionState = {
  editing: boolean;
  message?: string;
  status: ActionStatus;
};

const examplePrompts = [
  "Plan my week",
  "Balance school and work",
  "Find open time",
  "Create study blocks",
  "Suggest my Top 3",
];

const suggestionTypeLabels: Record<AssistantSuggestionType, string> = {
  suggested_weekly_block: "Schedule idea",
  suggested_next_action: "Next action",
  workload_warning: "Workload note",
  missing_deadline_warning: "Deadline note",
  unclear_project_warning: "Clarity note",
};

const suggestionTypeStyles: Record<AssistantSuggestionType, string> = {
  suggested_weekly_block: "border-brand-teal/20 bg-brand-teal/10 text-brand-teal",
  suggested_next_action: "border-brand-ocean/20 bg-brand-ocean/10 text-brand-ocean",
  workload_warning: "border-[#e7c783] bg-[#fff8e6] text-[#8a5d0a]",
  missing_deadline_warning: "border-brand-coral/20 bg-brand-coral/10 text-brand-coral",
  unclear_project_warning: "border-brand-ink/10 bg-brand-ink/5 text-brand-ink/70",
};

const suggestionMarkerStyles: Record<AssistantSuggestionType, string> = {
  suggested_weekly_block: "bg-brand-teal",
  suggested_next_action: "bg-brand-ocean",
  workload_warning: "bg-[#c99725]",
  missing_deadline_warning: "bg-brand-coral",
  unclear_project_warning: "bg-brand-ink/50",
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

  return "Planning Assistant is unavailable right now.";
}

function isActionableSuggestion(suggestion: AssistantSuggestion) {
  return (
    suggestion.type === "suggested_weekly_block" ||
    suggestion.type === "suggested_next_action"
  );
}

function isEditableSuggestion(suggestion: AssistantSuggestion) {
  return isActionableSuggestion(suggestion);
}

function getActions(response?: AssistantPlanReviewResponse) {
  return response?.actions?.length ? response.actions : response?.suggestions ?? [];
}

function normalizeResponseForChat(
  response: AssistantPlanReviewResponse,
  messageId: string,
): AssistantPlanReviewResponse {
  const actions = getActions(response).map((suggestion, index) => ({
    ...suggestion,
    id: `${messageId}-${suggestion.id || index + 1}`,
  }));

  return {
    ...response,
    actions,
    suggestions: actions,
  };
}

function AssistantContextDetails({
  context,
}: {
  context?: AssistantContextSummary;
}) {
  if (!context) return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-brand-ink/5 bg-brand-ink/5 px-3 py-1.5 text-[11px] font-semibold text-brand-ink/60 sm:text-xs">
      <FolderStackIcon className="h-3.5 w-3.5 text-brand-teal/70 shrink-0" />
      <span className="truncate">
        Using your schedule context: {context.activeProjectsCount} projects • {context.plannedWeeklyHours}h planned • {context.weeklyBlocksCount} blocks
      </span>
    </div>
  );
}


function updateSuggestionInResponse(
  response: AssistantPlanReviewResponse,
  suggestionId: string,
  patch: Partial<AssistantSuggestion>,
): AssistantPlanReviewResponse {
  const update = (suggestion: AssistantSuggestion) =>
    suggestion.id === suggestionId ? { ...suggestion, ...patch } : suggestion;

  return {
    ...response,
    actions: response.actions.map(update),
    suggestions: response.suggestions.map(update),
  };
}

function ActionCard({
  actionState,
  index,
  onApply,
  onIgnore,
  onToggleEdit,
  onUpdate,
  suggestion,
}: {
  actionState: ActionState;
  index: number;
  onApply: () => void;
  onIgnore: () => void;
  onToggleEdit: () => void;
  onUpdate: (patch: Partial<AssistantSuggestion>) => void;
  suggestion: AssistantSuggestion;
}) {
  const canApply = isActionableSuggestion(suggestion);
  const isEditing = actionState.editing;
  const [showDetails, setShowDetails] = useState(false);
  const isFinished =
    actionState.status === "applied" || actionState.status === "ignored";
  const detailItems = [
    suggestion.rationale ? { label: "Why this helps", value: suggestion.rationale } : null,
    suggestion.plannedTask ? { label: "Task", value: suggestion.plannedTask } : null,
    suggestion.proposedNextAction
      ? { label: "Suggested next action", value: suggestion.proposedNextAction }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <article
      className={cn(
        "animate-assistant-card rounded-[20px] border border-brand-ink/10 bg-white p-4 shadow-[0_14px_34px_rgba(18,32,47,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(18,32,47,0.1)]",
        actionState.status === "applied" && "border-brand-teal/20 bg-brand-teal/5",
        actionState.status === "ignored" && "opacity-60 grayscale-[20%]",
        actionState.status === "error" && "border-brand-coral/20 bg-brand-coral/5",
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
            suggestionMarkerStyles[suggestion.type],
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
                suggestionTypeStyles[suggestion.type],
              )}
              variant="subtle"
            >
              {suggestionTypeLabels[suggestion.type]}
            </Badge>
            {actionState.status === "applied" && (
              <span className="text-[11px] font-semibold text-brand-teal">
                Applied
              </span>
            )}
            {actionState.status === "ignored" && (
              <span className="text-[11px] font-semibold text-brand-ink/50">
                Dismissed
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold tracking-[-0.01em] text-brand-ink">
            {suggestion.title}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-brand-ink/70">
            {suggestion.description}
          </p>
        </div>
      </div>

      {(suggestion.projectName || suggestion.day || suggestion.estimatedHours) && !isEditing ? (
        <div className="mt-4 grid gap-2 text-xs text-brand-ink/60 sm:grid-cols-3">
          {suggestion.projectName && (
            <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Project</span>
              <span className="mt-0.5 block truncate font-semibold text-brand-ink">{suggestion.projectName}</span>
            </div>
          )}
          {suggestion.day && (
            <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Day</span>
              <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.day}</span>
            </div>
          )}
          {suggestion.estimatedHours && (
            <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Time</span>
              <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.estimatedHours}h</span>
            </div>
          )}
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-4 grid gap-3 text-sm">
          {suggestion.projectName !== undefined && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Project</span>
              <input
                className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                value={suggestion.projectName ?? ""}
                onChange={(event) => onUpdate({ projectName: event.target.value })}
              />
            </label>
          )}
          {suggestion.day !== undefined && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Day</span>
              <select
                className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                value={suggestion.day ?? "Monday"}
                onChange={(event) => onUpdate({ day: event.target.value as WeekDay })}
              >
                {weekDays.map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </label>
          )}
          {suggestion.estimatedHours !== undefined && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Hours</span>
              <input
                className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                min="0.25" step="0.25" type="number"
                value={suggestion.estimatedHours ?? 1}
                onChange={(event) => onUpdate({ estimatedHours: Number(event.target.value) })}
              />
            </label>
          )}
          {suggestion.plannedTask !== undefined && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Task</span>
              <textarea
                className="w-full resize-y rounded-lg border border-brand-ink/10 bg-white px-3 py-2 text-sm leading-5"
                rows={2}
                value={suggestion.plannedTask ?? ""}
                onChange={(event) => onUpdate({ plannedTask: event.target.value })}
              />
            </label>
          )}
        </div>
      ) : null}

      {detailItems.length > 0 && !isEditing ? (
        <div className="mt-3">
          <button
            className="text-xs font-semibold text-brand-ink/50 hover:text-brand-ink"
            type="button"
            onClick={() => setShowDetails((current) => !current)}
          >
            {showDetails ? "Hide details" : "Details"}
          </button>
          {showDetails ? (
            <div className="mt-2 space-y-2 rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] p-3">
              {detailItems.map((item) => (
                <div key={item.label}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-brand-ink/70">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {actionState.message && (
        <p className={cn(
          "mt-3 rounded-xl border p-2 text-xs leading-5",
          actionState.status === "error"
            ? "border-brand-coral/20 bg-brand-coral/10 text-brand-coral"
            : "border-brand-teal/20 bg-brand-teal/10 text-brand-teal"
        )}>
          {actionState.message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isActionableSuggestion(suggestion) ? (
          <>
            <Button
              className="h-9 rounded-full px-4 text-xs font-semibold active:scale-[0.98]"
              disabled={!canApply || isFinished || actionState.status === "applying"}
              size="sm"
              onClick={onApply}
            >
              {actionState.status === "applying" ? "Applying..." : "Apply"}
            </Button>
            {isEditableSuggestion(suggestion) && (
              <Button
                className="h-9 rounded-full px-4 text-xs font-semibold active:scale-[0.98]"
                disabled={isFinished || actionState.status === "applying"}
                size="sm"
                variant="outline"
                onClick={onToggleEdit}
              >
                {isEditing ? "Done" : "Edit"}
              </Button>
            )}
            <Button
              className="h-9 rounded-full px-4 text-xs font-semibold text-brand-ink/60 hover:text-brand-ink active:scale-[0.98]"
              disabled={isFinished || actionState.status === "applying"}
              size="sm"
              variant="secondary"
              onClick={onIgnore}
            >
              Ignore
            </Button>
          </>
        ) : (
          <>
            <Button
              className="h-9 rounded-full px-4 text-xs font-semibold active:scale-[0.98]"
              disabled={isFinished}
              size="sm"
              variant="secondary"
              onClick={onIgnore}
            >
              Got it
            </Button>
            <Button
              className="h-9 rounded-full px-4 text-xs font-semibold text-brand-ink/60 hover:text-brand-ink active:scale-[0.98]"
              disabled={isFinished}
              size="sm"
              variant="outline"
              onClick={onIgnore}
            >
              Dismiss
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function ChatBubble({
  actionStates,
  message,
  onApply,
  onIgnore,
  onToggleEdit,
  onUpdateSuggestion,
}: {
  actionStates: Record<string, ActionState>;
  message: ChatMessage;
  onApply: (suggestion: AssistantSuggestion) => void;
  onIgnore: (suggestionId: string) => void;
  onToggleEdit: (suggestionId: string) => void;
  onUpdateSuggestion: (
    messageId: string,
    suggestionId: string,
    patch: Partial<AssistantSuggestion>,
  ) => void;
}) {
  const isUser = message.role === "user";
  const actions = getActions(message.response);
  const actionCount = actions.length;
  const actionableActions = actions.filter(isActionableSuggestion);
  const insightActions = actions.filter(
    (suggestion) => !isActionableSuggestion(suggestion),
  );

  return (
    <div className={cn("animate-assistant-message flex w-full gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-teal/10">
          <TargetIcon className="h-4 w-4 text-brand-teal" />
        </div>
      )}
      <div className={cn("flex max-w-[90%] flex-col gap-2 sm:max-w-[82%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-[22px] px-4 py-3 sm:px-5 sm:py-3.5",
            isUser
              ? "bg-brand-ink text-white shadow-sm"
              : "border border-brand-ink/5 bg-white text-brand-ink shadow-sm",
          )}
        >
          <p className={cn("text-sm leading-6 whitespace-pre-wrap", isUser ? "text-white" : "text-brand-ink")}>
            {message.content}
          </p>
        </div>

        {!isUser && actionCount > 0 ? (
          <div className="mt-2 w-full space-y-4">
            {actionableActions.length > 0 ? (
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                  <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/70">
                    Suggested next steps
                  </h4>
                  <span className="text-xs text-brand-ink/40">
                    Review before applying
                  </span>
                </div>
                <div className="grid gap-3">
                  {actionableActions.map((suggestion, index) => (
                    <ActionCard
                      key={suggestion.id}
                      actionState={
                        actionStates[suggestion.id] ?? {
                          editing: false,
                          status: "pending",
                        }
                      }
                      index={index}
                      suggestion={suggestion}
                      onApply={() => onApply(suggestion)}
                      onIgnore={() => onIgnore(suggestion.id)}
                      onToggleEdit={() => onToggleEdit(suggestion.id)}
                      onUpdate={(patch) =>
                        onUpdateSuggestion(message.id, suggestion.id, patch)
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {insightActions.length > 0 ? (
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                  <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/70">
                    Helpful notes
                  </h4>
                  <span className="text-xs text-brand-ink/40">
                    Nothing changes from these notes
                  </span>
                </div>
                <div className="grid gap-3">
                  {insightActions.map((suggestion, index) => (
                    <ActionCard
                      key={suggestion.id}
                      actionState={
                        actionStates[suggestion.id] ?? {
                          editing: false,
                          status: "pending",
                        }
                      }
                      index={actionableActions.length + index}
                      suggestion={suggestion}
                      onApply={() => onApply(suggestion)}
                      onIgnore={() => onIgnore(suggestion.id)}
                      onToggleEdit={() => onToggleEdit(suggestion.id)}
                      onUpdate={(patch) =>
                        onUpdateSuggestion(message.id, suggestion.id, patch)
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AssistantPage() {
  const [status, setStatus] = useState<AssistantStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<AssistantContextSummary | undefined>();
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [prompt]);

  const hasMessages = messages.length > 0;
  const isBusy = isSubmitting || status === "loading";


  async function requestPlanReview(
    method: "GET" | "POST",
    nextPrompt?: string,
    signal?: AbortSignal,
  ) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const accessToken = data.session?.access_token;

    if (!accessToken) {
      const signedOutError = new Error("Sign in before using Planning Assistant.");
      signedOutError.name = "SignedOutError";
      throw signedOutError;
    }

    const apiResponse = await fetch("/api/assistant/plan", {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify({ prompt: nextPrompt }) : undefined,
      signal,
    });

    const payload: unknown = await apiResponse.json().catch(() => null);

    if (!apiResponse.ok) {
      const apiError =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Planning Assistant could not load.";
      throw new Error(apiError);
    }

    return payload as AssistantPlanReviewResponse;
  }

  async function requestApplyAction(suggestion: AssistantSuggestion) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const accessToken = data.session?.access_token;

    if (!accessToken) {
      const signedOutError = new Error("Sign in before applying suggestions.");
      signedOutError.name = "SignedOutError";
      throw signedOutError;
    }

    const apiResponse = await fetch("/api/assistant/apply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approvedSuggestions: [suggestion],
      }),
    });

    const payload: unknown = await apiResponse.json().catch(() => null);

    if (!apiResponse.ok) {
      const apiError =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "That action could not be applied.";
      throw new Error(apiError);
    }

    return payload as AssistantApplyResponse;
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus("signed_out");
      setError("Supabase is not configured yet.");
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    async function loadContext() {
      try {
        const response = await requestPlanReview(
          "GET",
          undefined,
          controller.signal,
        );

        if (!isActive) {
          return;
        }

        setContext(response.context);
        setError(null);
        setStatus("ready");
      } catch (loadError) {
        if (!isActive || controller.signal.aborted) {
          return;
        }

        if (
          loadError instanceof Error &&
          loadError.name === "SignedOutError"
        ) {
          setStatus("signed_out");
          setError(null);
          return;
        }

        setStatus("error");
        setError(getErrorMessage(loadError));
      }
    }

    void loadContext();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSubmitting]);

  function updateActionState(
    suggestionId: string,
    nextState: Partial<ActionState>,
  ) {
    setActionStates((current) => ({
      ...current,
      [suggestionId]: Object.assign(
        { editing: false, status: "pending" as ActionStatus },
        current[suggestionId],
        nextState,
      ),
    }));
  }

  function updateSuggestion(
    messageId: string,
    suggestionId: string,
    patch: Partial<AssistantSuggestion>,
  ) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId || !message.response) {
          return message;
        }

        return {
          ...message,
          response: updateSuggestionInResponse(
            message.response,
            suggestionId,
            patch,
          ),
        };
      }),
    );
  }

  async function sendPrompt(nextPrompt: string) {
    if (isSubmitting || status === "loading") {
      return;
    }

    if (status === "signed_out") {
      setError("Sign in before using Planning Assistant.");
      return;
    }

    const trimmedPrompt = nextPrompt.trim();

    if (!trimmedPrompt) {
      setError("Ask the assistant what you want help planning.");
      return;
    }

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: trimmedPrompt,
    };

    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await requestPlanReview("POST", trimmedPrompt);
      const assistantMessageId = createId("assistant");
      const chatResponse = normalizeResponseForChat(response, assistantMessageId);
      const actions = getActions(chatResponse);

      setContext(chatResponse.context);
      setActionStates((current) => {
        const nextStates = { ...current };

        actions.forEach((suggestion) => {
          nextStates[suggestion.id] = {
            editing: false,
            status: "pending",
          };
        });

        return nextStates;
      });
      setMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          role: "assistant",
          content: chatResponse.assistantMessage || chatResponse.message,
          response: chatResponse,
        },
      ]);
      setStatus("ready");
    } catch (submitError) {
      if (
        submitError instanceof Error &&
        submitError.name === "SignedOutError"
      ) {
        setStatus("signed_out");
        setError(null);
        return;
      }

      setError(getErrorMessage(submitError));
      setMessages((current) => [
        ...current,
        {
          id: createId("assistant-error"),
          role: "assistant",
          content:
            "I couldn’t finish that planning request. Try again in a moment, or ask in a simpler way.",
        },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendPrompt(prompt);
  }

  async function applySuggestion(suggestion: AssistantSuggestion) {
    if (!isActionableSuggestion(suggestion)) {
      updateActionState(suggestion.id, {
        message: "This one is guidance only, so there is nothing to apply.",
        status: "ignored",
      });
      return;
    }

    updateActionState(suggestion.id, {
      message: undefined,
      status: "applying",
    });

    try {
      const response = await requestApplyAction(suggestion);
      const result = response.results[0];

      setContext(response.context);
      updateActionState(suggestion.id, {
        editing: false,
        message: result?.message ?? response.message,
        status: result?.status === "applied" ? "applied" : "error",
      });
    } catch (applyError) {
      updateActionState(suggestion.id, {
        message: getErrorMessage(applyError),
        status: "error",
      });
    }
  }

  function ignoreSuggestion(suggestionId: string) {
    updateActionState(suggestionId, {
      editing: false,
      message: undefined,
      status: "ignored",
    });
  }

  function toggleEdit(suggestionId: string) {
    setActionStates((current) => {
      const existing = current[suggestionId] ?? {
        editing: false,
        status: "pending" as ActionStatus,
      };

      return {
        ...current,
        [suggestionId]: {
          ...existing,
          editing: !existing.editing,
        },
      };
    });
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-brand-mist pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-0">
      <SchedulerNav />

      <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-4 pb-3 pt-4 sm:px-6 sm:py-8 md:gap-6">
        
        {/* Assistant Header Card */}
        <section className="panel shrink-0 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-brand-ink sm:text-2xl">
              Planning Assistant
            </h1>
            <p className="mt-1 text-sm leading-6 text-brand-ink/60">
              Ask for help planning your week, projects, work blocks, or priorities.
            </p>
            <p className="mt-2 text-xs font-semibold text-brand-teal">
              Nothing is added to your schedule unless you approve it.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <AssistantContextDetails context={context} />
            {hasMessages && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 rounded-full px-3 text-[11px] font-bold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink"
                onClick={() => {
                  if (confirm("Clear your conversation history?")) {
                    setMessages([]);
                    setActionStates({});
                    setError(null);
                  }
                }}
              >
                Clear Chat
              </Button>
            )}
          </div>
        </section>

        {/* Main Chat Area */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Chat Flow Container */}
          <div className="flex-1 overflow-y-auto px-2 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6">
              {!hasMessages ? (
                <div className="flex flex-col items-center justify-center py-6 text-center sm:py-16">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-teal/10">
                    <TargetIcon className="h-6 w-6 text-brand-teal" />
                  </div>
                  <h2 className="mb-2 text-xl font-semibold text-brand-ink sm:text-2xl">
                    What would you like to plan?
                  </h2>
                  <p className="mb-8 max-w-md text-sm text-brand-ink/60">
                    Ask Schedule Builder to organize your week, balance work and projects, or turn goals into time blocks.
                  </p>
                  <div className="flex max-w-lg flex-wrap justify-center gap-2.5">
                    {examplePrompts.map((example) => (
                      <button
                        key={example}
                        className="rounded-full border border-brand-ink/10 bg-white px-4 py-2 text-sm font-semibold text-brand-ink/70 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-teal/30 hover:text-brand-ink active:scale-95"
                        type="button"
                        onClick={() => {
                          setPrompt(example);
                        }}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  actionStates={actionStates}
                  message={message}
                  onApply={(suggestion) => void applySuggestion(suggestion)}
                  onIgnore={ignoreSuggestion}
                  onToggleEdit={toggleEdit}
                  onUpdateSuggestion={updateSuggestion}
                />
              ))}

              {isSubmitting ? (
                <div className="flex justify-start">
                  <div className="flex h-[44px] items-center gap-3 rounded-2xl border border-white/60 bg-white/90 px-4 shadow-sm">
                    <span className="text-sm font-semibold text-brand-ink/60">
                      Thinking through your schedule
                    </span>
                    <div className="flex gap-1.5">
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink/40"></div>
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink/40 [animation-delay:0.2s]"></div>
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink/40 [animation-delay:0.4s]"></div>
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="mx-auto w-full max-w-md rounded-[20px] border border-brand-coral/20 bg-brand-coral/10 p-4 text-center text-sm leading-6 text-brand-coral">
                  {error}
                </div>
              ) : null}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Chat Composer */}
          <div className="shrink-0 border-t border-brand-ink/5 bg-brand-mist/90 pb-2 pt-4 backdrop-blur-md sm:pb-4">
            {status === "signed_out" ? (
              <div className="text-center">
                <p className="text-sm font-semibold text-brand-ink">
                  Sign in to use Planning Assistant
                </p>
                <p className="mt-1 text-sm text-brand-ink/60">
                  The assistant reviews your signed-in schedule securely.
                </p>
                <Link
                  href="/"
                  className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-brand-ink px-5 text-sm font-semibold text-white"
                >
                  Sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
                {hasMessages ? (
                  <div className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
                    <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
                      {examplePrompts.map((example) => (
                        <button
                          key={example}
                          className="whitespace-nowrap rounded-full border border-brand-ink/10 bg-white/80 px-3.5 py-2 text-xs font-semibold text-brand-ink/60 shadow-sm hover:-translate-y-0.5 hover:border-brand-teal/30 hover:bg-white hover:text-brand-ink active:scale-95"
                          type="button"
                          onClick={() => setPrompt(example)}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 rounded-[24px] border border-brand-ink/10 bg-white p-2 shadow-sm focus-within:border-brand-teal/30 sm:flex-row sm:items-end sm:rounded-full sm:p-2.5">
                  <div className="relative flex-1">
                    <textarea
                      ref={textareaRef}
                      className="min-h-[44px] w-full resize-none bg-transparent px-4 py-2.5 text-sm leading-6 text-brand-ink placeholder:text-brand-ink/40 focus:outline-none sm:min-h-[48px] sm:text-base max-h-[160px] overflow-y-auto"
                      disabled={isBusy}
                      maxLength={2000}
                      placeholder="Ask me to plan your week..."
                      rows={1}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendPrompt(prompt);
                        }
                      }}
                    />
                  </div>
                  <Button
                    className="h-11 w-full shrink-0 rounded-[16px] px-6 text-sm font-semibold sm:h-12 sm:w-auto sm:rounded-full"
                    disabled={isBusy || !prompt.trim()}
                    type="submit"
                  >
                    Send
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
