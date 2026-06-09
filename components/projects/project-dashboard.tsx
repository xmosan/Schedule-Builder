"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import {
  CalendarIcon,
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { AddProjectForm } from "@/components/projects/add-project-form";
import { ProjectList } from "@/components/projects/project-list";
import { WeeklyPlanSection } from "@/components/projects/weekly-plan-section";
import { WeeklySummaryCard } from "@/components/projects/weekly-summary-card";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildCalendarDays,
  getCurrentWeekStart,
  getProjectDeadlineBuckets,
  type CalendarDaySchedule,
} from "@/lib/calendar";
import {
  findWeeklyPlanImportedEventConflicts,
  findWeeklyPlanWorkConflicts,
} from "@/lib/schedule-conflicts";
import {
  createStarterProjectsForPlannerType,
  getDefaultGoalsForPlannerType,
  getRecommendedDesiredIntegrations,
  isPlannerProfileOnboarded,
  type OnboardingAnswers,
  type PlannerProfile,
  type PlannerType,
} from "@/lib/onboarding";
import {
  getPlannedHours,
  getProjectsStorageKey,
  parseStoredProjects,
  sortProjectsForFocus,
  starterProjects,
  type Project,
} from "@/lib/projects";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  deleteProjectForUser,
  deleteWeeklyPlanBlockForUser,
  fetchImportedCalendarEventsForUser,
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
  fetchWeeklyPlanBlocksForUser,
  fetchWorkShiftsForUser,
  getWeeklyPlanStartTimeMigrationMessage,
  savePlannerProfileForUser,
  replaceProjectsForUser,
  replaceWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";
import {
  formatImportedEventSource,
  formatImportedEventTimeRange,
  isScheduleBuilderExportedEvent,
  isSchoolCalendarEvent,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import {
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";
import {
  formatEstimatedHours,
  formatStartTime,
  getWeeklyPlanStorageKey,
  parseStartTimeToMinutes,
  parseStoredWeeklyPlan,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

type AuthStatus = "loading" | "signed_in" | "signed_out";
type OnboardingStatus = "loading" | "required" | "completed";
type SchedulerSection = "dashboard" | "projects" | "plan" | "settings";

type GoogleDashboardStatus = {
  connected?: boolean;
  lastSyncedAt?: string | null;
  status?: string;
  syncCalendarName?: string | null;
  syncEnabled?: boolean;
};

type GoogleSyncDashboardStatus = {
  removedSyncedEvents?: Array<{
    id: string;
    syncedStartsAt: string;
    syncedTitle: string;
  }>;
  statuses?: Array<{
    syncStatus: "synced" | "needs_attention";
    weeklyPlanBlockId: string;
  }>;
  syncEnabled?: boolean;
};

type DashboardAction = {
  description: string;
  href: string;
  id: string;
  label: string;
  title: string;
};

type SetupProgressItem = {
  done: boolean;
  href: string;
  label: string;
  nextLabel: string;
  statusLabel?: string;
};

type DashboardTopThreeItem = {
  description: string;
  href: string;
  id: string;
  label: string;
  title: string;
};

type DashboardAttentionItem = {
  description: string;
  href: string;
  id: string;
  label: string;
  title: string;
};

function getSchedulerSection(pathname: string): SchedulerSection {
  if (pathname.startsWith("/projects")) {
    return "projects";
  }

  if (pathname.startsWith("/plan")) {
    return "plan";
  }

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  return "dashboard";
}

function getSchedulerErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

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

  return "Please try again shortly.";
}

function getFriendlyAuthErrorMessage(error: unknown) {
  const message = getSchedulerErrorMessage(error);

  if (/unable to exchange external code/i.test(message)) {
    return "Google sign-in could not finish. The Google authorization code may have expired or the Supabase Google provider callback settings may need to be checked. Please start again with Continue with Google.";
  }

  return message;
}

function isMissingPlannerProfilesTable(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "PGRST205" &&
    typeof candidate.message === "string" &&
    candidate.message.includes("planner_profiles")
  );
}

function getOnboardingProfileErrorMessage(error: unknown) {
  if (isMissingPlannerProfilesTable(error)) {
    return "The onboarding table is missing in Supabase. Run supabase/onboarding.sql in the Supabase project connected to this app, then try again.";
  }

  return getSchedulerErrorMessage(error);
}

function getAuthRedirectUrl() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const currentOrigin = window.location.origin.replace(/\/$/, "");
  const isLocalOrigin =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  return isLocalOrigin ? currentOrigin : configuredSiteUrl || currentOrigin;
}

function getAuthUrlErrorMessage() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash,
  );
  const errorDescription =
    searchParams.get("error_description") ??
    hashParams.get("error_description");
  const errorCode = searchParams.get("error") ?? hashParams.get("error");

  if (!errorDescription && !errorCode) {
    return null;
  }

  return getFriendlyAuthErrorMessage(
    errorDescription ?? `Authentication failed: ${errorCode}`,
  );
}

function clearAuthUrlError() {
  const url = new URL(window.location.href);
  const searchParams = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
  );
  const authErrorKeys = ["error", "error_code", "error_description"];

  authErrorKeys.forEach((key) => {
    searchParams.delete(key);
    hashParams.delete(key);
  });

  url.search = searchParams.toString();
  url.hash = hashParams.toString();
  window.history.replaceState(null, "", url.toString());
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDashboardDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function getDashboardPersona(plannerType: PlannerType) {
  if (plannerType === "Student") {
    return {
      eyebrow: "Student command center",
      title: "Keep classes, deadlines, and study time in one calm view.",
      subtitle:
        "Start with school events and study blocks, then use the Assistant to find open time around the rest of your week.",
    };
  }

  if (plannerType === "Professional") {
    return {
      eyebrow: "Work-aware command center",
      title: "Plan around work shifts without losing the rest of your week.",
      subtitle:
        "See unavailable hours, personal projects, calendar commitments, and the next open window before adding more.",
    };
  }

  if (plannerType === "Organization leader") {
    return {
      eyebrow: "Organization command center",
      title: "Keep events, prep blocks, and team work from colliding.",
      subtitle:
        "Use projects and imported calendars to spot conflicts, protect prep time, and keep upcoming commitments visible.",
    };
  }

  return {
    eyebrow: "Planning command center",
    title: "Know what matters next without hunting through every page.",
    subtitle:
      "Bring projects, tasks, unavailable time, calendars, and weekly blocks into one useful starting point.",
  };
}

function getPlanBlockTimeSummary(block: WeeklyPlanBlock) {
  const timeLabel = block.startTime ? formatStartTime(block.startTime) : "Anytime";
  return `${timeLabel} - ${formatEstimatedHours(block.estimatedHours)}`;
}

function getTodayScheduleGroups(today: CalendarDaySchedule | undefined) {
  if (!today) {
    return {
      external: [],
      plan: [],
      work: [],
    };
  }

  const work = today.workShifts.map((shift) => ({
    detail: shift.location || shift.notes || "Unavailable time",
    id: `work-${shift.id}`,
    label: "Work",
    title: formatWorkShiftRange(shift),
  }));
  const plan = today.planBlocks.map((block) => ({
    detail: block.plannedTask,
    id: `plan-${block.id}`,
    label: block.startTime ? "Plan" : "Flexible",
    title: `${block.projectName} - ${getPlanBlockTimeSummary(block)}`,
  }));
  const external = today.importedEvents
    .filter((event) => !isScheduleBuilderExportedEvent(event))
    .map((event) => ({
      detail: formatImportedEventSource(event),
      id: `event-${event.id}`,
      label: isSchoolCalendarEvent(event)
        ? "School"
        : event.source === "google_calendar"
          ? "Google"
          : "External",
      title: `${event.title} - ${formatImportedEventTimeRange(event)}`,
    }));

  return {
    external,
    plan,
    work,
  };
}

function getCommitmentCounts(day: CalendarDaySchedule) {
  const externalEvents = day.importedEvents.filter(
    (event) => !isScheduleBuilderExportedEvent(event),
  );

  return {
    deadlines: day.deadlines.length,
    externalEvents: externalEvents.length,
    planBlocks: day.planBlocks.length,
    workShifts: day.workShifts.length,
  };
}

function hasAnyCommitment(day: CalendarDaySchedule) {
  const counts = getCommitmentCounts(day);

  return (
    counts.workShifts > 0 ||
    counts.planBlocks > 0 ||
    counts.externalEvents > 0 ||
    counts.deadlines > 0
  );
}

function importedEventOverlapsWindow(
  event: ImportedCalendarEvent,
  startMinutes: number,
  endMinutes: number,
) {
  if (isScheduleBuilderExportedEvent(event)) {
    return false;
  }

  if (event.allDay) {
    return true;
  }

  const startDate = new Date(event.startsAt);
  const endDate = event.endsAt ? new Date(event.endsAt) : null;

  if (Number.isNaN(startDate.getTime())) {
    return false;
  }

  const eventStart = startDate.getHours() * 60 + startDate.getMinutes();
  const eventEnd =
    endDate && !Number.isNaN(endDate.getTime())
      ? endDate.getHours() * 60 + endDate.getMinutes()
      : eventStart + 30;

  return eventStart < endMinutes && eventEnd > startMinutes;
}

function dayHasCommitmentInWindow(
  day: CalendarDaySchedule,
  startMinutes: number,
  endMinutes: number,
) {
  const hasWorkShift = day.workShifts.some((shift) => {
    const shiftStart = parseStartTimeToMinutes(shift.startTime);
    const shiftEnd = parseStartTimeToMinutes(shift.endTime);

    if (shiftStart === null || shiftEnd === null) {
      return false;
    }

    return shiftStart < endMinutes && shiftEnd > startMinutes;
  });

  if (hasWorkShift) {
    return true;
  }

  const hasPlanBlock = day.planBlocks.some((block) => {
    const blockStart = parseStartTimeToMinutes(block.startTime);

    if (blockStart === null) {
      return false;
    }

    return (
      blockStart < endMinutes &&
      blockStart + block.estimatedHours * 60 > startMinutes
    );
  });

  if (hasPlanBlock) {
    return true;
  }

  return day.importedEvents.some((event) =>
    importedEventOverlapsWindow(event, startMinutes, endMinutes),
  );
}

function getOpenTimeSummaries(days: CalendarDaySchedule[]) {
  const summaries: string[] = [];

  days.forEach((day) => {
    if (!hasAnyCommitment(day)) {
      summaries.push(`${day.day} open`);
    }
  });

  if (summaries.length >= 3) {
    return summaries.slice(0, 3);
  }

  days.forEach((day) => {
    if (
      summaries.length < 3 &&
      hasAnyCommitment(day) &&
      !dayHasCommitmentInWindow(day, 17 * 60, 22 * 60)
    ) {
      summaries.push(`${day.day} evening`);
    }
  });

  if (summaries.length >= 3) {
    return summaries.slice(0, 3);
  }

  days.forEach((day) => {
    if (
      summaries.length < 3 &&
      hasAnyCommitment(day) &&
      !dayHasCommitmentInWindow(day, 8 * 60, 12 * 60)
    ) {
      summaries.push(`${day.day} morning`);
    }
  });

  return summaries.slice(0, 3);
}

function wantsIntegration(
  profile: PlannerProfile | null,
  integration: "D2L / Brightspace" | "Google Calendar",
  fallback = true,
) {
  if (!profile) {
    return fallback;
  }

  return profile.desiredIntegrations.includes(integration);
}

function buildSetupProgressItems({
  hasGoogleCalendar,
  hasImportedCalendarEvents,
  hasPlanBlocks,
  hasProjects,
  hasSchoolEvents,
  hasWorkShifts,
  plannerProfile,
  plannerType,
}: {
  hasGoogleCalendar: boolean;
  hasImportedCalendarEvents: boolean;
  hasPlanBlocks: boolean;
  hasProjects: boolean;
  hasSchoolEvents: boolean;
  hasWorkShifts: boolean;
  plannerProfile: PlannerProfile | null;
  plannerType: PlannerType;
}) {
  const wantsGoogleCalendar = wantsIntegration(
    plannerProfile,
    "Google Calendar",
    true,
  );
  const wantsD2l = wantsIntegration(
    plannerProfile,
    "D2L / Brightspace",
    plannerType === "Student",
  );
  const googleDone = hasGoogleCalendar || !wantsGoogleCalendar;
  const d2lDone = hasSchoolEvents || !wantsD2l;

  if (plannerType === "Student") {
    return [
      {
        done: hasProjects,
        href: "/projects",
        label: "Courses/projects",
        nextLabel: "Add",
      },
      {
        done: d2lDone,
        href: "/integrations",
        label: "D2L / Brightspace",
        nextLabel: "Import",
        statusLabel: hasSchoolEvents ? "Set" : "Skipped",
      },
      {
        done: googleDone,
        href: "/integrations",
        label: "Google Calendar",
        nextLabel: "Connect",
        statusLabel: hasGoogleCalendar ? "Set" : "Skipped",
      },
      {
        done: hasPlanBlocks,
        href: "/plan",
        label: "Weekly plan",
        nextLabel: "Plan",
      },
      {
        done: true,
        href: "/assistant",
        label: "Assistant",
        nextLabel: "Ready",
        statusLabel: "Ready",
      },
    ] satisfies SetupProgressItem[];
  }

  if (plannerType === "Professional") {
    return [
      {
        done: hasWorkShifts,
        href: "/work",
        label: "Work shifts",
        nextLabel: "Add",
      },
      {
        done: googleDone,
        href: "/integrations",
        label: "Google Calendar",
        nextLabel: "Connect",
        statusLabel: hasGoogleCalendar ? "Set" : "Skipped",
      },
      {
        done: hasProjects,
        href: "/projects",
        label: "Projects/tasks",
        nextLabel: "Add",
      },
      {
        done: hasPlanBlocks,
        href: "/plan",
        label: "Weekly plan",
        nextLabel: "Plan",
      },
      {
        done: true,
        href: "/assistant",
        label: "Assistant",
        nextLabel: "Ready",
        statusLabel: "Ready",
      },
    ] satisfies SetupProgressItem[];
  }

  if (plannerType === "Organization leader") {
    return [
      {
        done: hasProjects,
        href: "/projects",
        label: "Organization projects",
        nextLabel: "Add",
      },
      {
        done: hasGoogleCalendar || hasImportedCalendarEvents,
        href: "/integrations",
        label: "Calendar context",
        nextLabel: "Connect/import",
      },
      {
        done: hasPlanBlocks,
        href: "/plan",
        label: "Weekly plan",
        nextLabel: "Plan",
      },
      {
        done: true,
        href: "/assistant",
        label: "Assistant",
        nextLabel: "Ready",
        statusLabel: "Ready",
      },
    ] satisfies SetupProgressItem[];
  }

  return [
    {
      done: hasProjects,
      href: "/projects",
      label: "Projects/tasks",
      nextLabel: "Add",
    },
    {
      done: hasWorkShifts,
      href: "/work",
      label: "Unavailable time",
      nextLabel: "Add",
    },
    {
      done: googleDone,
      href: "/integrations",
      label: "Google Calendar",
      nextLabel: "Connect",
      statusLabel: hasGoogleCalendar ? "Set" : "Skipped",
    },
    {
      done: hasPlanBlocks,
      href: "/plan",
      label: "Weekly plan",
      nextLabel: "Plan",
    },
    {
      done: true,
      href: "/assistant",
      label: "Assistant",
      nextLabel: "Ready",
      statusLabel: "Ready",
    },
  ] satisfies SetupProgressItem[];
}

function buildSuggestedDashboardActions({
  conflictCount,
  flexibleBlocksCount,
  hasGoogleCalendar,
  hasImportedCalendarEvents,
  hasPlanBlocks,
  hasProjects,
  hasSchoolEvents,
  hasWorkShifts,
  isGoogleSyncEnabled,
  openTimeSummaries,
  plannerType,
  syncNeedsAttentionCount,
  weeklyPlanHours,
  weeklyWorkHours,
}: {
  conflictCount: number;
  flexibleBlocksCount: number;
  hasGoogleCalendar: boolean;
  hasImportedCalendarEvents: boolean;
  hasPlanBlocks: boolean;
  hasProjects: boolean;
  hasSchoolEvents: boolean;
  hasWorkShifts: boolean;
  isGoogleSyncEnabled: boolean;
  openTimeSummaries: string[];
  plannerType: PlannerType;
  syncNeedsAttentionCount: number;
  weeklyPlanHours: number;
  weeklyWorkHours: number;
}) {
  const actions: DashboardAction[] = [];
  const addAction = (action: DashboardAction) => {
    if (!actions.some((item) => item.id === action.id)) {
      actions.push(action);
    }
  };

  if (conflictCount > 0) {
    addAction({
      description:
        "A planned block may overlap work time or an external calendar event.",
      href: "/calendar",
      id: "review-conflicts",
      label: "Check Calendar",
      title: "Review schedule conflicts",
    });
  }

  if (syncNeedsAttentionCount > 0) {
    addAction({
      description:
        "Some synced blocks changed after being sent to Google Calendar.",
      href: "/plan",
      id: "review-sync-attention",
      label: "Review sync",
      title: "Review Google sync updates",
    });
  }

  if (!hasPlanBlocks) {
    addAction({
      description:
        "Add the first block so your week has a real plan to work from.",
      href: "/plan",
      id: "start-weekly-plan",
      label: "Start planning",
      title: "Start your weekly plan",
    });
  }

  if (flexibleBlocksCount > 0 && isGoogleSyncEnabled) {
    addAction({
      description:
        "Timed blocks can be sent to Google Calendar; flexible blocks need start times first.",
      href: "/plan",
      id: "add-start-times",
      label: "Add times",
      title: "Add start times before syncing",
    });
  }

  if (weeklyWorkHours >= 30 && weeklyPlanHours <= 2) {
    addAction({
      description:
        "You have limited open time this week. Ask the Assistant to find your best planning windows.",
      href: "/assistant",
      id: "limited-open-time",
      label: "Find windows",
      title: "Find the best open time",
    });
  }

  if (plannerType === "Student") {
    if (!hasSchoolEvents) {
      addAction({
        description:
          "Bring course due dates, quizzes, and school events into the Calendar hub.",
        href: "/integrations",
        id: "import-d2l",
        label: "Import school calendar",
        title: "Import D2L / Brightspace",
      });
    }
    if (!hasGoogleCalendar) {
      addAction({
        description:
          "Use existing classes, meetings, and commitments as planning context.",
        href: "/integrations",
        id: "connect-google",
        label: "Connect calendar",
        title: "Connect Google Calendar",
      });
    }
    if (!hasProjects) {
      addAction({
        description: "Add courses, exams, assignments, or school projects.",
        href: "/projects",
        id: "add-school-projects",
        label: "Open Projects",
        title: "Add school projects",
      });
    }
    if (!hasPlanBlocks) {
      addAction({
        description: "Turn one upcoming class task into a realistic study block.",
        href: "/plan",
        id: "create-study-blocks",
        label: "Open Weekly Plan",
        title: "Create study blocks",
      });
    }
  } else if (plannerType === "Professional") {
    if (!hasWorkShifts) {
      addAction({
        description: "Add recurring unavailable hours so plans avoid work time.",
        href: "/work",
        id: "add-work-shifts",
        label: "Add shifts",
        title: "Add your work schedule",
      });
    }
    if (!hasGoogleCalendar) {
      addAction({
        description: "Bring meetings and existing events into planning context.",
        href: "/integrations",
        id: "connect-google",
        label: "Connect calendar",
        title: "Connect Google Calendar",
      });
    }
    if (!hasProjects) {
      addAction({
        description: "Capture personal projects, errands, or recurring tasks.",
        href: "/projects",
        id: "add-personal-work",
        label: "Open Projects",
        title: "Add tasks or projects",
      });
    }
    if (!hasPlanBlocks) {
      addAction({
        description: "Place one priority into a real window around your shifts.",
        href: "/plan",
        id: "create-weekly-block",
        label: "Open Weekly Plan",
        title: "Create weekly blocks",
      });
    }
  } else if (plannerType === "Organization leader") {
    if (!hasProjects) {
      addAction({
        description: "Track event prep, outreach, admin work, and team tasks.",
        href: "/projects",
        id: "add-org-projects",
        label: "Open Projects",
        title: "Add organization projects",
      });
    }
    if (!hasImportedCalendarEvents) {
      addAction({
        description:
          "Import events that already live in another calendar or platform.",
        href: "/integrations",
        id: "import-ics",
        label: "Import ICS",
        title: "Import organization events",
      });
    }
    if (!hasGoogleCalendar) {
      addAction({
        description: "Bring existing meetings into the weekly planning view.",
        href: "/integrations",
        id: "connect-google",
        label: "Connect calendar",
        title: "Connect Google Calendar",
      });
    }
    if (!hasPlanBlocks) {
      addAction({
        description: "Reserve time for agendas, logistics, and follow-ups.",
        href: "/plan",
        id: "prep-blocks",
        label: "Open Weekly Plan",
        title: "Plan prep blocks",
      });
    }
  } else {
    if (!hasProjects) {
      addAction({
        description: "Start with one project, task, appointment, or routine.",
        href: "/projects",
        id: "add-projects",
        label: "Open Projects",
        title: "Add projects or tasks",
      });
    }
    if (!hasWorkShifts) {
      addAction({
        description: "Protect fixed commitments so plans fit your real week.",
        href: "/work",
        id: "add-unavailable",
        label: "Add unavailable time",
        title: "Add recurring unavailable time",
      });
    }
    if (!hasGoogleCalendar) {
      addAction({
        description: "Use your existing calendar events as planning context.",
        href: "/integrations",
        id: "connect-google",
        label: "Connect calendar",
        title: "Connect Google Calendar",
      });
    }
    if (!hasPlanBlocks) {
      addAction({
        description: "Put one priority on the weekly board and build from there.",
        href: "/plan",
        id: "weekly-plan",
        label: "Open Weekly Plan",
        title: "Create a weekly plan block",
      });
    }
  }

  addAction({
    description:
      openTimeSummaries.length > 0
        ? `Likely openings: ${openTimeSummaries.join(", ")}.`
        : "Ask for open windows, conflict checks, or what to prioritize next.",
    href: "/assistant",
    id: "assistant",
    label: "Open Assistant",
    title:
      plannerType === "Student"
        ? "Find open study time"
        : plannerType === "Organization leader"
          ? "Check conflicts and prep time"
          : "Ask for open time",
  });

  return actions.slice(0, 3);
}

function SetupProgressCard({
  completeCount,
  items,
}: {
  completeCount: number;
  items: SetupProgressItem[];
}) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Setup progress
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
              {completeCount} of {items.length} essentials set up
            </h2>
          </div>
          <Badge variant="subtle">
            {completeCount === items.length ? "Ready" : "Keep going"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <Link
              className="flex items-center justify-between gap-3 rounded-[20px] border border-brand-ink/8 bg-white/70 px-4 py-3 text-brand-ink transition hover:-translate-y-0.5 hover:bg-white"
              href={item.href}
              key={item.label}
            >
              <span className="text-sm font-semibold">{item.label}</span>
              <span
                className={
                  item.done
                    ? "rounded-full bg-brand-teal/10 px-2.5 py-1 text-xs font-semibold text-brand-teal"
                    : "rounded-full bg-brand-ink/5 px-2.5 py-1 text-xs font-semibold text-brand-ink/55"
                }
              >
                {item.done ? item.statusLabel ?? "Set" : item.nextLabel}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestedSetupCard({
  actions,
  plannerType,
}: {
  actions: DashboardAction[];
  plannerType: PlannerType;
}) {
  const primaryAction = actions[0];
  const secondaryActions = actions.slice(1, 3);

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Suggested setup
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
              Best next step
            </h2>
          </div>
          <Badge variant="subtle">{plannerType}</Badge>
        </div>

        {primaryAction ? (
          <Link
            className="mt-4 block rounded-[24px] border border-brand-teal/15 bg-brand-teal/8 p-4 text-brand-ink transition hover:-translate-y-0.5 hover:bg-brand-teal/12"
            href={primaryAction.href}
          >
            <p className="text-sm font-semibold text-brand-teal">Do this first</p>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-brand-ink">
              {primaryAction.title}
            </h3>
            <p className="mt-2 text-sm leading-5 text-brand-ink/62">
              {primaryAction.description}
            </p>
            <span className="mt-4 inline-flex rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-brand-teal">
              {primaryAction.label}
            </span>
          </Link>
        ) : null}

        {secondaryActions.length > 0 ? (
          <div className="mt-4 grid gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
              Also useful
            </p>
            {secondaryActions.map((action) => (
              <Link
                className="rounded-[22px] border border-brand-ink/8 bg-white/70 p-4 text-brand-ink transition hover:-translate-y-0.5 hover:bg-white"
                href={action.href}
                key={action.id}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{action.title}</p>
                    <p className="mt-1 text-sm leading-5 text-brand-ink/58">
                      {action.description}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-semibold text-brand-teal">
                    {action.label}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TodayWeekCard({
  openDayCount,
  openTimeSummaries,
  today,
  weekRangeLabel,
  weeklyExternalEvents,
  weeklyPlanHours,
  weeklyWorkHours,
}: {
  openDayCount: number;
  openTimeSummaries: string[];
  today: CalendarDaySchedule | undefined;
  weekRangeLabel: string;
  weeklyExternalEvents: number;
  weeklyPlanHours: number;
  weeklyWorkHours: number;
}) {
  const todayGroups = getTodayScheduleGroups(today);
  const todayItemCount =
    todayGroups.work.length + todayGroups.plan.length + todayGroups.external.length;
  const renderTodayGroup = (
    label: string,
    items: ReturnType<typeof getTodayScheduleGroups>["work"],
  ) =>
    items.length > 0 ? (
      <div className="rounded-[20px] border border-brand-ink/8 bg-white/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
          {label}
        </p>
        <div className="mt-3 grid gap-3">
          {items.slice(0, 3).map((item) => (
            <div key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-ink/5 px-2.5 py-1 text-xs font-semibold text-brand-ink/60">
                  {item.label}
                </span>
                <p className="min-w-0 text-sm font-semibold text-brand-ink">
                  {item.title}
                </p>
              </div>
              <p className="mt-1 text-sm leading-5 text-brand-ink/58">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Today
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
              {today ? formatDashboardDate(today.date) : "Nothing selected"}
            </h2>
          </div>
          <Badge variant="subtle">
            {todayItemCount > 0
              ? `${todayItemCount} item${todayItemCount === 1 ? "" : "s"}`
              : "Open"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3">
          {todayItemCount > 0 ? (
            <>
              {renderTodayGroup("Work shifts", todayGroups.work)}
              {renderTodayGroup("Plan blocks", todayGroups.plan)}
              {renderTodayGroup("External events", todayGroups.external)}
            </>
          ) : (
            <div className="rounded-[22px] border border-dashed border-brand-ink/12 bg-white/50 p-4">
              <p className="text-sm font-semibold text-brand-ink">
                Nothing scheduled today yet.
              </p>
              <p className="mt-1 text-sm leading-5 text-brand-ink/58">
                Use this as open space, or add a plan block when the day needs
                structure.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-brand-ink/8 pt-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              This week
            </p>
            <p className="mt-1 text-sm text-brand-ink/58">{weekRangeLabel}</p>
          </div>
          <Link
            className="rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-semibold text-brand-teal"
            href="/assistant"
          >
            Ask Assistant for open time
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
              Work
            </p>
            <p className="mt-2 text-lg font-semibold text-brand-ink">
              {formatEstimatedHours(weeklyWorkHours)}
            </p>
          </div>
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
              Plan
            </p>
            <p className="mt-2 text-lg font-semibold text-brand-ink">
              {formatEstimatedHours(weeklyPlanHours)}
            </p>
          </div>
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
              External
            </p>
            <p className="mt-2 text-lg font-semibold text-brand-ink">
              {weeklyExternalEvents}
            </p>
          </div>
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
              Open days
            </p>
            <p className="mt-2 text-lg font-semibold text-brand-ink">
              {openDayCount}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-[22px] border border-brand-ink/8 bg-white/70 p-4">
          <p className="text-sm font-semibold text-brand-ink">
            Open-time snapshot
          </p>
          {openTimeSummaries.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {openTimeSummaries.map((summary) => (
                <span
                  className="rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-semibold text-brand-teal"
                  key={summary}
                >
                  {summary}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-5 text-brand-ink/58">
              Open windows need a closer look this week. The Assistant can scan
              work shifts, plan blocks, and external events for you.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardTopThreeCard({ items }: { items: DashboardTopThreeItem[] }) {
  const heading = items.length >= 3 ? "Today's Top 3" : "Today's priorities";

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
          {heading}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
          What to focus on next
        </h2>

        <div className="mt-4 grid gap-3">
          {items.length > 0 ? (
            items.map((item, index) => (
              <Link
                className="rounded-[22px] border border-brand-ink/8 bg-white/70 p-4 text-brand-ink transition hover:-translate-y-0.5 hover:bg-white"
                href={item.href}
                key={item.id}
              >
                <div className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-sm font-semibold text-brand-teal">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-brand-ink/5 px-2.5 py-1 text-xs font-semibold text-brand-ink/55">
                        {item.label}
                      </span>
                      <p className="text-sm font-semibold text-brand-ink">
                        {item.title}
                      </p>
                    </div>
                    <p className="mt-2 text-sm leading-5 text-brand-ink/58">
                      {item.description}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-brand-ink/12 bg-white/50 p-4">
              <p className="text-sm font-semibold text-brand-ink">
                Add projects or plan blocks to generate priorities.
              </p>
              <p className="mt-1 text-sm leading-5 text-brand-ink/58">
                Once Schedule Builder has a few priorities, this card becomes
                your daily launch pad.
              </p>
            </div>
          )}
        </div>

        {items.length === 1 ? (
          <p className="mt-4 rounded-[18px] bg-brand-ink/5 px-4 py-3 text-sm leading-5 text-brand-ink/60">
            Add more projects or plan blocks to build a fuller priority list.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NeedsAttentionCard({ items }: { items: DashboardAttentionItem[] }) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Needs attention
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
              {items.length > 0 ? `${items.length} item${items.length === 1 ? "" : "s"}` : "All clear"}
            </h2>
          </div>
          <Badge variant="subtle">{items.length > 0 ? "Review" : "Calm"}</Badge>
        </div>

        <div className="mt-4 grid gap-3">
          {items.length > 0 ? (
            items.map((item) => (
              <Link
                className="rounded-[22px] border border-brand-coral/15 bg-brand-coral/5 p-4 text-brand-ink transition hover:-translate-y-0.5 hover:bg-brand-coral/10"
                href={item.href}
                key={item.id}
              >
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-sm leading-5 text-brand-ink/60">
                  {item.description}
                </p>
                <span className="mt-3 inline-flex rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-brand-coral">
                  {item.label}
                </span>
              </Link>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-brand-ink/12 bg-white/50 p-4">
              <p className="text-sm font-semibold text-brand-ink">
                No conflicts or sync cleanup surfaced right now.
              </p>
              <p className="mt-1 text-sm leading-5 text-brand-ink/58">
                The Calendar and Weekly Plan will flag issues here when they
                need a quick review.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActionsCard({ plannerType }: { plannerType: PlannerType }) {
  const actions =
    plannerType === "Student"
      ? [
          { href: "/integrations", label: "Import D2L" },
          { href: "/plan", label: "Plan study time" },
          { href: "/assistant", label: "Find study time" },
        ]
      : plannerType === "Professional"
        ? [
            { href: "/work", label: "Add work shift" },
            { href: "/calendar", label: "Open Calendar" },
            { href: "/assistant", label: "Find open time" },
          ]
        : plannerType === "Organization leader"
          ? [
              { href: "/projects", label: "Add org project" },
              { href: "/integrations", label: "Import events" },
              { href: "/assistant", label: "Check conflicts" },
            ]
          : [
              { href: "/projects", label: "Add project/task" },
              { href: "/plan", label: "Plan this week" },
              { href: "/assistant", label: "Ask Assistant" },
            ];

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
          Quick actions
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Link
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-brand-ink/10 bg-white/75 px-3 text-sm font-semibold text-brand-ink transition hover:-translate-y-0.5 hover:bg-white"
              href={action.href}
              key={action.label}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FocusRuleCard() {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
            <TargetIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Focus note
            </p>
            <p className="mt-2 text-sm leading-6 text-brand-ink/70">
              Priorities are suggested from your active projects, deadlines,
              and weekly plan.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type AccountCardProps = {
  dataMessage: string | null;
  email?: string | null;
  onSignOut: () => void;
};

function AccountCard({ dataMessage, email, onSignOut }: AccountCardProps) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
          Signed in as
        </p>
        <p className="mt-2 truncate text-sm font-semibold text-brand-ink sm:text-base">
          {email}
        </p>
        {dataMessage ? (
          <p className="mt-3 text-sm leading-6 text-brand-ink/60">
            {dataMessage}
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-brand-ink/60">
            Your schedule is connected to Supabase for cross-device planning.
          </p>
        )}
        <Button
          className="mt-4 w-full"
          size="sm"
          variant="outline"
          onClick={onSignOut}
        >
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

type SettingsQuickLinksCardProps = {
  onEditPreferences: () => void;
};

function SettingsQuickLinksCard({
  onEditPreferences,
}: SettingsQuickLinksCardProps) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
          Planning setup
        </p>
        <div className="mt-4 grid gap-3">
          <Link
            className="rounded-[22px] border border-brand-ink/8 bg-white/70 p-4 text-brand-ink hover:-translate-y-0.5 hover:bg-white"
            href="/work"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Work Schedule</p>
                <p className="text-sm leading-5 text-brand-ink/58">
                  Add unavailable work hours.
                </p>
              </div>
            </div>
          </Link>

          <Link
            className="rounded-[22px] border border-brand-ink/8 bg-white/70 p-4 text-brand-ink hover:-translate-y-0.5 hover:bg-white"
            href="/integrations"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
                <TargetIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Integrations</p>
                <p className="text-sm leading-5 text-brand-ink/58">
                  Review calendar connection options.
                </p>
              </div>
            </div>
          </Link>

          <button
            className="rounded-[22px] border border-brand-ink/8 bg-white/70 p-4 text-left text-brand-ink transition hover:-translate-y-0.5 hover:bg-white"
            type="button"
            onClick={onEditPreferences}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-coral/10 p-2 text-brand-coral">
                <TargetIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Update preferences</p>
                <p className="text-sm leading-5 text-brand-ink/58">
                  Revisit your setup path and recommendations.
                </p>
              </div>
            </div>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProjectDashboard() {
  const pathname = usePathname();
  const currentSection = getSchedulerSection(pathname);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>(starterProjects);
  const [planBlocks, setPlanBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [workShifts, setWorkShifts] = useState<WorkShift[]>([]);
  const [importedEvents, setImportedEvents] = useState<ImportedCalendarEvent[]>(
    [],
  );
  const [plannerProfile, setPlannerProfile] = useState<PlannerProfile | null>(
    null,
  );
  const [onboardingStatus, setOnboardingStatus] =
    useState<OnboardingStatus>("loading");
  const [isEditingOnboardingPreferences, setIsEditingOnboardingPreferences] =
    useState(false);
  const [hasLoadedRemoteData, setHasLoadedRemoteData] = useState(false);
  const [canSyncProjects, setCanSyncProjects] = useState(false);
  const [canSyncWeeklyPlan, setCanSyncWeeklyPlan] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isOnboardingSubmitting, setIsOnboardingSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<GoogleDashboardStatus | null>(null);
  const [googleSyncStatus, setGoogleSyncStatus] =
    useState<GoogleSyncDashboardStatus | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let client: SupabaseClient;

    try {
      client = getSupabaseBrowserClient();
    } catch (error) {
      setAuthError(getFriendlyAuthErrorMessage(error));
      setAuthStatus("signed_out");
      return;
    }

    setSupabase(client);

    let isActive = true;

    async function loadSession() {
      try {
        const urlAuthError = getAuthUrlErrorMessage();

        if (urlAuthError) {
          setAuthError(urlAuthError);
          clearAuthUrlError();
        }

        const { data, error } = await client.auth.getSession();

        if (!isActive) {
          return;
        }

        if (error) {
          setAuthError(getFriendlyAuthErrorMessage(error));
        }

        const nextUser = data.session?.user ?? null;
        setUser(nextUser);
        setAuthStatus(nextUser ? "signed_in" : "signed_out");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setAuthError(getFriendlyAuthErrorMessage(error));
        setAuthStatus("signed_out");
      }
    }

    void loadSession();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session: Session | null) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setAuthStatus(nextUser ? "signed_in" : "signed_out");
      setIsAuthSubmitting(false);

      if (nextUser || event === "SIGNED_OUT") {
        setAuthError(null);
      }

      if (!nextUser) {
        setProjects(starterProjects);
        setPlanBlocks([]);
        setWorkShifts([]);
        setImportedEvents([]);
        setPlannerProfile(null);
        setOnboardingStatus("loading");
        setIsEditingOnboardingPreferences(false);
        setHasLoadedRemoteData(false);
        setCanSyncProjects(false);
        setCanSyncWeeklyPlan(false);
        setOnboardingError(null);
        setDataMessage(null);
        setGoogleCalendarStatus(null);
        setGoogleSyncStatus(null);
      }
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      return;
    }

    const activeSupabase = supabase;
    const activeUser = user;
    let isActive = true;
    const projectStorageKey = getProjectsStorageKey(activeUser.id);
    const weeklyPlanStorageKey = getWeeklyPlanStorageKey(activeUser.id);
    const userStoredProjects = parseStoredProjects(
      window.localStorage.getItem(projectStorageKey),
    );
    const legacyStoredProjects = parseStoredProjects(
      window.localStorage.getItem(getProjectsStorageKey()),
    );
    const userStoredPlanBlocks = parseStoredWeeklyPlan(
      window.localStorage.getItem(weeklyPlanStorageKey),
    );
    const legacyStoredPlanBlocks = parseStoredWeeklyPlan(
      window.localStorage.getItem(getWeeklyPlanStorageKey()),
    );

    setProjects(userStoredProjects ?? []);
    setPlanBlocks(userStoredPlanBlocks ?? []);
    setOnboardingStatus("loading");
    setHasLoadedRemoteData(false);
    setCanSyncProjects(false);
    setCanSyncWeeklyPlan(false);
    setOnboardingError(null);
    setDataMessage("Loading your schedule from Supabase...");

    async function loadRemoteScheduler() {
      try {
        const [
          profileResult,
          projectsResult,
          weeklyPlanResult,
          workShiftsResult,
          importedEventsResult,
        ] = await Promise.all([
          fetchPlannerProfileForUser(activeSupabase, activeUser.id),
          fetchProjectsForUser(activeSupabase, activeUser.id),
          fetchWeeklyPlanBlocksForUser(activeSupabase, activeUser.id),
          fetchWorkShiftsForUser(activeSupabase, activeUser.id),
          fetchImportedCalendarEventsForUser(activeSupabase, activeUser.id),
        ]);

        if (!isActive) {
          return;
        }

        const profileLoadFailed = Boolean(profileResult.error);
        const nextProfile = profileResult.error == null ? profileResult.data : null;
        const hasCompletedOnboarding = isPlannerProfileOnboarded(nextProfile);
        const shouldShowOnboarding = !hasCompletedOnboarding;
        const storedProjects =
          userStoredProjects ??
          (hasCompletedOnboarding ? legacyStoredProjects : null);
        const migratedPlanBlocks =
          userStoredPlanBlocks ??
          (hasCompletedOnboarding ? legacyStoredPlanBlocks : null) ??
          [];
        const nextProjects =
          projectsResult.error == null
            ? projectsResult.data.length > 0
              ? projectsResult.data
              : storedProjects ?? []
            : storedProjects ?? [];
        const nextPlanBlocks =
          weeklyPlanResult.error == null
            ? weeklyPlanResult.data.length > 0
              ? weeklyPlanResult.data
              : migratedPlanBlocks
            : migratedPlanBlocks;

        setOnboardingStatus(shouldShowOnboarding ? "required" : "completed");
        setPlannerProfile(nextProfile);
        setIsEditingOnboardingPreferences(false);
        setOnboardingError(
          profileLoadFailed && shouldShowOnboarding
            ? `We could not check your onboarding profile: ${getOnboardingProfileErrorMessage(profileResult.error)}`
            : null,
        );
        setProjects(nextProjects);
        setPlanBlocks(nextPlanBlocks);
        setWorkShifts(workShiftsResult.error == null ? workShiftsResult.data : []);
        setImportedEvents(
          importedEventsResult.error == null ? importedEventsResult.data : [],
        );
        window.localStorage.setItem(projectStorageKey, JSON.stringify(nextProjects));
        window.localStorage.setItem(
          weeklyPlanStorageKey,
          JSON.stringify(nextPlanBlocks),
        );
        setHasLoadedRemoteData(true);
        setCanSyncProjects(projectsResult.error == null);
        setCanSyncWeeklyPlan(weeklyPlanResult.error == null);

        const loadErrors = [
          profileResult.error,
          projectsResult.error,
          weeklyPlanResult.error,
          workShiftsResult.error,
          importedEventsResult.error,
        ].filter(Boolean);

        if (loadErrors.length > 0) {
          setDataMessage(
            `Supabase sync had trouble loading your schedule: ${loadErrors
              .map(getSchedulerErrorMessage)
              .join(" ")} Local backup is still in use. If onboarding does not appear, run the latest Supabase SQL.`,
          );
          return;
        }

        setDataMessage(null);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setProjects(userStoredProjects ?? []);
        setPlanBlocks(userStoredPlanBlocks ?? []);
        setWorkShifts([]);
        setImportedEvents([]);
        setPlannerProfile(null);
        setOnboardingStatus("completed");
        setIsEditingOnboardingPreferences(false);
        setHasLoadedRemoteData(true);
        setCanSyncProjects(false);
        setCanSyncWeeklyPlan(false);
        setDataMessage(
          `Supabase sync had trouble loading your schedule: ${getSchedulerErrorMessage(error)} Local backup is still in use.`,
        );
      }
    }

    void loadRemoteScheduler();

    return () => {
      isActive = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !user || !hasLoadedRemoteData) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function loadGoogleCalendarDashboardStatus() {
      try {
        const { data } = await activeSupabase.auth.getSession();
        const accessToken = data.session?.access_token;

        if (!accessToken) {
          return;
        }

        const headers = { Authorization: `Bearer ${accessToken}` };
        const weekStartDate = formatDateInputValue(getCurrentWeekStart());
        const [statusResponse, syncStatusResponse] = await Promise.all([
          fetch("/api/google-calendar/status", { headers }),
          fetch(
            `/api/google-calendar/sync-status?week_start_date=${weekStartDate}`,
            { headers },
          ),
        ]);

        if (!isActive) {
          return;
        }

        if (statusResponse.ok) {
          setGoogleCalendarStatus(await statusResponse.json());
        } else {
          setGoogleCalendarStatus(null);
        }

        if (syncStatusResponse.ok) {
          setGoogleSyncStatus(await syncStatusResponse.json());
        } else {
          setGoogleSyncStatus(null);
        }
      } catch {
        if (!isActive) {
          return;
        }

        setGoogleCalendarStatus(null);
        setGoogleSyncStatus(null);
      }
    }

    void loadGoogleCalendarDashboardStatus();

    return () => {
      isActive = false;
    };
  }, [hasLoadedRemoteData, planBlocks, supabase, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const activeUser = user;
    window.localStorage.setItem(
      getProjectsStorageKey(activeUser.id),
      JSON.stringify(projects),
    );

    if (!supabase || !hasLoadedRemoteData || !canSyncProjects) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function syncProjects() {
      let error: unknown = null;

      try {
        const result = await replaceProjectsForUser(
          activeSupabase,
          activeUser.id,
          projects,
        );
        error = result.error;
      } catch (syncError) {
        error = syncError;
      }

      if (!isActive || !error) {
        if (isActive && !error) {
          setDataMessage((current) =>
            current &&
            (current.includes("local backup") || current.includes("Saved locally"))
              ? null
              : current,
          );
        }
        return;
      }

      setDataMessage(
        `Saved locally. Supabase sync will retry after your next change. ${getSchedulerErrorMessage(error)}`,
      );
      console.error("Failed to sync projects to Supabase:", error);
    }

    void syncProjects();

    return () => {
      isActive = false;
    };
  }, [canSyncProjects, hasLoadedRemoteData, projects, supabase, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const activeUser = user;
    window.localStorage.setItem(
      getWeeklyPlanStorageKey(activeUser.id),
      JSON.stringify(planBlocks),
    );

    if (!supabase || !hasLoadedRemoteData || !canSyncWeeklyPlan) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function syncWeeklyPlan() {
      let error: unknown = null;

      try {
        const result = await replaceWeeklyPlanBlocksForUser(
          activeSupabase,
          activeUser.id,
          planBlocks,
        );
        error = result.error;
      } catch (syncError) {
        error = syncError;
      }

      if (!isActive || !error) {
        if (isActive && !error) {
          setDataMessage((current) =>
            current &&
            (current.includes("local backup") || current.includes("Saved locally"))
              ? null
              : current,
          );
        }
        return;
      }

      setDataMessage(
        `Saved locally. Supabase sync will retry after your next change. ${getSchedulerErrorMessage(error)}`,
      );
      console.error("Failed to sync weekly plan blocks to Supabase:", error);
    }

    void syncWeeklyPlan();

    return () => {
      isActive = false;
    };
  }, [canSyncWeeklyPlan, hasLoadedRemoteData, planBlocks, supabase, user]);

  const activeProjects = useMemo(
    () => projects.filter((project) => !project.completed).length,
    [projects],
  );

  const completedProjects = useMemo(
    () => projects.filter((project) => project.completed).length,
    [projects],
  );

  const highPriorityProjects = useMemo(
    () =>
      projects.filter(
        (project) => !project.completed && project.priority === "High",
      ).length,
    [projects],
  );

  const totalHours = useMemo(() => getPlannedHours(projects), [projects]);

  const plannerType = plannerProfile?.plannerType ?? "General planning";

  const dashboardPersona = useMemo(
    () => getDashboardPersona(plannerType),
    [plannerType],
  );

  const weekStartDate = useMemo(() => getCurrentWeekStart(), []);

  const calendarWeek = useMemo(
    () =>
      buildCalendarDays({
        importedEvents,
        planBlocks,
        projects,
        weekStart: weekStartDate,
        workShifts,
      }),
    [importedEvents, planBlocks, projects, weekStartDate, workShifts],
  );

  const deadlineBuckets = useMemo(
    () => getProjectDeadlineBuckets(projects, weekStartDate),
    [projects, weekStartDate],
  );

  const todayIsoDate = useMemo(() => formatDateInputValue(new Date()), []);

  const todaySchedule = useMemo(
    () =>
      calendarWeek.days.find((day) => day.isoDate === todayIsoDate) ??
      calendarWeek.days[0],
    [calendarWeek.days, todayIsoDate],
  );

  const weeklyPlanHours = useMemo(
    () =>
      planBlocks.reduce((sum, block) => sum + Number(block.estimatedHours || 0), 0),
    [planBlocks],
  );

  const weeklyWorkHours = useMemo(
    () =>
      workShifts.reduce(
        (sum, shift) => sum + getWorkShiftDurationHours(shift),
        0,
      ),
    [workShifts],
  );

  const externalImportedEvents = useMemo(
    () =>
      importedEvents.filter(
        (event) =>
          event.source !== "google_calendar" &&
          !isScheduleBuilderExportedEvent(event),
      ),
    [importedEvents],
  );

  const schoolEventCount = useMemo(
    () => importedEvents.filter(isSchoolCalendarEvent).length,
    [importedEvents],
  );

  const hasGoogleCalendar = useMemo(
    () =>
      Boolean(googleCalendarStatus?.connected) ||
      importedEvents.some((event) => event.source === "google_calendar"),
    [googleCalendarStatus?.connected, importedEvents],
  );

  const weeklyExternalEvents = useMemo(
    () =>
      calendarWeek.days.reduce(
        (count, day) =>
          count +
          day.importedEvents.filter((event) => !isScheduleBuilderExportedEvent(event))
            .length,
        0,
      ),
    [calendarWeek.days],
  );

  const openDayCount = useMemo(
    () =>
      calendarWeek.days.filter((day) => {
        const hasExternalEvent = day.importedEvents.some(
          (event) => !isScheduleBuilderExportedEvent(event),
        );

        return (
          day.workShifts.length === 0 &&
          day.planBlocks.length === 0 &&
          day.deadlines.length === 0 &&
          !hasExternalEvent
        );
      }).length,
    [calendarWeek.days],
  );

  const flexibleBlocksCount = useMemo(
    () => planBlocks.filter((block) => !block.startTime).length,
    [planBlocks],
  );

  const syncNeedsAttentionCount = useMemo(
    () =>
      googleSyncStatus?.statuses?.filter(
        (status) => status.syncStatus === "needs_attention",
      ).length ?? 0,
    [googleSyncStatus?.statuses],
  );

  const removedSyncedEventsCount =
    googleSyncStatus?.removedSyncedEvents?.length ?? 0;

  const setupProgressItems = useMemo(
    () =>
      buildSetupProgressItems({
        hasGoogleCalendar,
        hasImportedCalendarEvents: externalImportedEvents.length > 0,
        hasPlanBlocks: planBlocks.length > 0,
        hasProjects: projects.length > 0,
        hasSchoolEvents: schoolEventCount > 0,
        hasWorkShifts: workShifts.length > 0,
        plannerProfile,
        plannerType,
      }),
    [
      externalImportedEvents.length,
      hasGoogleCalendar,
      planBlocks.length,
      plannerProfile,
      plannerType,
      projects.length,
      workShifts.length,
      schoolEventCount,
    ],
  );

  const setupCompleteCount = setupProgressItems.filter((item) => item.done).length;

  const workConflicts = useMemo(
    () => findWeeklyPlanWorkConflicts(planBlocks, workShifts),
    [planBlocks, workShifts],
  );

  const importedConflicts = useMemo(
    () =>
      findWeeklyPlanImportedEventConflicts(
        planBlocks,
        importedEvents,
        weekStartDate,
      ),
    [importedEvents, planBlocks, weekStartDate],
  );

  const conflictCount = workConflicts.length + importedConflicts.length;

  const openTimeSummaries = useMemo(
    () => getOpenTimeSummaries(calendarWeek.days),
    [calendarWeek.days],
  );

  const isGoogleSyncEnabled = Boolean(googleSyncStatus?.syncEnabled);

  const suggestedDashboardActions = useMemo(
    () =>
      buildSuggestedDashboardActions({
        conflictCount,
        flexibleBlocksCount,
        hasGoogleCalendar,
        hasImportedCalendarEvents: externalImportedEvents.length > 0,
        hasPlanBlocks: planBlocks.length > 0,
        hasProjects: projects.length > 0,
        hasSchoolEvents: schoolEventCount > 0,
        hasWorkShifts: workShifts.length > 0,
        isGoogleSyncEnabled,
        openTimeSummaries,
        plannerType,
        syncNeedsAttentionCount,
        weeklyPlanHours,
        weeklyWorkHours,
      }),
    [
      conflictCount,
      externalImportedEvents.length,
      flexibleBlocksCount,
      hasGoogleCalendar,
      isGoogleSyncEnabled,
      openTimeSummaries,
      planBlocks.length,
      plannerType,
      projects.length,
      schoolEventCount,
      syncNeedsAttentionCount,
      weeklyPlanHours,
      weeklyWorkHours,
      workShifts.length,
    ],
  );

  const dashboardTopThree = useMemo(() => {
    const items: DashboardTopThreeItem[] = [];

    todaySchedule?.planBlocks.slice(0, 2).forEach((block) => {
      items.push({
        description: block.plannedTask || getPlanBlockTimeSummary(block),
        href: "/plan",
        id: `today-plan-${block.id}`,
        label: block.startTime ? "Today" : "Flexible",
        title: block.projectName,
      });
    });

    deadlineBuckets.exactDeadlines
      .filter((deadline) => deadline.isoDate && deadline.isoDate >= todayIsoDate)
      .sort((first, second) =>
        (first.isoDate ?? "").localeCompare(second.isoDate ?? ""),
      )
      .slice(0, 2)
      .forEach((deadline) => {
        items.push({
          description: `Due ${deadline.deadlineText}`,
          href: "/calendar",
          id: `deadline-${deadline.projectId}`,
          label: "Deadline",
          title: deadline.projectName,
        });
      });

    sortProjectsForFocus(projects)
      .filter((project) => !project.completed)
      .slice(0, 4)
      .forEach((project) => {
        items.push({
          description: project.nextAction,
          href: "/projects",
          id: `project-${project.id}`,
          label: project.priority,
          title: project.name,
        });
      });

    const seenIds = new Set<string>();
    return items
      .filter((item) => {
        if (seenIds.has(item.id)) {
          return false;
        }

        seenIds.add(item.id);
        return true;
      })
      .slice(0, 3);
  }, [deadlineBuckets.exactDeadlines, projects, todayIsoDate, todaySchedule]);

  const attentionItems = useMemo(() => {
    const items: DashboardAttentionItem[] = [];

    if (syncNeedsAttentionCount > 0) {
      items.push({
        description:
          "Some synced blocks changed after they were sent to Google Calendar.",
        href: "/plan",
        id: "sync-needs-attention",
        label: "Review sync",
        title: `${syncNeedsAttentionCount} synced block${
          syncNeedsAttentionCount === 1 ? "" : "s"
        } need attention`,
      });
    }

    if (removedSyncedEventsCount > 0) {
      items.push({
        description:
          "Some Google Calendar events still exist after their Schedule Builder blocks were removed.",
        href: "/plan",
        id: "removed-synced-events",
        label: "Open Weekly Plan",
        title: "Calendar events still in Google",
      });
    }

    if (workConflicts.length + importedConflicts.length > 0) {
      items.push({
        description:
          "A planned block may overlap work time or an external calendar event.",
        href: "/calendar",
        id: "schedule-conflicts",
        label: "Check Calendar",
        title: `${workConflicts.length + importedConflicts.length} possible conflict${
          workConflicts.length + importedConflicts.length === 1 ? "" : "s"
        }`,
      });
    }

    if (deadlineBuckets.deadlinesNeedingDates.length > 0) {
      items.push({
        description:
          "Add exact dates so these deadlines can land correctly on the Calendar.",
        href: "/projects",
        id: "deadlines-needing-dates",
        label: "Edit projects",
        title: `${deadlineBuckets.deadlinesNeedingDates.length} deadline${
          deadlineBuckets.deadlinesNeedingDates.length === 1 ? "" : "s"
        } need dates`,
      });
    }

    if (flexibleBlocksCount > 0 && googleSyncStatus?.syncEnabled) {
      items.push({
        description:
          "Flexible blocks stay in Schedule Builder until you add start times.",
        href: "/plan",
        id: "flexible-blocks",
        label: "Add time",
        title: `${flexibleBlocksCount} block${
          flexibleBlocksCount === 1 ? "" : "s"
        } need time before Google sync`,
      });
    }

    return items.slice(0, 4);
  }, [
    deadlineBuckets.deadlinesNeedingDates.length,
    flexibleBlocksCount,
    googleSyncStatus?.syncEnabled,
    importedConflicts.length,
    removedSyncedEventsCount,
    syncNeedsAttentionCount,
    workConflicts.length,
  ]);

  function addProject(project: Project) {
    setProjects((current) => [project, ...current]);
  }

  function toggleComplete(id: number) {
    setProjects((current) =>
      current.map((project) =>
        project.id === id
          ? { ...project, completed: !project.completed }
          : project,
      ),
    );
  }

  function updateProject(updatedProject: Project) {
    setProjects((current) =>
      current.map((project) =>
        project.id === updatedProject.id ? updatedProject : project,
      ),
    );
  }

  async function deleteProject(id: number) {
    const projectExists = projects.some((project) => project.id === id);

    if (!projectExists) {
      return;
    }

    if (supabase && user && hasLoadedRemoteData && canSyncProjects) {
      const result = await deleteProjectForUser(supabase, user.id, id);

      if (result.error) {
        const message = getSchedulerErrorMessage(result.error);
        setDataMessage(`Project was not removed from Supabase: ${message}`);
        throw new Error(message);
      }

      setDataMessage(null);
    } else {
      setDataMessage(
        "Removed locally. Supabase sync will retry when the connection is ready.",
      );
    }

    setProjects((current) => current.filter((project) => project.id !== id));
  }

  function addWeeklyPlanBlock(block: WeeklyPlanBlock) {
    setPlanBlocks((current) => [...current, block]);
  }

  async function saveWeeklyPlanBlocksNow(blocks: WeeklyPlanBlock[]) {
    if (!supabase || !user || !hasLoadedRemoteData || !canSyncWeeklyPlan) {
      setDataMessage(
        "Saved locally. Supabase sync will retry when the connection is ready.",
      );
      return;
    }

    const result = await replaceWeeklyPlanBlocksForUser(
      supabase,
      user.id,
      blocks,
    );

    if (result.error) {
      const message = getSchedulerErrorMessage(result.error);
      setDataMessage(`Weekly plan could not be saved to Supabase: ${message}`);
      throw new Error(message);
    }

    if (
      result.usedLegacyStartTimeFallback &&
      blocks.some((block) => block.startTime)
    ) {
      const message = getWeeklyPlanStartTimeMigrationMessage();
      setDataMessage(message);
      throw new Error(message);
    }

    setDataMessage(null);
  }

  async function updateWeeklyPlanBlock(updatedBlock: WeeklyPlanBlock) {
    const nextBlocks = planBlocks.map((block) =>
      block.id === updatedBlock.id ? updatedBlock : block,
    );

    await saveWeeklyPlanBlocksNow(nextBlocks);
    setPlanBlocks(nextBlocks);
  }

  async function removeWeeklyPlanBlock(id: string) {
    const blockExists = planBlocks.some((block) => block.id === id);

    if (!blockExists) {
      return;
    }

    if (supabase && user && hasLoadedRemoteData && canSyncWeeklyPlan) {
      const result = await deleteWeeklyPlanBlockForUser(supabase, user.id, id);

      if (result.error) {
        const message = getSchedulerErrorMessage(result.error);
        setDataMessage(`Weekly plan block was not removed from Supabase: ${message}`);
        throw new Error(message);
      }

      setDataMessage(null);
    } else {
      setDataMessage(
        "Removed locally. Supabase sync will retry when the connection is ready.",
      );
    }

    setPlanBlocks((current) => current.filter((block) => block.id !== id));
  }

  async function signInWithPassword(email: string, password: string) {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setAuthError(getFriendlyAuthErrorMessage(error));
      }
    } catch (error) {
      setAuthError(getFriendlyAuthErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function signUp(email: string, password: string) {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (error) {
        setAuthError(getFriendlyAuthErrorMessage(error));
        return;
      }

      if (!data.session) {
        setAuthMessage("Check your email to confirm your account, then sign in.");
      }
    } catch (error) {
      setAuthError(getFriendlyAuthErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function sendMagicLink(email: string) {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (error) {
        setAuthError(getFriendlyAuthErrorMessage(error));
        return;
      }

      setAuthMessage("Magic link sent. Open the email on this device to sign in.");
    } catch (error) {
      setAuthError(getFriendlyAuthErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function signInWithGoogle() {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage("Redirecting to Google...");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getAuthRedirectUrl(),
        },
      });

      if (!error) {
        return;
      }

      setAuthError(getFriendlyAuthErrorMessage(error));
      setAuthMessage(null);
    } catch (error) {
      setAuthError(getFriendlyAuthErrorMessage(error));
      setAuthMessage(null);
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function signOut() {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setDataMessage(null);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        setDataMessage(`Sign out failed: ${error.message}`);
      }
    } catch (error) {
      setDataMessage(`Sign out failed: ${getSchedulerErrorMessage(error)}`);
    }
  }

  async function completeOnboarding(answers: OnboardingAnswers) {
    if (!supabase || !user) {
      setOnboardingError("Sign in before saving onboarding.");
      return;
    }

    setIsOnboardingSubmitting(true);
    setOnboardingError(null);

    try {
      const result = await savePlannerProfileForUser(supabase, user.id, answers);

      if (result.error) {
        setOnboardingError(
          `Onboarding could not be saved: ${getOnboardingProfileErrorMessage(result.error)}`,
        );
        return;
      }

      setOnboardingStatus("completed");
      setIsEditingOnboardingPreferences(false);
      setPlannerProfile(
        result.data ?? {
          userId: user.id,
          ...answers,
          onboardingCompleted: true,
        },
      );
      setDataMessage(null);

      if (projects.length === 0) {
        setProjects(createStarterProjectsForPlannerType(answers.plannerType));
      }
    } catch (error) {
      setOnboardingError(
        `Onboarding could not be saved: ${getOnboardingProfileErrorMessage(error)}`,
      );
    } finally {
      setIsOnboardingSubmitting(false);
    }
  }

  async function skipOnboarding() {
    const plannerType = "General planning";
    const planningGoals = getDefaultGoalsForPlannerType(plannerType);

    await completeOnboarding({
      plannerType,
      planningGoals,
      desiredIntegrations: getRecommendedDesiredIntegrations(
        plannerType,
        planningGoals,
      ),
      scheduleIntensity: "Moderate",
    });
  }

  if (!isSupabaseConfigured()) {
    return (
      <AuthPanel
        error={authError}
        isConfigured={false}
        isSubmitting={false}
        message={authMessage}
        onSendMagicLink={sendMagicLink}
        onSignInWithGoogle={signInWithGoogle}
        onSignInWithPassword={signInWithPassword}
        onSignUp={signUp}
      />
    );
  }

  if (
    authStatus === "loading" ||
    (authStatus === "signed_in" &&
      (!hasLoadedRemoteData || onboardingStatus === "loading"))
  ) {
    return (
      <div className="px-3 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
        <div className="app-shell">
          <div className="mx-auto max-w-xl">
            <Card className="rounded-[30px] border-white/75 bg-white/90">
              <CardContent className="p-6 sm:p-7">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                  Loading
                </p>
                <h1 className="mt-3 text-2xl font-semibold text-brand-ink sm:text-3xl">
                  Preparing your synced scheduler...
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/65">
                  {dataMessage ?? "Checking your session and loading your latest schedule."}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === "signed_out") {
    return (
      <AuthPanel
        error={authError}
        isConfigured
        isSubmitting={isAuthSubmitting}
        message={authMessage}
        onSendMagicLink={sendMagicLink}
        onSignInWithGoogle={signInWithGoogle}
        onSignInWithPassword={signInWithPassword}
        onSignUp={signUp}
      />
    );
  }

  if (onboardingStatus === "required" || isEditingOnboardingPreferences) {
    return (
      <OnboardingPanel
        error={onboardingError}
        initialAnswers={plannerProfile}
        isSubmitting={isOnboardingSubmitting}
        mode={isEditingOnboardingPreferences ? "edit" : "setup"}
        onCancel={() => {
          setIsEditingOnboardingPreferences(false);
          setOnboardingError(null);
        }}
        onComplete={completeOnboarding}
        onSkip={skipOnboarding}
      />
    );
  }

  return (
    <div className="pb-28 pt-5 sm:pt-6 md:pb-10 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        {currentSection === "dashboard" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
                <div className="max-w-4xl">
                  <div className="eyebrow-chip">
                    <FolderStackIcon className="h-4 w-4" />
                    {dashboardPersona.eyebrow}
                  </div>

                  <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl lg:text-6xl">
                    {dashboardPersona.title}
                  </h1>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                    {dashboardPersona.subtitle}
                  </p>

                  <div className="mt-5 flex flex-wrap gap-2.5">
                    <Badge>{activeProjects} active projects</Badge>
                    <Badge variant="subtle">
                      {planBlocks.length} weekly blocks
                    </Badge>
                    <Badge variant="subtle">
                      {workShifts.length} unavailable blocks
                    </Badge>
                    <Badge variant="subtle">
                      {hasGoogleCalendar
                        ? googleCalendarStatus?.syncEnabled
                          ? "Google sync enabled"
                          : "Google connected"
                        : "Calendar optional"}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <Link
                    href="/calendar"
                    className="rounded-[24px] border border-brand-ink/8 bg-white/78 p-4 text-brand-ink hover:-translate-y-0.5 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                        <CalendarIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Open Calendar</p>
                        <p className="text-sm text-brand-ink/58">
                          See the week in one place.
                        </p>
                      </div>
                    </div>
                  </Link>

                  <Link
                    href="/assistant"
                    className="rounded-[24px] border border-brand-ink/8 bg-white/78 p-4 text-brand-ink hover:-translate-y-0.5 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
                        <TargetIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Ask Assistant</p>
                        <p className="text-sm text-brand-ink/58">
                          Find open time or review conflicts.
                        </p>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            </section>

            <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
                <SetupProgressCard
                  completeCount={setupCompleteCount}
                  items={setupProgressItems}
                />
                <TodayWeekCard
                  openDayCount={openDayCount}
                  openTimeSummaries={openTimeSummaries}
                  today={todaySchedule}
                  weekRangeLabel={calendarWeek.weekRangeLabel}
                  weeklyExternalEvents={weeklyExternalEvents}
                  weeklyPlanHours={weeklyPlanHours}
                  weeklyWorkHours={weeklyWorkHours}
                />
                <DashboardTopThreeCard items={dashboardTopThree} />
              </div>

              <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6">
                <SuggestedSetupCard
                  actions={suggestedDashboardActions}
                  plannerType={plannerType}
                />
                <NeedsAttentionCard items={attentionItems} />
                <QuickActionsCard plannerType={plannerType} />
                <FocusRuleCard />
              </aside>
            </section>
          </>
        ) : null}

        {currentSection === "projects" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
                <div className="max-w-3xl">
                  <div className="eyebrow-chip">
                    <FolderStackIcon className="h-4 w-4" />
                    Projects
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                    Manage your active work, next actions, and weekly project priorities.
                  </h1>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[24px] border border-white/75 bg-white/74 p-4 shadow-[0_14px_34px_rgba(18,32,47,0.06)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
                      Active
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-brand-ink">
                      {activeProjects}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-white/75 bg-white/74 p-4 shadow-[0_14px_34px_rgba(18,32,47,0.06)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
                      Completed
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-brand-ink">
                      {completedProjects}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-white/75 bg-white/74 p-4 shadow-[0_14px_34px_rgba(18,32,47,0.06)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
                      Weekly hours
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-brand-ink">
                      {totalHours}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-white/75 bg-white/74 p-4 shadow-[0_14px_34px_rgba(18,32,47,0.06)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/42">
                      High priority
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-brand-ink">
                      {highPriorityProjects}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid items-start gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="order-2 min-w-0 xl:order-1">
                <ProjectList
                  projects={projects}
                  onDeleteProject={deleteProject}
                  onToggleComplete={toggleComplete}
                  onUpdateProject={updateProject}
                />
              </div>
              <aside className="order-1 min-w-0 xl:sticky xl:top-6 xl:order-2">
                <AddProjectForm onAddProject={addProject} />
              </aside>
            </section>
          </>
        ) : null}

        {currentSection === "plan" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="max-w-3xl">
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-5xl">
                  Weekly Plan
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                  Turn project priorities into scheduled work blocks for the
                  week.
                </p>
              </div>
            </section>

            <WeeklyPlanSection
              importedEvents={importedEvents}
              onAddBlock={addWeeklyPlanBlock}
              onRemoveBlock={removeWeeklyPlanBlock}
              onSavePlanBlocks={() => saveWeeklyPlanBlocksNow(planBlocks)}
              onUpdateBlock={updateWeeklyPlanBlock}
              planBlocks={planBlocks}
              projects={projects}
              workShifts={workShifts}
            />
          </>
        ) : null}

        {currentSection === "settings" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="max-w-3xl">
                <div className="eyebrow-chip">
                  <TargetIcon className="h-4 w-4" />
                  Settings
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                  Account and sync status.
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                  Check which account is signed in and confirm your schedule is
                  syncing.
                </p>
              </div>
            </section>

            <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <AccountCard
                dataMessage={dataMessage}
                email={user?.email}
                onSignOut={() => void signOut()}
              />
              <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
                <WeeklySummaryCard
                  totalHours={totalHours}
                  activeProjects={activeProjects}
                  completedProjects={completedProjects}
                />
                <FocusRuleCard />
                <SettingsQuickLinksCard
                  onEditPreferences={() => {
                    setOnboardingError(null);
                    setIsEditingOnboardingPreferences(true);
                  }}
                />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
