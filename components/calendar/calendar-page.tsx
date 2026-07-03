"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IcsImportPanel } from "@/components/calendar/ics-import-panel";
import {
  CalendarIcon,
  ClockIcon,
  FolderStackIcon,
  PlusIcon,
} from "@/components/projects/icons";
import { SchedulerAppShell } from "@/components/scheduler/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  formatImportedEventSource,
  formatImportedEventTimeRange,
  getImportedEventDurationHours,
  isSchoolCalendarEvent,
  isScheduleBuilderExportedEvent,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import {
  buildCalendarDays,
  buildCalendarMonth,
  calendarWeekDays,
  getCurrentWeekStart,
  getPlanBlockTimeLabel,
  type CalendarDaySchedule,
  type CalendarMonthDaySchedule,
} from "@/lib/calendar";
import type { Project } from "@/lib/projects";
import {
  createDefaultScheduledItemDraft,
  createScheduledItemPayload,
  formatScheduledItemTimeLabel,
  formatScheduledItemTypeLabel,
  sortScheduledItems,
  validateScheduledItemDraft,
  type ScheduledItem,
  type ScheduledItemDraft,
  type ScheduledItemType,
} from "@/lib/scheduled-items";
import {
  findScheduledItemConflicts,
  findWeeklyPlanImportedEventConflicts,
  findWeeklyPlanWorkConflicts,
  type ScheduledItemConflict,
  type WeeklyPlanImportedEventConflict,
  type WeeklyPlanWorkConflict,
} from "@/lib/schedule-conflicts";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  fetchProjectsForUser,
  fetchImportedCalendarEventsForUser,
  createScheduledItemForUser,
  deleteScheduledItemForUser,
  fetchScheduledItemsForUser,
  fetchScheduleExceptionsForUser,
  fetchWeeklyPlanBlocksForUser,
  fetchWorkShiftsForUser,
  updateScheduledItemForUser,
} from "@/lib/supabase/scheduler";
import type { ScheduleException } from "@/lib/schedule-exceptions";
import { formatEstimatedHours, type WeeklyPlanBlock } from "@/lib/weekly-plan";
import {
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";
import { cn } from "@/lib/utils";
import { getUserFacingError } from "@/lib/user-facing-error";

type CalendarStatus = "loading" | "ready" | "signed_out" | "error";
type CalendarView = "week" | "month";

type CalendarFilters = {
  deadlines: boolean;
  flexible: boolean;
  importedEvents: boolean;
  planBlocks: boolean;
  scheduledItems: boolean;
  workShifts: boolean;
};

type PlanBlockGoogleSyncStatus = "needs_attention" | "synced";

type GoogleCalendarSyncStatusResponse = {
  error?: string;
  statuses?: Array<{
    syncStatus: PlanBlockGoogleSyncStatus;
    weeklyPlanBlockId: string;
  }>;
};

type ScheduledItemFormState = {
  initialDraft: ScheduledItemDraft;
  item?: ScheduledItem;
  mode: "create" | "edit";
};

const defaultFilters: CalendarFilters = {
  deadlines: true,
  flexible: true,
  importedEvents: true,
  planBlocks: true,
  scheduledItems: true,
  workShifts: true,
};

const filterItems: Array<{
  key: keyof CalendarFilters;
  label: string;
}> = [
  {
    key: "workShifts",
    label: "Work",
  },
  {
    key: "planBlocks",
    label: "Plan",
  },
  {
    key: "scheduledItems",
    label: "Tasks",
  },
  {
    key: "deadlines",
    label: "Deadlines",
  },
  {
    key: "importedEvents",
    label: "External",
  },
  {
    key: "flexible",
    label: "Flexible",
  },
];

type MonthIndicatorTone =
  | "conflict"
  | "deadline"
  | "external"
  | "flexible"
  | "google"
  | "ics"
  | "plan"
  | "scheduleBuilder"
  | "school"
  | "task"
  | "appointment"
  | "work";

type CalendarEventGroup = {
  children: ReactNode;
  count: number;
  label: string;
};

function getErrorMessage(error: unknown) {
  return getUserFacingError(error, "Calendar data is unavailable right now.");
}

function getMissingTableMessage(error: unknown) {
  const message = getErrorMessage(error);

  if (
    message.includes("projects") ||
    message.includes("scheduled_items") ||
    message.includes("weekly_plan_blocks") ||
    message.includes("work_shifts") ||
    message.includes("imported_calendar_events")
  ) {
    return "One of the scheduler tables is missing or unavailable in Supabase. Check the project schema, then refresh this page.";
  }

  return message;
}

function formatHours(hours: number) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr${
    hours === 1 ? "" : "s"
  }`;
}

function normalizeProjectLookupName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isProjectWorkBlock(block: WeeklyPlanBlock, projects: Project[]) {
  const blockTitle = normalizeProjectLookupName(block.projectName);

  return projects.some(
    (project) => normalizeProjectLookupName(project.name) === blockTitle,
  );
}

function getPlanBlockKindLabel(block: WeeklyPlanBlock, projects: Project[]) {
  return isProjectWorkBlock(block, projects)
    ? "Project work"
    : "Task / appointment";
}

function formatDateInputValue(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getWeekStartInputValueForDate(date: Date) {
  const weekStart = new Date(date);
  const offsetFromMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - offsetFromMonday);
  return formatDateInputValue(weekStart);
}

function getVisibleDayData(day: CalendarDaySchedule, filters: CalendarFilters) {
  const workShifts = filters.workShifts ? day.workShifts : [];
  const planBlocks = filters.planBlocks
    ? day.planBlocks.filter((block) => filters.flexible || block.startTime)
    : [];
  const scheduledItems = filters.scheduledItems ? day.scheduledItems : [];
  const deadlines = filters.deadlines ? day.deadlines : [];
  const importedEvents = filters.importedEvents ? day.importedEvents : [];
  const externalCommitmentEvents = importedEvents.filter(
    (event) => !isScheduleBuilderExportedEvent(event),
  );
  const scheduledHours =
    workShifts.reduce(
      (sum, shift) => sum + getWorkShiftDurationHours(shift),
      0,
    ) +
    planBlocks.reduce((sum, block) => sum + block.estimatedHours, 0) +
    scheduledItems.reduce((sum, item) => sum + item.estimatedHours, 0) +
    externalCommitmentEvents.reduce(
      (sum, event) => sum + getImportedEventDurationHours(event),
      0,
    );

  return {
    deadlines,
    hasEvents:
      workShifts.length > 0 ||
      planBlocks.length > 0 ||
      scheduledItems.length > 0 ||
      deadlines.length > 0 ||
      importedEvents.length > 0,
    importedEvents,
    planBlocks,
    scheduledItems,
    scheduledHours,
    workShifts,
  };
}

function getImportedEventSourceTone(
  event: ImportedCalendarEvent,
): Extract<
  MonthIndicatorTone,
  "external" | "google" | "ics" | "scheduleBuilder" | "school"
> {
  if (isScheduleBuilderExportedEvent(event)) {
    return "scheduleBuilder";
  }

  if (isSchoolCalendarEvent(event)) {
    return "school";
  }

  if (event.source === "google_calendar") {
    return "google";
  }

  if (event.source === "ics") {
    return "ics";
  }

  return "external";
}

function splitPlanBlocks(planBlocks: WeeklyPlanBlock[]) {
  return {
    flexiblePlanBlocks: planBlocks.filter((block) => !block.startTime),
    timedPlanBlocks: planBlocks.filter((block) => block.startTime),
  };
}

function getMonthEventSummary(
  day: CalendarMonthDaySchedule,
  filters: CalendarFilters,
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>,
  importedConflictByBlockId: Map<string, WeeklyPlanImportedEventConflict>,
) {
  const visibleDay = getVisibleDayData(day, filters);
  const { flexiblePlanBlocks, timedPlanBlocks } = splitPlanBlocks(
    visibleDay.planBlocks,
  );
  const indicators: Array<{
    count: number;
    id: string;
    label: string;
    tone: MonthIndicatorTone;
  }> = [];
  const conflictingBlocks = visibleDay.planBlocks.filter(
    (block) =>
      conflictByBlockId.has(block.id) ||
      importedConflictByBlockId.has(block.id),
  );

  if (conflictingBlocks.length > 0) {
    indicators.push({
      count: conflictingBlocks.length,
      id: "conflict",
      label: "Conflict",
      tone: "conflict",
    });
  }

  if (visibleDay.workShifts.length > 0) {
    indicators.push({
      count: visibleDay.workShifts.length,
      id: "work",
      label: "Work",
      tone: "work",
    });
  }

  if (timedPlanBlocks.length > 0) {
    indicators.push({
      count: timedPlanBlocks.length,
      id: "plan",
      label: "Plan",
      tone: "plan",
    });
  }

  if (flexiblePlanBlocks.length > 0) {
    indicators.push({
      count: flexiblePlanBlocks.length,
      id: "flexible",
      label: "Flexible",
      tone: "flexible",
    });
  }

  const taskCount = visibleDay.scheduledItems.filter(
    (item) => item.itemType === "task",
  ).length;
  const appointmentCount = visibleDay.scheduledItems.filter(
    (item) => item.itemType === "appointment",
  ).length;

  if (taskCount > 0) {
    indicators.push({
      count: taskCount,
      id: "task",
      label: "Task",
      tone: "task",
    });
  }

  if (appointmentCount > 0) {
    indicators.push({
      count: appointmentCount,
      id: "appointment",
      label: "Appt",
      tone: "appointment",
    });
  }

  if (visibleDay.deadlines.length > 0) {
    indicators.push({
      count: visibleDay.deadlines.length,
      id: "deadline",
      label: "Due",
      tone: "deadline",
    });
  }

  const importedEventsBySource = visibleDay.importedEvents.reduce(
    (groups, event) => {
      const tone = getImportedEventSourceTone(event);
      groups.set(tone, (groups.get(tone) ?? 0) + 1);
      return groups;
    },
    new Map<
      Extract<
        MonthIndicatorTone,
        "external" | "google" | "ics" | "scheduleBuilder" | "school"
      >,
      number
    >(),
  );

  importedEventsBySource.forEach((count, tone) => {
    indicators.push({
      count,
      id: tone,
      label:
        tone === "google"
          ? "Google"
          : tone === "ics"
            ? "ICS"
            : tone === "scheduleBuilder"
              ? "SB export"
              : tone === "school"
                ? "School"
                : "External",
      tone,
    });
  });

  return {
    indicators,
    totalItems:
      visibleDay.workShifts.length +
      visibleDay.planBlocks.length +
      visibleDay.scheduledItems.length +
      visibleDay.deadlines.length +
      visibleDay.importedEvents.length,
    visibleDay,
  };
}

function getMonthEventToneClass(tone: MonthIndicatorTone) {
  if (tone === "conflict") {
    return "border-brand-coral/18 bg-brand-coral/[0.09] text-brand-coral";
  }

  if (tone === "work") {
    return "border-brand-ocean/16 bg-brand-ocean/[0.075] text-brand-ocean";
  }

  if (tone === "deadline") {
    return "border-brand-coral/16 bg-brand-coral/[0.08] text-brand-coral";
  }

  if (tone === "google") {
    return "border-brand-teal/16 bg-brand-teal/[0.08] text-brand-teal";
  }

  if (tone === "ics") {
    return "border-brand-ocean/14 bg-brand-ocean/[0.065] text-brand-ocean";
  }

  if (tone === "scheduleBuilder") {
    return "border-brand-teal/12 bg-brand-teal/[0.045] text-brand-teal/72";
  }

  if (tone === "school") {
    return "border-[#a44824]/14 bg-[#fff2ea] text-[#a44824]";
  }

  if (tone === "appointment") {
    return "border-brand-coral/14 bg-brand-coral/[0.075] text-brand-coral";
  }

  if (tone === "task") {
    return "border-brand-teal/14 bg-brand-teal/[0.07] text-brand-teal";
  }

  if (tone === "external") {
    return "border-brand-ink/10 bg-brand-ink/[0.045] text-brand-ink/70";
  }

  if (tone === "flexible") {
    return "border-brand-teal/12 bg-brand-teal/[0.045] text-brand-teal/78";
  }

  return "border-brand-teal/14 bg-brand-teal/[0.075] text-brand-teal";
}

function addMonthsToDate(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDaysToDate(date: Date, amount: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function EventCardShell({
  accent,
  badges,
  children,
  meta,
  title,
}: {
  accent:
    | "appointment"
    | "deadline"
    | "external"
    | "google"
    | "ics"
    | "plan"
    | "task"
    | "work";
  badges: ReactNode;
  children?: ReactNode;
  meta?: string;
  title: string;
}) {
  const accentClass =
    accent === "work"
      ? "border-brand-ocean/14 bg-brand-ocean/[0.055]"
      : accent === "appointment"
        ? "border-brand-coral/14 bg-brand-coral/[0.055]"
      : accent === "task"
        ? "border-brand-teal/14 bg-brand-teal/[0.045]"
      : accent === "deadline"
        ? "border-brand-coral/14 bg-brand-coral/[0.055]"
        : accent === "plan"
          ? "border-brand-teal/14 bg-brand-teal/[0.055]"
          : accent === "google"
            ? "border-brand-teal/14 bg-brand-teal/[0.065]"
            : accent === "ics"
              ? "border-brand-ocean/12 bg-brand-ocean/[0.045]"
              : "border-brand-ink/10 bg-brand-ink/[0.035]";

  return (
    <article
      className={cn(
        "rounded-[22px] border p-4 shadow-[0_12px_28px_rgba(18,32,47,0.035)]",
        accentClass,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {badges}
        {meta ? (
          <span className="text-xs font-semibold text-brand-ink/45">
            {meta}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
        {title}
      </p>
      {children}
    </article>
  );
}

function WorkShiftEvent({ shift }: { shift: WorkShift }) {
  return (
    <EventCardShell
      accent="work"
      badges={
        <>
          <Badge className="bg-brand-ocean/10 text-brand-ocean" variant="subtle">
            Work shift
          </Badge>
          {shift.isException ? (
            <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
              Updated for this date
            </Badge>
          ) : null}
        </>
      }
      meta={`${formatWorkShiftRange(shift)} • ${formatHours(
        getWorkShiftDurationHours(shift),
      )}`}
      title="Blocked time"
    >
      {shift.location ? (
        <p className="mt-2 text-sm font-medium leading-6 text-brand-ink/65">
          {shift.location}
        </p>
      ) : null}
      {shift.notes ? (
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-brand-ink/56">
          {shift.notes}
        </p>
      ) : null}
    </EventCardShell>
  );
}

function PlanBlockEvent({
  block,
  importedConflict,
  projects,
  syncStatus,
  workConflict,
}: {
  block: WeeklyPlanBlock;
  importedConflict?: WeeklyPlanImportedEventConflict | null;
  projects: Project[];
  syncStatus?: PlanBlockGoogleSyncStatus | null;
  workConflict?: WeeklyPlanWorkConflict | null;
}) {
  const hasConflict = Boolean(workConflict || importedConflict);

  return (
    <EventCardShell
      accent={hasConflict ? "deadline" : "plan"}
      badges={
        <>
          <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
            {getPlanBlockKindLabel(block, projects)}
          </Badge>
          {hasConflict ? (
            <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
              Conflict
            </Badge>
          ) : null}
          {syncStatus === "synced" ? (
            <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
              Synced to Google
            </Badge>
          ) : null}
          {syncStatus === "needs_attention" ? (
            <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
              Sync needs attention
            </Badge>
          ) : null}
        </>
      }
      meta={getPlanBlockTimeLabel(block)}
      title={block.projectName}
    >
      <p className="mt-1 text-sm leading-6 text-brand-ink/65">
        {block.plannedTask}
      </p>
      {workConflict ? (
        <p className="mt-3 rounded-2xl border border-brand-coral/16 bg-white/66 px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
          {workConflict.message}
        </p>
      ) : null}
      {importedConflict ? (
        <p className="mt-3 rounded-2xl border border-brand-coral/16 bg-white/66 px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
          {importedConflict.message}
        </p>
      ) : null}
    </EventCardShell>
  );
}

function DeadlineEvent({
  deadlineText,
  projectName,
}: {
  deadlineText: string;
  projectName: string;
}) {
  return (
    <EventCardShell
      accent="deadline"
      badges={
        <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
          Deadline
        </Badge>
      }
      meta={deadlineText}
      title={projectName}
    >
      <p className="mt-1 text-sm leading-6 text-brand-ink/65">
        Project deadline
      </p>
    </EventCardShell>
  );
}

function ImportedCalendarEventCard({
  event,
}: {
  event: ImportedCalendarEvent;
}) {
  const sourceTone = getImportedEventSourceTone(event);
  const sourceLabel = formatImportedEventSource(event);
  const cardAccent =
    sourceTone === "scheduleBuilder" || sourceTone === "school"
      ? "ics"
      : sourceTone;

  return (
    <EventCardShell
      accent={cardAccent}
      badges={
        <>
          <Badge className={getMonthEventToneClass(sourceTone)} variant="subtle">
            {sourceLabel}
          </Badge>
          <Badge className="bg-brand-ink/[0.045] text-brand-ink/52" variant="subtle">
            Read-only
          </Badge>
        </>
      }
      meta={formatImportedEventTimeRange(event)}
      title={event.title}
    >
      {event.location ? (
        <p className="mt-1 text-sm leading-6 text-brand-ink/62">
          {event.location}
        </p>
      ) : null}
      {event.description ? (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-brand-ink/56">
          {event.description}
        </p>
      ) : null}
    </EventCardShell>
  );
}

function ScheduledItemEvent({
  conflicts,
  item,
  onEdit,
  onRemove,
}: {
  conflicts: ScheduledItemConflict[];
  item: ScheduledItem;
  onEdit: (item: ScheduledItem) => void;
  onRemove: (item: ScheduledItem) => void;
}) {
  const typeLabel = formatScheduledItemTypeLabel(item.itemType);

  return (
    <EventCardShell
      accent={item.itemType === "appointment" ? "appointment" : "task"}
      badges={
        <>
          <Badge
            className={
              item.itemType === "appointment"
                ? "bg-brand-coral/10 text-brand-coral"
                : "bg-brand-teal/10 text-brand-teal"
            }
            variant="subtle"
          >
            {typeLabel}
          </Badge>
          {conflicts.length > 0 ? (
            <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
              Conflict
            </Badge>
          ) : null}
        </>
      }
      meta={formatScheduledItemTimeLabel(item)}
      title={item.title}
    >
      {item.description ? (
        <p className="mt-1 text-sm leading-6 text-brand-ink/65">
          {item.description}
        </p>
      ) : null}
      {item.location ? (
        <p className="mt-2 text-sm font-medium leading-6 text-brand-ink/58">
          {item.location}
        </p>
      ) : null}
      {conflicts.map((conflict) => (
        <p
          key={`${item.id}-${conflict.kind}-${conflict.sourceLabel}`}
          className="mt-3 rounded-2xl border border-brand-coral/16 bg-white/66 px-3 py-2 text-xs font-semibold leading-5 text-brand-coral"
        >
          {conflict.message}
        </p>
      ))}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-full border border-brand-ink/10 bg-white/72 px-3 py-1.5 text-xs font-semibold text-brand-ink/58 transition hover:bg-white hover:text-brand-ink"
          type="button"
          onClick={() => onEdit(item)}
        >
          Edit
        </button>
        <button
          className="rounded-full border border-brand-coral/12 bg-white/72 px-3 py-1.5 text-xs font-semibold text-brand-coral/75 transition hover:bg-brand-coral/8 hover:text-brand-coral"
          type="button"
          onClick={() => onRemove(item)}
        >
          Remove
        </button>
      </div>
    </EventCardShell>
  );
}

function ScheduledItemFormDialog({
  getConflicts,
  initialDraft,
  loading,
  mode,
  onCancel,
  onSubmit,
  open,
}: {
  getConflicts: (draft: ScheduledItemDraft) => ScheduledItemConflict[];
  initialDraft: ScheduledItemDraft;
  loading: boolean;
  mode: "create" | "edit";
  onCancel: () => void;
  onSubmit: (draft: ScheduledItemDraft) => void;
  open: boolean;
}) {
  const [draft, setDraft] = useState<ScheduledItemDraft>(initialDraft);

  useEffect(() => {
    if (open) {
      setDraft(initialDraft);
    }
  }, [initialDraft, open]);

  if (!open) {
    return null;
  }

  const validationMessage = validateScheduledItemDraft(draft);
  const conflicts = getConflicts(draft);
  const typeLabel = formatScheduledItemTypeLabel(draft.itemType);
  const submitLabel =
    mode === "edit"
      ? "Save changes"
      : draft.itemType === "appointment"
        ? "Add appointment"
        : "Add task";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-brand-ink/28 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <form
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/70 bg-white p-5 shadow-[0_30px_90px_rgba(18,32,47,0.24)] sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();

          if (!validationMessage) {
            onSubmit(draft);
          }
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
              {mode === "edit" ? "Edit" : "Add"} exact-date item
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-brand-ink">
              {mode === "edit" ? `Edit ${typeLabel}` : "Task or appointment"}
            </h2>
          </div>
          <button
            className="w-fit rounded-full border border-brand-ink/10 bg-white/78 px-3 py-1.5 text-xs font-semibold text-brand-ink/58 transition hover:bg-white hover:text-brand-ink"
            disabled={loading}
            type="button"
            onClick={onCancel}
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-brand-ink">
              Item type
            </p>
            <div className="grid gap-2 rounded-[22px] bg-brand-ink/[0.045] p-1 sm:grid-cols-2">
              {(["task", "appointment"] as const).map((itemType) => (
                <button
                  key={itemType}
                  aria-pressed={draft.itemType === itemType}
                  className={`rounded-[18px] px-4 py-3 text-sm font-semibold transition ${
                    draft.itemType === itemType
                      ? "bg-white text-brand-ink shadow-[0_10px_24px_rgba(18,32,47,0.08)]"
                      : "text-brand-ink/58 hover:bg-white/60 hover:text-brand-ink"
                  }`}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      itemType,
                    }))
                  }
                >
                  {formatScheduledItemTypeLabel(itemType)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-brand-ink">
              Title
              <Input
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-brand-ink">
              Date
              <Input
                type="date"
                value={draft.itemDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    itemDate: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <label className="space-y-2 text-sm font-semibold text-brand-ink">
            Details <span className="font-normal text-brand-ink/42">optional</span>
            <textarea
              className="min-h-24 w-full rounded-2xl border border-brand-ink/10 bg-white/82 px-4 py-3 text-sm leading-6 text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-brand-ink/36 focus:border-brand-teal/35 focus:bg-white"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm font-semibold text-brand-ink">
              Start{" "}
              <span className="font-normal text-brand-ink/42">
                {draft.itemType === "task" ? "optional" : "required"}
              </span>
              <Input
                type="time"
                value={draft.startTime ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    startTime: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-brand-ink">
              Duration
              <Input
                min="0.25"
                step="0.25"
                type="number"
                value={draft.estimatedHours}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    estimatedHours: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-brand-ink">
              Location{" "}
              <span className="font-normal text-brand-ink/42">optional</span>
              <Input
                value={draft.location}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          {validationMessage ? (
            <p className="rounded-2xl border border-brand-coral/16 bg-brand-coral/[0.07] px-4 py-3 text-sm font-semibold leading-6 text-brand-coral">
              {validationMessage}
            </p>
          ) : null}

          {!validationMessage && conflicts.length > 0 ? (
            <div className="rounded-[22px] border border-brand-coral/14 bg-brand-coral/[0.055] p-4">
              <p className="text-sm font-semibold text-brand-coral">
                Heads up before saving
              </p>
              <div className="mt-2 grid gap-2">
                {conflicts.map((conflict) => (
                  <p
                    key={`${conflict.kind}-${conflict.sourceLabel}`}
                    className="text-sm leading-6 text-brand-coral/88"
                  >
                    {conflict.message}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <Button
            disabled={loading}
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button disabled={loading || Boolean(validationMessage)} type="submit">
            {loading ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CalendarEventGroupSection({ children, count, label }: CalendarEventGroup) {
  if (count === 0) {
    return null;
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-ink/22" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-ink/42">
          {label}
        </p>
        <span className="rounded-full bg-brand-ink/[0.045] px-2 py-0.5 text-[11px] font-semibold text-brand-ink/42">
          {count}
        </span>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function DayEventGroups({
  conflictByBlockId,
  day,
  importedConflictByBlockId,
  onEditScheduledItem,
  onRemoveScheduledItem,
  planBlockSyncStatusById,
  projects,
  scheduledItemConflictsById,
}: {
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>;
  day: ReturnType<typeof getVisibleDayData>;
  importedConflictByBlockId: Map<string, WeeklyPlanImportedEventConflict>;
  onEditScheduledItem: (item: ScheduledItem) => void;
  onRemoveScheduledItem: (item: ScheduledItem) => void;
  planBlockSyncStatusById: Record<string, PlanBlockGoogleSyncStatus>;
  projects: Project[];
  scheduledItemConflictsById: Map<string, ScheduledItemConflict[]>;
}) {
  const { flexiblePlanBlocks, timedPlanBlocks } = splitPlanBlocks(
    day.planBlocks,
  );

  return (
    <div className="space-y-4">
      <CalendarEventGroupSection
        count={day.workShifts.length}
        label="Work shifts"
      >
        {day.workShifts.map((shift) => (
          <WorkShiftEvent key={shift.id} shift={shift} />
        ))}
      </CalendarEventGroupSection>

      <CalendarEventGroupSection
        count={day.importedEvents.length}
        label="Calendar events"
      >
        {day.importedEvents.map((event) => (
          <ImportedCalendarEventCard key={event.id} event={event} />
        ))}
      </CalendarEventGroupSection>

      <CalendarEventGroupSection
        count={timedPlanBlocks.length}
        label="Time blocks"
      >
        {timedPlanBlocks.map((block) => (
          <PlanBlockEvent
            key={block.id}
            block={block}
            importedConflict={importedConflictByBlockId.get(block.id)}
            projects={projects}
            syncStatus={planBlockSyncStatusById[block.id]}
            workConflict={conflictByBlockId.get(block.id)}
          />
        ))}
      </CalendarEventGroupSection>

      <CalendarEventGroupSection
        count={day.scheduledItems.length}
        label="Tasks & appointments"
      >
        {day.scheduledItems.map((item) => (
          <ScheduledItemEvent
            key={item.id}
            conflicts={scheduledItemConflictsById.get(item.id) ?? []}
            item={item}
            onEdit={onEditScheduledItem}
            onRemove={onRemoveScheduledItem}
          />
        ))}
      </CalendarEventGroupSection>

      <CalendarEventGroupSection
        count={flexiblePlanBlocks.length}
        label="Flexible blocks"
      >
        {flexiblePlanBlocks.map((block) => (
          <PlanBlockEvent
            key={block.id}
            block={block}
            importedConflict={importedConflictByBlockId.get(block.id)}
            projects={projects}
            syncStatus={planBlockSyncStatusById[block.id]}
            workConflict={conflictByBlockId.get(block.id)}
          />
        ))}
      </CalendarEventGroupSection>

      <CalendarEventGroupSection count={day.deadlines.length} label="Deadlines">
        {day.deadlines.map((deadline) => (
          <DeadlineEvent
            key={`${deadline.projectId}-${deadline.deadlineText}`}
            deadlineText={deadline.deadlineText}
            projectName={deadline.projectName}
          />
        ))}
      </CalendarEventGroupSection>
    </div>
  );
}

function MonthIndicatorBadge({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: MonthIndicatorTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold leading-none ${getMonthEventToneClass(
        tone,
      )}`}
    >
      {label}
      {count > 1 ? ` ${count}` : ""}
    </span>
  );
}

function MonthEventDot({ tone }: { tone: MonthIndicatorTone }) {
  const dotClass =
    tone === "conflict"
      ? "bg-brand-coral"
      : tone === "work"
      ? "bg-brand-ocean"
      : tone === "google"
        ? "bg-brand-teal"
      : tone === "ics"
        ? "bg-brand-ocean"
      : tone === "scheduleBuilder"
        ? "bg-brand-teal/55"
      : tone === "school"
        ? "bg-[#a44824]"
      : tone === "appointment"
        ? "bg-brand-coral"
      : tone === "task"
        ? "bg-brand-teal"
      : tone === "external"
        ? "bg-brand-ink/55"
      : tone === "deadline"
        ? "bg-brand-coral"
        : tone === "flexible"
          ? "bg-brand-teal/45"
          : "bg-brand-teal";

  return (
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 rounded-full ${dotClass}`}
    />
  );
}

function MonthDayDetail({
  conflictByBlockId,
  day,
  filters,
  importedConflictByBlockId,
  onCreateScheduledItem,
  onEditScheduledItem,
  onRemoveScheduledItem,
  planBlockSyncStatusById,
  projects,
  scheduledItemConflictsById,
  status,
}: {
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>;
  day: CalendarMonthDaySchedule | null;
  filters: CalendarFilters;
  importedConflictByBlockId: Map<string, WeeklyPlanImportedEventConflict>;
  onCreateScheduledItem: (itemDate: string) => void;
  onEditScheduledItem: (item: ScheduledItem) => void;
  onRemoveScheduledItem: (item: ScheduledItem) => void;
  planBlockSyncStatusById: Record<string, PlanBlockGoogleSyncStatus>;
  projects: Project[];
  scheduledItemConflictsById: Map<string, ScheduledItemConflict[]>;
  status: CalendarStatus;
}) {
  if (!day) {
    return null;
  }

  const visibleDay = getVisibleDayData(day, filters);
  const selectedWeekPlanHref = `/plan?week=${encodeURIComponent(
    getWeekStartInputValueForDate(day.date),
  )}`;

  return (
    <Card className="h-fit rounded-[30px] border-white/70 bg-white/90 shadow-[0_18px_45px_rgba(18,32,47,0.06)] lg:sticky lg:top-6">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/42">
              Selected day
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
              {day.day}, {day.dateLabel}
            </h3>
          </div>
          <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
            {formatHours(visibleDay.scheduledHours)}
          </Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className="inline-flex h-9 items-center justify-center rounded-full bg-brand-ink px-3 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:bg-brand-teal"
            href={selectedWeekPlanHref}
          >
            Review this week in Weekly Plan
          </Link>
          <Link
            className="inline-flex h-9 items-center justify-center rounded-full border border-brand-ink/10 bg-white/78 px-3 text-xs font-semibold text-brand-ink transition hover:-translate-y-0.5 hover:bg-white"
            href={selectedWeekPlanHref}
          >
            Add time block
          </Link>
          <button
            className="inline-flex h-9 items-center justify-center rounded-full border border-brand-teal/15 bg-brand-teal/8 px-3 text-xs font-semibold text-brand-teal transition hover:-translate-y-0.5 hover:bg-brand-teal/12"
            type="button"
            onClick={() => onCreateScheduledItem(day.isoDate)}
          >
            Add task or appointment
          </button>
        </div>

        <div className="mt-4">
          {status === "loading" ? (
            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm text-brand-ink/52">
              Loading your calendar...
            </div>
          ) : null}

          {status !== "loading" && !visibleDay.hasEvents ? (
            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4">
              <p className="text-sm font-semibold text-brand-ink/70">
                Nothing scheduled here yet.
              </p>
              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                No work shifts, time blocks, tasks, or external events.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="inline-flex h-9 items-center justify-center rounded-full bg-brand-ink px-3 text-xs font-semibold text-white"
                  href={selectedWeekPlanHref}
                >
                  Add time block
                </Link>
                <Link
                  className="inline-flex h-9 items-center justify-center rounded-full border border-brand-ink/10 bg-white/78 px-3 text-xs font-semibold text-brand-ink"
                  href="/work"
                >
                  Add work shift
                </Link>
                <button
                  className="inline-flex h-9 items-center justify-center rounded-full border border-brand-teal/15 bg-brand-teal/8 px-3 text-xs font-semibold text-brand-teal"
                  type="button"
                  onClick={() => onCreateScheduledItem(day.isoDate)}
                >
                  Add task
                </button>
              </div>
            </div>
          ) : null}

          {status !== "loading" && visibleDay.hasEvents ? (
            <DayEventGroups
              conflictByBlockId={conflictByBlockId}
              day={visibleDay}
              importedConflictByBlockId={importedConflictByBlockId}
              onEditScheduledItem={onEditScheduledItem}
              onRemoveScheduledItem={onRemoveScheduledItem}
              planBlockSyncStatusById={planBlockSyncStatusById}
              projects={projects}
              scheduledItemConflictsById={scheduledItemConflictsById}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarMonthView({
  conflictByBlockId,
  filters,
  importedConflictByBlockId,
  monthCalendar,
  onCreateScheduledItem,
  onEditScheduledItem,
  onRemoveScheduledItem,
  planBlockSyncStatusById,
  projects,
  scheduledItemConflictsById,
  selectedMonthDay,
  selectedMonthIso,
  setSelectedMonthIso,
  status,
}: {
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>;
  filters: CalendarFilters;
  importedConflictByBlockId: Map<string, WeeklyPlanImportedEventConflict>;
  monthCalendar: ReturnType<typeof buildCalendarMonth>;
  onCreateScheduledItem: (itemDate: string) => void;
  onEditScheduledItem: (item: ScheduledItem) => void;
  onRemoveScheduledItem: (item: ScheduledItem) => void;
  planBlockSyncStatusById: Record<string, PlanBlockGoogleSyncStatus>;
  projects: Project[];
  scheduledItemConflictsById: Map<string, ScheduledItemConflict[]>;
  selectedMonthDay: CalendarMonthDaySchedule | null;
  selectedMonthIso: string | null;
  setSelectedMonthIso: (isoDate: string) => void;
  status: CalendarStatus;
}) {
  const hasVisibleMonthItems = monthCalendar.days.some((day) => {
    if (!day.isCurrentMonth) {
      return false;
    }

    return getMonthEventSummary(
      day,
      filters,
      conflictByBlockId,
      importedConflictByBlockId,
    ).totalItems > 0;
  });

  return (
    <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="overflow-hidden rounded-[32px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)]">
        <CardContent className="p-3 sm:p-5 lg:p-6">
          <div className="mb-4 flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                {monthCalendar.monthLabel}
              </h2>
              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                Compact overview. Select a day to see full event details.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {calendarWeekDays.map((day) => (
              <div
                key={day}
                className="px-1 pb-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-ink/38 sm:text-xs"
              >
                {day.slice(0, 3)}
              </div>
            ))}

            {monthCalendar.days.map((day) => {
              const { indicators } = getMonthEventSummary(
                day,
                filters,
                conflictByBlockId,
                importedConflictByBlockId,
              );
              const isSelected =
                day.isCurrentMonth &&
                (selectedMonthIso === day.isoDate ||
                  (!selectedMonthIso &&
                    selectedMonthDay?.isoDate === day.isoDate));

              return (
                <button
                  key={day.isoDate}
                  aria-label={`${day.day}, ${day.dateLabel}`}
                  className={`min-h-[76px] rounded-[18px] border p-2 text-left transition sm:min-h-[122px] sm:rounded-[24px] sm:p-3 lg:min-h-[132px] ${
                    day.isCurrentMonth
                      ? "border-brand-ink/8 bg-white/82 hover:-translate-y-0.5 hover:border-brand-teal/20 hover:bg-brand-teal/[0.035]"
                      : "border-transparent bg-brand-ink/[0.025] text-brand-ink/24"
                  } ${
                    isSelected
                      ? "border-brand-teal/35 bg-brand-teal/[0.075] shadow-[0_12px_28px_rgba(20,121,110,0.1)]"
                      : ""
                  }`}
                  disabled={!day.isCurrentMonth}
                  type="button"
                  onClick={() => setSelectedMonthIso(day.isoDate)}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                        day.isToday
                          ? "bg-brand-ink text-white"
                          : isSelected
                            ? "bg-brand-teal text-white"
                          : day.isCurrentMonth
                            ? "text-brand-ink/72"
                            : "text-brand-ink/28"
                      }`}
                    >
                      {day.dayNumber}
                    </span>
                  </div>

                  <div className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
                    {indicators.slice(0, 3).map((indicator) => (
                      <MonthIndicatorBadge
                        key={indicator.id}
                        count={indicator.count}
                        label={indicator.label}
                        tone={indicator.tone}
                      />
                    ))}
                    {indicators.length > 3 ? (
                      <span className="inline-flex items-center rounded-full border border-brand-ink/10 bg-brand-ink/[0.02] px-2 py-1 text-[11px] font-semibold text-brand-ink/42">
                        +{indicators.length - 3} more
                      </span>
                    ) : null}
                  </div>

                  {day.isCurrentMonth && indicators.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1 sm:hidden">
                      {indicators.slice(0, 3).map((indicator) => (
                        <MonthEventDot
                          key={indicator.id}
                          tone={indicator.tone}
                        />
                      ))}
                      {indicators.length > 3 ? (
                        <span className="text-[10px] font-semibold text-brand-ink/42">
                          +
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {status !== "loading" && !hasVisibleMonthItems ? (
            <div className="mt-4 rounded-[24px] border border-dashed border-brand-ink/12 bg-white/62 p-4 text-sm leading-6 text-brand-ink/55">
              No calendar items match these filters for this month.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <MonthDayDetail
        conflictByBlockId={conflictByBlockId}
        day={selectedMonthDay}
        filters={filters}
        importedConflictByBlockId={importedConflictByBlockId}
        onCreateScheduledItem={onCreateScheduledItem}
        onEditScheduledItem={onEditScheduledItem}
        onRemoveScheduledItem={onRemoveScheduledItem}
        planBlockSyncStatusById={planBlockSyncStatusById}
        projects={projects}
        scheduledItemConflictsById={scheduledItemConflictsById}
        status={status}
      />
    </section>
  );
}

export function CalendarPage() {
  const [status, setStatus] = useState<CalendarStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [planBlocks, setPlanBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>([]);
  const [scheduleExceptions, setScheduleExceptions] = useState<
    ScheduleException[]
  >([]);
  const [workShifts, setWorkShifts] = useState<WorkShift[]>([]);
  const [importedEvents, setImportedEvents] = useState<ImportedCalendarEvent[]>([]);
  const [filters, setFilters] = useState<CalendarFilters>(defaultFilters);
  const [view, setView] = useState<CalendarView>("week");
  const [weekStartDate, setWeekStartDate] = useState(() =>
    getCurrentWeekStart(),
  );
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedMonthIso, setSelectedMonthIso] = useState<string | null>(null);
  const [planBlockSyncStatusById, setPlanBlockSyncStatusById] = useState<
    Record<string, PlanBlockGoogleSyncStatus>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [scheduledItemMessage, setScheduledItemMessage] = useState<string | null>(
    null,
  );
  const [scheduledItemForm, setScheduledItemForm] =
    useState<ScheduledItemFormState | null>(null);
  const [scheduledItemFormLoading, setScheduledItemFormLoading] = useState(false);
  const [scheduledItemToRemove, setScheduledItemToRemove] =
    useState<ScheduledItem | null>(null);
  const [scheduledItemRemoveLoading, setScheduledItemRemoveLoading] =
    useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDateValue = params.get("date");
    const requestedView = params.get("view");

    if (requestedView === "week" || requestedView === "month") {
      setView(requestedView);
    }

    if (!requestedDateValue) {
      return;
    }

    const requestedDate = new Date(`${requestedDateValue}T00:00:00`);

    if (Number.isNaN(requestedDate.getTime())) {
      return;
    }

    setWeekStartDate(
      new Date(`${getWeekStartInputValueForDate(requestedDate)}T00:00:00`),
    );
    setMonthDate(requestedDate);
    setSelectedMonthIso(requestedDateValue);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus("signed_out");
      setError("Supabase is not configured yet.");
      return;
    }

    let isActive = true;

    async function loadCalendarData() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (!isActive) {
          return;
        }

        if (sessionError) {
          setStatus("error");
          setError(sessionError.message);
          return;
        }

        const userId = data.session?.user.id ?? null;

        if (!userId) {
          setStatus("signed_out");
          setError(null);
          return;
        }

        const [
          projectsResult,
          planResult,
          scheduledItemsResult,
          scheduleExceptionsResult,
          workResult,
          importedEventsResult,
        ] = await Promise.all([
            fetchProjectsForUser(supabase, userId),
            fetchWeeklyPlanBlocksForUser(supabase, userId),
            fetchScheduledItemsForUser(supabase, userId),
            fetchScheduleExceptionsForUser(supabase, userId),
            fetchWorkShiftsForUser(supabase, userId),
            fetchImportedCalendarEventsForUser(supabase, userId),
          ]);

        if (!isActive) {
          return;
        }

        setProjects(projectsResult.data);
        setPlanBlocks(planResult.data);
        setScheduledItems(scheduledItemsResult.data);
        setScheduleExceptions(scheduleExceptionsResult.data);
        setWorkShifts(workResult.data);
        setImportedEvents(importedEventsResult.data);
        setStatus("ready");

        const errors = [
          projectsResult.error,
          planResult.error,
          scheduledItemsResult.error,
          scheduleExceptionsResult.error,
          workResult.error,
          importedEventsResult.error,
        ].filter(Boolean);

        setError(errors.length > 0 ? getMissingTableMessage(errors[0]) : null);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setStatus("error");
        setError(getMissingTableMessage(loadError));
      }
    }

    void loadCalendarData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured() || status === "signed_out") {
      setPlanBlockSyncStatusById({});
      return;
    }

    let isActive = true;

    async function loadPlanBlockSyncStatuses() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (!isActive) {
          return;
        }

        if (sessionError || !data.session?.access_token) {
          setPlanBlockSyncStatusById({});
          return;
        }

        const weekStartValue = formatDateInputValue(weekStartDate);
        const response = await fetch(
          `/api/google-calendar/sync-status?week_start_date=${encodeURIComponent(
            weekStartValue,
          )}`,
          {
            headers: {
              Authorization: `Bearer ${data.session.access_token}`,
            },
          },
        );
        const payload =
          (await response.json()) as GoogleCalendarSyncStatusResponse;

        if (!isActive) {
          return;
        }

        if (!response.ok || payload.error) {
          setPlanBlockSyncStatusById({});
          return;
        }

        setPlanBlockSyncStatusById(
          (payload.statuses ?? []).reduce<
            Record<string, PlanBlockGoogleSyncStatus>
          >((acc, item) => {
            acc[item.weeklyPlanBlockId] = item.syncStatus;
            return acc;
          }, {}),
        );
      } catch {
        if (isActive) {
          setPlanBlockSyncStatusById({});
        }
      }
    }

    void loadPlanBlockSyncStatuses();

    return () => {
      isActive = false;
    };
  }, [status, weekStartDate]);

  const calendar = useMemo(
    () =>
      buildCalendarDays({
        importedEvents,
        planBlocks,
        projects,
        scheduledItems,
        scheduleExceptions,
        weekStart: weekStartDate,
        workShifts,
      }),
    [
      importedEvents,
      planBlocks,
      projects,
      scheduledItems,
      scheduleExceptions,
      weekStartDate,
      workShifts,
    ],
  );

  const monthCalendar = useMemo(
    () =>
      buildCalendarMonth({
        importedEvents,
        monthDate,
        planBlocks,
        projects,
        scheduledItems,
        scheduleExceptions,
        workShifts,
      }),
    [
      importedEvents,
      monthDate,
      planBlocks,
      projects,
      scheduledItems,
      scheduleExceptions,
      workShifts,
    ],
  );

  const effectiveWeekShifts = useMemo(
    () => calendar.days.flatMap((day) => day.workShifts),
    [calendar.days],
  );

  const planWorkConflicts = useMemo(
    () => findWeeklyPlanWorkConflicts(planBlocks, effectiveWeekShifts),
    [effectiveWeekShifts, planBlocks],
  );
  const planImportedEventConflicts = useMemo(
    () =>
      findWeeklyPlanImportedEventConflicts(
        planBlocks,
        importedEvents,
        weekStartDate,
      ),
    [importedEvents, planBlocks, weekStartDate],
  );

  const conflictByBlockId = useMemo(
    () =>
      new Map(
        planWorkConflicts.map((conflict) => [conflict.block.id, conflict]),
      ),
    [planWorkConflicts],
  );
  const importedConflictByBlockId = useMemo(
    () =>
      new Map(
        planImportedEventConflicts.map((conflict) => [
          conflict.block.id,
          conflict,
        ]),
      ),
    [planImportedEventConflicts],
  );
  const scheduledItemConflictsById = useMemo(() => {
    const entries = scheduledItems.map((item) => [
      item.id,
      findScheduledItemConflicts({
        importedEvents,
        item,
        planBlocks,
        scheduledItems,
        weekStart: weekStartDate,
        workShifts: effectiveWeekShifts,
      }),
    ] as const);

    return new Map(entries.filter(([, conflicts]) => conflicts.length > 0));
  }, [
    effectiveWeekShifts,
    importedEvents,
    planBlocks,
    scheduledItems,
    weekStartDate,
  ]);

  const weekSummary = useMemo(() => {
    const workHours = workShifts.reduce(
      (sum, shift) => sum + getWorkShiftDurationHours(shift),
      0,
    );
    const plannedProjectHours = planBlocks.reduce(
      (sum, block) => sum + block.estimatedHours,
      0,
    );
    const daysWithCommitments = calendar.days.filter((day) => {
      return (
        day.workShifts.length > 0 ||
        day.planBlocks.length > 0 ||
        day.scheduledItems.length > 0 ||
        day.deadlines.length > 0 ||
        day.importedEvents.length > 0
      );
    }).length;
    const importedEventCount = calendar.days.reduce(
      (sum, day) =>
        sum +
        day.importedEvents.filter(
          (event) => !isScheduleBuilderExportedEvent(event),
        ).length,
      0,
    );
    const deadlineCount = calendar.days.reduce(
      (sum, day) => sum + day.deadlines.length,
      0,
    );
    const scheduledItemCount = calendar.days.reduce(
      (sum, day) => sum + day.scheduledItems.length,
      0,
    );

    return {
      deadlineCount,
      daysWithCommitments,
      importedEventCount,
      openDays: Math.max(0, 7 - daysWithCommitments),
      plannedProjectHours,
      scheduledItemCount,
      workHours,
    };
  }, [calendar.days, planBlocks, workShifts]);

  const monthSummary = useMemo(() => {
    const currentMonthDays = monthCalendar.days.filter(
      (day) => day.isCurrentMonth,
    );
    const visibleDays = currentMonthDays.map((day) =>
      getVisibleDayData(day, filters),
    );
    const workShiftDays = visibleDays.filter(
      (day) => day.workShifts.length > 0,
    ).length;
    const plannedBlocks = visibleDays.reduce(
      (sum, day) => sum + day.planBlocks.length,
      0,
    );
    const deadlines = visibleDays.reduce(
      (sum, day) => sum + day.deadlines.length,
      0,
    );
    const scheduledItemCount = visibleDays.reduce(
      (sum, day) => sum + day.scheduledItems.length,
      0,
    );
    const importedEventCount = visibleDays.reduce(
      (sum, day) =>
        sum +
        day.importedEvents.filter(
          (event) => !isScheduleBuilderExportedEvent(event),
        ).length,
      0,
    );
    const openDays = visibleDays.filter((day) => !day.hasEvents).length;
    const hasFilteredEvents = visibleDays.some((day) => day.hasEvents);

    return {
      deadlines,
      hasFilteredEvents,
      importedEventCount,
      openDays,
      plannedBlocks,
      scheduledItemCount,
      workShiftDays,
    };
  }, [filters, monthCalendar.days]);

  const summaryCards =
    view === "week"
      ? [
          {
            label: "Work commitments",
            value: formatHours(weekSummary.workHours),
          },
          {
            label: "Time blocks",
            value: formatEstimatedHours(weekSummary.plannedProjectHours),
          },
          {
            label: "Tasks/appts",
            value: weekSummary.scheduledItemCount,
          },
          {
            label: "External events",
            value: weekSummary.importedEventCount,
          },
          {
            label: "Open days",
            value: weekSummary.openDays,
          },
          {
            label: "Deadlines",
            value: weekSummary.deadlineCount,
          },
        ]
      : [
          {
            label: "Work days",
            value: monthSummary.workShiftDays,
          },
          {
            label: "Time blocks",
            value: monthSummary.plannedBlocks,
          },
          {
            label: "Tasks/appts",
            value: monthSummary.scheduledItemCount,
          },
          {
            label: "Deadlines",
            value: monthSummary.deadlines,
          },
          {
            label: "External",
            value: monthSummary.importedEventCount,
          },
          {
            label: "Open days",
            value: monthSummary.openDays,
          },
        ];

  const selectedMonthDay =
    monthCalendar.days.find(
      (day) => day.isCurrentMonth && day.isoDate === selectedMonthIso,
    ) ??
    monthCalendar.days.find((day) => day.isCurrentMonth && day.isToday) ??
    monthCalendar.days.find((day) => day.isCurrentMonth) ??
    null;
  const googleCalendarEventCount = importedEvents.filter(
    (event) => event.source === "google_calendar",
  ).length;
  const schoolCalendarEventCount = importedEvents.filter(
    isSchoolCalendarEvent,
  ).length;
  const icsEventCount = importedEvents.filter(
    (event) => event.source === "ics" && !isScheduleBuilderExportedEvent(event),
  ).length;
  const scheduleBuilderExportCount = importedEvents.filter(
    isScheduleBuilderExportedEvent,
  ).length;
  const externalStatusLabel =
    googleCalendarEventCount > 0
      ? "Google Calendar connected"
      : schoolCalendarEventCount > 0
        ? "School calendar events included"
        : icsEventCount > 0
        ? "ICS events included"
        : scheduleBuilderExportCount > 0
          ? "Schedule Builder exports included"
        : "External events can be added";
  const deadlinesNeedingExactDates = (
    view === "week"
      ? calendar.upcomingDeadlines
      : monthCalendar.upcomingDeadlines
  ).filter((deadline) => !deadline.isoDate);

  function toggleFilter(key: keyof CalendarFilters) {
    setFilters((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function changeMonth(amount: number) {
    setMonthDate((current) => addMonthsToDate(current, amount));
    setSelectedMonthIso(null);
  }

  function changeWeek(amount: number) {
    setWeekStartDate((current) => addDaysToDate(current, amount * 7));
  }

  function returnToCurrentMonth() {
    setMonthDate(new Date());
    setSelectedMonthIso(null);
  }

  function returnToCurrentWeek() {
    setWeekStartDate(getCurrentWeekStart());
  }

  function openCreateScheduledItem(itemDate: string) {
    setScheduledItemMessage(null);
    setScheduledItemForm({
      initialDraft: createDefaultScheduledItemDraft(itemDate),
      mode: "create",
    });
  }

  function openEditScheduledItem(item: ScheduledItem) {
    setScheduledItemMessage(null);
    setScheduledItemForm({
      initialDraft: {
        itemType: item.itemType,
        title: item.title,
        description: item.description,
        itemDate: item.itemDate,
        startTime: item.startTime ?? "",
        estimatedHours: String(item.estimatedHours),
        location: item.location,
      },
      item,
      mode: "edit",
    });
  }

  function getScheduledItemDraftConflicts(draft: ScheduledItemDraft) {
    if (validateScheduledItemDraft(draft)) {
      return [];
    }

    const payload = createScheduledItemPayload(draft);
    const previewItem: ScheduledItem = {
      id: scheduledItemForm?.item?.id ?? "scheduled-item-preview",
      ...payload,
    };

    return findScheduledItemConflicts({
      importedEvents,
      item: previewItem,
      planBlocks,
      scheduledItems,
      weekStart: weekStartDate,
      workShifts,
    });
  }

  async function getSignedInUserForScheduledItems() {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      return {
        error: sessionError.message,
        supabase,
        userId: null,
      };
    }

    return {
      error: data.session?.user.id ? null : "Sign in to manage scheduled items.",
      supabase,
      userId: data.session?.user.id ?? null,
    };
  }

  async function submitScheduledItem(draft: ScheduledItemDraft) {
    const validationMessage = validateScheduledItemDraft(draft);

    if (validationMessage || !scheduledItemForm) {
      setScheduledItemMessage(validationMessage ?? "Try opening the form again.");
      return;
    }

    setScheduledItemFormLoading(true);
    setScheduledItemMessage(null);

    try {
      const { error: sessionError, supabase, userId } =
        await getSignedInUserForScheduledItems();

      if (!userId) {
        setScheduledItemMessage(sessionError);
        return;
      }

      if (scheduledItemForm.mode === "edit" && scheduledItemForm.item) {
        const result = await updateScheduledItemForUser(
          supabase,
          userId,
          scheduledItemForm.item.id,
          draft,
        );

        if (result.error || !result.data) {
          setScheduledItemMessage(
            result.error?.message ?? "This item could not be updated.",
          );
          return;
        }

        setScheduledItems((current) =>
          sortScheduledItems(
            current.map((item) =>
              item.id === result.data?.id ? result.data : item,
            ),
          ),
        );
        setScheduledItemForm(null);
        setScheduledItemMessage("Scheduled item updated.");
        return;
      }

      const result = await createScheduledItemForUser(supabase, userId, draft);

      if (result.error || !result.data) {
        setScheduledItemMessage(
          result.error?.message ?? "This item could not be added.",
        );
        return;
      }

      setScheduledItems((current) => sortScheduledItems([...current, result.data!]));
      setScheduledItemForm(null);
      setScheduledItemMessage(
        result.data.itemType === "appointment"
          ? "Appointment added."
          : "Task added.",
      );
    } finally {
      setScheduledItemFormLoading(false);
    }
  }

  async function confirmRemoveScheduledItem() {
    if (!scheduledItemToRemove) {
      return;
    }

    setScheduledItemRemoveLoading(true);
    setScheduledItemMessage(null);

    try {
      const { error: sessionError, supabase, userId } =
        await getSignedInUserForScheduledItems();

      if (!userId) {
        setScheduledItemMessage(sessionError);
        return;
      }

      const result = await deleteScheduledItemForUser(
        supabase,
        userId,
        scheduledItemToRemove.id,
      );

      if (result.error) {
        setScheduledItemMessage(
          getErrorMessage(result.error),
        );
        return;
      }

      setScheduledItems((current) =>
        current.filter((item) => item.id !== scheduledItemToRemove.id),
      );
      setScheduledItemMessage("Scheduled item removed.");
      setScheduledItemToRemove(null);
    } finally {
      setScheduledItemRemoveLoading(false);
    }
  }

  return (
    <SchedulerAppShell contentClassName="flex flex-col gap-5 sm:gap-6">
        <ScheduledItemFormDialog
          getConflicts={getScheduledItemDraftConflicts}
          initialDraft={
            scheduledItemForm?.initialDraft ??
            createDefaultScheduledItemDraft(formatDateInputValue(new Date()))
          }
          loading={scheduledItemFormLoading}
          mode={scheduledItemForm?.mode ?? "create"}
          open={Boolean(scheduledItemForm)}
          onCancel={() => {
            if (!scheduledItemFormLoading) {
              setScheduledItemForm(null);
            }
          }}
          onSubmit={submitScheduledItem}
        />
        <ConfirmDialog
          confirmLabel="Remove item"
          description="This removes the task or appointment from Schedule Builder. It will not change Google Calendar or imported calendar events."
          destructive
          loading={scheduledItemRemoveLoading}
          open={Boolean(scheduledItemToRemove)}
          title="Remove scheduled item?"
          onCancel={() => {
            if (!scheduledItemRemoveLoading) {
              setScheduledItemToRemove(null);
            }
          }}
          onConfirm={confirmRemoveScheduledItem}
        />
        <section className="page-header !block overflow-hidden bg-dashboard-radial">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_420px] xl:items-end">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-teal/12 bg-brand-teal/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
                <CalendarIcon className="h-4 w-4" />
                Central schedule hub
              </div>
              <h1 className="page-title mt-3">
                Calendar
              </h1>
              <p className="page-contract">
                Confirm your week.
              </p>
              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                See work shifts, time blocks, external events, and deadlines
                in one schedule.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                  {externalStatusLabel}
                </Badge>
                {googleCalendarEventCount > 0 ? (
                  <Badge className="bg-brand-ink/[0.045] text-brand-ink/56" variant="subtle">
                    Google Calendar events are read-only
                  </Badge>
                ) : null}
                {planWorkConflicts.length + planImportedEventConflicts.length > 0 ? (
                  <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                    {planWorkConflicts.length + planImportedEventConflicts.length} conflict
                    {planWorkConflicts.length + planImportedEventConflicts.length === 1
                      ? ""
                      : "s"}
                  </Badge>
                ) : null}
              </div>
            </div>

            <Card className="rounded-[30px] border-white/70 bg-white/90 shadow-[0_18px_45px_rgba(18,32,47,0.065)]">
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-stretch">
                  <div
                    aria-label="Calendar view"
                    className="inline-flex w-fit rounded-full border border-brand-ink/8 bg-white/78 p-1 shadow-[0_12px_28px_rgba(18,32,47,0.06)]"
                    role="group"
                  >
                    {(["week", "month"] as const).map((nextView) => (
                      <button
                        key={nextView}
                        aria-label={`Show ${nextView} view`}
                        aria-pressed={view === nextView}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          view === nextView
                            ? "bg-brand-ink text-white shadow-[0_10px_24px_rgba(18,32,47,0.16)]"
                            : "text-brand-ink/58 hover:bg-brand-ink/5 hover:text-brand-ink"
                        }`}
                        type="button"
                        onClick={() => setView(nextView)}
                      >
                        {nextView === "week" ? "Week" : "Month"}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-full border border-brand-ink/10 bg-white/76 px-3 py-2 text-sm font-semibold text-brand-ink/62 transition hover:bg-white hover:text-brand-ink"
                      type="button"
                      onClick={() =>
                        view === "week" ? changeWeek(-1) : changeMonth(-1)
                      }
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-full border border-brand-teal/15 bg-brand-teal/8 px-3 py-2 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/12"
                      type="button"
                      onClick={
                        view === "week"
                          ? returnToCurrentWeek
                          : returnToCurrentMonth
                      }
                    >
                      {view === "week" ? "Today" : "This month"}
                    </button>
                    <button
                      className="rounded-full border border-brand-ink/10 bg-white/76 px-3 py-2 text-sm font-semibold text-brand-ink/62 transition hover:bg-white hover:text-brand-ink"
                      type="button"
                      onClick={() =>
                        view === "week" ? changeWeek(1) : changeMonth(1)
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>

                <p className="rounded-[22px] border border-brand-ink/8 bg-white/70 px-4 py-3 text-sm font-semibold text-brand-ink/62">
                  {view === "week"
                    ? calendar.weekRangeLabel
                    : monthCalendar.monthLabel}
                </p>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                  {summaryCards.map((card) => (
                    <div
                      key={card.label}
                      className="rounded-[20px] border border-brand-ink/[0.06] bg-white/72 p-3"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-ink/40">
                        {card.label}
                      </p>
                      <p className="mt-2 text-xl font-semibold tracking-[-0.04em] text-brand-ink">
                        {card.value}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {status === "signed_out" ? (
          <Card className="rounded-[30px] border-white/70 bg-white/88">
            <CardContent className="p-5 sm:p-6">
              <p className="text-lg font-semibold text-brand-ink">
                Sign in to view your calendar.
              </p>
              <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                Calendar combines your synced projects, weekly plan, and work
                shifts.
              </p>
              <Link
                className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white"
                href="/"
              >
                Go to sign in
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {status !== "signed_out" ? (
          <>
            <section className="grid gap-3 rounded-[28px] border border-white/70 bg-white/68 p-3 shadow-[0_12px_32px_rgba(18,32,47,0.045)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center sm:p-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/38">
                  Show on calendar
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {filterItems.map((item) => (
                    <button
                      key={item.key}
                      aria-pressed={filters[item.key]}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                        filters[item.key]
                          ? "border-brand-teal/20 bg-brand-teal/10 text-brand-teal shadow-[0_8px_18px_rgba(20,121,110,0.06)]"
                          : "border-brand-ink/10 bg-white/70 text-brand-ink/48 hover:bg-white hover:text-brand-ink/68"
                      }`}
                      type="button"
                      onClick={() => toggleFilter(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/38 lg:text-right">
                  Quick actions
                </p>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-ink px-4 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(18,32,47,0.12)] transition hover:-translate-y-0.5 hover:bg-brand-teal sm:text-sm"
                    href="/plan"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add time block
                  </Link>
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-ink/10 bg-white/80 px-4 text-xs font-semibold text-brand-ink transition hover:-translate-y-0.5 hover:bg-white sm:text-sm"
                    href="/work"
                  >
                    <ClockIcon className="h-3.5 w-3.5" />
                    Add work shift
                  </Link>
                  <a
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-ink/10 bg-white/80 px-4 text-xs font-semibold text-brand-ink transition hover:-translate-y-0.5 hover:bg-white sm:text-sm"
                    href="#import-ics"
                  >
                    Import ICS
                  </a>
                  <Link
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-ink/10 bg-white/80 px-4 text-xs font-semibold text-brand-ink transition hover:-translate-y-0.5 hover:bg-white sm:text-sm"
                    href="/projects"
                  >
                    <FolderStackIcon className="h-3.5 w-3.5" />
                    Projects
                  </Link>
                </div>
              </div>
            </section>

            <section id="import-ics" className="scroll-mt-6">
              <IcsImportPanel
                compact
                onImported={(events) =>
                  setImportedEvents((current) =>
                    [...current, ...events].sort(
                      (first, second) =>
                        new Date(first.startsAt).getTime() -
                        new Date(second.startsAt).getTime(),
                    ),
                  )
                }
              />
            </section>

            {error ? (
              <p className="rounded-[22px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
                {error}
              </p>
            ) : null}

            {scheduledItemMessage ? (
              <p
                className={`rounded-[22px] border px-4 py-3 text-sm font-medium leading-6 ${
                  scheduledItemMessage.toLowerCase().includes("could not") ||
                  scheduledItemMessage.toLowerCase().includes("sign in") ||
                  scheduledItemMessage.toLowerCase().includes("required")
                    ? "border-brand-coral/18 bg-brand-coral/[0.08] text-brand-coral"
                    : "border-brand-teal/16 bg-brand-teal/[0.08] text-brand-teal"
                }`}
              >
                {scheduledItemMessage}
              </p>
            ) : null}

            {view === "week" ? (
              <section className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
                {calendar.days.map((day) => {
                  const visibleDay = getVisibleDayData(day, filters);
                  const conflictCount = visibleDay.planBlocks.filter(
                    (block) =>
                      conflictByBlockId.has(block.id) ||
                      importedConflictByBlockId.has(block.id),
                  ).length;

                  return (
                    <Card
                      key={day.day}
                      className="h-full overflow-hidden rounded-[30px] border-white/70 bg-white/90 shadow-[0_18px_45px_rgba(18,32,47,0.065)] sm:rounded-[34px]"
                    >
                      <CardContent className="flex h-full flex-col p-4 sm:p-5 lg:p-6">
                        <div className="mb-4 flex flex-col gap-3 border-b border-brand-ink/8 pb-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                                {day.day}
                              </h2>
                              {conflictCount > 0 ? (
                                <Badge
                                  className="bg-brand-coral/10 text-brand-coral"
                                  variant="subtle"
                                >
                                  {conflictCount} conflict
                                  {conflictCount === 1 ? "" : "s"}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm font-medium text-brand-ink/50">
                              {day.dateLabel}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <Badge
                              className="bg-brand-teal/8 text-brand-teal"
                              variant="subtle"
                            >
                              {formatHours(visibleDay.scheduledHours)}
                            </Badge>
                            <button
                              className="inline-flex h-8 items-center justify-center rounded-full border border-brand-teal/15 bg-brand-teal/8 px-3 text-xs font-semibold text-brand-teal transition hover:bg-brand-teal/12"
                              type="button"
                              onClick={() => openCreateScheduledItem(day.isoDate)}
                            >
                              Add task
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-1 flex-col gap-3">
                          {status === "loading" ? (
                            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm text-brand-ink/52">
                              Loading your calendar...
                            </div>
                          ) : null}

                          {status !== "loading" && !visibleDay.hasEvents ? (
                            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4">
                              <p className="text-sm font-semibold text-brand-ink/70">
                                Open day
                              </p>
                              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                                No work shifts, time blocks, tasks, or external events.
                              </p>
                            </div>
                          ) : null}

                          {status !== "loading" && visibleDay.hasEvents ? (
                            <DayEventGroups
                              conflictByBlockId={conflictByBlockId}
                              day={visibleDay}
                              importedConflictByBlockId={importedConflictByBlockId}
                              onEditScheduledItem={openEditScheduledItem}
                              onRemoveScheduledItem={setScheduledItemToRemove}
                              planBlockSyncStatusById={planBlockSyncStatusById}
                              projects={projects}
                              scheduledItemConflictsById={scheduledItemConflictsById}
                            />
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            ) : (
              <CalendarMonthView
                conflictByBlockId={conflictByBlockId}
                filters={filters}
                importedConflictByBlockId={importedConflictByBlockId}
                monthCalendar={monthCalendar}
                onCreateScheduledItem={openCreateScheduledItem}
                onEditScheduledItem={openEditScheduledItem}
                onRemoveScheduledItem={setScheduledItemToRemove}
                planBlockSyncStatusById={planBlockSyncStatusById}
                projects={projects}
                scheduledItemConflictsById={scheduledItemConflictsById}
                selectedMonthDay={selectedMonthDay}
                selectedMonthIso={selectedMonthIso}
                setSelectedMonthIso={setSelectedMonthIso}
                status={status}
              />
            )}

            {filters.deadlines && deadlinesNeedingExactDates.length > 0 ? (
              <Card className="rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.05)]">
                <CardContent className="p-4 sm:p-6">
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                    Deadlines needing dates
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-brand-ink/58">
                    Add exact dates to place these on your calendar.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {deadlinesNeedingExactDates.map((deadline) => (
                      <div
                          key={`${deadline.projectId}-${deadline.deadlineText}`}
                        className="rounded-[22px] border border-brand-coral/12 bg-brand-coral/[0.045] p-4"
                      >
                        <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                          Needs exact date
                        </Badge>
                        <p className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
                          {deadline.projectName}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                          {deadline.deadlineText}
                        </p>
                        <Link
                          className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-brand-ink/10 bg-white/78 px-3 text-xs font-semibold text-brand-ink transition hover:bg-white"
                          href="/projects"
                        >
                          Edit project
                        </Link>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
    </SchedulerAppShell>
  );
}
