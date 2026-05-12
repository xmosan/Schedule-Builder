"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  buildCalendarDays,
  getPlanBlockTimeLabel,
  type CalendarDaySchedule,
} from "@/lib/calendar";
import type { Project } from "@/lib/projects";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  fetchProjectsForUser,
  fetchWeeklyPlanBlocksForUser,
  fetchWorkShiftsForUser,
} from "@/lib/supabase/scheduler";
import { formatEstimatedHours, type WeeklyPlanBlock } from "@/lib/weekly-plan";
import {
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";

type CalendarStatus = "loading" | "ready" | "signed_out" | "error";

type CalendarFilters = {
  deadlines: boolean;
  flexible: boolean;
  planBlocks: boolean;
  workShifts: boolean;
};

const defaultFilters: CalendarFilters = {
  deadlines: true,
  flexible: true,
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
    key: "flexible",
    label: "Flexible blocks",
  },
];

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
    message.includes("work_shifts")
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
  const scheduledHours =
    workShifts.reduce(
      (sum, shift) => sum + getWorkShiftDurationHours(shift),
      0,
    ) + planBlocks.reduce((sum, block) => sum + block.estimatedHours, 0);

  return {
    deadlines,
    hasEvents:
      workShifts.length > 0 || planBlocks.length > 0 || deadlines.length > 0,
    planBlocks,
    scheduledHours,
    workShifts,
  };
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

function PlanBlockEvent({ block }: { block: WeeklyPlanBlock }) {
  return (
    <div className="rounded-[22px] border border-brand-teal/12 bg-brand-teal/[0.055] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
          Plan block
        </Badge>
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

export function CalendarPage() {
  const [status, setStatus] = useState<CalendarStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [planBlocks, setPlanBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [workShifts, setWorkShifts] = useState<WorkShift[]>([]);
  const [filters, setFilters] = useState<CalendarFilters>(defaultFilters);
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

        const [projectsResult, planResult, workResult] = await Promise.all([
          fetchProjectsForUser(supabase, userId),
          fetchWeeklyPlanBlocksForUser(supabase, userId),
          fetchWorkShiftsForUser(supabase, userId),
        ]);

        if (!isActive) {
          return;
        }

        setProjects(projectsResult.data);
        setPlanBlocks(planResult.data);
        setWorkShifts(workResult.data);
        setStatus("ready");

        const errors = [
          projectsResult.error,
          planResult.error,
          workResult.error,
        ].filter(Boolean);

        setError(
          errors.length > 0
            ? getMissingTableMessage(errors[0])
            : null,
        );
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
        planBlocks,
        projects,
        workShifts,
      }),
    [planBlocks, projects, workShifts],
  );

  const summary = useMemo(() => {
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
        day.deadlines.length > 0
      );
    }).length;

    return {
      daysWithCommitments,
      openDays: Math.max(0, 7 - daysWithCommitments),
      plannedProjectHours,
      workHours,
    };
  }, [calendar.days, planBlocks, workShifts]);

  function toggleFilter(key: keyof CalendarFilters) {
    setFilters((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <div className="px-3 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_360px] lg:items-end">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Calendar
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                Calendar
              </h1>
              <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                See work shifts, planned blocks, and project deadlines in one
                weekly view.
              </p>
              <p className="mt-3 inline-flex rounded-full border border-brand-ink/8 bg-white/72 px-4 py-2 text-sm font-semibold text-brand-ink/62">
                {calendar.weekRangeLabel}
              </p>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88">
              <CardContent className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Work hours
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {formatHours(summary.workHours)}
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Project hours
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {formatEstimatedHours(summary.plannedProjectHours)}
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Days committed
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {summary.daysWithCommitments}
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Open days
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {summary.openDays}
                  </p>
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
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card className="rounded-[28px] border-white/70 bg-white/82">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-brand-ink">
                        Calendar filters
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        Hide or show schedule categories for this view.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filterItems.map((item) => (
                        <button
                          key={item.key}
                          aria-pressed={filters[item.key]}
                          className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
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
                  </div>

                  {error ? (
                    <p className="mt-4 rounded-[22px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
                      {error}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-[28px] border-white/70 bg-white/82">
                <CardContent className="p-4 sm:p-5">
                  <h2 className="text-lg font-semibold text-brand-ink">
                    Quick actions
                  </h2>
                  <div className="mt-4 grid gap-2">
                    <Link
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(18,32,47,0.14)] hover:bg-brand-teal"
                      href="/plan"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add plan block
                    </Link>
                    <Link
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-brand-ink/10 bg-white/75 px-4 text-sm font-semibold text-brand-ink hover:bg-white"
                      href="/work"
                    >
                      <ClockIcon className="h-4 w-4" />
                      Add work shift
                    </Link>
                    <Link
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-brand-ink/10 bg-white/75 px-4 text-sm font-semibold text-brand-ink hover:bg-white"
                      href="/projects"
                    >
                      <FolderStackIcon className="h-4 w-4" />
                      Manage projects
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </section>

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
                              No work shifts, plan blocks, or deadlines yet.
                            </p>
                          </div>
                        ) : null}

                        {visibleDay.workShifts.map((shift) => (
                          <WorkShiftEvent key={shift.id} shift={shift} />
                        ))}

                        {visibleDay.planBlocks.map((block) => (
                          <PlanBlockEvent key={block.id} block={block} />
                        ))}

                        {visibleDay.deadlines.map((deadline) => (
                          <DeadlineEvent
                            key={`${deadline.projectId}-${deadline.deadlineText}`}
                            deadlineText={deadline.deadlineText}
                            projectName={deadline.projectName}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            {filters.deadlines && calendar.upcomingDeadlines.length > 0 ? (
              <Card className="rounded-[30px] border-white/70 bg-white/86">
                <CardContent className="p-4 sm:p-6">
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                    Upcoming deadline notes
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-brand-ink/58">
                    These deadline labels are useful, but not specific enough to
                    place on a calendar day yet.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {calendar.upcomingDeadlines.map((deadline) => (
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
