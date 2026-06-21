"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
} from "@/components/projects/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  generateWeeklyPlanIcs,
  getCurrentWeekMondayInputValue,
} from "@/lib/calendar-export";
import {
  formatImportedEventSource,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import type { Project } from "@/lib/projects";
import {
  getWeeklyPlanImportedEventConflictForBlock,
  getWeeklyPlanWorkConflictForBlock,
} from "@/lib/schedule-conflicts";
import {
  createWeeklyPlanBlock,
  formatEstimatedHours,
  formatStartTime,
  normalizeStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { WorkShift } from "@/lib/work-schedule";

type WeeklyPlanSectionProps = {
  importedEvents?: ImportedCalendarEvent[];
  onAddBlock: (block: WeeklyPlanBlock) => void;
  onRemoveBlock: (id: string) => Promise<void> | void;
  onSavePlanBlocks?: () => Promise<void> | void;
  onUpdateBlock?: (block: WeeklyPlanBlock) => Promise<void> | void;
  planBlocks: WeeklyPlanBlock[];
  projects: Project[];
  workShifts?: WorkShift[];
};

type WeeklyPlanBlockMode = "project" | "task";

type WeeklyPlanDraftState = {
  day: WeekDay;
  mode: WeeklyPlanBlockMode;
  projectId: string;
  title: string;
  plannedTask: string;
  estimatedHours: string;
  startTime: string;
};

type FormTarget = "quick" | WeekDay;
type GoogleCalendarSyncStatusValue =
  | "failed"
  | "needs_attention"
  | "not_synced"
  | "synced";

type GoogleCalendarSyncStatus = {
  googleEventId?: string | null;
  googleEventHtmlLink?: string | null;
  lastSyncedAt?: string | null;
  syncStatus: Exclude<GoogleCalendarSyncStatusValue, "failed" | "not_synced">;
  syncedTitle?: string | null;
  weeklyPlanBlockId: string;
};

type GoogleCalendarSyncStatusResponse = {
  error?: string;
  removedSyncedEvents?: GoogleCalendarRemovedSyncedEvent[];
  statuses?: GoogleCalendarSyncStatus[];
  syncCalendarName?: string | null;
  syncEnabled?: boolean;
  weekStartDate?: string;
};

type GoogleCalendarRemovedSyncedEvent = {
  googleEventHtmlLink?: string | null;
  id: string;
  lastSyncedAt?: string | null;
  syncedEndsAt: string;
  syncedStartsAt: string;
  syncedTitle: string;
};

type PreSyncConflict = {
  detail: string;
  label: string;
  tone: "ready" | "warning";
};

type GoogleCalendarSyncBlockResult = {
  blockId: string;
  googleEventId?: string | null;
  googleEventHtmlLink?: string | null;
  message: string;
  status: "already_synced" | "failed" | "synced";
  syncStatus?: "needs_attention" | "synced";
  warnings?: string[];
};

type GoogleCalendarSyncBlocksResponse = {
  error?: string;
  results?: GoogleCalendarSyncBlockResult[];
  syncCalendarName?: string | null;
  weekStartDate?: string;
};

type GoogleCalendarUpdateSyncedEventResponse = {
  blockId?: string;
  error?: string;
  googleEventId?: string | null;
  googleEventHtmlLink?: string | null;
  lastSyncedAt?: string | null;
  message?: string;
  syncStatus?: "synced";
  syncedTitle?: string | null;
  weeklyPlanBlockId?: string | null;
};

type GoogleCalendarRemoveSyncedEventResponse = {
  error?: string;
  message?: string;
  syncEventId?: string;
};

type GoogleSyncMaintenanceConfirmation =
  | {
      block: WeeklyPlanBlock;
      type: "update";
    }
  | {
      event: GoogleCalendarRemovedSyncedEvent;
      type: "remove";
    };

const weeklyBlockRemovalAnimationMs = 300;

function getInitialDraft(projects: Project[]): WeeklyPlanDraftState {
  const firstProject = projects[0];

  return {
    day: "Monday",
    mode: firstProject ? "project" : "task",
    projectId: firstProject ? String(firstProject.id) : "",
    title: "",
    plannedTask: firstProject?.nextAction ?? "",
    estimatedHours: "1",
    startTime: "",
  };
}

function normalizeProjectLookupName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function findProjectByDisplayName(projects: Project[], title: string) {
  const normalizedTitle = normalizeProjectLookupName(title);

  return projects.find(
    (project) => normalizeProjectLookupName(project.name) === normalizedTitle,
  );
}

function inferBlockMode(block: WeeklyPlanBlock, projects: Project[]) {
  return findProjectByDisplayName(projects, block.projectName)
    ? "project"
    : "task";
}

function getModeLabel(mode: WeeklyPlanBlockMode) {
  return mode === "project" ? "Project work" : "Task / appointment";
}

function normalizeBlockPart(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getBlockIdentityKey({
  day,
  plannedTask,
  projectName,
}: Pick<WeeklyPlanBlock, "day" | "plannedTask" | "projectName">) {
  return [
    day,
    normalizeBlockPart(projectName),
    normalizeBlockPart(plannedTask),
  ].join(":");
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

  return "Please try again in a moment.";
}

function getGoogleSyncDisplayError(error: unknown) {
  const message = getErrorMessage(error);

  if (
    message.includes("weekly_plan_blocks.start_time") ||
    (message.includes("start_time") && message.includes("weekly_plan_blocks"))
  ) {
    return "Google Calendar sync needs one Supabase update before timed blocks can be synced. Run the weekly-plan-start-times migration, then try again.";
  }

  return message;
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateInputValue(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getWeekMondayInputValue(date: Date) {
  const monday = new Date(date);
  const offsetFromMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offsetFromMonday);
  return formatDateInputValue(monday);
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatWeekRangeFromInput(value: string) {
  const startDate = parseDateInput(value);

  if (!startDate) {
    return "Choose a Monday to set the week range.";
  }

  const monday = parseDateInput(getWeekMondayInputValue(startDate));

  if (!monday) {
    return "Choose a Monday to set the week range.";
  }

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return `${formatShortDate(monday)} - ${formatShortDate(sunday)}`;
}

function getWeekDateForDay(value: string, day: WeekDay) {
  const startDate = parseDateInput(value);

  if (!startDate) {
    return null;
  }

  const monday = parseDateInput(getWeekMondayInputValue(startDate));

  if (!monday) {
    return null;
  }

  const date = new Date(monday);
  date.setDate(monday.getDate() + weekDays.indexOf(day));
  return date;
}

function formatBlockDayDate(day: WeekDay, weekStartValue: string) {
  const date = getWeekDateForDay(weekStartValue, day);

  if (!date) {
    return day;
  }

  return `${day}, ${formatShortDate(date)}`;
}

function formatSyncedEventRange(startsAt: string, endsAt: string) {
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "Original synced time";
  }

  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateLabel = startDate.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: localTimeZone,
    weekday: "long",
  });
  const startTime = startDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: localTimeZone,
  });
  const endTime = endDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: localTimeZone,
  });

  return `${dateLabel} • ${startTime} - ${endTime}`;
}

function formatGoogleSyncDisplayTitle(title: string) {
  const trimmedTitle = title.trim();
  const prefix = "Schedule Builder:";

  if (trimmedTitle.toLowerCase().startsWith(prefix.toLowerCase())) {
    const projectTitle = trimmedTitle.slice(prefix.length).trim();
    return projectTitle || "Schedule Builder time block";
  }

  return trimmedTitle || "Schedule Builder time block";
}

function getSyncStatusLabel(status: GoogleCalendarSyncStatusValue) {
  if (status === "synced") {
    return "Synced";
  }

  if (status === "needs_attention") {
    return "Needs attention";
  }

  if (status === "failed") {
    return "Sync failed";
  }

  return "Not synced";
}

function getSyncStatusClassName(status: GoogleCalendarSyncStatusValue) {
  if (status === "synced") {
    return "bg-brand-teal/10 text-brand-teal";
  }

  if (status === "needs_attention") {
    return "bg-brand-coral/10 text-brand-coral";
  }

  if (status === "failed") {
    return "bg-brand-coral/10 text-brand-coral";
  }

  return "bg-brand-ink/[0.045] text-brand-ink/52";
}

function getBlockTimeRangeMinutes(block: WeeklyPlanBlock) {
  const startMinutes = parseStartTimeToMinutes(block.startTime);

  if (startMinutes === null) {
    return null;
  }

  return {
    end: startMinutes + block.estimatedHours * 60,
    start: startMinutes,
  };
}

function blockEndsAfterMidnight(block: WeeklyPlanBlock) {
  const range = getBlockTimeRangeMinutes(block);

  return Boolean(range && range.end > 24 * 60);
}

function weeklyPlanBlocksOverlap(
  firstBlock: WeeklyPlanBlock,
  secondBlock: WeeklyPlanBlock,
) {
  if (firstBlock.id === secondBlock.id || firstBlock.day !== secondBlock.day) {
    return false;
  }

  const firstRange = getBlockTimeRangeMinutes(firstBlock);
  const secondRange = getBlockTimeRangeMinutes(secondBlock);

  if (!firstRange || !secondRange) {
    return false;
  }

  return firstRange.start < secondRange.end && firstRange.end > secondRange.start;
}

function getExternalConflictLabel(event: ImportedCalendarEvent) {
  if (event.source === "google_calendar") {
    return "May overlap with Google Calendar event";
  }

  if (event.source === "ics") {
    return "May overlap with ICS event";
  }

  return `May overlap with ${formatImportedEventSource(event)} event`;
}

export function WeeklyPlanSection({
  importedEvents = [],
  onAddBlock,
  onRemoveBlock,
  onSavePlanBlocks,
  onUpdateBlock,
  planBlocks,
  projects,
  workShifts = [],
}: WeeklyPlanSectionProps) {
  const [draft, setDraft] = useState<WeeklyPlanDraftState>(() =>
    getInitialDraft(projects),
  );
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [activeDayForm, setActiveDayForm] = useState<WeekDay | null>(null);
  const [duplicateWarningKey, setDuplicateWarningKey] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [errorTarget, setErrorTarget] = useState<FormTarget | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [exitingBlockIds, setExitingBlockIds] = useState<
    Record<string, boolean>
  >({});
  const [exportWeekStart, setExportWeekStart] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [googleSyncEnabled, setGoogleSyncEnabled] = useState(false);
  const [googleSyncCalendarName, setGoogleSyncCalendarName] = useState<
    string | null
  >(null);
  const [googleSyncStatuses, setGoogleSyncStatuses] = useState<
    Record<string, GoogleCalendarSyncStatus>
  >({});
  const [removedGoogleSyncEvents, setRemovedGoogleSyncEvents] = useState<
    GoogleCalendarRemovedSyncedEvent[]
  >([]);
  const [googleSyncResults, setGoogleSyncResults] = useState<
    Record<string, GoogleCalendarSyncBlockResult>
  >({});
  const [googleSyncSelectedIds, setGoogleSyncSelectedIds] = useState<
    Record<string, boolean>
  >({});
  const [googleSyncError, setGoogleSyncError] = useState<string | null>(null);
  const [googleSyncMessage, setGoogleSyncMessage] = useState<string | null>(
    null,
  );
  const [isGoogleSyncLoading, setIsGoogleSyncLoading] = useState(false);
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false);
  const [isConfirmingGoogleSync, setIsConfirmingGoogleSync] = useState(false);
  const [
    googleSyncMaintenanceConfirmation,
    setGoogleSyncMaintenanceConfirmation,
  ] = useState<GoogleSyncMaintenanceConfirmation | null>(null);
  const [googleSyncMaintenanceActionId, setGoogleSyncMaintenanceActionId] =
    useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<WeeklyPlanDraftState>(() =>
    getInitialDraft(projects),
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [projectFocusMessage, setProjectFocusMessage] = useState<string | null>(
    null,
  );
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [pendingRemoveBlockId, setPendingRemoveBlockId] = useState<string | null>(
    null,
  );
  const removeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  useEffect(() => {
    setDraft((current) => {
      if (current.mode === "task") {
        return current;
      }

      const currentProjectStillExists = projects.some(
        (project) => String(project.id) === current.projectId,
      );

      if (projects.length === 0) {
        return {
          ...current,
          mode: "task",
          projectId: "",
        };
      }

      if (currentProjectStillExists) {
        return current;
      }

      const firstProject = projects[0];

      return {
        ...current,
        mode: "project",
        projectId: String(firstProject.id),
        plannedTask: current.plannedTask || firstProject.nextAction,
      };
    });
  }, [projects]);

  useEffect(() => {
    const requestedWeek = new URLSearchParams(window.location.search).get("week");
    const requestedWeekDate = requestedWeek ? parseDateInput(requestedWeek) : null;

    setExportWeekStart(
      requestedWeekDate
        ? getWeekMondayInputValue(requestedWeekDate)
        : getCurrentWeekMondayInputValue(),
    );
  }, []);

  useEffect(() => {
    if (!exportWeekStart || !isSupabaseConfigured()) {
      return;
    }

    let isActive = true;

    async function loadGoogleSyncStatuses() {
      setIsGoogleSyncLoading(true);
      setGoogleSyncError(null);

      try {
        const accessToken = await getSupabaseAccessToken();
        const response = await fetch(
          `/api/google-calendar/sync-status?week_start_date=${encodeURIComponent(
            exportWeekStart,
          )}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const payload =
          (await response.json()) as GoogleCalendarSyncStatusResponse;

        if (!isActive) {
          return;
        }

        if (!response.ok || payload.error) {
          throw new Error(
            payload.error ?? "Google Calendar sync status could not be loaded.",
          );
        }

        setGoogleSyncEnabled(Boolean(payload.syncEnabled));
        setGoogleSyncCalendarName(payload.syncCalendarName ?? "Schedule Builder");
        setRemovedGoogleSyncEvents(payload.removedSyncedEvents ?? []);
        setGoogleSyncStatuses(
          (payload.statuses ?? []).reduce<
            Record<string, GoogleCalendarSyncStatus>
          >((acc, status) => {
            acc[status.weeklyPlanBlockId] = status;
            return acc;
          }, {}),
        );
      } catch (syncStatusError) {
        if (!isActive) {
          return;
        }

        setGoogleSyncEnabled(false);
        setRemovedGoogleSyncEvents([]);
        setGoogleSyncError(getGoogleSyncDisplayError(syncStatusError));
      } finally {
        if (isActive) {
          setIsGoogleSyncLoading(false);
        }
      }
    }

    void loadGoogleSyncStatuses();

    return () => {
      isActive = false;
    };
  }, [exportWeekStart, planBlocks]);

  useEffect(() => {
    setGoogleSyncSelectedIds((current) => {
      const activeBlockIds = new Set(planBlocks.map((block) => block.id));
      const next: Record<string, boolean> = {};

      Object.entries(current).forEach(([blockId, isSelected]) => {
        if (isSelected && activeBlockIds.has(blockId)) {
          next[blockId] = true;
        }
      });

      return next;
    });
  }, [planBlocks]);

  useEffect(() => {
    return () => {
      Object.values(removeTimers.current).forEach((timerId) => {
        clearTimeout(timerId);
      });
    };
  }, []);

  useEffect(() => {
    const selectedProjectId = new URLSearchParams(window.location.search).get(
      "project",
    );

    if (!selectedProjectId) {
      setProjectFocusMessage(null);
      return;
    }

    const selectedProject = projects.find(
      (project) => String(project.id) === selectedProjectId,
    );

    if (!selectedProject) {
      setProjectFocusMessage(
        "That project is no longer available. Choose another project below.",
      );
      return;
    }

    setDraft((current) => ({
      ...current,
      mode: "project",
      projectId: String(selectedProject.id),
      plannedTask: selectedProject.nextAction,
    }));
    setIsAddFormOpen(true);
    setActiveDayForm(null);
    setProjectFocusMessage(
      `${selectedProject.name} is selected. Choose a day and time estimate, then add it to your weekly plan.`,
    );
    setError(null);
  }, [projects]);

  async function getSupabaseAccessToken() {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured yet.");
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const accessToken = data.session?.access_token;

    if (!accessToken) {
      throw new Error("Sign in before syncing time blocks.");
    }

    return accessToken;
  }

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === draft.projectId),
    [draft.projectId, projects],
  );
  const draftBlockTitle =
    draft.mode === "project" ? selectedProject?.name.trim() ?? "" : draft.title.trim();

  const totalPlannedHours = useMemo(() => {
    return planBlocks.reduce((sum, block) => sum + block.estimatedHours, 0);
  }, [planBlocks]);

  const filledDays = useMemo(() => {
    return weekDays.filter((day) =>
      planBlocks.some((block) => block.day === day),
    ).length;
  }, [planBlocks]);

  const blocksByDay = useMemo(() => {
    return weekDays.reduce<Record<WeekDay, WeeklyPlanBlock[]>>((acc, day) => {
      acc[day] = planBlocks
        .map((block, index) => ({
          block,
          index,
          startMinutes: parseStartTimeToMinutes(block.startTime),
        }))
        .filter(({ block }) => block.day === day)
        .sort((first, second) => {
          if (first.startMinutes !== null && second.startMinutes !== null) {
            return (
              first.startMinutes - second.startMinutes ||
              first.index - second.index
            );
          }

          if (first.startMinutes !== null) {
            return -1;
          }

          if (second.startMinutes !== null) {
            return 1;
          }

          return first.index - second.index;
        })
        .map(({ block }) => block);
      return acc;
    }, {} as Record<WeekDay, WeeklyPlanBlock[]>);
  }, [planBlocks]);

  const duplicateCountsByBlockId = useMemo(() => {
    const countsByKey = new Map<string, number>();

    planBlocks.forEach((block) => {
      const blockKey = getBlockIdentityKey(block);
      countsByKey.set(blockKey, (countsByKey.get(blockKey) ?? 0) + 1);
    });

    return planBlocks.reduce<Record<string, number>>((acc, block) => {
      acc[block.id] = countsByKey.get(getBlockIdentityKey(block)) ?? 1;
      return acc;
    }, {});
  }, [planBlocks]);

  const draftDuplicateKey =
    draftBlockTitle && draft.plannedTask.trim()
      ? getBlockIdentityKey({
          day: draft.day,
          plannedTask: draft.plannedTask,
          projectName: draftBlockTitle,
        })
      : null;
  const hasDuplicateDraft = Boolean(
    draftDuplicateKey &&
      planBlocks.some(
        (block) => getBlockIdentityKey(block) === draftDuplicateKey,
      ),
  );
  const isConfirmingDuplicate = Boolean(
    draftDuplicateKey &&
      hasDuplicateDraft &&
      duplicateWarningKey === draftDuplicateKey,
  );
  const hasValidDraftStartTime =
    !draft.startTime.trim() || parseStartTimeToMinutes(draft.startTime) !== null;
  const canAddBlock =
    draftBlockTitle.length > 0 &&
    draft.plannedTask.trim().length > 0 &&
    Number(draft.estimatedHours) > 0 &&
    hasValidDraftStartTime;
  const selectedGoogleSyncIds = useMemo(
    () =>
      Object.entries(googleSyncSelectedIds)
        .filter(([, isSelected]) => isSelected)
        .map(([blockId]) => blockId),
    [googleSyncSelectedIds],
  );
  const selectedGoogleSyncBlocks = useMemo(
    () =>
      selectedGoogleSyncIds
        .map((blockId) => planBlocks.find((block) => block.id === blockId))
        .filter((block): block is WeeklyPlanBlock => Boolean(block)),
    [planBlocks, selectedGoogleSyncIds],
  );
  const syncWeekStartDate = useMemo(
    () => (exportWeekStart ? parseDateInput(exportWeekStart) : null),
    [exportWeekStart],
  );
  const selectedWeekRangeLabel = useMemo(
    () => formatWeekRangeFromInput(exportWeekStart),
    [exportWeekStart],
  );
  const readySyncBlocks = useMemo(
    () =>
      planBlocks.filter(
        (block) =>
          parseStartTimeToMinutes(block.startTime) !== null &&
          !["needs_attention", "synced"].includes(
            getBlockGoogleSyncStatus(block),
          ),
      ),
    [googleSyncResults, googleSyncStatuses, planBlocks],
  );
  const alreadySyncedSyncBlocks = useMemo(
    () =>
      planBlocks.filter(
        (block) => getBlockGoogleSyncStatus(block) === "synced",
      ),
    [googleSyncResults, googleSyncStatuses, planBlocks],
  );
  const needsAttentionSyncBlocks = useMemo(
    () =>
      planBlocks.filter(
        (block) => getBlockGoogleSyncStatus(block) === "needs_attention",
      ),
    [googleSyncResults, googleSyncStatuses, planBlocks],
  );
  const flexibleSyncBlocks = useMemo(
    () =>
      planBlocks.filter(
        (block) =>
          parseStartTimeToMinutes(block.startTime) === null &&
          !["needs_attention", "synced"].includes(
            getBlockGoogleSyncStatus(block),
          ),
      ),
    [googleSyncResults, googleSyncStatuses, planBlocks],
  );
  const readySyncBlockIds = useMemo(
    () => new Set(readySyncBlocks.map((block) => block.id)),
    [readySyncBlocks],
  );
  const canSyncSelectedBlocks =
    googleSyncEnabled &&
    readySyncBlocks.length > 0 &&
    selectedGoogleSyncIds.length > 0 &&
    !isGoogleSyncing;
  const selectedGoogleSyncConflictCount = useMemo(
    () =>
      selectedGoogleSyncBlocks.reduce(
        (count, block) => count + getBlockPreSyncConflicts(block).length,
        0,
      ),
    [
      selectedGoogleSyncBlocks,
      googleSyncStatuses,
      importedEvents,
      planBlocks,
      syncWeekStartDate,
      workShifts,
    ],
  );

  useEffect(() => {
    setGoogleSyncSelectedIds((current) => {
      const next: Record<string, boolean> = {};

      Object.entries(current).forEach(([blockId, isSelected]) => {
        if (isSelected && readySyncBlockIds.has(blockId)) {
          next[blockId] = true;
        }
      });

      return next;
    });
  }, [readySyncBlockIds]);

  function clearDraftWarnings() {
    setDuplicateWarningKey(null);
    setConflictWarning(null);

    if (error) {
      setError(null);
      setErrorTarget(null);
    }
  }

  function showFormError(target: FormTarget, message: string) {
    setError(message);
    setErrorTarget(target);
  }

  function getBlockGoogleSyncStatus(
    block: WeeklyPlanBlock,
  ): GoogleCalendarSyncStatusValue {
    const result = googleSyncResults[block.id];

    if (result?.status === "failed" && !isStaleStartTimeSyncFailure(block)) {
      return "failed" satisfies GoogleCalendarSyncStatusValue;
    }

    return (
      googleSyncStatuses[block.id]?.syncStatus ??
      ("not_synced" satisfies GoogleCalendarSyncStatusValue)
    );
  }

  function getBlockGoogleSyncMessage(block: WeeklyPlanBlock) {
    const result = googleSyncResults[block.id];

    if (result?.message && !isStaleStartTimeSyncFailure(block)) {
      return result.message;
    }

    const status = googleSyncStatuses[block.id];

    if (status?.syncStatus === "needs_attention") {
      return "This block changed after syncing. Google Calendar still has the older version.";
    }

    if (status?.syncStatus === "synced") {
      return "Already synced for this week.";
    }

    return null;
  }

  function getBlockGoogleEventLink(block: WeeklyPlanBlock) {
    return (
      googleSyncStatuses[block.id]?.googleEventHtmlLink ??
      googleSyncResults[block.id]?.googleEventHtmlLink ??
      null
    );
  }

  function isStaleStartTimeSyncFailure(block: WeeklyPlanBlock) {
    const result = googleSyncResults[block.id];

    return (
      result?.status === "failed" &&
      parseStartTimeToMinutes(block.startTime) !== null &&
      /start time/i.test(result.message)
    );
  }

  function getImportedEventsForConflictReview(block: WeeklyPlanBlock) {
    const syncedGoogleEventId = googleSyncStatuses[block.id]?.googleEventId;

    return importedEvents.filter(
      (event) =>
        !(
          event.source === "google_calendar" &&
          syncedGoogleEventId &&
          event.externalUid === syncedGoogleEventId
        ),
    );
  }

  function getOverlappingWeeklyPlanBlock(block: WeeklyPlanBlock) {
    return planBlocks.find((candidate) =>
      weeklyPlanBlocksOverlap(block, candidate),
    );
  }

  function getBlockPreSyncConflicts(block: WeeklyPlanBlock): PreSyncConflict[] {
    if (!syncWeekStartDate) {
      return [] as PreSyncConflict[];
    }

    const workConflict = getWeeklyPlanWorkConflictForBlock(block, workShifts);
    const importedConflict = getWeeklyPlanImportedEventConflictForBlock(
      block,
      getImportedEventsForConflictReview(block),
      syncWeekStartDate,
    );
    const planConflict = getOverlappingWeeklyPlanBlock(block);
    const conflicts: Array<PreSyncConflict | null> = [
      workConflict
        ? {
            detail: workConflict.shiftRangeLabel,
            label: "May overlap with work shift",
            tone: "warning",
          }
        : null,
      importedConflict
        ? {
            detail: importedConflict.event.title,
            label: getExternalConflictLabel(importedConflict.event),
            tone: "warning",
          }
        : null,
      planConflict
        ? {
            detail: planConflict.projectName,
            label: "May overlap with another time block",
            tone: "warning",
          }
        : null,
      blockEndsAfterMidnight(block)
        ? {
            detail: "Review the date in Google Calendar after syncing.",
            label: "This block ends after midnight.",
            tone: "warning",
          }
        : null,
    ];

    return conflicts.filter(
      (conflict): conflict is PreSyncConflict => conflict !== null,
    );
  }

  function toggleGoogleSyncSelection(block: WeeklyPlanBlock) {
    setGoogleSyncError(null);
    setGoogleSyncMessage(null);
    setIsConfirmingGoogleSync(false);
    setGoogleSyncSelectedIds((current) => ({
      ...current,
      [block.id]: !current[block.id],
    }));
  }

  function handleWeekStartChange(value: string) {
    const parsedDate = parseDateInput(value);

    setExportWeekStart(parsedDate ? getWeekMondayInputValue(parsedDate) : value);
    setExportError(null);
    setExportMessage(null);
    setGoogleSyncError(null);
    setGoogleSyncMessage(null);
    setGoogleSyncResults({});
    setGoogleSyncSelectedIds({});
    setIsConfirmingGoogleSync(false);
    setGoogleSyncMaintenanceConfirmation(null);
    setGoogleSyncMaintenanceActionId(null);
  }

  function getProjectForDraft(projectId: string) {
    return projects.find((project) => String(project.id) === projectId);
  }

  function getDraftTitleForSave(draftState: WeeklyPlanDraftState) {
    if (draftState.mode === "project") {
      return getProjectForDraft(draftState.projectId)?.name.trim() ?? "";
    }

    return draftState.title.trim();
  }

  function createDraftFromBlock(block: WeeklyPlanBlock): WeeklyPlanDraftState {
    const matchedProject = findProjectByDisplayName(projects, block.projectName);

    return {
      day: block.day,
      estimatedHours: String(block.estimatedHours),
      mode: matchedProject ? "project" : "task",
      plannedTask: block.plannedTask,
      projectId:
        matchedProject != null
          ? String(matchedProject.id)
          : projects[0]
            ? String(projects[0].id)
            : "",
      startTime: normalizeStartTime(block.startTime ?? "") ?? "",
      title: matchedProject ? "" : block.projectName,
    };
  }

  function applyModeToDraft(
    draftState: WeeklyPlanDraftState,
    mode: WeeklyPlanBlockMode,
  ): WeeklyPlanDraftState {
    if (mode === "project") {
      const project =
        getProjectForDraft(draftState.projectId) ?? projects[0] ?? null;

      return {
        ...draftState,
        mode,
        projectId: project ? String(project.id) : "",
        plannedTask: draftState.plannedTask || project?.nextAction || "",
      };
    }

    const currentProject = getProjectForDraft(draftState.projectId);

    return {
      ...draftState,
      mode,
      title: draftState.title || currentProject?.name || "",
    };
  }

  function buildBlockFromDraft(
    draftState: WeeklyPlanDraftState,
    existingId?: string,
  ) {
    const title = getDraftTitleForSave(draftState);
    const block = createWeeklyPlanBlock({
      day: draftState.day,
      estimatedHours: draftState.estimatedHours,
      plannedTask: draftState.plannedTask,
      projectName: title,
      startTime: draftState.startTime,
    });

    return block && existingId ? { ...block, id: existingId } : block;
  }

  function didGoogleSyncFieldsChange(
    previousBlock: WeeklyPlanBlock,
    nextBlock: WeeklyPlanBlock,
  ) {
    return (
      previousBlock.projectName.trim() !== nextBlock.projectName.trim() ||
      previousBlock.plannedTask.trim() !== nextBlock.plannedTask.trim() ||
      previousBlock.day !== nextBlock.day ||
      (normalizeStartTime(previousBlock.startTime ?? "") ?? "") !==
        (normalizeStartTime(nextBlock.startTime ?? "") ?? "") ||
      previousBlock.estimatedHours !== nextBlock.estimatedHours
    );
  }

  function markSyncedBlockNeedsAttention(blockId: string) {
    setGoogleSyncStatuses((current) => ({
      ...current,
      ...(current[blockId]
        ? {
            [blockId]: {
              ...current[blockId],
              syncStatus: "needs_attention" as const,
            },
          }
        : {}),
    }));
    setGoogleSyncSelectedIds((current) => {
      const next = { ...current };
      delete next[blockId];
      return next;
    });
  }

  function startEditingBlock(block: WeeklyPlanBlock) {
    setEditingBlockId(block.id);
    setEditDraft(createDraftFromBlock(block));
    setEditError(null);
    setGoogleSyncError(null);
    setGoogleSyncMessage(null);
    setIsConfirmingGoogleSync(false);
  }

  function cancelEditingBlock() {
    setEditingBlockId(null);
    setEditDraft(getInitialDraft(projects));
    setEditError(null);
  }

  async function saveEditedBlock(block: WeeklyPlanBlock) {
    if (!onUpdateBlock) {
      setEditError("Block editing is unavailable right now.");
      return;
    }

    const nextBlock = buildBlockFromDraft(editDraft, block.id);

    if (!nextBlock) {
      setEditError("Add a title, details, and a positive time estimate before saving.");
      return;
    }

    const nextBlockKey = getBlockIdentityKey(nextBlock);

    if (
      planBlocks.some(
        (candidate) =>
          candidate.id !== block.id &&
          getBlockIdentityKey(candidate) === nextBlockKey,
      )
    ) {
      setEditError(
        "That day already has this title and task. Update the existing block or make this one a little different.",
      );
      return;
    }

    const existingSyncStatus = googleSyncStatuses[block.id]?.syncStatus;
    const changedSyncedBlock =
      existingSyncStatus === "synced" &&
      didGoogleSyncFieldsChange(block, nextBlock);

    setIsSavingEdit(true);
    setEditError(null);

    try {
      await Promise.resolve(onUpdateBlock(nextBlock));
      setGoogleSyncResults((current) => {
        const next = { ...current };
        delete next[block.id];
        return next;
      });

      if (changedSyncedBlock) {
        markSyncedBlockNeedsAttention(block.id);
        setGoogleSyncMessage(
          `${nextBlock.projectName} changed after syncing. Google Calendar still has the older version.`,
        );
      } else if (
        parseStartTimeToMinutes(block.startTime) === null &&
        parseStartTimeToMinutes(nextBlock.startTime) !== null
      ) {
        setGoogleSyncSelectedIds((current) => ({
          ...current,
          [block.id]: true,
        }));
        setGoogleSyncMessage(
          `${nextBlock.projectName} now has a start time and can be selected for Google Calendar sync.`,
        );
      }

      setIsConfirmingGoogleSync(false);
      cancelEditingBlock();
    } catch (updateError) {
      setEditError(`Block could not be saved: ${getErrorMessage(updateError)}`);
    } finally {
      setIsSavingEdit(false);
    }
  }

  function openQuickAddForm() {
    setIsAddFormOpen((current) => !current);
    setActiveDayForm(null);
    clearDraftWarnings();
  }

  function openDayForm(day: WeekDay) {
    const shouldCloseForm = activeDayForm === day;

    setIsAddFormOpen(false);
    setActiveDayForm(shouldCloseForm ? null : day);

    if (!shouldCloseForm) {
      setDraft((draftState) => {
        const draftProject =
          getProjectForDraft(draftState.projectId) ?? projects[0] ?? null;

        return {
          ...draftState,
          day,
          projectId: draftProject ? String(draftProject.id) : "",
          plannedTask:
            draftState.plannedTask.trim() ||
            (draftState.mode === "project" ? draftProject?.nextAction : "") ||
            "",
        };
      });
      clearDraftWarnings();
    }
  }

  function handleProjectChange(projectId: string) {
    const nextProject = projects.find(
      (project) => String(project.id) === projectId,
    );

    setDraft((current) => ({
      ...current,
      projectId,
      plannedTask: nextProject?.nextAction ?? "",
    }));
    setProjectFocusMessage(null);
    clearDraftWarnings();
  }

  function handleDraftModeChange(mode: WeeklyPlanBlockMode) {
    setDraft((current) => {
      if (mode === "task") {
        return {
          ...current,
          mode,
          plannedTask: "",
          title: "",
        };
      }

      const project = getProjectForDraft(current.projectId) ?? projects[0] ?? null;

      return {
        ...current,
        mode,
        projectId: project ? String(project.id) : "",
        plannedTask: project?.nextAction ?? "",
        title: "",
      };
    });
    setProjectFocusMessage(null);
    clearDraftWarnings();
  }

  function handleEditModeChange(mode: WeeklyPlanBlockMode) {
    setEditDraft((current) => applyModeToDraft(current, mode));
    setEditError(null);
  }

  function handleEditProjectChange(projectId: string) {
    const nextProject = projects.find(
      (project) => String(project.id) === projectId,
    );

    setEditDraft((current) => ({
      ...current,
      projectId,
      plannedTask: nextProject?.nextAction ?? current.plannedTask,
    }));
    setEditError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>, target: FormTarget) {
    event.preventDefault();

    if (draft.mode === "project" && !selectedProject) {
      showFormError(
        target,
        "Choose a project, or switch this block to Task / appointment.",
      );
      return;
    }

    if (!hasValidDraftStartTime) {
      showFormError(
        target,
        "Choose a valid start time or leave the start time blank.",
      );
      return;
    }

    const planBlock = createWeeklyPlanBlock({
      day: draft.day,
      projectName: draftBlockTitle,
      plannedTask: draft.plannedTask,
      estimatedHours: draft.estimatedHours,
      startTime: draft.startTime,
    });

    if (!planBlock) {
      showFormError(
        target,
        "Add a task and a positive time estimate before saving.",
      );
      return;
    }

    const nextBlockKey = getBlockIdentityKey(planBlock);

    if (
      planBlocks.some((block) => getBlockIdentityKey(block) === nextBlockKey) &&
      duplicateWarningKey !== nextBlockKey
    ) {
      setDuplicateWarningKey(nextBlockKey);
      showFormError(
        target,
        "That day already has this title and task. Edit the existing block, or click Add anyway if you really want another copy.",
      );
      return;
    }

    const workConflict = getWeeklyPlanWorkConflictForBlock(planBlock, workShifts);
    const importedConflict = getWeeklyPlanImportedEventConflictForBlock(
      planBlock,
      importedEvents,
    );

    onAddBlock(planBlock);
    setDraft((current) => ({
      ...current,
      plannedTask:
        current.mode === "project"
          ? selectedProject?.nextAction ?? ""
          : "",
      estimatedHours: "1",
      startTime: "",
      title: current.mode === "project" ? current.title : "",
    }));
    if (target === "quick") {
      setIsAddFormOpen(false);
    } else {
      setActiveDayForm(null);
    }
    setDuplicateWarningKey(null);
    setError(null);
    setErrorTarget(null);
    const conflictMessages = [
      workConflict ? "This time may overlap with a saved work shift." : null,
      importedConflict ? "This time may overlap with an imported event." : null,
    ].filter((message): message is string => Boolean(message));

    setConflictWarning(
      conflictMessages.length > 0 ? conflictMessages.join(" ") : null,
    );
  }

  function handleCalendarExport() {
    setExportError(null);
    setExportMessage(null);

    if (planBlocks.length === 0) {
      setExportError("Add at least one time block before exporting.");
      return;
    }

    const result = generateWeeklyPlanIcs(planBlocks, exportWeekStart, projects);

    if (result.exportedCount === 0) {
      setExportError(
        result.warnings[0] ?? "No valid time blocks were available to export.",
      );
      return;
    }

    const blob = new Blob([result.content], {
      type: "text/calendar;charset=utf-8",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "schedule-builder-weekly-plan.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    const warningText =
      result.warnings.length > 0
        ? ` ${result.warnings.join(" ")}`
        : result.skippedCount > 0
          ? ` ${result.skippedCount} block${result.skippedCount === 1 ? "" : "s"} skipped.`
          : "";

    setExportMessage(
      `Exported ${result.exportedCount} calendar event${result.exportedCount === 1 ? "" : "s"}.${warningText}`,
    );
  }

  async function syncSelectedBlocksToGoogleCalendar(confirmed = false) {
    setGoogleSyncError(null);
    setGoogleSyncMessage(null);
    setGoogleSyncResults({});

    if (selectedGoogleSyncIds.length === 0) {
      setGoogleSyncError("Choose at least one timed block before syncing.");
      return;
    }

    if (!exportWeekStart) {
      setGoogleSyncError("Choose the Monday for the week you want to sync.");
      return;
    }

    if (!confirmed) {
      setIsConfirmingGoogleSync(true);
      setGoogleSyncMessage(null);
      setGoogleSyncError(null);
      return;
    }

    setIsGoogleSyncing(true);

    try {
      if (onSavePlanBlocks) {
        await Promise.resolve(onSavePlanBlocks());
      }

      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/google-calendar/sync-blocks", {
        body: JSON.stringify({
          blockIds: selectedGoogleSyncIds,
          weekStartDate: exportWeekStart,
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as GoogleCalendarSyncBlocksResponse;

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Time blocks could not be synced.");
      }

      const results = payload.results ?? [];
      const resultsByBlockId = results.reduce<
        Record<string, GoogleCalendarSyncBlockResult>
      >((acc, result) => {
        acc[result.blockId] = result;
        return acc;
      }, {});
      const succeeded = results.filter(
        (result) => result.status === "synced",
      ).length;
      const alreadySynced = results.filter(
        (result) => result.status === "already_synced",
      ).length;
      const failedResults = results.filter(
        (result) => result.status === "failed",
      );
      const failed = failedResults.length;

      setGoogleSyncResults(resultsByBlockId);
      setGoogleSyncStatuses((current) => {
        const next = { ...current };

        results.forEach((result) => {
          if (result.syncStatus === "synced" || result.syncStatus === "needs_attention") {
            next[result.blockId] = {
            googleEventHtmlLink: result.googleEventHtmlLink,
            googleEventId: result.googleEventId,
            lastSyncedAt: new Date().toISOString(),
              syncStatus: result.syncStatus,
              weeklyPlanBlockId: result.blockId,
            };
          }
        });

        return next;
      });
      setGoogleSyncSelectedIds((current) => {
        const next = { ...current };

        results.forEach((result) => {
          if (result.status === "synced" || result.status === "already_synced") {
            delete next[result.blockId];
          }

          if (result.status === "failed") {
            next[result.blockId] = true;
          }
        });

        return next;
      });
      setIsConfirmingGoogleSync(false);
      setGoogleSyncCalendarName(payload.syncCalendarName ?? googleSyncCalendarName);

      if (failed > 0) {
        const firstFailureMessage = failedResults[0]?.message;

        setGoogleSyncError(
          `${failed} block${failed === 1 ? "" : "s"} could not be synced.${
            firstFailureMessage ? ` ${firstFailureMessage}` : " Review the block messages below."
          }`,
        );
      }

      if (succeeded > 0 || alreadySynced > 0) {
        setGoogleSyncMessage(
          `${succeeded} block${succeeded === 1 ? "" : "s"} synced${
            alreadySynced > 0
              ? `, ${alreadySynced} already synced for this week`
              : ""
          }.`,
        );
      }
    } catch (syncError) {
      setIsConfirmingGoogleSync(false);
      setGoogleSyncError(getGoogleSyncDisplayError(syncError));
    } finally {
      setIsGoogleSyncing(false);
    }
  }

  function requestUpdateSyncedGoogleEvent(block: WeeklyPlanBlock) {
    setGoogleSyncError(null);
    setGoogleSyncMessage(null);
    setIsConfirmingGoogleSync(false);
    setGoogleSyncMaintenanceConfirmation({ block, type: "update" });
  }

  function requestRemoveSyncedGoogleEvent(event: GoogleCalendarRemovedSyncedEvent) {
    setGoogleSyncError(null);
    setGoogleSyncMessage(null);
    setIsConfirmingGoogleSync(false);
    setGoogleSyncMaintenanceConfirmation({ event, type: "remove" });
  }

  async function confirmGoogleSyncMaintenanceAction() {
    if (!googleSyncMaintenanceConfirmation) {
      return;
    }

    setGoogleSyncError(null);
    setGoogleSyncMessage(null);

    if (googleSyncMaintenanceConfirmation.type === "update") {
      const { block } = googleSyncMaintenanceConfirmation;
      setGoogleSyncMaintenanceActionId(`update:${block.id}`);

      try {
        if (onSavePlanBlocks) {
          await Promise.resolve(onSavePlanBlocks());
        }

        const accessToken = await getSupabaseAccessToken();
        const response = await fetch(
          "/api/google-calendar/update-synced-event",
          {
            body: JSON.stringify({
              blockId: block.id,
              weekStartDate: exportWeekStart,
            }),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          },
        );
        const payload =
          (await response.json()) as GoogleCalendarUpdateSyncedEventResponse;

        if (!response.ok || payload.error) {
          throw new Error(
            payload.error ?? "Google Calendar event could not be updated.",
          );
        }

        setGoogleSyncStatuses((current) => ({
          ...current,
          [block.id]: {
            googleEventId:
              payload.googleEventId ?? current[block.id]?.googleEventId,
            googleEventHtmlLink:
              payload.googleEventHtmlLink ??
              current[block.id]?.googleEventHtmlLink ??
              null,
            lastSyncedAt: payload.lastSyncedAt ?? new Date().toISOString(),
            syncStatus: "synced",
            syncedTitle: payload.syncedTitle ?? current[block.id]?.syncedTitle,
            weeklyPlanBlockId: block.id,
          },
        }));
        setGoogleSyncResults((current) => {
          const next = { ...current };
          delete next[block.id];
          return next;
        });
        setGoogleSyncMessage(
          payload.message ?? "Google Calendar event updated.",
        );
        setGoogleSyncMaintenanceConfirmation(null);
      } catch (maintenanceError) {
        setGoogleSyncError(getGoogleSyncDisplayError(maintenanceError));
      } finally {
        setGoogleSyncMaintenanceActionId(null);
      }

      return;
    }

    const { event } = googleSyncMaintenanceConfirmation;
    setGoogleSyncMaintenanceActionId(`remove:${event.id}`);

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/google-calendar/remove-synced-event", {
        body: JSON.stringify({
          syncEventId: event.id,
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload =
        (await response.json()) as GoogleCalendarRemoveSyncedEventResponse;

      if (!response.ok || payload.error) {
        throw new Error(
          payload.error ?? "Google Calendar event could not be removed.",
        );
      }

      setRemovedGoogleSyncEvents((current) =>
        current.filter((removedEvent) => removedEvent.id !== event.id),
      );
      setGoogleSyncMessage(
        payload.message ?? "Google Calendar event removed.",
      );
      setGoogleSyncMaintenanceConfirmation(null);
    } catch (maintenanceError) {
      setGoogleSyncError(getGoogleSyncDisplayError(maintenanceError));
    } finally {
      setGoogleSyncMaintenanceActionId(null);
    }
  }

  function requestRemoveBlock(blockId: string) {
    if (exitingBlockIds[blockId]) {
      return;
    }

    setPendingRemoveBlockId(blockId);
  }

  function removeBlockWithAnimation(blockId: string) {
    if (exitingBlockIds[blockId]) {
      return;
    }

    setPendingRemoveBlockId(null);
    setRemoveErrors((current) => {
      const next = { ...current };
      delete next[blockId];
      return next;
    });
    setExitingBlockIds((current) => ({ ...current, [blockId]: true }));

    removeTimers.current[blockId] = setTimeout(() => {
      void Promise.resolve(onRemoveBlock(blockId))
        .then(() => {
          setExitingBlockIds((current) => {
            const next = { ...current };
            delete next[blockId];
            return next;
          });
        })
        .catch((removeError: unknown) => {
          setExitingBlockIds((current) => {
            const next = { ...current };
            delete next[blockId];
            return next;
          });
          setRemoveErrors((current) => ({
            ...current,
            [blockId]: `Block could not be removed: ${getErrorMessage(removeError)}`,
          }));
        })
        .finally(() => {
          delete removeTimers.current[blockId];
        });
    }, weeklyBlockRemovalAnimationMs);
  }

  function renderStartTimeControl(block: WeeklyPlanBlock, helperText: string) {
    return (
      <div className="mt-3 rounded-2xl border border-brand-ink/8 bg-white/70 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold leading-5 text-brand-ink/48">
            {helperText}
          </p>
          <Button
            className="shrink-0"
            size="sm"
            type="button"
            variant="outline"
            onClick={() => startEditingBlock(block)}
          >
            Add time
          </Button>
        </div>
      </div>
    );
  }

  function renderModeToggle({
    fieldSuffix,
    mode,
    onChange,
  }: {
    fieldSuffix: string;
    mode: WeeklyPlanBlockMode;
    onChange: (mode: WeeklyPlanBlockMode) => void;
  }) {
    return (
      <div>
        <p className="field-label" id={`plan-mode-${fieldSuffix}`}>
          Block type
        </p>
        <div
          aria-labelledby={`plan-mode-${fieldSuffix}`}
          className="grid rounded-2xl bg-brand-ink/[0.045] p-1 sm:grid-cols-2"
          role="group"
        >
          {(["project", "task"] as const).map((option) => (
            <button
              key={option}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-semibold transition",
                mode === option
                  ? "bg-white text-brand-ink shadow-sm"
                  : "text-brand-ink/52 hover:text-brand-ink",
              )}
              type="button"
              onClick={() => onChange(option)}
            >
              {getModeLabel(option)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderEditBlockForm(block: WeeklyPlanBlock) {
    const fieldSuffix = `edit-${block.id}`;

    return (
      <form
        className="mt-4 rounded-[22px] border border-brand-teal/14 bg-white/72 p-3 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void saveEditedBlock(block);
        }}
      >
        <div className="grid gap-3 lg:grid-cols-[150px_minmax(0,1fr)_150px]">
          <div className="lg:col-span-3">
            {renderModeToggle({
              fieldSuffix,
              mode: editDraft.mode,
              onChange: handleEditModeChange,
            })}
          </div>

          <div>
            <label className="field-label" htmlFor={`plan-day-${fieldSuffix}`}>
              Day
            </label>
            <Select
              id={`plan-day-${fieldSuffix}`}
              value={editDraft.day}
              onChange={(event) => {
                setEditDraft((current) => ({
                  ...current,
                  day: event.target.value as WeekDay,
                }));
                setEditError(null);
              }}
            >
              {weekDays.map((weekDay) => (
                <option key={weekDay} value={weekDay}>
                  {weekDay}
                </option>
              ))}
            </Select>
          </div>

          {editDraft.mode === "project" ? (
            <div className="lg:col-span-2">
              <label
                className="field-label"
                htmlFor={`plan-project-${fieldSuffix}`}
              >
                Project
              </label>
              <Select
                id={`plan-project-${fieldSuffix}`}
                value={editDraft.projectId}
                onChange={(event) => handleEditProjectChange(event.target.value)}
                disabled={projects.length === 0}
              >
                {projects.length > 0 ? (
                  projects.map((project) => (
                    <option key={project.id} value={String(project.id)}>
                      {project.name}
                      {project.completed ? " (done)" : ""}
                    </option>
                  ))
                ) : (
                  <option value="">No projects yet</option>
                )}
              </Select>
            </div>
          ) : (
            <div className="lg:col-span-2">
              <label className="field-label" htmlFor={`plan-title-${fieldSuffix}`}>
                Title
              </label>
              <Input
                id={`plan-title-${fieldSuffix}`}
                placeholder="Mom's appointment"
                value={editDraft.title}
                onChange={(event) => {
                  setEditDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }));
                  setEditError(null);
                }}
              />
            </div>
          )}

          <div className="lg:col-span-3">
            <label className="field-label" htmlFor={`plan-task-${fieldSuffix}`}>
              {editDraft.mode === "project" ? "Planned task" : "Details"}
            </label>
            <Input
              id={`plan-task-${fieldSuffix}`}
              placeholder={
                editDraft.mode === "project"
                  ? "Draft the next deliverable"
                  : "Take mom to appointment"
              }
              value={editDraft.plannedTask}
              onChange={(event) => {
                setEditDraft((current) => ({
                  ...current,
                  plannedTask: event.target.value,
                }));
                setEditError(null);
              }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor={`plan-start-${fieldSuffix}`}>
              Start
              <span className="font-normal text-brand-ink/45"> optional</span>
            </label>
            <Input
              id={`plan-start-${fieldSuffix}`}
              type="time"
              value={editDraft.startTime}
              onChange={(event) => {
                setEditDraft((current) => ({
                  ...current,
                  startTime: event.target.value,
                }));
                setEditError(null);
              }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor={`plan-hours-${fieldSuffix}`}>
              Duration
            </label>
            <Input
              id={`plan-hours-${fieldSuffix}`}
              type="number"
              min="0.5"
              step="0.5"
              inputMode="decimal"
              placeholder="1"
              value={editDraft.estimatedHours}
              onChange={(event) => {
                setEditDraft((current) => ({
                  ...current,
                  estimatedHours: event.target.value,
                }));
                setEditError(null);
              }}
            />
          </div>

          <div className="flex items-end gap-2">
            <Button
              className="w-full"
              disabled={isSavingEdit}
              size="sm"
              type="button"
              variant="outline"
              onClick={cancelEditingBlock}
            >
              Cancel
            </Button>
            <Button
              className="w-full"
              disabled={isSavingEdit}
              size="sm"
              type="submit"
            >
              {isSavingEdit ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {editError ? (
          <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
            {editError}
          </p>
        ) : null}
      </form>
    );
  }

  function renderPlanBlock(
    block: WeeklyPlanBlock,
    day: WeekDay,
    index: number,
    isTimed: boolean,
    duplicateCount: number,
  ) {
    const timeLabel = isTimed ? formatStartTime(block.startTime) : "Anytime";
    const googleSyncStatus = getBlockGoogleSyncStatus(block);
    const workConflict = getWeeklyPlanWorkConflictForBlock(block, workShifts);
    const importedConflict = getWeeklyPlanImportedEventConflictForBlock(
      block,
      importedEvents,
    );
    const blockMode = inferBlockMode(block, projects);
    const isEditingThisBlock = editingBlockId === block.id;

    return (
      <div
        key={block.id}
        className="weekly-block-shell"
        data-exiting={exitingBlockIds[block.id] ? "true" : "false"}
      >
        <div
          className={cn(
            "weekly-block-inner animate-weekly-block rounded-[24px] border p-4 shadow-[0_12px_28px_rgba(18,32,47,0.045)]",
            isTimed
              ? "border-brand-teal/14 bg-gradient-to-br from-white via-white to-brand-teal/[0.055]"
              : "border-brand-ink/8 bg-gradient-to-br from-white via-white to-brand-mist/55",
          )}
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 hidden rounded-2xl p-2 sm:block",
                isTimed
                  ? "bg-brand-teal/10 text-brand-teal"
                  : "bg-brand-ink/[0.045] text-brand-ink/52",
              )}
            >
              <TargetIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-[-0.02em] text-brand-ink">
                    {block.projectName}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-brand-ink/68">
                    {block.plannedTask}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    aria-expanded={isEditingThisBlock}
                    className="h-10 rounded-full border border-brand-ink/10 bg-white/85 px-4 text-xs font-bold text-brand-ink/58 shadow-[0_8px_18px_rgba(18,32,47,0.05)] hover:border-brand-teal/20 hover:bg-brand-teal/10 hover:text-brand-teal"
                    disabled={Boolean(exitingBlockIds[block.id])}
                    size="sm"
                    title={`Edit ${block.projectName}`}
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      isEditingThisBlock
                        ? cancelEditingBlock()
                        : startEditingBlock(block)
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    aria-label={`Remove ${block.projectName} from ${day}`}
                    className="h-11 w-11 rounded-full border border-brand-ink/10 bg-white/85 p-0 text-brand-ink/58 shadow-[0_8px_18px_rgba(18,32,47,0.06)] hover:border-brand-coral/20 hover:bg-brand-coral/10 hover:text-brand-coral"
                    disabled={Boolean(exitingBlockIds[block.id])}
                    size="sm"
                    title={`Remove ${block.projectName}`}
                    type="button"
                    variant="secondary"
                    onClick={() => requestRemoveBlock(block.id)}
                  >
                    <TrashIcon aria-hidden="true" className="h-5 w-5" />
                    <span className="sr-only">Remove block</span>
                  </Button>
                </div>
              </div>

              {removeErrors[block.id] ? (
                <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-xs font-medium leading-5 text-brand-coral">
                  {removeErrors[block.id]}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-brand-ink/8 bg-white/72 px-3 py-1.5 text-xs font-semibold text-brand-ink/50">
                  {getModeLabel(blockMode)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
                    isTimed
                      ? "bg-brand-teal/[0.085] text-brand-teal"
                      : "bg-brand-ink/[0.045] text-brand-ink/58",
                  )}
                >
                  <ClockIcon className="h-4 w-4" />
                  {timeLabel}
                  <span className="text-brand-ink/25">•</span>
                  {formatEstimatedHours(block.estimatedHours)}
                </span>
                {duplicateCount > 1 ? (
                  <span className="inline-flex items-center rounded-full border border-brand-ink/8 bg-brand-ink/[0.035] px-3 py-1.5 text-xs font-semibold text-brand-ink/45">
                    Similar block appears {duplicateCount} times
                  </span>
                ) : null}
                {googleSyncStatus !== "not_synced" ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold",
                      getSyncStatusClassName(googleSyncStatus),
                    )}
                  >
                    {getSyncStatusLabel(googleSyncStatus)}
                  </span>
                ) : null}
              </div>

              {isEditingThisBlock ? renderEditBlockForm(block) : null}

              {!isTimed && !isEditingThisBlock
                ? renderStartTimeControl(
                    block,
                    "Add a start time when this block needs to become a real calendar event.",
                  )
                : null}

              {workConflict || importedConflict ? (
                <div className="mt-3 space-y-2">
                  {workConflict ? (
                    <p className="rounded-2xl border border-brand-coral/14 bg-brand-coral/[0.07] px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
                      {workConflict.message}
                    </p>
                  ) : null}
                  {importedConflict ? (
                    <p className="rounded-2xl border border-brand-coral/14 bg-brand-coral/[0.07] px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
                      {importedConflict.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderBlockForm(target: FormTarget, showDayField: boolean) {
    const fieldSuffix = target === "quick" ? "quick" : target.toLowerCase();
    const shouldShowError = error && errorTarget === target;

    return (
      <form
        className={
          showDayField
            ? "mt-5 grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)_170px]"
            : "mt-4 space-y-3"
        }
        onSubmit={(event) => handleSubmit(event, target)}
      >
        {showDayField ? (
          <div>
            <label className="field-label" htmlFor={`plan-day-${fieldSuffix}`}>
              Day
            </label>
            <Select
              id={`plan-day-${fieldSuffix}`}
              value={draft.day}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  day: event.target.value as WeekDay,
                }));
                clearDraftWarnings();
              }}
            >
              {weekDays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className={showDayField ? "lg:col-span-3" : ""}>
          {renderModeToggle({
            fieldSuffix,
            mode: draft.mode,
            onChange: handleDraftModeChange,
          })}
        </div>

        {draft.mode === "project" ? (
          <div>
            <label
              className="field-label"
              htmlFor={`plan-project-${fieldSuffix}`}
            >
              Project
            </label>
            <Select
              id={`plan-project-${fieldSuffix}`}
              value={draft.projectId}
              onChange={(event) => handleProjectChange(event.target.value)}
              disabled={projects.length === 0}
            >
              {projects.length > 0 ? (
                projects.map((project) => (
                  <option key={project.id} value={String(project.id)}>
                    {project.name}
                    {project.completed ? " (done)" : ""}
                  </option>
                ))
              ) : (
                <option value="">No projects yet</option>
              )}
            </Select>
          </div>
        ) : (
          <div>
            <label className="field-label" htmlFor={`plan-title-${fieldSuffix}`}>
              Title
            </label>
            <Input
              id={`plan-title-${fieldSuffix}`}
              placeholder="Mom's appointment"
              value={draft.title}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }));
                clearDraftWarnings();
              }}
            />
          </div>
        )}

        <div className={showDayField ? "lg:col-span-2" : ""}>
          <label className="field-label" htmlFor={`plan-task-${fieldSuffix}`}>
            {draft.mode === "project" ? "Planned task" : "Details"}
          </label>
          <Input
            id={`plan-task-${fieldSuffix}`}
            placeholder={
              draft.mode === "project"
                ? "Draft the next deliverable"
                : "Take mom to appointment"
            }
            value={draft.plannedTask}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                plannedTask: event.target.value,
              }));
              clearDraftWarnings();
            }}
          />
        </div>

        <div className={showDayField ? "" : "grid gap-3"}>
          <div>
            <label
              className="field-label"
              htmlFor={`plan-start-time-${fieldSuffix}`}
            >
              Start
              <span className="font-normal text-brand-ink/45"> optional</span>
            </label>
            <Input
              id={`plan-start-time-${fieldSuffix}`}
              type="time"
              value={draft.startTime}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  startTime: event.target.value,
                }));
                clearDraftWarnings();
              }}
            />
          </div>

          {!showDayField ? (
            <div>
              <label className="field-label" htmlFor={`plan-hours-${fieldSuffix}`}>
                Hours
              </label>
              <Input
                id={`plan-hours-${fieldSuffix}`}
                type="number"
                min="0.5"
                step="0.5"
                inputMode="decimal"
                placeholder="1"
                value={draft.estimatedHours}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    estimatedHours: event.target.value,
                  }));
                  clearDraftWarnings();
                }}
              />
            </div>
          ) : null}
        </div>

        {showDayField ? (
          <div>
            <label className="field-label" htmlFor={`plan-hours-${fieldSuffix}`}>
              Estimated time
            </label>
            <Input
              id={`plan-hours-${fieldSuffix}`}
              type="number"
              min="0.5"
              step="0.5"
              inputMode="decimal"
              placeholder="1"
              value={draft.estimatedHours}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  estimatedHours: event.target.value,
                }));
                clearDraftWarnings();
              }}
            />
          </div>
        ) : null}

        <div
          className={
            showDayField
              ? "flex items-end lg:col-span-3"
              : "grid grid-cols-2 gap-2"
          }
        >
          {showDayField ? null : (
            <Button
              className="w-full"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setActiveDayForm(null)}
            >
              Cancel
            </Button>
          )}
          <Button
            className="w-full"
            size={showDayField ? "default" : "sm"}
            type="submit"
            disabled={!canAddBlock}
          >
            <PlusIcon className="h-4 w-4" />
            {isConfirmingDuplicate ? "Add anyway" : "Add time block"}
          </Button>
        </div>

        {projectFocusMessage && target === "quick" ? (
          <p className="rounded-[20px] border border-brand-teal/15 bg-brand-teal/[0.07] px-4 py-3 text-sm font-medium leading-6 text-brand-teal lg:col-span-3">
            {projectFocusMessage}
          </p>
        ) : null}

        {shouldShowError ? (
          <p className="rounded-[20px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral lg:col-span-3">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <section className="space-y-5 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="metric-card">
          <p className="text-sm text-brand-ink/55">Planned hours</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">
            {formatEstimatedHours(totalPlannedHours)}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-sm text-brand-ink/55">Days filled</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">
            {filledDays}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-sm text-brand-ink/55">Time blocks</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">
            {planBlocks.length}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-sm text-brand-ink/55">Projects ready</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">
            {projects.filter((project) => !project.completed).length}
          </p>
        </div>
      </div>

      <Card className="rounded-[24px] border-white/70 bg-white/78 sm:rounded-[28px]">
        <CardContent className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
              <CalendarIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                Planning week
              </h2>
              <p className="mt-1 text-sm leading-6 text-brand-ink/60">
                {selectedWeekRangeLabel}. This same week is used for calendar
                download and Google Calendar sync.
              </p>
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="weekly-plan-week">
              Week of
            </label>
            <Input
              id="weekly-plan-week"
              type="date"
              value={exportWeekStart}
              onChange={(event) => handleWeekStartChange(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[24px] border-white/70 bg-white/78 sm:rounded-[28px]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                <PlusIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                  Quick add time block
                </h2>
                <p className="text-sm leading-6 text-brand-ink/60">
                  Add a time block quickly, or use a day card below.
                </p>
              </div>
            </div>
            <Button
              aria-expanded={isAddFormOpen}
              className="w-full sm:w-auto"
              size="sm"
              type="button"
              variant="outline"
              onClick={openQuickAddForm}
            >
              {!isAddFormOpen ? <PlusIcon className="h-4 w-4" /> : null}
              {isAddFormOpen ? "Hide quick add" : "Open quick add"}
            </Button>
          </div>

          {isAddFormOpen ? (
            renderBlockForm("quick", true)
          ) : null}
        </CardContent>
      </Card>

      {conflictWarning ? (
        <p className="rounded-[22px] border border-brand-coral/16 bg-brand-coral/[0.07] px-4 py-3 text-sm font-semibold leading-6 text-brand-coral">
          {conflictWarning}
        </p>
      ) : null}

      {planBlocks.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-brand-ink/12 bg-white/62 p-5">
          <p className="text-base font-semibold text-brand-ink">
            No blocks planned yet.
          </p>
          <p className="mt-1 text-sm leading-6 text-brand-ink/55">
            Start by adding one to a day below.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {weekDays.map((day) => {
          const dayBlocks = blocksByDay[day];
          const timedBlocks = dayBlocks.filter(
            (block) => parseStartTimeToMinutes(block.startTime) !== null,
          );
          const flexibleBlocks = dayBlocks.filter(
            (block) => parseStartTimeToMinutes(block.startTime) === null,
          );
          const dayHours = dayBlocks.reduce(
            (sum, block) => sum + block.estimatedHours,
            0,
          );

          return (
            <Card
              key={day}
              className="h-full overflow-hidden rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)] sm:rounded-[34px]"
            >
              <CardContent className="flex h-full flex-col p-4 sm:p-5 lg:p-6">
                <div className="mb-4 flex flex-col gap-4 border-b border-brand-ink/8 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.02em] text-brand-ink">
                      {day}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="subtle">
                        {dayBlocks.length} block
                        {dayBlocks.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge
                        className="bg-brand-teal/8 text-brand-teal"
                        variant="subtle"
                      >
                        {formatEstimatedHours(dayHours)}
                      </Badge>
                    </div>
                  </div>
                  {activeDayForm === day ? (
                    <Button
                      className="h-10 px-4 text-sm sm:w-auto"
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => setActiveDayForm(null)}
                    >
                      Close
                    </Button>
                  ) : (
                    <Button
                      className="w-full border-dashed sm:w-auto"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => openDayForm(day)}
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add to {day}
                    </Button>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-4">
                  {activeDayForm === day ? (
                    <div className="rounded-[24px] border border-brand-teal/18 bg-brand-teal/[0.045] p-3 sm:p-4">
                      <div>
                        <p className="text-sm font-semibold text-brand-ink">
                          Add to {day}
                        </p>
                        <p className="text-xs leading-5 text-brand-ink/52">
                          Choose project work or a one-off task, then add the
                          time and duration.
                        </p>
                      </div>
                      {renderBlockForm(day, false)}
                    </div>
                  ) : null}

                  {dayBlocks.length > 0 ? (
                    <div className="space-y-4">
                      {timedBlocks.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-teal" />
                            <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-brand-teal">
                              Timed
                            </p>
                          </div>
                          <div className="space-y-2">
                            {timedBlocks.map((block, index) =>
                              renderPlanBlock(
                                block,
                                day,
                                index,
                                true,
                                duplicateCountsByBlockId[block.id] ?? 1,
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}

                      {flexibleBlocks.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-ink/30" />
                            <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-brand-ink/45">
                              Anytime
                            </p>
                          </div>
                          <div className="space-y-2">
                            {flexibleBlocks.map((block, index) =>
                              renderPlanBlock(
                                block,
                                day,
                                timedBlocks.length + index,
                                false,
                                duplicateCountsByBlockId[block.id] ?? 1,
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/55 p-4">
                      <p className="text-sm font-semibold text-brand-ink/70">
                        Open day
                      </p>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                        Add a focused block when this day needs structure.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card
        id="google-calendar-sync"
        className="scroll-mt-6 rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]"
      >
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                  Send this plan to your calendar
                </h2>
                <p className="mt-1 text-sm leading-6 text-brand-ink/60">
                  When the week looks right, download a calendar file or
                  manually sync timed blocks to Google Calendar.
                </p>
              </div>
            </div>
            <Badge className="bg-brand-ink/[0.045] text-brand-ink/56" variant="subtle">
              Week of {selectedWeekRangeLabel}
            </Badge>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[26px] border border-brand-ink/8 bg-white/70 p-4">
              <Badge className="bg-brand-ocean/10 text-brand-ocean" variant="subtle">
                Calendar file
              </Badge>
              <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
                Download calendar file
              </h3>
              <p className="mt-2 text-sm leading-6 text-brand-ink/58">
                Works with Apple Calendar, Google Calendar, and Outlook.
                Flexible blocks use the default 9:00 AM order if no start time
                is set.
              </p>
              <Button
                className="mt-4 w-full"
                type="button"
                onClick={handleCalendarExport}
              >
                Download .ics file
              </Button>
              {exportError ? (
                <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-sm font-medium leading-6 text-brand-coral">
                  {exportError}
                </p>
              ) : null}
              {exportMessage ? (
                <p className="mt-3 rounded-2xl border border-brand-teal/15 bg-brand-teal/[0.07] px-3 py-2 text-sm font-medium leading-6 text-brand-teal">
                  {exportMessage}
                </p>
              ) : null}
            </div>

            <div className="rounded-[26px] border border-brand-teal/12 bg-brand-teal/[0.035] p-4">
              <Badge
                className={
                  googleSyncEnabled
                    ? "bg-brand-teal/10 text-brand-teal"
                    : "bg-brand-ink/[0.045] text-brand-ink/52"
                }
                variant="subtle"
              >
                {googleSyncEnabled ? "Sync enabled" : "Sync not enabled"}
              </Badge>
              <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-brand-ink">
                Sync to Google Calendar
              </h3>
              <p className="mt-2 text-sm leading-6 text-brand-ink/58">
                Sends selected timed blocks to your dedicated{" "}
                {googleSyncCalendarName ?? "Schedule Builder"} Google Calendar.
                Nothing syncs unless you choose it.
              </p>
              {!googleSyncEnabled ? (
                <Link
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-brand-teal"
                  href="/integrations"
                >
                  Enable Google sync
                </Link>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/38">
                      Ready to sync
                    </p>
                    <p className="mt-1 text-lg font-semibold text-brand-ink">
                      {readySyncBlocks.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/38">
                      Synced
                    </p>
                    <p className="mt-1 text-lg font-semibold text-brand-ink">
                      {alreadySyncedSyncBlocks.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/38">
                      Needs time
                    </p>
                    <p className="mt-1 text-lg font-semibold text-brand-ink">
                      {flexibleSyncBlocks.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/38">
                      Needs attention
                    </p>
                    <p className="mt-1 text-lg font-semibold text-brand-ink">
                      {needsAttentionSyncBlocks.length}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {isGoogleSyncLoading ? (
            <p className="mt-4 rounded-2xl border border-brand-teal/12 bg-brand-teal/[0.06] px-4 py-3 text-sm font-medium leading-6 text-brand-teal">
              Checking Google Calendar sync status...
            </p>
          ) : null}

          {googleSyncEnabled ? (
            <div className="mt-6 space-y-4">
              {planBlocks.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/55 p-4">
                <p className="text-sm font-semibold text-brand-ink/70">
                  Add time blocks with start times before syncing to Google Calendar.
                </p>
                <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                  Start by adding one time block to a day above.
                </p>
              </div>
              ) : null}

              {readySyncBlocks.length > 0 ? (
              <div className="rounded-[26px] border border-brand-teal/12 bg-white/70 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-brand-ink">
                      Ready to sync
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                      Select the timed blocks you want to send. Each card shows
                      the exact day and time.
                    </p>
                  </div>
                  <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                    {readySyncBlocks.length} ready
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3">
                  {readySyncBlocks.map((block) => {
                    const syncStatus = getBlockGoogleSyncStatus(block);
                    const isSelectable = googleSyncEnabled;
                    const syncMessage = getBlockGoogleSyncMessage(block);
                    const preSyncConflicts = getBlockPreSyncConflicts(block);
                    const isSelected = Boolean(googleSyncSelectedIds[block.id]);
                    const reviewBadges: PreSyncConflict[] =
                      preSyncConflicts.length > 0
                        ? preSyncConflicts
                        : isSelected && isSelectable
                          ? [
                              {
                                detail: "No overlaps found",
                                label: "Ready to sync",
                                tone: "ready",
                              },
                            ]
                          : [];
                    const googleEventLink = getBlockGoogleEventLink(block);
                    const blockDayDate = formatBlockDayDate(
                      block.day,
                      exportWeekStart,
                    );

                    return (
                      <div
                        key={block.id}
                        className={cn(
                          "rounded-[22px] border p-4 transition",
                          isSelectable
                            ? "border-brand-teal/14 bg-brand-teal/[0.035]"
                            : "border-brand-ink/8 bg-white/64",
                        )}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <label className="flex min-w-0 items-start gap-3">
                            <input
                              aria-label={`Select ${block.projectName} for Google Calendar sync`}
                              checked={isSelected}
                              className="mt-1 h-5 w-5 rounded border-brand-ink/20 accent-brand-teal"
                              disabled={!isSelectable || isGoogleSyncing}
                              type="checkbox"
                              onChange={() => toggleGoogleSyncSelection(block)}
                            />
                            <span className="min-w-0">
                              <span className="mb-2 inline-flex rounded-full bg-brand-ink/[0.045] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/55">
                                {blockDayDate}
                              </span>
                              <span className="block text-sm font-semibold text-brand-ink">
                                {block.projectName}
                              </span>
                              <span className="mt-1 block text-sm leading-6 text-brand-ink/62">
                                {block.plannedTask}
                              </span>
                            </span>
                          </label>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            <Badge className={getSyncStatusClassName(syncStatus)} variant="subtle">
                              {getSyncStatusLabel(syncStatus)}
                            </Badge>
                            <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                              {formatStartTime(block.startTime)} •{" "}
                              {formatEstimatedHours(block.estimatedHours)}
                            </Badge>
                          </div>
                        </div>

                        {reviewBadges.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {reviewBadges.map((item) => (
                              <span
                                key={`${item.label}-${item.detail}`}
                                className={cn(
                                  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold",
                                  item.tone === "ready"
                                    ? "bg-brand-teal/10 text-brand-teal"
                                    : "bg-brand-coral/10 text-brand-coral",
                                )}
                                title={item.detail}
                              >
                                {item.label}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {syncMessage ? (
                          <p
                            className={cn(
                              "mt-3 rounded-2xl border px-3 py-2 text-xs font-semibold leading-5",
                              syncStatus === "failed"
                                ? "border-brand-coral/16 bg-brand-coral/[0.08] text-brand-coral"
                                : "border-brand-ink/8 bg-white/70 text-brand-ink/50",
                            )}
                          >
                            {syncMessage}
                          </p>
                        ) : null}

                        {googleEventLink ? (
                          <a
                            aria-label={`Open synced Google Calendar event for ${block.projectName}`}
                            className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full border border-brand-teal/18 bg-white px-4 text-xs font-bold text-brand-teal shadow-sm transition hover:-translate-y-0.5 hover:border-brand-teal/30 hover:bg-brand-teal/[0.06] sm:w-auto"
                            href={googleEventLink}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open in Google Calendar
                          </a>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              ) : null}

              {alreadySyncedSyncBlocks.length > 0 ? (
                <div className="rounded-[26px] border border-brand-teal/12 bg-white/68 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-brand-ink">
                        Already synced
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                        These blocks are already on your Schedule Builder Google
                        Calendar.
                      </p>
                    </div>
                    <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                      {alreadySyncedSyncBlocks.length} synced
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {alreadySyncedSyncBlocks.map((block) => {
                      const googleEventLink = getBlockGoogleEventLink(block);
                      const blockDayDate = formatBlockDayDate(
                        block.day,
                        exportWeekStart,
                      );

                      return (
                        <div
                          key={block.id}
                          className="rounded-[22px] border border-brand-ink/8 bg-white/74 p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <span className="mb-2 inline-flex rounded-full bg-brand-ink/[0.045] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/55">
                                {blockDayDate}
                              </span>
                              <p className="text-sm font-semibold text-brand-ink">
                                {block.projectName}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                                {block.plannedTask}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 sm:justify-end">
                              <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
                                Synced
                              </Badge>
                              <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                                {formatStartTime(block.startTime)} •{" "}
                                {formatEstimatedHours(block.estimatedHours)}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-3 rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2 text-xs font-semibold leading-5 text-brand-ink/50">
                            Already added to Google Calendar.
                          </p>
                          {googleEventLink ? (
                            <a
                              aria-label={`Open synced Google Calendar event for ${block.projectName}`}
                              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full border border-brand-teal/18 bg-white px-4 text-xs font-bold text-brand-teal shadow-sm transition hover:-translate-y-0.5 hover:border-brand-teal/30 hover:bg-brand-teal/[0.06] sm:w-auto"
                              href={googleEventLink}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open in Google Calendar
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {needsAttentionSyncBlocks.length > 0 ? (
                <div className="rounded-[26px] border border-brand-coral/14 bg-brand-coral/[0.045] p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-brand-ink">
                        Needs attention
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                        These blocks changed after syncing.
                      </p>
                    </div>
                    <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                      {needsAttentionSyncBlocks.length} to review
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {needsAttentionSyncBlocks.map((block) => {
                      const googleEventLink = getBlockGoogleEventLink(block);
                      const blockDayDate = formatBlockDayDate(
                        block.day,
                        exportWeekStart,
                      );
                      const timeLabel =
                        parseStartTimeToMinutes(block.startTime) !== null
                          ? formatStartTime(block.startTime)
                          : "Anytime";

                      return (
                        <div
                          key={block.id}
                          className="rounded-[22px] border border-brand-coral/12 bg-white/76 p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <span className="mb-2 inline-flex rounded-full bg-brand-coral/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-coral">
                                {blockDayDate}
                              </span>
                              <p className="text-sm font-semibold text-brand-ink">
                                {block.projectName}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                                {block.plannedTask}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 sm:justify-end">
                              <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                                Needs attention
                              </Badge>
                              <Badge variant="subtle">
                                {timeLabel} •{" "}
                                {formatEstimatedHours(block.estimatedHours)}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-3 rounded-2xl border border-brand-coral/12 bg-brand-coral/[0.055] px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
                            This block changed after syncing. Google Calendar
                            may still have the older version.
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {googleEventLink ? (
                              <a
                                aria-label={`Open older Google Calendar event for ${block.projectName}`}
                                className="inline-flex h-10 w-full items-center justify-center rounded-full border border-brand-teal/18 bg-white px-4 text-xs font-bold text-brand-teal shadow-sm transition hover:-translate-y-0.5 hover:border-brand-teal/30 hover:bg-brand-teal/[0.06]"
                                href={googleEventLink}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Open in Google Calendar
                              </a>
                            ) : null}
                            <Button
                              className={googleEventLink ? "" : "sm:col-span-2"}
                              disabled={Boolean(googleSyncMaintenanceActionId)}
                              size="sm"
                              type="button"
                              onClick={() => requestUpdateSyncedGoogleEvent(block)}
                            >
                              Update Google Calendar event
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {flexibleSyncBlocks.length > 0 ? (
                <div className="rounded-[26px] border border-brand-ink/8 bg-white/62 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-brand-ink">
                        Needs start time
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                        These stay flexible until you add a time.
                      </p>
                    </div>
                    <Badge variant="subtle">
                      {flexibleSyncBlocks.length} flexible
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {flexibleSyncBlocks.map((block) => {
                      const blockDayDate = formatBlockDayDate(
                        block.day,
                        exportWeekStart,
                      );

                      return (
                        <div
                          key={block.id}
                          className="rounded-[22px] border border-brand-ink/8 bg-white/72 p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <span className="mb-2 inline-flex rounded-full bg-brand-ink/[0.045] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/55">
                                {blockDayDate}
                              </span>
                              <p className="text-sm font-semibold text-brand-ink">
                                {block.projectName}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                                {block.plannedTask}
                              </p>
                            </div>
                            <Badge variant="subtle">
                              Anytime •{" "}
                              {formatEstimatedHours(block.estimatedHours)}
                            </Badge>
                          </div>
                          {renderStartTimeControl(
                            block,
                            "Add a start time to make this block eligible for Google Calendar sync.",
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {removedGoogleSyncEvents.length > 0 ? (
                <div className="rounded-[26px] border border-brand-coral/14 bg-brand-coral/[0.055] p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-brand-ink">
                        Calendar events still in Google
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        These events were synced before, but their Schedule
                        Builder blocks were removed.
                      </p>
                    </div>
                    <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                      {removedGoogleSyncEvents.length} event
                      {removedGoogleSyncEvents.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {removedGoogleSyncEvents.map((event) => {
                      const displayTitle = formatGoogleSyncDisplayTitle(
                        event.syncedTitle,
                      );

                      return (
                        <div
                          key={event.id}
                          className="rounded-[22px] border border-brand-ink/8 bg-white/75 p-4"
                        >
                          <p className="text-sm font-semibold text-brand-ink">
                            {displayTitle}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-brand-ink/56">
                            {formatSyncedEventRange(
                              event.syncedStartsAt,
                              event.syncedEndsAt,
                            )}
                          </p>
                          <p className="mt-3 rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2 text-xs font-semibold leading-5 text-brand-ink/52">
                            This event still exists in Google Calendar.
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {event.googleEventHtmlLink ? (
                              <a
                                aria-label={`Open removed block Google Calendar event ${displayTitle}`}
                                className="inline-flex h-10 w-full items-center justify-center rounded-full border border-brand-teal/18 bg-white px-4 text-xs font-bold text-brand-teal shadow-sm transition hover:-translate-y-0.5 hover:border-brand-teal/30 hover:bg-brand-teal/[0.06]"
                                href={event.googleEventHtmlLink}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Open in Google Calendar
                              </a>
                            ) : null}
                            <Button
                              className={
                                event.googleEventHtmlLink ? "" : "sm:col-span-2"
                              }
                              disabled={Boolean(googleSyncMaintenanceActionId)}
                              size="sm"
                              type="button"
                              variant="outline"
                              onClick={() => requestRemoveSyncedGoogleEvent(event)}
                            >
                              Remove from Google Calendar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {googleSyncError ? (
            <p className="mt-4 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-sm font-medium leading-6 text-brand-coral">
              {googleSyncError}
            </p>
          ) : null}

          {googleSyncMessage ? (
            <p className="mt-4 rounded-2xl border border-brand-teal/15 bg-brand-teal/[0.07] px-3 py-2 text-sm font-medium leading-6 text-brand-teal">
              {googleSyncMessage}
            </p>
          ) : null}

          {isConfirmingGoogleSync && selectedGoogleSyncBlocks.length > 0 ? (
            <div className="mt-4 rounded-[24px] border border-brand-teal/14 bg-brand-teal/[0.045] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-brand-ink">
                    Review before syncing
                  </p>
                  <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                    {selectedGoogleSyncBlocks.length} block
                    {selectedGoogleSyncBlocks.length === 1 ? "" : "s"} will be
                    added to your Schedule Builder Google Calendar.
                  </p>
                </div>
                <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
                  {selectedGoogleSyncBlocks.length} selected
                </Badge>
              </div>

              {selectedGoogleSyncConflictCount > 0 ? (
                <p className="mt-3 rounded-2xl border border-brand-coral/14 bg-brand-coral/[0.07] px-3 py-2 text-xs font-semibold leading-5 text-brand-coral">
                  Some selected blocks need a quick review before syncing.
                </p>
              ) : null}

              <div className="mt-3 grid gap-2">
                {selectedGoogleSyncBlocks.map((block) => {
                  const reviewBadges = getBlockPreSyncConflicts(block);

                  return (
                    <div
                      key={block.id}
                      className="rounded-[18px] border border-brand-ink/8 bg-white/75 p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-ink/42">
                            {formatBlockDayDate(block.day, exportWeekStart)}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-brand-ink">
                            {block.projectName}
                          </p>
                        </div>
                        <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                          {formatStartTime(block.startTime)} •{" "}
                          {formatEstimatedHours(block.estimatedHours)}
                        </Badge>
                      </div>
                      {reviewBadges.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {reviewBadges.map((item) => (
                            <span
                              key={`${block.id}-${item.label}-${item.detail}`}
                              className="inline-flex items-center rounded-full bg-brand-coral/10 px-3 py-1 text-xs font-semibold text-brand-coral"
                              title={item.detail}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button
                  disabled={isGoogleSyncing}
                  type="button"
                  variant="outline"
                  onClick={() => setIsConfirmingGoogleSync(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={isGoogleSyncing}
                  type="button"
                  onClick={() => syncSelectedBlocksToGoogleCalendar(true)}
                >
                  {isGoogleSyncing
                    ? "Syncing..."
                    : "Sync to Google Calendar"}
                </Button>
              </div>
            </div>
          ) : null}

          {googleSyncMaintenanceConfirmation ? (
            <div className="mt-4 rounded-[24px] border border-brand-ink/10 bg-white/82 p-4 shadow-[0_14px_35px_rgba(18,32,47,0.06)]">
              {googleSyncMaintenanceConfirmation.type === "update" ? (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">
                        Update Google Calendar event?
                      </p>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        This will update the existing Google Calendar event to
                        match the current Schedule Builder block.
                      </p>
                    </div>
                    <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                      Needs attention
                    </Badge>
                  </div>
                  <div className="mt-3 rounded-[18px] border border-brand-ink/8 bg-white/75 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-ink/42">
                      {formatBlockDayDate(
                        googleSyncMaintenanceConfirmation.block.day,
                        exportWeekStart,
                      )}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-brand-ink">
                      {googleSyncMaintenanceConfirmation.block.projectName}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                      {googleSyncMaintenanceConfirmation.block.plannedTask}
                    </p>
                    <Badge className="mt-2 bg-brand-teal/8 text-brand-teal" variant="subtle">
                      {formatStartTime(
                        googleSyncMaintenanceConfirmation.block.startTime,
                      )}{" "}
                      •{" "}
                      {formatEstimatedHours(
                        googleSyncMaintenanceConfirmation.block.estimatedHours,
                      )}
                    </Badge>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">
                        Remove from Google Calendar?
                      </p>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        This removes the event from your dedicated Schedule
                        Builder Google Calendar. It will not change local time
                        blocks.
                      </p>
                    </div>
                    <Badge className="bg-brand-coral/10 text-brand-coral" variant="subtle">
                      Google event
                    </Badge>
                  </div>
                  <div className="mt-3 rounded-[18px] border border-brand-ink/8 bg-white/75 p-3">
                    <p className="text-sm font-semibold text-brand-ink">
                      {formatGoogleSyncDisplayTitle(
                        googleSyncMaintenanceConfirmation.event.syncedTitle,
                      )}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                      {formatSyncedEventRange(
                        googleSyncMaintenanceConfirmation.event.syncedStartsAt,
                        googleSyncMaintenanceConfirmation.event.syncedEndsAt,
                      )}
                    </p>
                  </div>
                </>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button
                  disabled={Boolean(googleSyncMaintenanceActionId)}
                  type="button"
                  variant="outline"
                  onClick={() => setGoogleSyncMaintenanceConfirmation(null)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={Boolean(googleSyncMaintenanceActionId)}
                  type="button"
                  onClick={() => void confirmGoogleSyncMaintenanceAction()}
                >
                  {googleSyncMaintenanceActionId
                    ? googleSyncMaintenanceConfirmation.type === "update"
                      ? "Updating..."
                      : "Removing..."
                    : googleSyncMaintenanceConfirmation.type === "update"
                      ? "Update Google Calendar event"
                      : "Remove from Google Calendar"}
                </Button>
              </div>
            </div>
          ) : null}

          {googleSyncEnabled && readySyncBlocks.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2 text-sm font-semibold leading-6 text-brand-ink/55">
              No blocks ready to sync. Add a start time to a block before
              syncing.
            </p>
          ) : null}

          {googleSyncEnabled &&
          readySyncBlocks.length > 0 &&
          selectedGoogleSyncIds.length === 0 &&
          !isConfirmingGoogleSync ? (
            <p className="mt-4 rounded-2xl border border-brand-ink/8 bg-white/70 px-3 py-2 text-sm font-semibold leading-6 text-brand-ink/55">
              Select at least one block to sync.
            </p>
          ) : null}

          {googleSyncEnabled &&
          readySyncBlocks.length > 0 &&
          !isConfirmingGoogleSync ? (
            <Button
              className="mt-4 w-full"
              disabled={!canSyncSelectedBlocks}
              type="button"
              onClick={() => syncSelectedBlocksToGoogleCalendar()}
            >
              {selectedGoogleSyncIds.length > 0
                ? `Sync selected (${selectedGoogleSyncIds.length})`
                : "Sync selected"}
            </Button>
          ) : null}

          <p className="mt-3 text-sm leading-6 text-brand-ink/50">
            Google sync is one-way. Schedule Builder will not update or delete
            Google Calendar events automatically.
          </p>
        </CardContent>
      </Card>

      <ConfirmDialog
        confirmLabel="Remove block"
        description="This removes the block from your weekly plan. If it was synced to Google Calendar, the Google event may still remain unless removed separately."
        destructive
        open={Boolean(pendingRemoveBlockId)}
        title="Remove this block?"
        onCancel={() => setPendingRemoveBlockId(null)}
        onConfirm={() => {
          if (pendingRemoveBlockId) {
            removeBlockWithAnimation(pendingRemoveBlockId);
          }
        }}
      />
    </section>
  );
}
