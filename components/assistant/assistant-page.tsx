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
  "Find overload",
  "Create work blocks",
  "Suggest Top 3",
  "Balance school/work",
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
    <div className="rounded-2xl border border-brand-ink/5 bg-white/40 p-2.5 sm:p-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-brand-ink/40">
        {label}
      </p>
      <p className="mt-0.5 text-xs font-semibold text-brand-ink sm:text-sm">{value}</p>
    </div>
  );
}

function AssistantContextDetails({
  context,
}: {
  context?: AssistantContextSummary;
}) {
  return (
    <div className="rounded-[22px] border border-white/60 bg-white/64 p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <FolderStackIcon className="h-4 w-4 text-brand-ink/40" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-brand-ink/50">
          Planning context
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        <ContextMetric
          label="Projects"
          value={context?.activeProjectsCount ?? "--"}
        />
        <ContextMetric
          label="Planned"
          value={context ? `${context.plannedWeeklyHours}h` : "--"}
        />
        <ContextMetric
          label="Blocks"
          value={context?.weeklyBlocksCount ?? "--"}
        />
        <ContextMetric
          label="Shifts"
          value={context?.workShiftsCount ?? "--"}
        />
        <ContextMetric
          label="Type"
          value={context?.plannerType ?? "--"}
        />
        <ContextMetric
          label="Work"
          value={context ? `${context.workScheduleHours}h` : "--"}
        />
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
        "rounded-[20px] border bg-white/80 p-4 shadow-sm transition-opacity",
        actionState.status === "applied" && "border-brand-teal/20 bg-brand-teal/5",
        actionState.status === "ignored" && "opacity-50 grayscale-[30%]",
        actionState.status === "error" && "border-brand-coral/20 bg-brand-coral/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge
              className={cn("border px-2 py-0.5 text-[10px]", severityStyles[suggestion.severity])}
              variant="subtle"
            >
              {suggestionTypeLabels[suggestion.type]}
            </Badge>
            {actionState.status === "applied" && <Badge variant="subtle" className="text-[10px]">Applied</Badge>}
            {actionState.status === "ignored" && <Badge variant="subtle" className="text-[10px]">Ignored</Badge>}
          </div>
          <h3 className="text-sm font-semibold text-brand-ink">
            {suggestion.title}
          </h3>
          <p className="mt-1 text-sm leading-5 text-brand-ink/60">
            {suggestion.description}
          </p>
        </div>
      </div>

      {(suggestion.projectName || suggestion.day || suggestion.estimatedHours) && !isEditing ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 rounded-xl bg-white/50 px-3 py-2 text-xs">
          {suggestion.projectName && (
            <div><span className="font-medium text-brand-ink/50">Project:</span> <span className="font-semibold text-brand-ink">{suggestion.projectName}</span></div>
          )}
          {suggestion.day && (
            <div><span className="font-medium text-brand-ink/50">Day:</span> <span className="font-semibold text-brand-ink">{suggestion.day}</span></div>
          )}
          {suggestion.estimatedHours && (
            <div><span className="font-medium text-brand-ink/50">Time:</span> <span className="font-semibold text-brand-ink">{suggestion.estimatedHours}h</span></div>
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
              <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Task Details</span>
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

      {actionState.message && (
        <p className={cn(
          "mt-3 rounded-xl border p-2 text-xs leading-5",
          actionState.status === "error"
            ? "border-brand-coral/20 bg-brand-coral/8 text-brand-coral"
            : "border-brand-teal/18 bg-brand-teal/8 text-brand-teal"
        )}>
          {actionState.message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          className="h-8 px-4 text-xs"
          disabled={!canApply || isFinished || actionState.status === "applying"}
          size="sm"
          onClick={onApply}
        >
          {actionState.status === "applying" ? "Applying..." : "Apply"}
        </Button>
        {isEditableSuggestion(suggestion) && (
          <Button
            className="h-8 px-3 text-xs"
            disabled={isFinished || actionState.status === "applying"}
            size="sm"
            variant="outline"
            onClick={onToggleEdit}
          >
            {isEditing ? "Done" : "Edit"}
          </Button>
        )}
        <Button
          className="h-8 px-3 text-xs text-brand-ink/60 hover:text-brand-ink"
          disabled={isFinished || actionState.status === "applying"}
          size="sm"
          variant="secondary"
          onClick={onIgnore}
        >
          Ignore
        </Button>
      </div>
      
      {!canApply && (
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-brand-ink/40">
          Guidance only. Nothing saved.
        </p>
      )}
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
  
  // Count warnings (severity: warning or important) vs normal suggestions
  const warningCount = actions.filter(a => a.severity === 'warning' || a.severity === 'important').length;
  const suggestionCount = actionCount - warningCount;

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[85%] sm:px-5 sm:py-3.5",
          isUser
            ? "bg-brand-ink text-white shadow-sm"
            : "border border-white/60 bg-white/70 text-brand-ink shadow-sm backdrop-blur-sm",
        )}
      >
        <p className={cn("text-sm leading-6", isUser ? "text-white" : "text-brand-ink")}>
          {message.content}
        </p>
      </div>

      {!isUser && actionCount > 0 ? (
        <div className="mt-2 w-full max-w-[92%] sm:max-w-[85%]">
          <div className="mb-3 px-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink/60">
              Suggestions from this response
            </h4>
            <div className="mt-1 flex items-center gap-2 text-xs text-brand-ink/50">
              <span>{suggestionCount} suggestion{suggestionCount !== 1 ? 's' : ''}</span>
              {warningCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-brand-amber/80">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-xs text-brand-ink/40">
              Review suggestions before applying. Rejected suggestions are ignored.
            </p>
          </div>
          <div className="grid gap-3">
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
        </div>
      ) : null}
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
    <div className="px-3 pb-[160px] pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-6 sm:gap-8">
        <SchedulerNav />

        {/* Simple Hero Section */}
        <header className="max-w-3xl">
          <div className="eyebrow-chip mb-4">
            <TargetIcon className="h-3.5 w-3.5" />
            Assistant
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-5xl">
            Planning Assistant
          </h1>
          <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:text-lg sm:leading-7">
            Ask for help planning your week, balancing projects, or turning work into schedule blocks.
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-brand-ink/45">
            <CheckCircleIcon className="h-3.5 w-3.5 text-brand-teal/60" />
            <span>You stay in control. Nothing changes unless you approve it.</span>
          </div>
        </header>

        {/* Workspace Layout */}
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
          
          {/* Main Column: Chat Flow */}
          <main className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-4">
              {!hasMessages ? (
                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl border border-white/60 bg-white/70 px-4 py-3.5 text-sm leading-6 text-brand-ink shadow-sm sm:max-w-[85%] sm:px-5">
                    Ask me to help plan your week, balance your workload, or turn projects into work blocks.
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
                  <div className="max-w-[92%] rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm leading-6 text-brand-ink/60 shadow-sm sm:max-w-[85%] sm:px-5">
                    Thinking through your plan...
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-[20px] border border-brand-coral/18 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                  {error}
                </div>
              ) : null}

              <div ref={chatEndRef} />
            </div>

            {status === "signed_out" ? (
              <Card className="rounded-[24px] border-white/70 bg-white/88 max-w-md">
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
            ) : (
              <section className="panel-strong mt-2 p-3 sm:p-4">
                {/* Suggested Prompt Chips */}
                <div 
                  className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  {examplePrompts.map((example) => (
                    <button
                      key={example}
                      className="shrink-0 rounded-full border border-brand-ink/8 bg-white/60 px-3.5 py-1.5 text-xs font-semibold text-brand-ink/60 transition-all hover:border-brand-teal/30 hover:bg-white hover:text-brand-ink active:scale-95"
                      type="button"
                      onClick={() => setPrompt(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSubmit} className="relative">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="relative flex-1">
                      <textarea
                        className="min-h-[52px] w-full resize-none rounded-[20px] border border-brand-ink/10 bg-white/84 px-4 py-3 text-sm leading-6 text-brand-ink placeholder:text-brand-ink/30 focus:border-brand-teal/30 focus:bg-white focus:outline-none sm:max-h-48"
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
                      className="h-12 w-full px-6 sm:w-auto"
                      disabled={isBusy}
                      type="submit"
                    >
                      Send
                    </Button>
                  </div>
                </form>
              </section>
            )}
          </main>

          {/* Right Sidebar: Context */}
          <aside className="order-first flex flex-col gap-4 lg:order-last lg:sticky lg:top-6">
            <AssistantContextDetails context={context} />
          </aside>

        </div>
      </div>
    </div>
  );
}

