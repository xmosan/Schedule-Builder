"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  clearLocalAssistantConversation,
  createAssistantThreadId,
  parseAssistantConversationSnapshot,
  readLocalAssistantConversation,
  writeLocalAssistantConversation,
  type AssistantConversationSnapshot,
} from "@/lib/assistant-conversation";
import type { AssistantSchedulingContext } from "@/lib/assistant-schedule-analysis";
import {
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  type AssistantApplyResponse,
  type AssistantContextSummary,
  type AssistantPlanReviewResponse,
  type AssistantSuggestion,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import {
  priorityLevels,
  projectCategories,
  type ProjectCategory,
  type ProjectPriority,
} from "@/lib/projects";
import type { ScheduledItemType } from "@/lib/scheduled-items";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatStartTime, weekDays, type WeekDay } from "@/lib/weekly-plan";
import { cn } from "@/lib/utils";

type AssistantStatus = "loading" | "ready" | "signed_out" | "error";
type ChatRole = "assistant" | "user";
type ActionStatus =
  | "pending"
  | "dismissing"
  | "removed"
  | "applying"
  | "applied"
  | "error";

type ChatMessage = {
  id: string;
  isStreaming?: boolean;
  role: ChatRole;
  content: string;
  response?: AssistantPlanReviewResponse;
};

type AssistantChatHistoryItem = {
  role: ChatRole;
  content: string;
};

type AssistantStreamEvent =
  | { type: "message_delta"; delta: string }
  | { type: "final"; response: AssistantPlanReviewResponse }
  | { type: "error"; error: string };

type ActionState = {
  editing: boolean;
  message?: string;
  result?: AssistantApplyResponse["results"][number];
  status: ActionStatus;
};

type AssistantNotice = {
  id: string;
  message: string;
  tone: "error" | "success";
};

const cardExitDelayMs = 300;

const examplePrompts = [
  "Plan my week",
  "Balance school and work",
  "Find open time",
  "Create study blocks",
  "Suggest my Top 3",
];

function getSchedulingQuickReplies(
  context: AssistantSchedulingContext | null,
) {
  if (!context) {
    return [];
  }

  if (
    context.state === "awaiting_window_selection" ||
    context.state === "needs_clarification"
  ) {
    return context.candidateWindows.slice(0, 6).map((window) => ({
      label: window.label,
      prompt: window.label,
    }));
  }

  if (context.state === "awaiting_duration") {
    return [
      { label: "30 minutes", prompt: "30 minutes" },
      { label: "1 hour", prompt: "one hour" },
      { label: "2 hours", prompt: "two hours" },
      { label: "Full opening", prompt: "Use the full opening" },
    ];
  }

  return [];
}
const confirmationPromptPattern =
  /^(yes|yeah|yep|confirm|confirmed|apply|apply it|do it|save it|update it|make the change|alright|all right|ok|okay)(?:[\s,!.].*)?$/i;

const suggestionTypeLabels: Record<AssistantSuggestionType, string> = {
  new_project: "Project draft",
  update_project: "Project edit",
  suggested_scheduled_item: "Task / appointment",
  suggested_weekly_block: "Schedule idea",
  suggested_next_action: "Next action",
  workload_warning: "Workload note",
  missing_deadline_warning: "Deadline note",
  unclear_project_warning: "Clarity note",
};

const suggestionTypeStyles: Record<AssistantSuggestionType, string> = {
  new_project: "border-brand-teal/20 bg-brand-teal/10 text-brand-teal",
  update_project: "border-brand-ocean/20 bg-brand-ocean/10 text-brand-ocean",
  suggested_scheduled_item: "border-brand-teal/20 bg-brand-teal/10 text-brand-teal",
  suggested_weekly_block: "border-brand-teal/20 bg-brand-teal/10 text-brand-teal",
  suggested_next_action: "border-brand-ocean/20 bg-brand-ocean/10 text-brand-ocean",
  workload_warning: "border-[#e7c783] bg-[#fff8e6] text-[#8a5d0a]",
  missing_deadline_warning: "border-brand-coral/20 bg-brand-coral/10 text-brand-coral",
  unclear_project_warning: "border-brand-ink/10 bg-brand-ink/5 text-brand-ink/70",
};

const suggestionMarkerStyles: Record<AssistantSuggestionType, string> = {
  new_project: "bg-brand-teal",
  update_project: "bg-brand-ocean",
  suggested_scheduled_item: "bg-brand-teal",
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

function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Detroit";
  } catch {
    return "America/Detroit";
  }
}

function formatAssistantDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        weekday: "short",
        year: "numeric",
      }).format(date);
}

function isActionableSuggestion(suggestion: AssistantSuggestion) {
  return (
    suggestion.type === "new_project" ||
    suggestion.type === "update_project" ||
    suggestion.type === "suggested_scheduled_item" ||
    suggestion.type === "suggested_weekly_block" ||
    suggestion.type === "suggested_next_action"
  );
}

function isEditableSuggestion(suggestion: AssistantSuggestion) {
  return isActionableSuggestion(suggestion);
}

function isActionVisible(actionState?: ActionState) {
  return actionState?.status !== "removed";
}

function isPendingActionState(actionState?: ActionState) {
  return (
    !actionState ||
    actionState.status === "pending" ||
    actionState.status === "error"
  );
}

function isConfirmationPrompt(prompt: string) {
  return confirmationPromptPattern.test(prompt.trim());
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

function normalizeMessagesForRequest(
  messages: ChatMessage[],
): AssistantChatHistoryItem[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function parseAssistantStreamLine(line: string): AssistantStreamEvent | null {
  if (!line.trim()) {
    return null;
  }

  const parsed = JSON.parse(line) as unknown;

  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return null;
  }

  if (
    parsed.type === "message_delta" &&
    "delta" in parsed &&
    typeof parsed.delta === "string"
  ) {
    return {
      type: "message_delta",
      delta: parsed.delta,
    };
  }

  if (parsed.type === "final" && "response" in parsed) {
    return {
      type: "final",
      response: parsed.response as AssistantPlanReviewResponse,
    };
  }

  if (
    parsed.type === "error" &&
    "error" in parsed &&
    typeof parsed.error === "string"
  ) {
    return {
      type: "error",
      error: parsed.error,
    };
  }

  return null;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function takeTypingChunk(buffer: string) {
  const match = buffer.match(/^\s*\S+\s*/);

  if (match?.[0]) {
    return match[0];
  }

  return buffer.slice(0, Math.min(4, buffer.length));
}

function getTypingDelay(chunk: string) {
  if (/[.!?]\s*$/.test(chunk)) {
    return 90;
  }

  if (/[,;:]\s*$/.test(chunk)) {
    return 55;
  }

  return Math.max(22, Math.min(42, chunk.length * 4));
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
    actionState.status === "applied" ||
    actionState.status === "dismissing" ||
    actionState.status === "removed";
  const isExiting = actionState.status === "dismissing";
  const isScheduledItemSuggestion = suggestion.type === "suggested_scheduled_item";
  const isWeeklyBlockSuggestion = suggestion.type === "suggested_weekly_block";
  const projectNameLabel =
    suggestion.type === "update_project"
      ? "Project to update"
      : isWeeklyBlockSuggestion
        ? "Project or title"
        : "Project";
  const detailItems = [
    suggestion.rationale ? { label: "Why this helps", value: suggestion.rationale } : null,
    suggestion.plannedTask
      ? { label: isWeeklyBlockSuggestion || isScheduledItemSuggestion ? "Details" : "Task", value: suggestion.plannedTask }
      : null,
    suggestion.itemDate ? { label: "Date", value: suggestion.itemDate } : null,
    isScheduledItemSuggestion
      ? {
          label: "Time",
          value: suggestion.startTime
            ? formatStartTime(suggestion.startTime)
            : "Flexible",
        }
      : null,
    suggestion.location ? { label: "Location", value: suggestion.location } : null,
    suggestion.conflictWarnings?.length
      ? {
          label: "Conflict warnings",
          value: suggestion.conflictWarnings.join(" "),
        }
      : null,
    suggestion.newProjectName
      ? { label: "New project name", value: suggestion.newProjectName }
      : null,
    suggestion.proposedNextAction
      ? { label: "Suggested next action", value: suggestion.proposedNextAction }
      : null,
    suggestion.deadline ? { label: "Deadline", value: suggestion.deadline } : null,
    suggestion.category ? { label: "Category", value: suggestion.category } : null,
    suggestion.priority ? { label: "Priority", value: suggestion.priority } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <div
      aria-hidden={isExiting}
      className="assistant-card-shell"
      data-exiting={isExiting ? "true" : "false"}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <article
        className={cn(
          "assistant-card-inner animate-assistant-card rounded-[20px] border border-brand-ink/10 bg-white p-4 shadow-[0_14px_34px_rgba(18,32,47,0.07)] hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(18,32,47,0.1)]",
          actionState.status === "applied" && "border-brand-teal/20 bg-brand-teal/5",
          isExiting && "pointer-events-none",
          actionState.status === "error" && "border-brand-coral/20 bg-brand-coral/5",
        )}
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
            </div>
            <h3 className="text-base font-semibold tracking-[-0.01em] text-brand-ink">
              {suggestion.title}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-brand-ink/70">
              {suggestion.description}
            </p>
          </div>
        </div>

        {(suggestion.projectName ||
          suggestion.itemType ||
          suggestion.itemDate ||
          suggestion.startTime ||
          suggestion.location ||
          suggestion.day ||
          suggestion.estimatedHours ||
          suggestion.weeklyHours ||
          suggestion.category ||
          suggestion.priority ||
          suggestion.deadline ||
          suggestion.newProjectName) &&
        !isEditing ? (
          <div className="mt-4 grid gap-2 text-xs text-brand-ink/60 sm:grid-cols-3">
            {suggestion.projectName && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                  {isWeeklyBlockSuggestion ? "Project / title" : "Project"}
                </span>
                <span className="mt-0.5 block truncate font-semibold text-brand-ink">{suggestion.projectName}</span>
              </div>
            )}
            {isScheduledItemSuggestion && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                  Type
                </span>
                <span className="mt-0.5 block font-semibold text-brand-ink">
                  {suggestion.itemType === "appointment" ? "Appointment" : "Task"}
                </span>
              </div>
            )}
            {suggestion.itemDate && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Date</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{formatAssistantDate(suggestion.itemDate)}</span>
              </div>
            )}
            {isScheduledItemSuggestion && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Time</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">
                  {suggestion.startTime ? formatStartTime(suggestion.startTime) : "Flexible"}
                </span>
              </div>
            )}
            {suggestion.newProjectName && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">New name</span>
                <span className="mt-0.5 block truncate font-semibold text-brand-ink">{suggestion.newProjectName}</span>
              </div>
            )}
            {suggestion.deadline && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Deadline</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.deadline}</span>
              </div>
            )}
            {suggestion.category && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Category</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.category}</span>
              </div>
            )}
            {suggestion.priority && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Priority</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.priority}</span>
              </div>
            )}
            {suggestion.day && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Day</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.day}</span>
              </div>
            )}
            {isWeeklyBlockSuggestion && suggestion.startTime && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Start</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">
                  {formatStartTime(suggestion.startTime)}
                </span>
              </div>
            )}
            {suggestion.estimatedHours && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Duration</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.estimatedHours}h</span>
              </div>
            )}
            {suggestion.weeklyHours !== undefined && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Weekly time</span>
                <span className="mt-0.5 block font-semibold text-brand-ink">{suggestion.weeklyHours}h</span>
              </div>
            )}
            {suggestion.location && (
              <div className="rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">Location</span>
                <span className="mt-0.5 block truncate font-semibold text-brand-ink">{suggestion.location}</span>
              </div>
            )}
          </div>
        ) : null}

        {suggestion.conflictWarnings && suggestion.conflictWarnings.length > 0 && !isEditing ? (
          <div className="mt-3 space-y-2">
            {suggestion.conflictWarnings.map((warning) => (
              <p
                key={warning}
                className="rounded-2xl border border-brand-coral/20 bg-brand-coral/10 px-3 py-2 text-xs font-semibold leading-5 text-brand-coral"
              >
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        {isEditing ? (
          <div className="mt-4 grid gap-3 text-sm">
            {isScheduledItemSuggestion && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Title</span>
                  <input
                    className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                    value={suggestion.title ?? ""}
                    onChange={(event) => onUpdate({ title: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Type</span>
                  <select
                    className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                    value={suggestion.itemType ?? "task"}
                    onChange={(event) =>
                      onUpdate({ itemType: event.target.value as ScheduledItemType })
                    }
                  >
                    <option value="task">Task</option>
                    <option value="appointment">Appointment</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Date</span>
                  <input
                    className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                    type="date"
                    value={suggestion.itemDate ?? ""}
                    onChange={(event) => onUpdate({ itemDate: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-brand-ink/60">
                    Start {suggestion.itemType === "appointment" ? "" : "optional"}
                  </span>
                  <input
                    className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                    type="time"
                    value={suggestion.startTime ?? ""}
                    onChange={(event) => onUpdate({ startTime: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Location optional</span>
                  <input
                    className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                    value={suggestion.location ?? ""}
                    onChange={(event) => onUpdate({ location: event.target.value })}
                  />
                </label>
              </>
            )}
            {suggestion.projectName !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">
                  {projectNameLabel}
                </span>
                <input
                  className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                  value={suggestion.projectName ?? ""}
                  onChange={(event) => onUpdate({ projectName: event.target.value })}
                />
              </label>
            )}
            {suggestion.newProjectName !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">New project name</span>
                <input
                  className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                  value={suggestion.newProjectName ?? ""}
                  onChange={(event) =>
                    onUpdate({ newProjectName: event.target.value })
                  }
                />
              </label>
            )}
            {suggestion.category !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Category</span>
                <select
                  className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                  value={suggestion.category ?? "Must-do"}
                  onChange={(event) =>
                    onUpdate({ category: event.target.value as ProjectCategory })
                  }
                >
                  {projectCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
            )}
            {suggestion.priority !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Priority</span>
                <select
                  className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                  value={suggestion.priority ?? "Medium"}
                  onChange={(event) =>
                    onUpdate({ priority: event.target.value as ProjectPriority })
                  }
                >
                  {priorityLevels.map((priority) => (
                    <option key={priority} value={priority}>{priority}</option>
                  ))}
                </select>
              </label>
            )}
            {suggestion.deadline !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Deadline</span>
                <input
                  className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                  value={suggestion.deadline ?? ""}
                  onChange={(event) => onUpdate({ deadline: event.target.value })}
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
            {suggestion.weeklyHours !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Weekly hours</span>
                <input
                  className="w-full rounded-lg border border-brand-ink/10 bg-white px-3 py-1.5 text-sm"
                  min="0" step="0.25" type="number"
                  value={suggestion.weeklyHours ?? 0}
                  onChange={(event) => onUpdate({ weeklyHours: Number(event.target.value) })}
                />
              </label>
            )}
            {suggestion.plannedTask !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">
                  {isWeeklyBlockSuggestion ? "Details" : "Task"}
                </span>
                <textarea
                  className="w-full resize-y rounded-lg border border-brand-ink/10 bg-white px-3 py-2 text-sm leading-5"
                  rows={2}
                  value={suggestion.plannedTask ?? ""}
                  onChange={(event) => onUpdate({ plannedTask: event.target.value })}
                />
              </label>
            )}
            {suggestion.proposedNextAction !== undefined && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-brand-ink/60">Next action</span>
                <textarea
                  className="w-full resize-y rounded-lg border border-brand-ink/10 bg-white px-3 py-2 text-sm leading-5"
                  rows={2}
                  value={suggestion.proposedNextAction ?? ""}
                  onChange={(event) =>
                    onUpdate({ proposedNextAction: event.target.value })
                  }
                />
              </label>
            )}
          </div>
        ) : null}

        {detailItems.length > 0 && !isEditing ? (
          <div className="mt-3">
            <button
              className="text-xs font-semibold text-brand-ink/50 transition hover:text-brand-ink active:scale-[0.98]"
              type="button"
              onClick={() => setShowDetails((current) => !current)}
            >
              {showDetails ? "Hide details" : "Details"}
            </button>
            {showDetails ? (
              <div className="animate-assistant-details mt-2 space-y-2 overflow-hidden rounded-2xl border border-brand-ink/10 bg-brand-ink/[0.025] p-3">
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

        {actionState.status === "applied" &&
        (actionState.result?.planHref || actionState.result?.calendarHref) ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {actionState.result.planHref ? (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-teal/30 hover:text-brand-teal"
                href={actionState.result.planHref}
              >
                View in Weekly Plan
              </Link>
            ) : null}
            {actionState.result.calendarHref ? (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-brand-ink/10 bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-teal/30 hover:text-brand-teal"
                href={actionState.result.calendarHref}
              >
                View in Calendar
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isActionableSuggestion(suggestion) ? (
            <>
              <Button
                className="h-9 rounded-full px-4 text-xs font-semibold active:scale-[0.98]"
                disabled={!canApply || isFinished || actionState.status === "applying"}
                size="sm"
                onClick={onApply}
              >
                {actionState.status === "applying"
                  ? "Applying..."
                  : suggestion.type === "new_project"
                    ? "Save project"
                  : suggestion.type === "update_project"
                    ? "Update project"
                    : suggestion.type === "suggested_scheduled_item"
                      ? suggestion.itemType === "appointment"
                        ? "Add appointment"
                        : "Add task"
                    : "Apply"}
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
    </div>
  );
}

function ChatBubble({
  actionStates,
  isReviewOpen,
  message,
  onApply,
  onIgnore,
  onOpenReview,
  onToggleEdit,
  onUpdateSuggestion,
}: {
  actionStates: Record<string, ActionState>;
  isReviewOpen: boolean;
  message: ChatMessage;
  onApply: (suggestion: AssistantSuggestion) => void;
  onIgnore: (suggestionId: string) => void;
  onOpenReview: (messageId: string) => void;
  onToggleEdit: (suggestionId: string) => void;
  onUpdateSuggestion: (
    messageId: string,
    suggestionId: string,
    patch: Partial<AssistantSuggestion>,
  ) => void;
}) {
  const isUser = message.role === "user";
  const actions = getActions(message.response);
  const visibleActions = actions.filter((suggestion) =>
    isActionVisible(actionStates[suggestion.id]),
  );
  const visibleActionCount = visibleActions.length;
  const hasHandledAllSuggestions = actions.length > 0 && visibleActionCount === 0;
  const actionableActions = visibleActions.filter(isActionableSuggestion);
  const insightActions = visibleActions.filter(
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
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-ink/60">
                Thinking through your schedule
              </span>
              <span className="flex gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink/40" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink/40 [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink/40 [animation-delay:0.4s]" />
              </span>
            </div>
          ) : (
            <p className={cn("text-sm leading-6 whitespace-pre-wrap", isUser ? "text-white" : "text-brand-ink")}>
              {message.content}
              {!isUser && message.isStreaming ? (
                <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-brand-teal align-[-2px]" />
              ) : null}
            </p>
          )}
        </div>

        {!isUser && !message.isStreaming && actions.length > 0 ? (
          <div className="mt-2 w-full space-y-4">
            {hasHandledAllSuggestions ? (
              <div className="animate-assistant-card rounded-[20px] border border-brand-teal/20 bg-brand-teal/10 p-4 text-sm font-semibold leading-6 text-brand-teal">
                You’re all set. Ask for another plan whenever you’re ready.
              </div>
            ) : null}

            {!hasHandledAllSuggestions && !isReviewOpen ? (
              <div className="animate-assistant-card rounded-[22px] border border-brand-teal/14 bg-white/92 p-4 shadow-[0_14px_34px_rgba(18,32,47,0.065)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-brand-ink">
                      I found {visibleActionCount} suggested{" "}
                      {visibleActionCount === 1 ? "change" : "changes"} to review.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-brand-ink/55">
                      Nothing changes until you open them and apply one.
                    </p>
                  </div>
                  <Button
                    className="h-10 rounded-full px-4 text-xs font-semibold"
                    size="sm"
                    type="button"
                    onClick={() => onOpenReview(message.id)}
                  >
                    Review changes
                  </Button>
                </div>
              </div>
            ) : null}

            {isReviewOpen && actionableActions.length > 0 ? (
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                  <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/70">
                    Suggested next steps
                  </h4>
                  <span className="text-xs text-brand-ink/40">
                    {actionableActions.length} remaining
                  </span>
                </div>
                <div className="grid max-h-[46vh] gap-3 overflow-y-auto pr-1 sm:max-h-[520px]">
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

            {isReviewOpen && insightActions.length > 0 ? (
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                  <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-brand-ink/70">
                    Helpful notes
                  </h4>
                  <span className="text-xs text-brand-ink/40">
                    {insightActions.length} remaining
                  </span>
                </div>
                <div className="grid max-h-[46vh] gap-3 overflow-y-auto pr-1 sm:max-h-[520px]">
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
  const router = useRouter();
  const [status, setStatus] = useState<AssistantStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<AssistantContextSummary | undefined>();
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [openReviewMessages, setOpenReviewMessages] = useState<Record<string, boolean>>({});
  const [assistantNotices, setAssistantNotices] = useState<AssistantNotice[]>([]);
  const [isIntroHidden, setIsIntroHidden] = useState(false);
  const [isClearChatDialogOpen, setIsClearChatDialogOpen] = useState(false);
  const [isClearChatLoading, setIsClearChatLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSchedulingContext, setActiveSchedulingContext] =
    useState<AssistantSchedulingContext | null>(null);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState(() => createAssistantThreadId());
  const [hasRestoredConversation, setHasRestoredConversation] = useState(false);
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
  const showIntroCard = !hasMessages && !isIntroHidden;
  const schedulingQuickReplies = getSchedulingQuickReplies(
    activeSchedulingContext,
  );

  async function clearConversationHistory() {
    setIsClearChatLoading(true);

    try {
      if (activeUserId) {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        if (accessToken) {
          await fetch("/api/assistant/conversation", {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        }

        clearLocalAssistantConversation(activeUserId);
      }

      setThreadId(createAssistantThreadId());
      setActiveSchedulingContext(null);
      setMessages([]);
      setActionStates({});
      setOpenReviewMessages({});
      setAssistantNotices([]);
      setError(null);
      setIsIntroHidden(false);
      setIsClearChatDialogOpen(false);
    } finally {
      setIsClearChatLoading(false);
    }
  }


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
      body:
        method === "POST"
          ? JSON.stringify({
              prompt: nextPrompt,
              activeSchedulingContext,
              threadId,
              timezone: getBrowserTimeZone(),
            })
          : undefined,
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

  async function requestPlanReviewStream({
    nextPrompt,
    onDelta,
    recentMessages,
  }: {
    nextPrompt: string;
    onDelta: (delta: string) => void;
    recentMessages: AssistantChatHistoryItem[];
  }) {
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
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: nextPrompt,
        activeSchedulingContext,
        threadId,
        recentMessages,
        timezone: getBrowserTimeZone(),
      }),
    });

    if (!apiResponse.ok) {
      const payload: unknown = await apiResponse.json().catch(() => null);
      const apiError =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Planning Assistant could not load.";
      throw new Error(apiError);
    }

    if (!apiResponse.body) {
      throw new Error("Planning Assistant could not stream a response.");
    }

    const reader = apiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: AssistantPlanReviewResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseAssistantStreamLine(line);

        if (!event) {
          continue;
        }

        if (event.type === "message_delta") {
          onDelta(event.delta);
        }

        if (event.type === "final") {
          finalResponse = event.response;
        }

        if (event.type === "error") {
          throw new Error(event.error);
        }
      }
    }

    const finalLine = buffer.trim();

    if (finalLine) {
      const event = parseAssistantStreamLine(finalLine);

      if (event?.type === "message_delta") {
        onDelta(event.delta);
      }

      if (event?.type === "final") {
        finalResponse = event.response;
      }

      if (event?.type === "error") {
        throw new Error(event.error);
      }
    }

    if (!finalResponse) {
      throw new Error("Planning Assistant finished without a final response.");
    }

    return finalResponse;
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
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        const userId = sessionData.session?.user.id ?? null;
        const accessToken = sessionData.session?.access_token ?? null;

        if (!userId || !accessToken) {
          setStatus("signed_out");
          setError(null);
          setHasRestoredConversation(true);
          return;
        }

        setActiveUserId(userId);
        let restoredSnapshot = readLocalAssistantConversation(userId);

        try {
          const conversationResponse = await fetch(
            "/api/assistant/conversation",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: controller.signal,
            },
          );
          const conversationPayload = (await conversationResponse
            .json()
            .catch(() => null)) as { snapshot?: unknown } | null;
          const serverSnapshot = parseAssistantConversationSnapshot(
            conversationPayload?.snapshot,
          );

          if (
            serverSnapshot &&
            (!restoredSnapshot ||
              serverSnapshot.updatedAt >= restoredSnapshot.updatedAt)
          ) {
            restoredSnapshot = serverSnapshot;
          }
        } catch {
          // The local snapshot keeps the conversation usable during outages.
        }

        if (restoredSnapshot && isActive) {
          setThreadId(restoredSnapshot.threadId);
          setMessages(restoredSnapshot.messages);
          setActionStates(
            Object.fromEntries(
              Object.entries(restoredSnapshot.actionStates).map(([id, state]) => [
                id,
                state.status === "applying"
                  ? { ...state, status: "pending" as const }
                  : state,
              ]),
            ),
          );
          setOpenReviewMessages(restoredSnapshot.openReviewMessages);
          setActiveSchedulingContext(
            restoredSnapshot.activeSchedulingContext,
          );
          setIsIntroHidden(restoredSnapshot.messages.length > 0);
        }

        const response = await requestPlanReview(
          "GET",
          undefined,
          controller.signal,
        );

        if (!isActive) {
          return;
        }

        setContext(response.context);
        setHasRestoredConversation(true);
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
        setHasRestoredConversation(true);
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

  useEffect(() => {
    if (!hasRestoredConversation || !activeUserId) {
      return;
    }

    const snapshot: AssistantConversationSnapshot = {
      actionStates,
      activeSchedulingContext,
      messages: messages
        .filter((message) => !message.isStreaming)
        .map((message) => ({
          content: message.content,
          id: message.id,
          response: message.response,
          role: message.role,
        })),
      openReviewMessages,
      threadId,
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    const timeoutId = window.setTimeout(async () => {
      writeLocalAssistantConversation(activeUserId, snapshot);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        if (!accessToken) {
          return;
        }

        const response = await fetch("/api/assistant/conversation", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ snapshot }),
        });
        const payload = (await response.json().catch(() => null)) as {
          snapshot?: unknown;
        } | null;
        const persisted = parseAssistantConversationSnapshot(payload?.snapshot);

        if (persisted && persisted.threadId !== threadId) {
          setThreadId(persisted.threadId);
        }
      } catch {
        // The local copy remains authoritative until the server is reachable.
      }
    }, 650);

    return () => window.clearTimeout(timeoutId);
  }, [
    actionStates,
    activeSchedulingContext,
    activeUserId,
    hasRestoredConversation,
    messages,
    openReviewMessages,
    threadId,
  ]);

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

  function addAssistantNotice(
    message: string,
    tone: AssistantNotice["tone"] = "success",
  ) {
    const noticeId = createId("notice");

    setAssistantNotices((current) => [
      ...current.slice(-2),
      {
        id: noticeId,
        message,
        tone,
      },
    ]);

    window.setTimeout(() => {
      setAssistantNotices((current) =>
        current.filter((notice) => notice.id !== noticeId),
      );
    }, 3500);
  }

  function removeSuggestionAfterAnimation(suggestionId: string) {
    updateActionState(suggestionId, {
      editing: false,
      message: undefined,
      status: "dismissing",
    });

    window.setTimeout(() => {
      updateActionState(suggestionId, {
        editing: false,
        message: undefined,
        status: "removed",
      });
    }, cardExitDelayMs);
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

  function getLatestPendingActionReview() {
    for (const message of [...messages].reverse()) {
      if (message.role !== "assistant" || !message.response) {
        continue;
      }

      const pendingActions = getActions(message.response).filter((suggestion) => {
        const actionState = actionStates[suggestion.id];

        return (
          isActionableSuggestion(suggestion) &&
          isActionVisible(actionState) &&
          isPendingActionState(actionState)
        );
      });

      if (pendingActions.length > 0) {
        return {
          messageId: message.id,
          pendingActions,
        };
      }
    }

    return null;
  }

  async function applyConfirmedSuggestion(
    userMessage: ChatMessage,
    assistantMessageId: string,
    suggestion: AssistantSuggestion,
  ) {
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Applying the approved change...",
        isStreaming: true,
      },
    ]);
    setPrompt("");
    setIsSubmitting(true);
    setError(null);
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
        result,
        status: result?.status === "applied" ? "applied" : "error",
      });

      const content =
        result?.status === "applied"
          ? result.message
          : result?.message ??
            "I could not apply that change. Open the review card and check the fields.";

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content,
                isStreaming: false,
              }
            : message,
        ),
      );

      if (result?.status === "applied") {
        addAssistantNotice(result.message || "Suggestion applied.");
        setActiveSchedulingContext(null);
        window.dispatchEvent(new CustomEvent("schedule-builder:data-changed"));
        router.refresh();
      }
    } catch (applyError) {
      const message = getErrorMessage(applyError);

      updateActionState(suggestion.id, {
        message,
        status: "error",
      });
      setMessages((current) =>
        current.map((chatMessage) =>
          chatMessage.id === assistantMessageId
            ? {
                ...chatMessage,
                content: message,
                isStreaming: false,
              }
            : chatMessage,
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
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
    const assistantMessageId = createId("assistant");

    const schedulingExpectsInput =
      activeSchedulingContext?.state === "awaiting_window_selection" ||
      activeSchedulingContext?.state === "awaiting_duration" ||
      activeSchedulingContext?.state === "needs_clarification";

    if (isConfirmationPrompt(trimmedPrompt) && !schedulingExpectsInput) {
      const pendingReview = getLatestPendingActionReview();

      if (pendingReview?.pendingActions.length === 1) {
        await applyConfirmedSuggestion(
          userMessage,
          assistantMessageId,
          pendingReview.pendingActions[0],
        );
        return;
      }

      if (pendingReview && pendingReview.pendingActions.length > 1) {
        setMessages((current) => [
          ...current,
          userMessage,
          {
            id: assistantMessageId,
            role: "assistant",
            content:
              "I see more than one pending change. Open the review card and choose the exact update you want me to apply.",
            isStreaming: false,
          },
        ]);
        setOpenReviewMessages((current) => ({
          ...current,
          [pendingReview.messageId]: true,
        }));
        setPrompt("");
        return;
      }
    }

    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };
    const recentMessages = normalizeMessagesForRequest(messages);

    setMessages((current) => [...current, userMessage, assistantPlaceholder]);
    setPrompt("");
    setIsSubmitting(true);
    setError(null);

    let incomingBuffer = "";
    let revealedText = "";
    let streamFinished = false;
    const setAssistantContent = (content: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content }
            : message,
        ),
      );
    };
    const revealBufferedText = async () => {
      while (!streamFinished || incomingBuffer.length > 0) {
        if (incomingBuffer.length === 0) {
          await sleep(18);
          continue;
        }

        const chunk = takeTypingChunk(incomingBuffer);
        incomingBuffer = incomingBuffer.slice(chunk.length);
        revealedText += chunk;
        setAssistantContent(revealedText);
        await sleep(getTypingDelay(chunk));
      }
    };
    const revealPromise = revealBufferedText();

    try {
      const response = await requestPlanReviewStream({
        nextPrompt: trimmedPrompt,
        recentMessages,
        onDelta: (delta) => {
          incomingBuffer += delta;
        },
      });
      streamFinished = true;
      await revealPromise;

      const chatResponse = normalizeResponseForChat(response, assistantMessageId);
      const actions = getActions(chatResponse);

      setContext(chatResponse.context);
      if (chatResponse.schedulingContext !== undefined) {
        setActiveSchedulingContext(chatResponse.schedulingContext);
      }
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
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: chatResponse.assistantMessage || chatResponse.message,
                isStreaming: false,
                response: chatResponse,
              }
            : message,
        ),
      );
      setOpenReviewMessages((current) => ({
        ...current,
        [assistantMessageId]:
          actions.length > 0 &&
          chatResponse.schedulingContext?.state === "awaiting_apply",
      }));
      setStatus("ready");
    } catch (submitError) {
      if (
        submitError instanceof Error &&
        submitError.name === "SignedOutError"
      ) {
        streamFinished = true;
        await revealPromise;
        setStatus("signed_out");
        setError(null);
        setMessages((current) =>
          current.filter((message) => message.id !== assistantMessageId),
        );
        return;
      }

      setError(getErrorMessage(submitError));
      streamFinished = true;
      await revealPromise;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content:
                  message.content ||
                  "I couldn’t finish that planning request. Try again in a moment, or ask in a simpler way.",
                isStreaming: false,
              }
            : message,
        ),
      );
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
      addAssistantNotice(
        "That note is informational, so there is nothing to apply.",
        "error",
      );
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
        result,
        status: result?.status === "applied" ? "applied" : "error",
      });

      if (result?.status === "applied") {
        addAssistantNotice(result.message || "Suggestion applied.");
        setActiveSchedulingContext(null);
        window.dispatchEvent(new CustomEvent("schedule-builder:data-changed"));
        router.refresh();
        return;
      }

      if (result?.status === "skipped") {
        addAssistantNotice(
          result.message || "This suggestion cannot be applied automatically.",
          "error",
        );
        return;
      }
    } catch (applyError) {
      updateActionState(suggestion.id, {
        message: getErrorMessage(applyError),
        status: "error",
      });
    }
  }

  function ignoreSuggestion(suggestionId: string) {
    removeSuggestionAfterAnimation(suggestionId);
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
        
        {showIntroCard ? (
          <section className="panel shrink-0 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-[-0.02em] text-brand-ink sm:text-2xl">
                  Planning Assistant
                </h1>
                <p className="mt-1 text-sm leading-6 text-brand-ink/60">
                  Propose blocks; you approve.
                </p>
                <p className="mt-1 text-sm leading-6 text-brand-ink/60">
                  Ask for help planning your week, projects, time blocks, or priorities.
                </p>
                <p className="mt-2 text-xs font-semibold text-brand-teal">
                  Nothing is added to your schedule unless you approve it.
                </p>
              </div>
              <button
                aria-label="Hide assistant intro"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-ink/8 bg-white/70 text-lg leading-none text-brand-ink/45 transition hover:bg-white hover:text-brand-ink"
                type="button"
                onClick={() => setIsIntroHidden(true)}
              >
                ×
              </button>
            </div>
            <div className="mt-4">
              <AssistantContextDetails context={context} />
            </div>
          </section>
        ) : (
          <section className="flex shrink-0 items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-brand-ink">
                Planning Assistant
              </h1>
              <p className="truncate text-xs text-brand-ink/50">
                Nothing changes unless you apply a suggestion.
              </p>
            </div>
            {hasMessages ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-full px-3 text-[11px] font-bold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink"
                onClick={() => setIsClearChatDialogOpen(true)}
              >
                Clear
              </Button>
            ) : null}
          </section>
        )}

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
                  isReviewOpen={openReviewMessages[message.id] ?? false}
                  message={message}
                  onApply={(suggestion) => void applySuggestion(suggestion)}
                  onIgnore={ignoreSuggestion}
                  onOpenReview={(messageId) =>
                    setOpenReviewMessages((current) => ({
                      ...current,
                      [messageId]: true,
                    }))
                  }
                  onToggleEdit={toggleEdit}
                  onUpdateSuggestion={updateSuggestion}
                />
              ))}

              {assistantNotices.length > 0 ? (
                <div className="mx-auto grid w-full max-w-md gap-2">
                  {assistantNotices.map((notice) => (
                    <div
                      key={notice.id}
                      className={cn(
                        "animate-assistant-card rounded-2xl border px-4 py-3 text-sm font-semibold leading-6 shadow-sm",
                        notice.tone === "success"
                          ? "border-brand-teal/20 bg-brand-teal/10 text-brand-teal"
                          : "border-brand-coral/20 bg-brand-coral/10 text-brand-coral",
                      )}
                    >
                      {notice.message}
                    </div>
                  ))}
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
                  <div className="mb-3 px-1">
                    {schedulingQuickReplies.length > 0 ? (
                      <p className="mb-2 text-xs font-semibold text-brand-ink/55">
                        {activeSchedulingContext?.pendingQuestion ?? "Choose an option"}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {(schedulingQuickReplies.length > 0
                        ? schedulingQuickReplies
                        : examplePrompts.map((example) => ({
                            label: example,
                            prompt: example,
                          }))).map((choice) => (
                        <button
                          key={`${choice.label}-${choice.prompt}`}
                          className="rounded-full border border-brand-ink/10 bg-white/80 px-3.5 py-2 text-xs font-semibold text-brand-ink/60 shadow-sm hover:-translate-y-0.5 hover:border-brand-teal/30 hover:bg-white hover:text-brand-ink active:scale-95"
                          type="button"
                          onClick={() => {
                            if (schedulingQuickReplies.length > 0) {
                              void sendPrompt(choice.prompt);
                              return;
                            }

                            setPrompt(choice.prompt);
                          }}
                        >
                          {choice.label}
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

      <ConfirmDialog
        confirmLabel="Clear conversation"
        description="This removes the Assistant messages and pending suggestions. Applied schedule items will remain."
        destructive
        loading={isClearChatLoading}
        open={isClearChatDialogOpen}
        title="Clear this conversation?"
        onCancel={() => setIsClearChatDialogOpen(false)}
        onConfirm={() => void clearConversationHistory()}
      />
    </div>
  );
}
