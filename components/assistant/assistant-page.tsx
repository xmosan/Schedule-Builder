"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarIcon,
  CheckCircleIcon,
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type AssistantApplyResponse,
  type AssistantContextSummary,
  type AssistantPlanReviewResponse,
  type AssistantSuggestion,
  type AssistantSuggestionSeverity,
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
  "Find overloaded days",
  "Turn projects into work blocks",
  "Suggest my Top 3",
  "Help me balance school, work, and projects",
];

const suggestionTypeLabels: Record<AssistantSuggestionType, string> = {
  suggested_weekly_block: "Suggested weekly block",
  suggested_next_action: "Suggested next action",
  workload_warning: "Workload note",
  missing_deadline_warning: "Missing deadline",
  unclear_project_warning: "Clarify project",
};

const severityStyles: Record<AssistantSuggestionSeverity, string> = {
  important: "border-brand-coral/18 bg-brand-coral/8 text-brand-coral",
  warning: "border-[#e7c783] bg-[#fff8e6] text-[#8a5d0a]",
  info: "border-brand-teal/18 bg-brand-teal/8 text-brand-teal",
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

function ContextMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-ink/42">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-brand-ink">{value}</p>
    </div>
  );
}

function AssistantContextDetails({
  context,
}: {
  context?: AssistantContextSummary;
}) {
  return (
    <details className="rounded-[24px] border border-white/70 bg-white/76 p-4 shadow-[0_14px_34px_rgba(18,32,47,0.05)]">
      <summary className="cursor-pointer text-sm font-semibold text-brand-ink">
        What the assistant can see
      </summary>
      <p className="mt-2 text-sm leading-6 text-brand-ink/60">
        A compact snapshot of your signed-in schedule. Your data stays scoped to
        your Supabase account.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <ContextMetric
          label="Active projects"
          value={context?.activeProjectsCount ?? "--"}
        />
        <ContextMetric
          label="Planned hours"
          value={context ? `${context.plannedWeeklyHours} hrs` : "--"}
        />
        <ContextMetric
          label="Weekly blocks"
          value={context?.weeklyBlocksCount ?? "--"}
        />
        <ContextMetric
          label="Work shifts"
          value={context?.workShiftsCount ?? "--"}
        />
        <ContextMetric
          label="Planner type"
          value={context?.plannerType ?? "--"}
        />
        <ContextMetric
          label="Work hours"
          value={context ? `${context.workScheduleHours} hrs` : "--"}
        />
      </div>
    </details>
  );
}

function SafetyNote() {
  return (
    <div className="rounded-[24px] border border-brand-teal/16 bg-brand-teal/8 p-4">
      <div className="flex items-start gap-3">
        <CheckCircleIcon className="mt-0.5 h-5 w-5 text-brand-teal" />
        <div>
          <p className="text-sm font-semibold text-brand-ink">
            You stay in control
          </p>
          <p className="mt-1 text-sm leading-6 text-brand-ink/62">
            The assistant can suggest changes, but nothing is added to your
            schedule unless you approve it.
          </p>
        </div>
      </div>
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
  onApply,
  onIgnore,
  onToggleEdit,
  onUpdate,
  suggestion,
}: {
  actionState: ActionState;
  onApply: () => void;
  onIgnore: () => void;
  onToggleEdit: () => void;
  onUpdate: (patch: Partial<AssistantSuggestion>) => void;
  suggestion: AssistantSuggestion;
}) {
  const canApply = isActionableSuggestion(suggestion);
  const isEditing = actionState.editing;
  const isFinished =
    actionState.status === "applied" || actionState.status === "ignored";

  return (
    <article
      className={cn(
        "rounded-[22px] border bg-white/84 p-4 shadow-[0_12px_30px_rgba(18,32,47,0.05)]",
        actionState.status === "applied" && "border-brand-teal/24 bg-brand-teal/8",
        actionState.status === "ignored" && "opacity-60",
        actionState.status === "error" && "border-brand-coral/22 bg-brand-coral/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={cn("border", severityStyles[suggestion.severity])}
          variant="subtle"
        >
          {suggestionTypeLabels[suggestion.type]}
        </Badge>
        {actionState.status === "applied" ? (
          <Badge variant="subtle">Applied</Badge>
        ) : null}
        {actionState.status === "ignored" ? (
          <Badge variant="subtle">Ignored</Badge>
        ) : null}
      </div>

      <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
        {suggestion.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-brand-ink/68">
        {suggestion.description}
      </p>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {suggestion.projectName || isEditing ? (
          <label className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Project
            </span>
            {isEditing ? (
              <input
                className="mt-2 w-full rounded-xl border border-brand-ink/10 bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                value={suggestion.projectName ?? ""}
                onChange={(event) => onUpdate({ projectName: event.target.value })}
              />
            ) : (
              <span className="mt-1 block font-semibold text-brand-ink">
                {suggestion.projectName}
              </span>
            )}
          </label>
        ) : null}

        {suggestion.day || isEditing ? (
          <label className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Day
            </span>
            {isEditing ? (
              <select
                className="mt-2 w-full rounded-xl border border-brand-ink/10 bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                value={suggestion.day ?? "Monday"}
                onChange={(event) =>
                  onUpdate({ day: event.target.value as WeekDay })
                }
              >
                {weekDays.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            ) : (
              <span className="mt-1 block font-semibold text-brand-ink">
                {suggestion.day}
              </span>
            )}
          </label>
        ) : null}

        {suggestion.estimatedHours || isEditing ? (
          <label className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Time
            </span>
            {isEditing ? (
              <input
                className="mt-2 w-full rounded-xl border border-brand-ink/10 bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                min="0.25"
                step="0.25"
                type="number"
                value={suggestion.estimatedHours ?? 1}
                onChange={(event) =>
                  onUpdate({ estimatedHours: Number(event.target.value) })
                }
              />
            ) : (
              <span className="mt-1 block font-semibold text-brand-ink">
                {suggestion.estimatedHours}{" "}
                {suggestion.estimatedHours === 1 ? "hr" : "hrs"}
              </span>
            )}
          </label>
        ) : null}

        {suggestion.plannedTask || isEditing ? (
          <label className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3 sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Task
            </span>
            {isEditing ? (
              <textarea
                className="mt-2 min-h-20 w-full resize-y rounded-xl border border-brand-ink/10 bg-white px-3 py-2 text-sm font-semibold leading-6 text-brand-ink"
                value={suggestion.plannedTask ?? ""}
                onChange={(event) => onUpdate({ plannedTask: event.target.value })}
              />
            ) : (
              <span className="mt-1 block font-semibold leading-6 text-brand-ink">
                {suggestion.plannedTask}
              </span>
            )}
          </label>
        ) : null}

        {suggestion.proposedNextAction || isEditing ? (
          <label className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3 sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Next action
            </span>
            {isEditing ? (
              <textarea
                className="mt-2 min-h-20 w-full resize-y rounded-xl border border-brand-ink/10 bg-white px-3 py-2 text-sm font-semibold leading-6 text-brand-ink"
                value={suggestion.proposedNextAction ?? ""}
                onChange={(event) =>
                  onUpdate({ proposedNextAction: event.target.value })
                }
              />
            ) : (
              <span className="mt-1 block font-semibold leading-6 text-brand-ink">
                {suggestion.proposedNextAction}
              </span>
            )}
          </label>
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-6 text-brand-ink/56">
        {suggestion.rationale}
      </p>

      {actionState.message ? (
        <p
          className={cn(
            "mt-3 rounded-[16px] border p-3 text-sm leading-6",
            actionState.status === "error"
              ? "border-brand-coral/20 bg-brand-coral/8 text-brand-coral"
              : "border-brand-teal/18 bg-brand-teal/8 text-brand-teal",
          )}
        >
          {actionState.message}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          className="sm:min-w-28"
          disabled={!canApply || isFinished || actionState.status === "applying"}
          size="sm"
          onClick={onApply}
        >
          {actionState.status === "applying" ? "Applying..." : "Apply"}
        </Button>
        {isEditableSuggestion(suggestion) ? (
          <Button
            disabled={isFinished || actionState.status === "applying"}
            size="sm"
            variant="outline"
            onClick={onToggleEdit}
          >
            {isEditing ? "Done editing" : "Edit"}
          </Button>
        ) : null}
        <Button
          disabled={isFinished || actionState.status === "applying"}
          size="sm"
          variant="secondary"
          onClick={onIgnore}
        >
          Ignore
        </Button>
      </div>

      {!canApply ? (
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
          This is guidance only. Nothing will be saved.
        </p>
      ) : null}
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

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-[26px] px-4 py-3 shadow-[0_12px_30px_rgba(18,32,47,0.05)] sm:max-w-[78%] sm:px-5 sm:py-4",
          isUser
            ? "bg-brand-ink text-white"
            : "border border-white/70 bg-white/88 text-brand-ink",
        )}
      >
        <p
          className={cn(
            "text-sm leading-7 sm:text-base",
            isUser ? "text-white" : "text-brand-ink/78",
          )}
        >
          {message.content}
        </p>

        {actions.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {actions.map((suggestion) => (
              <ActionCard
                key={suggestion.id}
                actionState={
                  actionStates[suggestion.id] ?? {
                    editing: false,
                    status: "pending",
                  }
                }
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

  const hasMessages = messages.length > 0;
  const isBusy = isSubmitting || status === "loading";

  const latestAssistantMessage = useMemo(() => {
    return [...messages].reverse().find((message) => message.role === "assistant");
  }, [messages]);

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
      message: "Ignored. Nothing changed in your schedule.",
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
    <div className="px-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-4 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-4 sm:p-7 lg:p-8">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <TargetIcon className="h-4 w-4" />
                Assistant
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-5xl">
                Planning Assistant
              </h1>
              <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:text-lg sm:leading-7">
                Ask for help planning your week, projects, work blocks, or
                priorities.
              </p>
            </div>

            <SafetyNote />
          </div>
        </section>

        <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="panel flex min-h-[34vh] flex-col gap-4 p-4 sm:min-h-[44vh] sm:p-5">
              <AssistantContextDetails context={context} />

              <div className="flex-1 space-y-4">
                {!hasMessages ? (
                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-[26px] border border-white/70 bg-white/88 px-4 py-4 shadow-[0_12px_30px_rgba(18,32,47,0.05)] sm:max-w-[78%] sm:px-5">
                      <p className="text-sm leading-7 text-brand-ink/78 sm:text-base">
                        Ask me to plan your week, balance projects, or find
                        overloaded days.
                      </p>
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
                    <div className="rounded-[26px] border border-white/70 bg-white/88 px-4 py-3 text-sm font-semibold text-brand-ink/62 shadow-[0_12px_30px_rgba(18,32,47,0.05)]">
                      Thinking through your plan...
                    </div>
                  </div>
                ) : null}

                <div ref={chatEndRef} />
              </div>
            </div>

            {error ? (
              <div className="rounded-[24px] border border-brand-coral/18 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                {error}
              </div>
            ) : null}

            {status === "signed_out" ? (
              <Card className="rounded-[28px] border-white/70 bg-white/88">
                <CardContent className="p-5">
                  <p className="text-base font-semibold text-brand-ink">
                    Sign in to use Planning Assistant.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                    The assistant reviews only your signed-in schedule.
                  </p>
                  <Link
                    href="/"
                    className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white"
                  >
                    Go to sign in
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            <form
              className="rounded-[28px] border border-white/80 bg-white/94 p-3 shadow-[0_18px_48px_rgba(18,32,47,0.12)] backdrop-blur"
              onSubmit={handleSubmit}
            >
              <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
                {examplePrompts.map((example) => (
                  <button
                    key={example}
                    className="shrink-0 rounded-full border border-brand-ink/8 bg-white/78 px-3 py-2 text-xs font-semibold text-brand-ink/68 hover:border-brand-teal/22 hover:bg-brand-teal/8 hover:text-brand-ink"
                    type="button"
                    onClick={() => setPrompt(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <textarea
                  className="max-h-36 min-h-24 w-full resize-none rounded-[22px] border border-brand-ink/10 bg-white/84 px-4 py-3 text-base leading-6 text-brand-ink placeholder:text-brand-ink/36 focus:border-brand-teal/35 focus:bg-white focus:outline-none sm:min-h-12 sm:flex-1"
                  disabled={status === "signed_out"}
                  maxLength={2000}
                  placeholder="Ask me to plan your week..."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendPrompt(prompt);
                    }
                  }}
                />
                <Button
                  className="h-12 w-full px-4 sm:w-auto"
                  disabled={isBusy || status === "signed_out"}
                  type="submit"
                >
                  Send
                </Button>
              </div>
            </form>
          </div>

          <aside className="hidden min-w-0 flex-col gap-4 lg:flex lg:sticky lg:top-6">
            <SafetyNote />
            <Card className="rounded-[28px] border-white/70 bg-white/84">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                    <FolderStackIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-brand-ink">
                      Good things to ask
                    </p>
                    <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                      Try asking for a weekly plan, overloaded days, or next
                      actions for active projects.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            {latestAssistantMessage?.response ? (
              <Card className="rounded-[28px] border-white/70 bg-white/84">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
                      <CalendarIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">
                        Latest ideas
                      </p>
                      <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                        {getActions(latestAssistantMessage.response).length}{" "}
                        reviewable suggestions in the latest assistant reply.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </aside>
        </section>
      </div>
    </div>
  );
}
