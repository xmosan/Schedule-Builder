"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IcsImportPanel } from "@/components/calendar/ics-import-panel";
import {
  CalendarIcon,
  ClockIcon,
  FolderStackIcon,
  PlusIcon,
} from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatImportedEventTimeRange,
  getImportedEventDurationHours,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import {
  buildCalendarDays,
  buildCalendarMonth,
  calendarWeekDays,
  getPlanBlockTimeLabel,
  type CalendarDaySchedule,
  type CalendarMonthDaySchedule,
} from "@/lib/calendar";
import type { Project } from "@/lib/projects";
import {
  findWeeklyPlanWorkConflicts,
  type WeeklyPlanWorkConflict,
} from "@/lib/schedule-conflicts";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  fetchProjectsForUser,
  fetchImportedCalendarEventsForUser,
  fetchWeeklyPlanBlocksForUser,
  fetchWorkShiftsForUser,
} from "@/lib/supabase/scheduler";
import { formatEstimatedHours, type WeeklyPlanBlock } from "@/lib/weekly-plan";
import {
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";
import { cn } from "@/lib/utils";

type CalendarStatus = "loading" | "ready" | "signed_out" | "error";
type CalendarView = "week" | "month";

type CalendarFilters = {
  deadlines: boolean;
  flexible: boolean;
  importedEvents: boolean;
  planBlocks: boolean;
  workShifts: boolean;
};

const defaultFilters: CalendarFilters = {
  deadlines: true,
  flexible: true,
  importedEvents: true,
  planBlocks: true,
  workShifts: true,
};

const filterItems: Array<{
  key: keyof CalendarFilters;
  label: string;
}> = [
  {
    key: "workShifts",
    label: "Work shifts",
  },
  {
    key: "planBlocks",
    label: "Plan blocks",
  },
  {
    key: "deadlines",
    label: "Deadlines",
  },
  {
    key: "importedEvents",
    label: "Imported events",
  },
  {
    key: "flexible",
    label: "Flexible blocks",
  },
];

type MonthIndicatorTone =
  | "conflict"
  | "deadline"
  | "flexible"
  | "imported"
  | "plan"
  | "work";

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

  return "Calendar data is unavailable right now.";
}

function getMissingTableMessage(error: unknown) {
  const message = getErrorMessage(error);

  if (
    message.includes("projects") ||
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

function getVisibleDayData(day: CalendarDaySchedule, filters: CalendarFilters) {
  const workShifts = filters.workShifts ? day.workShifts : [];
  const planBlocks = filters.planBlocks
    ? day.planBlocks.filter((block) => filters.flexible || block.startTime)
    : [];
  const deadlines = filters.deadlines ? day.deadlines : [];
  const importedEvents = filters.importedEvents ? day.importedEvents : [];
  const scheduledHours =
    workShifts.reduce(
      (sum, shift) => sum + getWorkShiftDurationHours(shift),
      0,
    ) +
    planBlocks.reduce((sum, block) => sum + block.estimatedHours, 0) +
    importedEvents.reduce(
      (sum, event) => sum + getImportedEventDurationHours(event),
      0,
    );

  return {
    deadlines,
    hasEvents:
      workShifts.length > 0 ||
      planBlocks.length > 0 ||
      deadlines.length > 0 ||
      importedEvents.length > 0,
    importedEvents,
    planBlocks,
    scheduledHours,
    workShifts,
  };
}

function getMonthEventSummary(
  day: CalendarMonthDaySchedule,
  filters: CalendarFilters,
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>,
) {
  const visibleDay = getVisibleDayData(day, filters);
  const timedPlanBlocks = visibleDay.planBlocks.filter(
    (block) => block.startTime,
  );
  const flexiblePlanBlocks = visibleDay.planBlocks.filter(
    (block) => !block.startTime,
  );
  const indicators: Array<{
    count: number;
    id: string;
    label: string;
    tone: MonthIndicatorTone;
  }> = [];
  const conflictingBlocks = visibleDay.planBlocks.filter((block) =>
    conflictByBlockId.has(block.id),
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

  if (visibleDay.deadlines.length > 0) {
    indicators.push({
      count: visibleDay.deadlines.length,
      id: "deadline",
      label: "Deadline",
      tone: "deadline",
    });
  }

  if (visibleDay.importedEvents.length > 0) {
    indicators.push({
      count: visibleDay.importedEvents.length,
      id: "imported",
      label: "Imported",
      tone: "imported",
    });
  }

  return {
    indicators,
    totalItems:
      visibleDay.workShifts.length +
      visibleDay.planBlocks.length +
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

  if (tone === "imported") {
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

function WorkShiftEvent({ shift }: { shift: WorkShift }) {
  return (
    <div className="rounded-[22px] border border-brand-ocean/12 bg-brand-ocean/[0.055] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-brand-ocean/10 text-brand-ocean" variant="subtle">
          Work shift
        </Badge>
        <span className="text-xs font-semibold text-brand-ink/45">
          Unavailable
        </span>
      </div>
      <p className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
        {formatWorkShiftRange(shift)} •{" "}
        {formatHours(getWorkShiftDurationHours(shift))}
      </p>
      {shift.location ? (
        <p className="mt-2 text-sm font-medium leading-6 text-brand-ink/65">
          {shift.location}
        </p>
      ) : null}
    </div>
  );
}

function PlanBlockEvent({
  block,
  conflict,
}: {
  block: WeeklyPlanBlock;
  conflict?: WeeklyPlanWorkConflict | null;
}) {
  return (
    <div
      className={cn(
        "rounded-[22px] border p-4",
        conflict
          ? "border-brand-coral/20 bg-brand-coral/[0.055]"
          : "border-brand-teal/12 bg-brand-teal/[0.055]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
          Plan block
        </Badge>
        {conflict ? (
          <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
            Conflict
          </Badge>
        ) : null}
        <span className="text-xs font-semibold text-brand-ink/45">
          {getPlanBlockTimeLabel(block)}
        </span>
      </div>
      <p className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
        {block.projectName}
      </p>
      <p className="mt-1 text-sm leading-6 text-brand-ink/65">
        {block.plannedTask}
      </p>
      {conflict ? (
        <p className="mt-3 rounded-2xl border border-brand-coral/16 bg-white/66 px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
          {conflict.message}
        </p>
      ) : null}
    </div>
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
    <div className="rounded-[22px] border border-brand-coral/12 bg-brand-coral/[0.055] p-4">
      <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
        Deadline
      </Badge>
      <p className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
        {projectName}
      </p>
      <p className="mt-1 text-sm leading-6 text-brand-ink/65">
        {deadlineText}
      </p>
    </div>
  );
}

function ImportedCalendarEventCard({
  event,
}: {
  event: ImportedCalendarEvent;
}) {
  return (
    <div className="rounded-[22px] border border-brand-ink/10 bg-brand-ink/[0.035] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-brand-ink/8 text-brand-ink/70" variant="subtle">
          Imported event
        </Badge>
        <span className="text-xs font-semibold text-brand-ink/45">
          {formatImportedEventTimeRange(event)}
        </span>
      </div>
      <p className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
        {event.title}
      </p>
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
    </div>
  );
}

function MonthIndicatorBadge({
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
    </span>
  );
}

function MonthEventDot({ tone }: { tone: MonthIndicatorTone }) {
  const dotClass =
    tone === "conflict"
      ? "bg-brand-coral"
      : tone === "work"
      ? "bg-brand-ocean"
      : tone === "imported"
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
  status,
}: {
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>;
  day: CalendarMonthDaySchedule | null;
  filters: CalendarFilters;
  status: CalendarStatus;
}) {
  if (!day) {
    return null;
  }

  const visibleDay = getVisibleDayData(day, filters);

  return (
    <Card className="h-fit rounded-[30px] border-white/70 bg-white/86">
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

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {status === "loading" ? (
            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm text-brand-ink/52">
              Loading calendar...
            </div>
          ) : null}

          {status !== "loading" && !visibleDay.hasEvents ? (
            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4">
              <p className="text-sm font-semibold text-brand-ink/70">
                Open day
              </p>
              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                No work shifts, plan blocks, imported events, or deadlines yet.
              </p>
            </div>
          ) : null}

          {visibleDay.workShifts.map((shift) => (
            <WorkShiftEvent key={shift.id} shift={shift} />
          ))}

          {visibleDay.planBlocks.map((block) => (
            <PlanBlockEvent
              key={block.id}
              block={block}
              conflict={conflictByBlockId.get(block.id)}
            />
          ))}

          {visibleDay.deadlines.map((deadline) => (
            <DeadlineEvent
              key={`${deadline.projectId}-${deadline.deadlineText}`}
              deadlineText={deadline.deadlineText}
              projectName={deadline.projectName}
            />
          ))}

          {visibleDay.importedEvents.map((event) => (
            <ImportedCalendarEventCard key={event.id} event={event} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarMonthView({
  conflictByBlockId,
  filters,
  monthCalendar,
  selectedMonthDay,
  selectedMonthIso,
  setSelectedMonthIso,
  status,
}: {
  conflictByBlockId: Map<string, WeeklyPlanWorkConflict>;
  filters: CalendarFilters;
  monthCalendar: ReturnType<typeof buildCalendarMonth>;
  selectedMonthDay: CalendarMonthDaySchedule | null;
  selectedMonthIso: string | null;
  setSelectedMonthIso: (isoDate: string) => void;
  status: CalendarStatus;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px] items-start">
      <Card className="overflow-hidden rounded-[32px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)]">
        <CardContent className="p-3 sm:p-5 lg:p-6">
          <div className="mb-4 flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                {monthCalendar.monthLabel}
              </h2>
              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                Weekly plan blocks currently reflect your active weekly plan.
                Work shifts repeat on matching weekdays.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-2">
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
                  className={`min-h-[72px] rounded-[18px] border p-2 text-left transition sm:min-h-[128px] sm:rounded-[24px] sm:p-3 ${
                    day.isCurrentMonth
                      ? "border-brand-ink/8 bg-white/82 hover:border-brand-teal/20 hover:bg-brand-teal/[0.035]"
                      : "border-transparent bg-brand-ink/[0.025] text-brand-ink/26"
                  } ${
                    isSelected
                      ? "border-brand-teal/30 bg-brand-teal/[0.055] shadow-[0_12px_28px_rgba(20,121,110,0.08)]"
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
        </CardContent>
      </Card>

      <MonthDayDetail
        conflictByBlockId={conflictByBlockId}
        day={selectedMonthDay}
        filters={filters}
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
  const [workShifts, setWorkShifts] = useState<WorkShift[]>([]);
  const [importedEvents, setImportedEvents] = useState<ImportedCalendarEvent[]>([]);
  const [filters, setFilters] = useState<CalendarFilters>(defaultFilters);
  const [view, setView] = useState<CalendarView>("week");
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedMonthIso, setSelectedMonthIso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

        const [projectsResult, planResult, workResult, importedEventsResult] =
          await Promise.all([
            fetchProjectsForUser(supabase, userId),
            fetchWeeklyPlanBlocksForUser(supabase, userId),
            fetchWorkShiftsForUser(supabase, userId),
            fetchImportedCalendarEventsForUser(supabase, userId),
          ]);

        if (!isActive) {
          return;
        }

        setProjects(projectsResult.data);
        setPlanBlocks(planResult.data);
        setWorkShifts(workResult.data);
        setImportedEvents(importedEventsResult.data);
        setStatus("ready");

        const errors = [
          projectsResult.error,
          planResult.error,
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

  const calendar = useMemo(
    () =>
      buildCalendarDays({
        importedEvents,
        planBlocks,
        projects,
        workShifts,
      }),
    [importedEvents, planBlocks, projects, workShifts],
  );

  const monthCalendar = useMemo(
    () =>
      buildCalendarMonth({
        importedEvents,
        monthDate,
        planBlocks,
        projects,
        workShifts,
      }),
    [importedEvents, monthDate, planBlocks, projects, workShifts],
  );

  const planWorkConflicts = useMemo(
    () => findWeeklyPlanWorkConflicts(planBlocks, workShifts),
    [planBlocks, workShifts],
  );

  const conflictByBlockId = useMemo(
    () =>
      new Map(
        planWorkConflicts.map((conflict) => [conflict.block.id, conflict]),
      ),
    [planWorkConflicts],
  );

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
        day.deadlines.length > 0 ||
        day.importedEvents.length > 0
      );
    }).length;
    const importedEventCount = calendar.days.reduce(
      (sum, day) => sum + day.importedEvents.length,
      0,
    );

    return {
      daysWithCommitments,
      importedEventCount,
      openDays: Math.max(0, 7 - daysWithCommitments),
      plannedProjectHours,
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
    const importedEventCount = visibleDays.reduce(
      (sum, day) => sum + day.importedEvents.length,
      0,
    );
    const openDays = visibleDays.filter((day) => !day.hasEvents).length;

    return {
      deadlines,
      importedEventCount,
      openDays,
      plannedBlocks,
      workShiftDays,
    };
  }, [filters, monthCalendar.days]);

  const summaryCards =
    view === "week"
      ? [
          {
            label: "Work hours",
            value: formatHours(weekSummary.workHours),
          },
          {
            label: "Project hours",
            value: formatEstimatedHours(weekSummary.plannedProjectHours),
          },
          {
            label: "Days committed",
            value: weekSummary.daysWithCommitments,
          },
          {
            label: "Imported events",
            value: weekSummary.importedEventCount,
          },
        ]
      : [
          {
            label: "Work shift days",
            value: monthSummary.workShiftDays,
          },
          {
            label: "Plan blocks",
            value: monthSummary.plannedBlocks,
          },
          {
            label: "Deadlines",
            value: monthSummary.deadlines,
          },
          {
            label: "Imported",
            value: monthSummary.importedEventCount,
          },
        ];

  const selectedMonthDay =
    monthCalendar.days.find(
      (day) => day.isCurrentMonth && day.isoDate === selectedMonthIso,
    ) ??
    monthCalendar.days.find((day) => day.isCurrentMonth && day.isToday) ??
    monthCalendar.days.find((day) => day.isCurrentMonth) ??
    null;

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

  function returnToCurrentMonth() {
    setMonthDate(new Date());
    setSelectedMonthIso(null);
  }

  return (
    <div className="px-3 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_360px] lg:items-end">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-5xl">
                Calendar
              </h1>
              <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                See work shifts, planned blocks, imported events, and project
                deadlines in one calendar view.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="inline-flex w-fit rounded-full border border-brand-ink/8 bg-white/78 p-1 shadow-[0_12px_28px_rgba(18,32,47,0.06)]">
                  {(["week", "month"] as const).map((nextView) => (
                    <button
                      key={nextView}
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

                <p className="inline-flex w-fit rounded-full border border-brand-ink/8 bg-white/72 px-4 py-2 text-sm font-semibold text-brand-ink/62">
                  {view === "week"
                    ? calendar.weekRangeLabel
                    : monthCalendar.monthLabel}
                </p>

                {view === "month" ? (
                  <div className="inline-flex w-fit flex-wrap gap-2">
                    <button
                      className="rounded-full border border-brand-ink/10 bg-white/76 px-3 py-2 text-sm font-semibold text-brand-ink/62 hover:bg-white hover:text-brand-ink"
                      type="button"
                      onClick={() => changeMonth(-1)}
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-full border border-brand-teal/15 bg-brand-teal/8 px-3 py-2 text-sm font-semibold text-brand-teal hover:bg-brand-teal/12"
                      type="button"
                      onClick={returnToCurrentMonth}
                    >
                      This month
                    </button>
                    <button
                      className="rounded-full border border-brand-ink/10 bg-white/76 px-3 py-2 text-sm font-semibold text-brand-ink/62 hover:bg-white hover:text-brand-ink"
                      type="button"
                      onClick={() => changeMonth(1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88">
              <CardContent className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                {summaryCards.map((card) => (
                  <div key={card.label} className="rounded-[22px] bg-white/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                      {card.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                      {card.value}
                    </p>
                  </div>
                ))}
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
            <section className="flex flex-col gap-4 rounded-[26px] border border-white/70 bg-white/60 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-sm font-semibold text-brand-ink/50">Filters:</span>
                {filterItems.map((item) => (
                  <button
                    key={item.key}
                    aria-pressed={filters[item.key]}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                      filters[item.key]
                        ? "border-brand-teal/20 bg-brand-teal/10 text-brand-teal"
                        : "border-brand-ink/10 bg-white/70 text-brand-ink/48"
                    }`}
                    type="button"
                    onClick={() => toggleFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-ink px-4 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(18,32,47,0.12)] hover:bg-brand-teal sm:text-sm"
                  href="/plan"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Plan
                </Link>
                <Link
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-ink/10 bg-white/80 px-4 text-xs font-semibold text-brand-ink hover:bg-white sm:text-sm"
                  href="/work"
                >
                  <ClockIcon className="h-3.5 w-3.5" />
                  Shift
                </Link>
                <Link
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-ink/10 bg-white/80 px-4 text-xs font-semibold text-brand-ink hover:bg-white sm:text-sm"
                  href="/projects"
                >
                  <FolderStackIcon className="h-3.5 w-3.5" />
                  Projects
                </Link>
              </div>
            </section>

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

            {error ? (
              <p className="rounded-[22px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
                {error}
              </p>
            ) : null}

            {view === "week" ? (
              <section className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
                {calendar.days.map((day) => {
                  const visibleDay = getVisibleDayData(day, filters);

                  return (
                    <Card
                      key={day.day}
                      className="h-full overflow-hidden rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)] sm:rounded-[34px]"
                    >
                      <CardContent className="flex h-full flex-col p-4 sm:p-5 lg:p-6">
                        <div className="mb-4 flex flex-col gap-3 border-b border-brand-ink/8 pb-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                              {day.day}
                            </h2>
                            <p className="mt-1 text-sm font-medium text-brand-ink/50">
                              {day.dateLabel}
                            </p>
                          </div>
                          <Badge
                            className="bg-brand-teal/8 text-brand-teal"
                            variant="subtle"
                          >
                            {formatHours(visibleDay.scheduledHours)}
                          </Badge>
                        </div>

                        <div className="flex flex-1 flex-col gap-3">
                          {status === "loading" ? (
                            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm text-brand-ink/52">
                              Loading calendar...
                            </div>
                          ) : null}

                          {status !== "loading" && !visibleDay.hasEvents ? (
                            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4">
                              <p className="text-sm font-semibold text-brand-ink/70">
                                Open day
                              </p>
                              <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                                No work shifts, plan blocks, imported events, or deadlines yet.
                              </p>
                            </div>
                          ) : null}

                          {visibleDay.workShifts.map((shift) => (
                            <WorkShiftEvent key={shift.id} shift={shift} />
                          ))}

                          {visibleDay.planBlocks.map((block) => (
                            <PlanBlockEvent
                              key={block.id}
                              block={block}
                              conflict={conflictByBlockId.get(block.id)}
                            />
                          ))}

                          {visibleDay.deadlines.map((deadline) => (
                            <DeadlineEvent
                              key={`${deadline.projectId}-${deadline.deadlineText}`}
                              deadlineText={deadline.deadlineText}
                              projectName={deadline.projectName}
                            />
                          ))}

                          {visibleDay.importedEvents.map((event) => (
                            <ImportedCalendarEventCard key={event.id} event={event} />
                          ))}
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
                monthCalendar={monthCalendar}
                selectedMonthDay={selectedMonthDay}
                selectedMonthIso={selectedMonthIso}
                setSelectedMonthIso={setSelectedMonthIso}
                status={status}
              />
            )}

            {filters.deadlines &&
            (view === "week"
              ? calendar.upcomingDeadlines.length
              : monthCalendar.upcomingDeadlines.length) > 0 ? (
              <Card className="rounded-[30px] border-white/70 bg-white/86">
                <CardContent className="p-4 sm:p-6">
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                    Deadlines needing dates
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-brand-ink/58">
                    Add exact dates to place these on your calendar.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {(view === "week"
                      ? calendar.upcomingDeadlines
                      : monthCalendar.upcomingDeadlines
                    ).map((deadline) => (
                        <DeadlineEvent
                          key={`${deadline.projectId}-${deadline.deadlineText}`}
                          deadlineText={deadline.deadlineText}
                          projectName={deadline.projectName}
                        />
                      ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
