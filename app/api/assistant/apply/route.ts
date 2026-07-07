import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  createAssistantContextSummary,
  getAssistantCurrentWeekStartInput,
  getRelevantImportedCalendarEvents,
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
  fetchScheduleExceptionsForUser,
  fetchWorkShiftsForUser,
  fetchWeeklyPlanBlocksForUser,
  createScheduledItemForUser,
  createScheduleExceptionForUser,
  createWeeklyPlanBlockForUser,
  deleteWeeklyPlanBlockForUser,
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
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import { formatWorkShiftRange, type WorkShift } from "@/lib/work-schedule";
import {
  getEffectiveWorkShiftsForDate,
  validateScheduleExceptionDraft,
  type ScheduleException,
  type ScheduleExceptionDraft,
} from "@/lib/schedule-exceptions";
import { getUserFacingError } from "@/lib/user-facing-error";
import {
  loadAssistantWorkflowById,
  persistAssistantWorkflow,
  updateAssistantProposalResults,
} from "@/lib/assistant-workflow-store";
import { getCanonicalPendingProposals } from "@/lib/assistant-workflow";
import {
  decideAssistantAutomation,
  resolveAssistantWorkflowStatus,
  type AutomationGrant,
  type CompactActionReceipt,
  type PlanningDecisionRecord,
} from "@/lib/assistant-automation";
import {
  loadAutomationGrantById,
  persistActionReceipt,
  persistPlanningDecision,
  updateAutomationGrantStatus,
} from "@/lib/assistant-automation-store";

export const dynamic = "force-dynamic";

const maxApprovedSuggestions = 120;

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
  return getUserFacingError(
    error,
    "The approved suggestion could not be applied.",
  );
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
      if (error) {
        console.error("Assistant apply session verification failed", error);
      }
      return NextResponse.json(
        { error: "Session could not be verified. Please sign in again." },
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
    workflowId: suggestion.workflowId,
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
    suggestion.type !== "suggested_next_action" &&
    suggestion.type !== "schedule_exception"
  ) {
    return "This suggestion is informational and cannot be applied automatically.";
  }

  return null;
}

async function applyScheduleExceptionSuggestion({
  currentExceptions,
  currentWorkShifts,
  suggestion,
  supabase,
  userId,
}: {
  currentExceptions: ScheduleException[];
  currentWorkShifts: WorkShift[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
}) {
  if (
    suggestion.type !== "schedule_exception" ||
    suggestion.exceptionType !== "modify_shift" ||
    !suggestion.exceptionDate ||
    !suggestion.relatedWorkShiftId
  ) {
    return createResult(
      suggestion,
      "error",
      "The one-day work change is missing required details.",
    );
  }

  const relatedShift = currentWorkShifts.find(
    (shift) => shift.id === suggestion.relatedWorkShiftId,
  );

  if (!relatedShift) {
    return createResult(
      suggestion,
      "error",
      "The recurring work shift no longer exists. Review Work Schedule before applying this change.",
    );
  }

  const duplicate = currentExceptions.find(
    (exception) =>
      exception.date === suggestion.exceptionDate &&
      exception.relatedWorkShiftId === relatedShift.id &&
      exception.exceptionType === "modify_shift",
  );

  if (duplicate) {
    return createResult(
      suggestion,
      "skipped",
      "A one-day change already exists for this work shift.",
    );
  }

  const draft: ScheduleExceptionDraft = {
    date: suggestion.exceptionDate,
    exceptionType: "modify_shift",
    relatedWorkShiftId: relatedShift.id,
    originalStartTime: relatedShift.startTime,
    originalEndTime: relatedShift.endTime,
    overrideStartTime: suggestion.overrideStartTime ?? relatedShift.startTime,
    overrideEndTime: suggestion.overrideEndTime ?? null,
    title: suggestion.title || "Leave work early",
    notes: suggestion.plannedTask ?? "Approved through Planning Assistant.",
    createdBy: "assistant_approved",
  };
  const validationMessage = validateScheduleExceptionDraft(draft);

  if (validationMessage) {
    return createResult(suggestion, "error", validationMessage);
  }

  const result = await createScheduleExceptionForUser(supabase, userId, draft);

  if (result.error || !result.data) {
    const message = result.error?.message ?? "";
    return createResult(
      suggestion,
      "error",
      message.includes("schedule_exceptions")
        ? "Temporary schedule changes are not available yet. Your recurring shift was not changed."
        : getErrorMessage(message || "The one-day work change could not be saved."),
    );
  }

  currentExceptions.push(result.data);

  return {
    ...createResult(
      suggestion,
      "applied",
      "Updated today’s work shift. Future recurring shifts were not changed.",
    ),
    calendarHref: `/calendar?date=${suggestion.exceptionDate}&view=week`,
  };
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
      getErrorMessage(result.error ?? "Scheduled item could not be saved."),
    );
  }

  currentScheduledItems.push(result.data);

  return {
    ...createResult(
      suggestion,
      "applied",
      itemType === "appointment"
        ? "Appointment added to your schedule."
        : "Task added to your schedule.",
    ),
    savedRecordId: result.data.id,
  };
}

async function applyWeeklyBlockSuggestion({
  appliedBlockCount,
  currentBlocks,
  currentScheduledItems,
  importedCalendarEvents,
  suggestion,
  supabase,
  userId,
  workShifts,
  scheduleExceptions,
}: {
  appliedBlockCount: number;
  currentBlocks: WeeklyPlanBlock[];
  currentScheduledItems: ScheduledItem[];
  importedCalendarEvents: ImportedCalendarEvent[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
  workShifts: WorkShift[];
  scheduleExceptions: ScheduleException[];
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

  if (suggestion.workflowId && !startTime) {
    return createResult(
      suggestion,
      "error",
      "This proposal selected an exact opening, so it must keep its validated start time.",
    );
  }

  const createdDate = getDateForWeekDay(weekStartDate, suggestion.day);
  const effectiveWorkShifts = getEffectiveWorkShiftsForDate(
    workShifts,
    scheduleExceptions,
    createdDate,
    suggestion.day,
  );

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
    ...(suggestion.itemDate ? { scheduledDate: suggestion.itemDate } : {}),
    ...(suggestion.batchId ? { seriesId: suggestion.batchId } : {}),
    ...(startTime ? { startTime } : {}),
  };
  const candidateStart = parseStartTimeToMinutes(startTime);
  const candidateEnd =
    candidateStart === null
      ? null
      : candidateStart + suggestion.estimatedHours * 60;
  const existingWeeklyConflict =
    candidateStart === null || candidateEnd === null
      ? null
      : currentBlocks.find((block) => {
          if (block.day !== suggestion.day) return false;
          if (
            block.scheduledDate &&
            block.scheduledDate !== createdDate
          ) {
            return false;
          }
          const blockStart = parseStartTimeToMinutes(block.startTime);
          if (blockStart === null) return false;
          const blockEnd = blockStart + block.estimatedHours * 60;
          return candidateStart < blockEnd && candidateEnd > blockStart;
        });
  const existingItemConflict =
    candidateStart === null || candidateEnd === null
      ? null
      : currentScheduledItems.find((item) => {
          if (item.itemDate !== createdDate) return false;
          const itemStart = parseStartTimeToMinutes(item.startTime);
          if (itemStart === null) return false;
          const itemEnd = itemStart + item.estimatedHours * 60;
          return candidateStart < itemEnd && candidateEnd > itemStart;
        });

  if (existingWeeklyConflict || existingItemConflict) {
    return createResult(
      suggestion,
      "error",
      `That ${suggestion.day} window now overlaps “${
        existingWeeklyConflict?.projectName ?? existingItemConflict?.title
      }”. Review the proposal and recalculate before applying.`,
    );
  }
  const weekStart = new Date(`${weekStartDate}T00:00:00`);
  const workConflict = getWeeklyPlanWorkConflictForBlock(
    candidateBlock,
    effectiveWorkShifts,
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
    return createResult(suggestion, "error", getErrorMessage(error));
  }

  const createdBlock = candidateBlock;

  currentBlocks.push(createdBlock);

  const workRanges = effectiveWorkShifts
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
    savedRecordId: createdBlock.id,
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
    return createResult(suggestion, "error", getErrorMessage(error));
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
    return createResult(suggestion, "error", getErrorMessage(error));
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
    return createResult(suggestion, "error", getErrorMessage(error));
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
    automationGrantId?: unknown;
    proposalIds?: unknown;
    workflowId?: unknown;
  };
  const automationGrantId =
    typeof body.automationGrantId === "string"
      ? body.automationGrantId.trim()
      : "";
  const workflowId =
    typeof body.workflowId === "string" ? body.workflowId.trim() : "";
  const proposalIds = Array.isArray(body.proposalIds)
    ? body.proposalIds.filter(
        (proposalId): proposalId is string =>
          typeof proposalId === "string" && proposalId.length > 0,
      )
    : [];

  if (!workflowId || !Array.isArray(body.proposalIds)) {
    return NextResponse.json(
      { error: "Send a workflowId and proposalIds array." },
      { status: 400 },
    );
  }

  if (proposalIds.length === 0) {
    return NextResponse.json(
      { error: "Approve at least one suggestion before applying." },
      { status: 400 },
    );
  }

  if (proposalIds.length > maxApprovedSuggestions) {
    return NextResponse.json(
      { error: `Apply at most ${maxApprovedSuggestions} suggestions at a time.` },
      { status: 400 },
    );
  }

  const workflowResult = await loadAssistantWorkflowById(
    authResult.supabase,
    authResult.userId,
    workflowId,
  );

  if (workflowResult.error || !workflowResult.data) {
    return NextResponse.json(
      {
        error:
          "The persisted proposal workflow could not be loaded. No schedule changes were applied.",
      },
      { status: workflowResult.error ? 500 : 404 },
    );
  }

  let automationGrant: AutomationGrant | null = null;
  if (automationGrantId) {
    const grantResult = await loadAutomationGrantById(
      authResult.supabase,
      authResult.userId,
      automationGrantId,
    );
    if (
      grantResult.error ||
      !grantResult.data ||
      grantResult.data.status !== "active" ||
      grantResult.data.workflowId !== workflowId ||
      (grantResult.data.expiresAt &&
        new Date(grantResult.data.expiresAt).getTime() <= Date.now())
    ) {
      return NextResponse.json(
        {
          error:
            "The scoped automation permission is missing, expired, or does not match this workflow. Nothing was applied.",
        },
        { status: 403 },
      );
    }
    automationGrant = grantResult.data;
  }

  const proposalById = new Map(
    getCanonicalPendingProposals(
      workflowResult.data.workflow,
      workflowResult.data.proposals,
    ).map((proposal) => [proposal.id, proposal]),
  );
  const suggestions = proposalIds.map((proposalId) => ({
    normalized:
      proposalById.get(proposalId)?.approvalStatus === "pending"
        ? proposalById.get(proposalId)?.suggestion ?? null
        : null,
    fallbackId: proposalId,
  }));

  if (suggestions.some((item) => !item.normalized)) {
    return NextResponse.json(
      {
        error:
          "One or more selected proposals are missing, already handled, or do not belong to this workflow. Nothing was applied.",
      },
      { status: 409 },
    );
  }

  const normalizedSuggestions = suggestions.flatMap((item) =>
    item.normalized ? [item.normalized] : [],
  );

  const [
    projectsResult,
    weeklyPlanResult,
    workShiftsResult,
    importedEventsResult,
    scheduledItemsResult,
    scheduleExceptionsResult,
  ] = await Promise.all([
    fetchProjectsForUser(authResult.supabase, authResult.userId),
    fetchWeeklyPlanBlocksForUser(authResult.supabase, authResult.userId),
    fetchWorkShiftsForUser(authResult.supabase, authResult.userId),
    fetchImportedCalendarEventsForUser(authResult.supabase, authResult.userId),
    fetchScheduledItemsForUser(authResult.supabase, authResult.userId),
    fetchScheduleExceptionsForUser(authResult.supabase, authResult.userId),
  ]);

  if (
    projectsResult.error ||
    weeklyPlanResult.error ||
    scheduledItemsResult.error
  ) {
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

  if (
    automationGrant &&
    (workShiftsResult.error ||
      importedEventsResult.error ||
      scheduleExceptionsResult.error)
  ) {
    return NextResponse.json(
      {
        error:
          "I couldn’t load enough schedule data to revalidate the automated plan. Nothing was applied.",
      },
      { status: 503 },
    );
  }

  const automationDecision = automationGrant
    ? decideAssistantAutomation({
        grant: automationGrant,
        sourceDataComplete: true,
        suggestions: normalizedSuggestions,
        workflowId,
      })
    : null;
  if (automationDecision && automationDecision.outcome !== "auto_apply") {
    return NextResponse.json(
      {
        error:
          "The proposals no longer fit the scoped automation permission. Nothing was applied.",
      },
      { status: 409 },
    );
  }

  const decisionId = automationGrant
    ? `decision-${workflowId}-${Date.now()}`
    : null;
  const decisionCreatedAt = new Date().toISOString();
  const pendingDecision: PlanningDecisionRecord | null =
    automationGrant && automationDecision && decisionId
      ? {
          actionType:
            normalizedSuggestions.length > 1
              ? "create_time_block_series"
              : "create_time_block",
          automationMode: "auto_applied",
          constraintsUsed: Object.entries(automationGrant.guardrails)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key]) => key)
            .concat(
              workflowResult.data.workflow.context?.temporaryScheduleContext
                ?.affectedCandidateCalculation
                ? ["temporary_work_context"]
                : [],
            ),
          createdAt: decisionCreatedAt,
          grantId: automationGrant.id,
          id: decisionId,
          preferencesUsed: [
            ...(automationGrant.guardrails.earliestTime ? ["preferred_evening_start"] : []),
            ...(automationGrant.guardrails.latestTime ? ["latest_finish_time"] : []),
            ...(automationGrant.guardrails.minimumBufferAfterWorkMinutes
              ? ["buffer_after_work"]
              : []),
          ],
          proposalIds,
          reasonCodes: automationDecision.reasonCodes,
          reversibleUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          scheduleExceptionIds: [],
          status: "pending",
          targetRecordIds: [],
          userId: authResult.userId,
          workflowId,
        }
      : null;
  const currentProjects = [...projectsResult.data];
  const currentBlocks = [...weeklyPlanResult.data];
  const currentScheduledItems = [...scheduledItemsResult.data];
  const currentScheduleExceptions = scheduleExceptionsResult.error
    ? []
    : [...scheduleExceptionsResult.data];
  const workShifts = workShiftsResult.error ? [] : [...workShiftsResult.data];
  const temporaryScheduleContext =
    workflowResult.data.workflow.context?.temporaryScheduleContext;
  if (
    automationGrant &&
    temporaryScheduleContext?.relatedWorkShiftId
  ) {
    const relatedShift = workShifts.find(
      (shift) => shift.id === temporaryScheduleContext.relatedWorkShiftId,
    );
    if (relatedShift) {
      currentScheduleExceptions.push({
        createdBy: "assistant_approved",
        date: temporaryScheduleContext.date,
        exceptionType: "modify_shift",
        id: `workflow-context-${temporaryScheduleContext.date}-${relatedShift.id}`,
        notes: "Temporary automation context; not persisted as a Work Schedule change.",
        originalEndTime: temporaryScheduleContext.originalEndTime,
        originalStartTime: relatedShift.startTime,
        overrideEndTime: temporaryScheduleContext.overrideEndTime,
        overrideStartTime: relatedShift.startTime,
        relatedWorkShiftId: relatedShift.id,
        title: "Temporary early departure context",
      });
    }
  }
  if (automationGrant?.guardrails.minimumBufferAfterWorkMinutes) {
    const buffer = automationGrant.guardrails.minimumBufferAfterWorkMinutes;
    const violatesBuffer = normalizedSuggestions.some((suggestion) => {
      if (!suggestion.itemDate || !suggestion.startTime || !suggestion.day) return true;
      const proposalStart = parseStartTimeToMinutes(suggestion.startTime);
      const workEnd = getEffectiveWorkShiftsForDate(
        workShifts,
        currentScheduleExceptions,
        suggestion.itemDate,
        suggestion.day,
      ).reduce((latest, shift) => {
        const end = parseStartTimeToMinutes(shift.endTime);
        return end === null ? latest : Math.max(latest, end);
      }, 0);
      return proposalStart === null || (workEnd > 0 && proposalStart < workEnd + buffer);
    });
    if (violatesBuffer) {
      return NextResponse.json(
        {
          error:
            "The proposed times no longer satisfy the requested buffer after work. Nothing was applied.",
        },
        { status: 409 },
      );
    }
  }
  if (pendingDecision) {
    const decisionResult = await persistPlanningDecision(
      authResult.supabase,
      pendingDecision,
    );
    if (decisionResult.error) {
      return NextResponse.json(
        {
          error:
            "I couldn’t create an audit record for automatic scheduling. Nothing was applied.",
        },
        { status: 500 },
      );
    }
  }
  const applyingWorkflow = {
    ...workflowResult.data.workflow,
    lastUpdatedAt: new Date().toISOString(),
    state: "applying" as const,
  };
  const applyingPersistence = await persistAssistantWorkflow(
    authResult.supabase,
    applyingWorkflow,
    workflowResult.data.proposals,
    workflowResult.data.batch,
  );
  if (applyingPersistence.error || !applyingPersistence.data) {
    if (pendingDecision) {
      await persistPlanningDecision(authResult.supabase, {
        ...pendingDecision,
        status: "failed",
      });
    }
    return NextResponse.json(
      {
        error:
          "I couldn’t record the applying state safely. Nothing was applied.",
      },
      { status: 500 },
    );
  }
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
        currentScheduledItems,
        importedCalendarEvents,
        suggestion: item.normalized,
        supabase: authResult.supabase,
        userId: authResult.userId,
        workShifts,
        scheduleExceptions: currentScheduleExceptions,
      });

      results.push(result);

      if (result.status === "applied") {
        appliedBlockCount += 1;
      }

      continue;
    }

    if (item.normalized.type === "schedule_exception") {
      results.push(
        await applyScheduleExceptionSuggestion({
          currentExceptions: currentScheduleExceptions,
          currentWorkShifts: workShifts,
          suggestion: item.normalized,
          supabase: authResult.supabase,
          userId: authResult.userId,
        }),
      );
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
  const failedCount = results.filter((result) => result.status !== "applied").length;
  const appliedMessages = results
    .filter((result) => result.status === "applied")
    .map((result) => result.message);
  const workflowUpdate = await updateAssistantProposalResults(
    authResult.supabase,
    workflowResult.data.workflow,
    results
      .filter(
        (result): result is AssistantApplyResult & { savedRecordId: string } =>
          result.status === "applied" && Boolean(result.savedRecordId),
      )
      .map((result) => ({
        approvalStatus: "applied" as const,
        proposalId: result.suggestionId,
        savedRecordId: result.savedRecordId,
      })),
  );

  console.info("assistant_workflow", {
    appliedCount,
    event: "apply_completed",
    failedCount,
    persistenceResult: workflowUpdate.error ? "failed" : "persisted",
    proposalCount: proposalIds.length,
    workflowId,
  });

  if (workflowUpdate.error || !workflowUpdate.data) {
    const createdWeeklyBlockIds = results.flatMap((result) =>
      result.status === "applied" &&
      result.type === "suggested_weekly_block" &&
      result.savedRecordId
        ? [result.savedRecordId]
        : [],
    );
    const rollbackResults = await Promise.all(
      createdWeeklyBlockIds.map((blockId) =>
        deleteWeeklyPlanBlockForUser(
          authResult.supabase,
          authResult.userId,
          blockId,
        ),
      ),
    );
    console.error("assistant_workflow", {
      event: "apply_persistence_failed",
      rollbackFailed: rollbackResults.some((result) => Boolean(result.error)),
      rolledBackTimeBlockCount: rollbackResults.filter(
        (result) => !result.error,
      ).length,
      workflowId,
    });
    return NextResponse.json(
      {
        error:
          "I couldn’t record the result of applying the approved sessions. No success confirmation was recorded.",
      },
      { status: 500 },
    );
  }

  let automationReceipt: CompactActionReceipt | null = null;
  if (pendingDecision && automationGrant && decisionId) {
    const appliedWeeklyResults = results.filter(
      (result) =>
        result.status === "applied" &&
        result.type === "suggested_weekly_block" &&
        Boolean(result.savedRecordId),
    );
    const targetRecordIds = appliedWeeklyResults.flatMap((result) =>
      result.savedRecordId ? [result.savedRecordId] : [],
    );
    const snapshotResult = targetRecordIds.length
      ? await authResult.supabase
          .from("weekly_plan_blocks")
          .select(
            "block_id, project_name, planned_task, estimated_hours, start_time, scheduled_date, series_id, inserted_at, updated_at",
          )
          .eq("user_id", authResult.userId)
          .in("block_id", targetRecordIds)
      : { data: [], error: null };
    const finalDecision: PlanningDecisionRecord = {
      ...pendingDecision,
      afterState: { records: snapshotResult.data ?? [] },
      status:
        appliedWeeklyResults.length === 0
          ? "failed"
          : appliedWeeklyResults.length === proposalIds.length
            ? "applied"
            : "partially_applied",
      targetRecordIds,
    };
    const sortedApplied = [...appliedWeeklyResults].sort(
      (first, second) =>
        `${first.createdDate ?? ""}${first.createdBlock?.startTime ?? ""}`.localeCompare(
          `${second.createdDate ?? ""}${second.createdBlock?.startTime ?? ""}`,
        ),
    );
    const firstApplied = sortedApplied[0];
    const activityTitle =
      workflowUpdate.data.workflow.context?.semanticRequest?.activity.title ??
      firstApplied?.suggestionTitle ??
      "Automated plan";
    automationReceipt = {
      actionType:
        appliedWeeklyResults.length > 0 ? "plan_applied" : "action_failed",
      availableActions:
        appliedWeeklyResults.length > 0 ? ["undo", "view"] : ["view"],
      createdAt: decisionCreatedAt,
      decisionRecordId: decisionId,
      id: `receipt-${decisionId}`,
      itemCount: appliedWeeklyResults.length,
      nextOccurrenceAt:
        firstApplied?.createdDate && firstApplied.createdBlock?.startTime
          ? `${firstApplied.createdDate}T${firstApplied.createdBlock.startTime}:00`
          : undefined,
      primaryTime:
        firstApplied?.createdDate && firstApplied.createdBlock?.startTime
          ? `${firstApplied.createdDate}T${firstApplied.createdBlock.startTime}:00`
          : undefined,
      summary:
        appliedWeeklyResults.length === proposalIds.length
          ? `${appliedWeeklyResults.length} Schedule Builder time blocks were added.`
          : `${appliedWeeklyResults.length} of ${proposalIds.length} Schedule Builder time blocks were added.`,
      title: `${activityTitle} plan`,
      userId: authResult.userId,
    };
    const [decisionResult, receiptResult, grantResult] = await Promise.all([
      persistPlanningDecision(authResult.supabase, finalDecision),
      persistActionReceipt(authResult.supabase, automationReceipt),
      updateAutomationGrantStatus(
        authResult.supabase,
        authResult.userId,
        automationGrant.id,
        "consumed",
      ),
    ]);
    if (
      snapshotResult.error ||
      snapshotResult.data?.length !== targetRecordIds.length ||
      decisionResult.error ||
      receiptResult.error ||
      grantResult.error
    ) {
      await Promise.all(
        targetRecordIds.map((blockId) =>
          deleteWeeklyPlanBlockForUser(
            authResult.supabase,
            authResult.userId,
            blockId,
          ),
        ),
      );
      await updateAssistantProposalResults(
        authResult.supabase,
        workflowUpdate.data.workflow,
        appliedWeeklyResults.map((result) => ({
          approvalStatus: "pending" as const,
          proposalId: result.suggestionId,
        })),
      );
      await persistPlanningDecision(authResult.supabase, {
        ...finalDecision,
        afterState: null,
        status: "failed",
        targetRecordIds: [],
      });
      await persistActionReceipt(authResult.supabase, {
        ...automationReceipt,
        actionType: "action_failed",
        availableActions: ["view"],
        itemCount: 0,
        summary:
          "The automatic changes were rolled back because a reversible receipt could not be recorded.",
      });
      await updateAutomationGrantStatus(
        authResult.supabase,
        authResult.userId,
        automationGrant.id,
        "revoked",
      );
      return NextResponse.json(
        {
          error:
            "I couldn’t record a reversible automation receipt, so the automatic changes were rolled back. Nothing was confirmed as scheduled.",
        },
        { status: 500 },
      );
    }
  }

  const context = await loadContextSummary(authResult.supabase, authResult.userId);
  const series = workflowUpdate.data.workflow.context?.seriesProposal;
  const activityTitle =
    workflowUpdate.data.workflow.context?.semanticRequest?.activity.title ??
    "requested";
  const activityReference = /read the sealed nectar/i.test(activityTitle)
    ? "Sealed Nectar reading"
    : activityTitle;
  const applyMessage =
    appliedCount > 0 && series && proposalIds.length > 5
      ? failedCount > 0
        ? `Partly. ${appliedCount} ${activityReference} sessions were added, and ${failedCount} still need attention.`
        : `Yes. Added ${appliedCount} ${activityReference} sessions across the next ${series.planningHorizon.weeks} weeks.`
      : appliedCount > 0
        ? `${failedCount > 0 ? "Partly." : "Yes."} ${appliedMessages.join(" ")}`
        : "No. I couldn’t apply the approved sessions. No success confirmation was recorded.";
  const response: AssistantApplyResponse = {
    automationReceipt,
    canonicalProposals: workflowUpdate.data.proposals,
    completionStatus: workflowUpdate.data.workflow.completionStatus,
    context,
    message: applyMessage,
    proposalBatch: workflowUpdate.data.batch,
    results,
    workflow: workflowUpdate.data.workflow,
    workflowStatus: resolveAssistantWorkflowStatus({
      workflow: workflowUpdate.data.workflow,
    }),
  };

  return NextResponse.json(response);
}
