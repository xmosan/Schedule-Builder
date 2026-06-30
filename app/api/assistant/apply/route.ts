import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  createAssistantContextSummary,
  getAssistantCurrentWeekStartInput,
  getRelevantImportedCalendarEvents,
  normalizeAssistantSuggestions,
  type AssistantApplyResponse,
  type AssistantApplyResult,
  type AssistantSuggestion,
} from "@/lib/assistant";
import {
  priorityLevels,
  projectCategories,
  type Project,
  type ProjectCategory,
  type ProjectPriority,
} from "@/lib/projects";
import {
  fetchImportedCalendarEventsForUser,
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
  fetchScheduledItemsForUser,
  fetchWorkShiftsForUser,
  fetchWeeklyPlanBlocksForUser,
  createScheduledItemForUser,
  createWeeklyPlanBlockForUser,
} from "@/lib/supabase/scheduler";
import type { ImportedCalendarEvent } from "@/lib/imported-calendar";
import {
  getWeeklyPlanImportedEventConflictForBlock,
  getWeeklyPlanWorkConflictForBlock,
} from "@/lib/schedule-conflicts";
import {
  isScheduledItemType,
  normalizeScheduledItemDate,
  validateScheduledItemDraft,
  type ScheduledItem,
  type ScheduledItemDraft,
} from "@/lib/scheduled-items";
import {
  formatStartTime,
  normalizeStartTime,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import { formatWorkShiftRange, type WorkShift } from "@/lib/work-schedule";

export const dynamic = "force-dynamic";

const maxApprovedSuggestions = 8;

type ProjectRow = {
  user_id: string;
  project_id: number;
  sort_index: number;
  name: string;
  category: ProjectCategory;
  priority: ProjectPriority;
  deadline: string;
  next_action: string;
  weekly_hours: number;
  completed: boolean;
};

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

  return "The approved suggestion could not be applied.";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function getAuthenticatedUser(
  request: NextRequest,
): Promise<{ supabase: SupabaseClient; userId: string } | NextResponse> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in before applying AI Plan Review suggestions." },
      { status: 401 },
    );
  }

  try {
    const supabase = createAuthenticatedSupabaseClient(accessToken);
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? "Session could not be verified." },
        { status: 401 },
      );
    }

    return {
      supabase,
      userId: data.user.id,
    };
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

function createResult(
  suggestion: AssistantSuggestion,
  status: AssistantApplyResult["status"],
  message: string,
): AssistantApplyResult {
  return {
    suggestionId: suggestion.id,
    suggestionTitle: suggestion.title,
    type: suggestion.type,
    status,
    message,
  };
}

function getWeekStartForDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const mondayOffset = date.getDay() === 0 ? -6 : 1 - date.getDay();
  date.setDate(date.getDate() + mondayOffset);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getDateForWeekDay(weekStartDate: string, day: WeekDay) {
  const date = new Date(`${weekStartDate}T00:00:00`);
  date.setDate(date.getDate() + weekDays.indexOf(day));
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatAppliedBlockMessage(block: WeeklyPlanBlock, dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
  const startMinutes = block.startTime
    ? Number(block.startTime.slice(0, 2)) * 60 + Number(block.startTime.slice(3, 5))
    : null;
  const endMinutes =
    startMinutes === null ? null : startMinutes + block.estimatedHours * 60;
  const endTime =
    endMinutes === null
      ? null
      : `${String(Math.floor((endMinutes % 1440) / 60)).padStart(2, "0")}:${String(
          endMinutes % 60,
        ).padStart(2, "0")}`;

  return block.startTime && endTime
    ? `Added “${block.projectName}” to ${dateLabel} from ${formatStartTime(
        block.startTime,
      )}–${formatStartTime(endTime)}.`
    : `Added “${block.projectName}” to ${dateLabel} as an anytime time block. Add a start time before treating it as a timed Calendar commitment.`;
}

function normalizeProjectKey(projectName: string) {
  return projectName.trim().toLowerCase();
}

function findProjectByName(projects: Project[], projectName: string) {
  const targetName = normalizeProjectKey(projectName);
  return projects.find((project) => normalizeProjectKey(project.name) === targetName);
}

function createBlockId(suggestionId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${suggestionId}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProjectId(currentProjects: Project[]) {
  const existingIds = new Set(currentProjects.map((project) => project.id));
  let projectId = Date.now();

  while (existingIds.has(projectId)) {
    projectId += 1;
  }

  return projectId;
}

function isProjectCategory(value: unknown): value is ProjectCategory {
  return (
    typeof value === "string" &&
    projectCategories.includes(value as ProjectCategory)
  );
}

function isProjectPriority(value: unknown): value is ProjectPriority {
  return (
    typeof value === "string" &&
    priorityLevels.includes(value as ProjectPriority)
  );
}

function validateActionableSuggestion(suggestion: AssistantSuggestion) {
  if (
    suggestion.type !== "new_project" &&
    suggestion.type !== "update_project" &&
    suggestion.type !== "suggested_scheduled_item" &&
    suggestion.type !== "suggested_weekly_block" &&
    suggestion.type !== "suggested_next_action"
  ) {
    return "This suggestion is informational and cannot be applied automatically.";
  }

  return null;
}

async function applyScheduledItemSuggestion({
  currentScheduledItems,
  suggestion,
  supabase,
  userId,
}: {
  currentScheduledItems: ScheduledItem[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
}) {
  if (suggestion.type !== "suggested_scheduled_item") {
    return createResult(
      suggestion,
      "error",
      "This suggestion is not a scheduled task or appointment.",
    );
  }

  const title = suggestion.title.trim();
  const itemDate = normalizeScheduledItemDate(suggestion.itemDate);
  const itemType = isScheduledItemType(suggestion.itemType)
    ? suggestion.itemType
    : null;
  const estimatedHours = suggestion.estimatedHours;
  const draft: ScheduledItemDraft | null =
    itemType && title && itemDate && estimatedHours
      ? {
          itemType,
          title,
          description: suggestion.plannedTask?.trim() ?? "",
          itemDate,
          startTime: suggestion.startTime ?? "",
          estimatedHours: String(estimatedHours),
          location: suggestion.location?.trim() ?? "",
        }
      : null;

  if (!draft) {
    return createResult(
      suggestion,
      "error",
      "Scheduled item needs a title, type, date, and duration.",
    );
  }

  const validationMessage = validateScheduledItemDraft(draft);

  if (validationMessage) {
    return createResult(suggestion, "error", validationMessage);
  }

  const result = await createScheduledItemForUser(supabase, userId, draft);

  if (result.error || !result.data) {
    return createResult(
      suggestion,
      "error",
      result.error?.message ?? "Scheduled item could not be saved.",
    );
  }

  currentScheduledItems.push(result.data);

  return createResult(
    suggestion,
    "applied",
    itemType === "appointment"
      ? "Appointment added to your schedule."
      : "Task added to your schedule.",
  );
}

async function applyWeeklyBlockSuggestion({
  appliedBlockCount,
  currentBlocks,
  importedCalendarEvents,
  suggestion,
  supabase,
  userId,
  workShifts,
}: {
  appliedBlockCount: number;
  currentBlocks: WeeklyPlanBlock[];
  importedCalendarEvents: ImportedCalendarEvent[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
  workShifts: WorkShift[];
}) {
  const projectName = suggestion.projectName?.trim();
  const plannedTask = suggestion.plannedTask?.trim();

  if (!projectName) {
    return createResult(suggestion, "error", "Weekly block title cannot be empty.");
  }

  if (!plannedTask) {
    return createResult(suggestion, "error", "Weekly block task cannot be empty.");
  }

  if (!suggestion.day) {
    return createResult(
      suggestion,
      "error",
      "Weekly block day must be Monday through Sunday.",
    );
  }

  if (!suggestion.estimatedHours || suggestion.estimatedHours <= 0) {
    return createResult(
      suggestion,
      "error",
      "Weekly block estimated time must be greater than 0.",
    );
  }

  const startTime = normalizeStartTime(suggestion.startTime ?? "");
  const weekStartDate = suggestion.itemDate
    ? getWeekStartForDate(suggestion.itemDate)
    : getAssistantCurrentWeekStartInput();

  if (!weekStartDate) {
    return createResult(suggestion, "error", "The selected week is invalid.");
  }

  const createdDate = getDateForWeekDay(weekStartDate, suggestion.day);

  if (suggestion.itemDate && suggestion.itemDate !== createdDate) {
    return createResult(
      suggestion,
      "error",
      "The selected date no longer matches the selected weekday. Review the proposal before applying it.",
    );
  }

  const candidateBlock: WeeklyPlanBlock = {
    id: createBlockId(suggestion.id),
    day: suggestion.day,
    projectName,
    plannedTask,
    estimatedHours: suggestion.estimatedHours,
    ...(startTime ? { startTime } : {}),
  };
  const weekStart = new Date(`${weekStartDate}T00:00:00`);
  const workConflict = getWeeklyPlanWorkConflictForBlock(
    candidateBlock,
    workShifts,
  );
  const importedConflict = getWeeklyPlanImportedEventConflictForBlock(
    candidateBlock,
    importedCalendarEvents,
    weekStart,
  );

  if (startTime && (workConflict || importedConflict)) {
    const conflictLabel = workConflict
      ? `your work shift (${workConflict.shiftRangeLabel})`
      : `“${importedConflict?.event.title}” (${importedConflict?.eventRangeLabel})`;

    return createResult(
      suggestion,
      "error",
      `That ${suggestion.day} window now overlaps ${conflictLabel}. Review the conflict before applying.`,
    );
  }

  const { error } = await createWeeklyPlanBlockForUser(
    supabase,
    userId,
    candidateBlock,
    currentBlocks.length + appliedBlockCount,
  );

  if (error) {
    return createResult(suggestion, "error", error.message);
  }

  const createdBlock = candidateBlock;

  currentBlocks.push(createdBlock);

  const workRanges = workShifts
    .filter((shift) => shift.day === createdBlock.day)
    .map(formatWorkShiftRange);
  const followUpWarnings = [
    !startTime && workRanges.length > 0
      ? `This day has work shifts (${workRanges.join(", ")}), so place the block outside those hours.`
      : null,
    importedConflict
      ? `This block may overlap with imported event "${importedConflict.event.title}" (${importedConflict.eventRangeLabel}).`
      : null,
  ].filter((message): message is string => Boolean(message));

  return {
    ...createResult(
      suggestion,
      "applied",
      `${formatAppliedBlockMessage(createdBlock, createdDate)}${
        followUpWarnings.length > 0 ? ` ${followUpWarnings.join(" ")}` : ""
      }`,
    ),
    calendarHref: `/calendar?view=week&date=${encodeURIComponent(createdDate)}&highlight=${encodeURIComponent(createdBlock.id)}`,
    createdBlock,
    createdDate,
    planHref: `/plan?week=${encodeURIComponent(weekStartDate)}&date=${encodeURIComponent(createdDate)}&highlight=${encodeURIComponent(createdBlock.id)}`,
  };
}

async function applyNewProjectSuggestion({
  currentProjects,
  suggestion,
  supabase,
  userId,
}: {
  currentProjects: Project[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
}) {
  const projectName = suggestion.projectName?.trim();
  const nextAction = suggestion.proposedNextAction?.trim();
  const weeklyHours = suggestion.weeklyHours ?? suggestion.estimatedHours ?? 0;

  if (!projectName) {
    return createResult(suggestion, "error", "Project name cannot be empty.");
  }

  if (findProjectByName(currentProjects, projectName)) {
    const result = await applyProjectUpdateSuggestion({
      currentProjects,
      suggestion,
      supabase,
      userId,
    });

    return result.status === "applied"
      ? {
          ...result,
          message: "Updated the existing project instead of creating a duplicate.",
        }
      : result;
  }

  if (!nextAction) {
    return createResult(
      suggestion,
      "error",
      "Project next action cannot be empty.",
    );
  }

  if (!Number.isFinite(weeklyHours) || weeklyHours < 0) {
    return createResult(
      suggestion,
      "error",
      "Project weekly hours must be 0 or greater.",
    );
  }

  const category = isProjectCategory(suggestion.category)
    ? suggestion.category
    : "Must-do";
  const priority = isProjectPriority(suggestion.priority)
    ? suggestion.priority
    : "Medium";
  const projectId = createProjectId(currentProjects);
  const row: ProjectRow = {
    user_id: userId,
    project_id: projectId,
    sort_index: currentProjects.length,
    name: projectName,
    category,
    priority,
    deadline: suggestion.deadline?.trim() ?? "",
    next_action: nextAction,
    weekly_hours: weeklyHours,
    completed: false,
  };
  const { error } = await supabase.from("projects").insert(row);

  if (error) {
    return createResult(suggestion, "error", error.message);
  }

  currentProjects.push({
    id: projectId,
    name: projectName,
    category,
    priority,
    deadline: row.deadline,
    nextAction,
    weeklyHours,
    completed: false,
  });

  return createResult(suggestion, "applied", "Created the project.");
}

async function applyProjectUpdateSuggestion({
  currentProjects,
  suggestion,
  supabase,
  userId,
}: {
  currentProjects: Project[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
}) {
  const projectName = suggestion.projectName?.trim();

  if (!projectName) {
    return createResult(suggestion, "error", "Project name cannot be empty.");
  }

  const project = findProjectByName(currentProjects, projectName);

  if (!project) {
    return createResult(suggestion, "error", "Could not find that project.");
  }

  const updates: Partial<ProjectRow> = {};
  const newProjectName = suggestion.newProjectName?.trim();
  const nextAction = suggestion.proposedNextAction?.trim();
  const deadline = suggestion.deadline?.trim();

  if (newProjectName && newProjectName !== project.name) {
    const duplicateProject = currentProjects.find(
      (candidate) =>
        candidate.id !== project.id &&
        normalizeProjectKey(candidate.name) === normalizeProjectKey(newProjectName),
    );

    if (duplicateProject) {
      return createResult(
        suggestion,
        "error",
        "Another project already uses that name.",
      );
    }

    updates.name = newProjectName;
  }

  if (deadline && deadline !== project.deadline) {
    updates.deadline = deadline;
  }

  if (
    suggestion.category &&
    isProjectCategory(suggestion.category) &&
    suggestion.category !== project.category
  ) {
    updates.category = suggestion.category;
  }

  if (
    suggestion.priority &&
    isProjectPriority(suggestion.priority) &&
    suggestion.priority !== project.priority
  ) {
    updates.priority = suggestion.priority;
  }

  if (nextAction && nextAction !== project.nextAction) {
    updates.next_action = nextAction;
  }

  if (suggestion.weeklyHours !== undefined) {
    if (!Number.isFinite(suggestion.weeklyHours) || suggestion.weeklyHours < 0) {
      return createResult(
        suggestion,
        "error",
        "Project weekly hours must be 0 or greater.",
      );
    }

    if (suggestion.weeklyHours !== project.weeklyHours) {
      updates.weekly_hours = suggestion.weeklyHours;
    }
  }

  if (Object.keys(updates).length === 0) {
    return createResult(
      suggestion,
      "skipped",
      "No project fields changed in this suggestion.",
    );
  }

  const { error } = await supabase
    .from("projects")
    .update(updates)
    .eq("user_id", userId)
    .eq("project_id", project.id);

  if (error) {
    return createResult(suggestion, "error", error.message);
  }

  if (updates.name) project.name = updates.name;
  if (updates.deadline !== undefined) project.deadline = updates.deadline;
  if (updates.category) project.category = updates.category;
  if (updates.priority) project.priority = updates.priority;
  if (updates.next_action) project.nextAction = updates.next_action;
  if (updates.weekly_hours !== undefined) project.weeklyHours = updates.weekly_hours;

  return createResult(suggestion, "applied", "Updated the project.");
}

async function applyNextActionSuggestion({
  currentProjects,
  suggestion,
  supabase,
  userId,
}: {
  currentProjects: Project[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
}) {
  const projectName = suggestion.projectName?.trim();
  const proposedNextAction = suggestion.proposedNextAction?.trim();

  if (!projectName) {
    return createResult(suggestion, "error", "Project name cannot be empty.");
  }

  if (!proposedNextAction) {
    return createResult(
      suggestion,
      "error",
      "Proposed next action cannot be empty.",
    );
  }

  const project = findProjectByName(currentProjects, projectName);

  if (!project) {
    return createResult(suggestion, "error", "Could not find that project.");
  }

  const { error } = await supabase
    .from("projects")
    .update({ next_action: proposedNextAction })
    .eq("user_id", userId)
    .eq("project_id", project.id);

  if (error) {
    return createResult(suggestion, "error", error.message);
  }

  project.nextAction = proposedNextAction;
  return createResult(suggestion, "applied", "Updated the project next action.");
}

async function loadContextSummary(supabase: SupabaseClient, userId: string) {
  const [
    profileResult,
    projectsResult,
    weeklyPlanResult,
    workShiftsResult,
    importedEventsResult,
  ] = await Promise.all([
    fetchPlannerProfileForUser(supabase, userId),
    fetchProjectsForUser(supabase, userId),
    fetchWeeklyPlanBlocksForUser(supabase, userId),
    fetchWorkShiftsForUser(supabase, userId),
    fetchImportedCalendarEventsForUser(supabase, userId),
  ]);

  return createAssistantContextSummary(
    projectsResult.error == null ? projectsResult.data : [],
    weeklyPlanResult.error == null ? weeklyPlanResult.data : [],
    profileResult.error == null && profileResult.data
      ? profileResult.data.plannerType
      : "Unknown",
    workShiftsResult.error == null ? workShiftsResult.data : [],
    importedEventsResult.error == null
      ? getRelevantImportedCalendarEvents(importedEventsResult.data)
      : [],
  );
}

export async function POST(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = (await request.json().catch(() => ({}))) as {
    approvedSuggestions?: unknown;
  };

  if (!Array.isArray(body.approvedSuggestions)) {
    return NextResponse.json(
      { error: "Send approvedSuggestions as an array." },
      { status: 400 },
    );
  }

  if (body.approvedSuggestions.length === 0) {
    return NextResponse.json(
      { error: "Approve at least one suggestion before applying." },
      { status: 400 },
    );
  }

  if (body.approvedSuggestions.length > maxApprovedSuggestions) {
    return NextResponse.json(
      { error: `Apply at most ${maxApprovedSuggestions} suggestions at a time.` },
      { status: 400 },
    );
  }

  const suggestions = body.approvedSuggestions.map((rawSuggestion, index) => {
    return {
      normalized: normalizeAssistantSuggestions([rawSuggestion])[0] ?? null,
      fallbackId: `approved-${index + 1}`,
    };
  });

  const [
    projectsResult,
    weeklyPlanResult,
    workShiftsResult,
    importedEventsResult,
    scheduledItemsResult,
  ] = await Promise.all([
    fetchProjectsForUser(authResult.supabase, authResult.userId),
    fetchWeeklyPlanBlocksForUser(authResult.supabase, authResult.userId),
    fetchWorkShiftsForUser(authResult.supabase, authResult.userId),
    fetchImportedCalendarEventsForUser(authResult.supabase, authResult.userId),
    fetchScheduledItemsForUser(authResult.supabase, authResult.userId),
  ]);

  if (projectsResult.error || weeklyPlanResult.error || scheduledItemsResult.error) {
    return NextResponse.json(
      {
        error: `Could not load scheduler data before applying suggestions. ${[
          projectsResult.error,
          weeklyPlanResult.error,
          scheduledItemsResult.error,
        ]
          .filter(Boolean)
          .map(getErrorMessage)
          .join(" ")}`,
      },
      { status: 500 },
    );
  }

  const currentProjects = [...projectsResult.data];
  const currentBlocks = [...weeklyPlanResult.data];
  const currentScheduledItems = [...scheduledItemsResult.data];
  const workShifts = workShiftsResult.error ? [] : [...workShiftsResult.data];
  const importedCalendarEvents =
    importedEventsResult.error == null
      ? getRelevantImportedCalendarEvents(importedEventsResult.data)
      : [];
  const results: AssistantApplyResult[] = [];
  let appliedBlockCount = 0;

  for (const item of suggestions) {
    if (!item.normalized) {
      results.push({
        suggestionId: item.fallbackId,
        suggestionTitle: "Invalid suggestion",
        type: "workload_warning",
        status: "error",
        message: "Suggestion payload did not match the safe assistant schema.",
      });
      continue;
    }

    const unsupportedMessage = validateActionableSuggestion(item.normalized);

    if (unsupportedMessage) {
      results.push(createResult(item.normalized, "skipped", unsupportedMessage));
      continue;
    }

    if (item.normalized.type === "suggested_weekly_block") {
      const result = await applyWeeklyBlockSuggestion({
        appliedBlockCount,
        currentBlocks,
        importedCalendarEvents,
        suggestion: item.normalized,
        supabase: authResult.supabase,
        userId: authResult.userId,
        workShifts,
      });

      results.push(result);

      if (result.status === "applied") {
        appliedBlockCount += 1;
      }

      continue;
    }

    if (item.normalized.type === "suggested_scheduled_item") {
      results.push(
        await applyScheduledItemSuggestion({
          currentScheduledItems,
          suggestion: item.normalized,
          supabase: authResult.supabase,
          userId: authResult.userId,
        }),
      );
      continue;
    }

    if (item.normalized.type === "new_project") {
      results.push(
        await applyNewProjectSuggestion({
          currentProjects,
          suggestion: item.normalized,
          supabase: authResult.supabase,
          userId: authResult.userId,
        }),
      );
      continue;
    }

    if (item.normalized.type === "update_project") {
      results.push(
        await applyProjectUpdateSuggestion({
          currentProjects,
          suggestion: item.normalized,
          supabase: authResult.supabase,
          userId: authResult.userId,
        }),
      );
      continue;
    }

    results.push(
      await applyNextActionSuggestion({
        currentProjects,
        suggestion: item.normalized,
        supabase: authResult.supabase,
        userId: authResult.userId,
      }),
    );
  }

  const appliedCount = results.filter((result) => result.status === "applied").length;
  const context = await loadContextSummary(authResult.supabase, authResult.userId);
  const response: AssistantApplyResponse = {
    context,
    message:
      appliedCount > 0
        ? `Applied ${appliedCount} approved ${appliedCount === 1 ? "suggestion" : "suggestions"}.`
        : "No approved suggestions were applied.",
    results,
  };

  return NextResponse.json(response);
}
