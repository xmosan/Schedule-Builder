import type { PlannerType } from "@/lib/onboarding";
import type {
  AssistantCompletionStatus,
  AssistantTurnResult,
} from "@/lib/assistant-intelligence";
import {
  createDeterministicScheduleAnswer,
  type AssistantScheduleAnalysisInput,
  type AssistantSchedulingContext,
} from "@/lib/assistant-schedule-analysis";
import type { CalendarDeadline } from "@/lib/calendar";
import {
  getExactProjectDeadlineDate,
  getProjectDeadlineBuckets,
} from "@/lib/calendar";
import {
  getPlannedHours,
  projectCategories,
  priorityScore,
  priorityLevels,
  sortProjectsForFocus,
  type Project,
  type ProjectCategory,
  type ProjectPriority,
} from "@/lib/projects";
import {
  describeWeeklyPlanWorkConflict,
  describeWeeklyPlanImportedEventConflict,
  findScheduledItemConflicts,
  findWeeklyPlanImportedEventConflicts,
  findWeeklyPlanWorkConflicts,
  getDayWorkShiftRanges,
  getWeeklyPlanImportedEventConflictForBlock,
  getWeeklyPlanWorkConflictForBlock,
  getWorkHoursByDay,
  getWorkScheduleSummary,
  type WeeklyPlanImportedEventConflict,
  type WeeklyPlanWorkConflict,
} from "@/lib/schedule-conflicts";
import {
  formatScheduledItemTimeLabel,
  isScheduledItemType,
  normalizeScheduledItemDate,
  parseScheduledItemDate,
  type ScheduledItem,
  type ScheduledItemType,
} from "@/lib/scheduled-items";
import {
  getImportedEventDurationHours,
  isScheduleBuilderExportedEvent,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import {
  formatEstimatedHours,
  formatStartTime,
  normalizeStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import {
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";
import {
  isScheduleExceptionType,
  type ScheduleException,
  type ScheduleExceptionType,
} from "@/lib/schedule-exceptions";

export const assistantSuggestionTypes = [
  "new_project",
  "update_project",
  "suggested_scheduled_item",
  "suggested_weekly_block",
  "suggested_next_action",
  "schedule_exception",
  "workload_warning",
  "missing_deadline_warning",
  "unclear_project_warning",
] as const;

export const assistantPlanningSuggestionTypes = [
  "new_project",
  "update_project",
  "suggested_scheduled_item",
  "suggested_weekly_block",
  "suggested_next_action",
  "schedule_exception",
  "workload_warning",
  "missing_deadline_warning",
  "unclear_project_warning",
] as const;

export type AssistantSuggestionType = (typeof assistantSuggestionTypes)[number];
export type AssistantSuggestionSeverity = "info" | "warning" | "important";
export type AssistantSource = "ai" | "fallback";

export type AssistantContextSourceState =
  | "available"
  | "empty"
  | "failed"
  | "not_connected";

export type AssistantContextSourceStatus = {
  detail: string;
  lastUpdatedAt?: string | null;
  state: AssistantContextSourceState;
};

export type AssistantContextStatus = {
  externalCalendars: AssistantContextSourceStatus;
  googleCalendar: AssistantContextSourceStatus;
  importedCalendars: AssistantContextSourceStatus;
  projects: AssistantContextSourceStatus;
  refreshedAt: string;
  scheduleExceptions: AssistantContextSourceStatus;
  weeklyPlan: AssistantContextSourceStatus;
  workSchedule: AssistantContextSourceStatus;
};

export type AssistantContextSummary = {
  activeProjectsCount: number;
  calendarConflictCount: number;
  deadlinesNeedingDatesCount: number;
  deadlinesWithDatesCount: number;
  googleSyncNeedsAttentionCount: number;
  googleSyncNeedsTimeCount: number;
  googleSyncOvernightCount: number;
  googleSyncReadyCount: number;
  googleSyncSyncedCount: number;
  importedEventConflictCount: number;
  importedEventsCount: number;
  plannedWeeklyHours: number;
  plannerType: PlannerType | "Unknown";
  totalWeeklyBlockHours: number;
  weeklyBlocksCount: number;
  workScheduleHours: number;
  workShiftsCount: number;
};

export type AssistantPlanningContext = AssistantContextSummary & {
  calendarConflicts: WeeklyPlanWorkConflict[];
  deadlinesNeedingDates: CalendarDeadline[];
  deadlinesWithDates: CalendarDeadline[];
  googleSync: AssistantGoogleSyncContext;
  importedCalendarEvents: ImportedCalendarEvent[];
  importedEventConflicts: WeeklyPlanImportedEventConflict[];
  projects: Project[];
  scheduleExceptions: ScheduleException[];
  scheduledItems: ScheduledItem[];
  timezone: string;
  weeklyPlanBlocks: WeeklyPlanBlock[];
  workScheduleSummary: string | null;
  workShifts: WorkShift[];
};

export type AssistantSuggestion = {
  id: string;
  type: AssistantSuggestionType;
  title: string;
  description: string;
  confidence: number;
  summary: string;
  rationale: string;
  severity: AssistantSuggestionSeverity;
  category?: ProjectCategory;
  conflictWarnings?: string[];
  deadline?: string;
  itemDate?: string;
  itemType?: ScheduledItemType;
  location?: string;
  newProjectName?: string;
  projectName?: string;
  priority?: ProjectPriority;
  day?: WeekDay;
  estimatedHours?: number;
  exceptionDate?: string;
  exceptionType?: ScheduleExceptionType;
  originalEndTime?: string;
  originalStartTime?: string;
  overrideEndTime?: string;
  overrideStartTime?: string;
  plannedTask?: string;
  proposedNextAction?: string;
  relatedWorkShiftId?: string;
  startTime?: string;
  weeklyHours?: number;
  batchId?: string;
  workflowId?: string;
};

export type AssistantPlanReviewResponse = {
  actions: AssistantSuggestion[];
  assistantMessage: string;
  context: AssistantContextSummary;
  contextStatus?: AssistantContextStatus;
  dataWarning?: string | null;
  message: string;
  source: AssistantSource;
  suggestions: AssistantSuggestion[];
  schedulingContext?: AssistantSchedulingContext | null;
  turnResult?: AssistantTurnResult;
};

export type AssistantApplyResultStatus = "applied" | "error" | "skipped";

export type AssistantApplyResult = {
  calendarHref?: string;
  createdBlock?: WeeklyPlanBlock;
  createdDate?: string;
  planHref?: string;
  suggestionId: string;
  suggestionTitle: string;
  type: AssistantSuggestionType;
  status: AssistantApplyResultStatus;
  message: string;
  savedRecordId?: string;
  workflowId?: string;
};

export type AssistantApplyResponse = {
  completionStatus: AssistantCompletionStatus;
  context: AssistantContextSummary;
  message: string;
  results: AssistantApplyResult[];
};

type AssistantHistoryItem = {
  content: string;
  role: "assistant" | "user";
};

export type AssistantGoogleSyncRow = {
  blockSnapshot?: unknown;
  googleEventHtmlLink?: string | null;
  syncStatus: "synced" | "needs_attention";
  syncedTitle?: string | null;
  weeklyPlanBlockId: string | null;
};

export type AssistantGoogleSyncBlock = {
  day: WeekDay;
  durationHours: number;
  id: string;
  plannedTask: string;
  projectName: string;
  startTime: string | null;
  warnings: string[];
};

export type AssistantGoogleSyncContext = {
  conflictBlocks: AssistantGoogleSyncBlock[];
  currentWeekStart: string;
  needsAttentionBlocks: AssistantGoogleSyncBlock[];
  needsTimeBlocks: AssistantGoogleSyncBlock[];
  overnightBlocks: AssistantGoogleSyncBlock[];
  readyBlocks: AssistantGoogleSyncBlock[];
  removedSyncedEvents: Array<{
    googleEventHtmlLink?: string | null;
    syncedTitle?: string | null;
  }>;
  syncCalendarName: string | null;
  syncEnabled: boolean;
  syncedBlocks: AssistantGoogleSyncBlock[];
};

const maxDefaultAssistantCards = 4;
const maxDefaultWarningCards = 2;
const importedEventLookaheadDays = 30;

const greetingPattern = /^(hey|hello|hi|salam|assalamu alaikum|yo|sup|good morning|good afternoon|good evening)[\s!.?]*$/i;
const vaguePromptPattern = /^(anything|whatever|what now|now what|help|idk|i don't know|not sure|surprise me)[\s!.?]*$/i;
const planningIntentPattern =
  /\b(plan|schedule|week|weekly|block|blocks|overlap|conflict|conflicts|overload|overloaded|priority|priorities|top 3|study|balance|deadline|deadlines|next action|project|projects|workload|time|focus|first|open time|open|study|sync|synced|google calendar|calendar|start time|start times|task|tasks|appointment|appointments|errand|errands|reminder|reminders)\b/i;
const actionCardIntentPattern =
  /\b(plan my week|plan this week|make a plan|create blocks?|create .*blocks?|add .*blocks?|add a .*block|add .*calendar|add .*appointment|add .*task|add .*reminder|add .*errand|remind me|schedule .*blocks?|schedule .*appointment|schedule .*task|schedule my top 3|turn .* into .*blocks?|generate .*blocks?|move|update|change|edit|set|shift|rename|draft|save|create .*project|add .*project|new project|add time|add start time)\b/i;
const directQuestionPromptPattern =
  /\?|^(do|does|did|is|are|am|can|could|should|would|what|why|how|which|when|where)\b/i;
const analysisOnlyPromptPattern =
  /\b(review|check|analy[sz]e|watch out|look okay|does my schedule|am i overloaded|overloaded days|find overloaded|conflicts?|anything wrong|status|ready)\b/i;
const focusPromptPattern = /\b(focus|first|top 3|top priority|priorit|what should i do)\b/i;
const balancePromptPattern = /\bbalance\b/i;
const overloadPromptPattern = /\b(overload|overloaded|too much|busy|overlap|conflict|conflicts)\b/i;
const planWeekPromptPattern = /\b(plan my week|plan this week|weekly plan|week)\b/i;
const studyPromptPattern = /\b(study|school|class|course|exam|assignment)\b/i;
const openTimePromptPattern =
  /\b(find open time|open time|open slots|free time|available time|availability)\b/i;
const projectDraftPromptPattern =
  /\b(create|add|start|draft|make|save)\b.*\b(project|goal|initiative|class|course)\b|\bnew project\b/i;
const standaloneBlockPromptPattern =
  /\b(add|create|schedule|put|save)\b.*\b(task|appointment|errand|reminder|calendar)\b|\bremind me\b/i;
const projectUpdatePromptPattern =
  /\b(change|update|edit|move|set|shift|rename|adjust|confirm)\b.*\b(project|deadline|due date|priority|category|weekly hours|hours|next action|name)\b|\b(due date|deadline)\b.*\b(later|earlier|after|before|to|on|by)\b/i;
const googleSyncPromptPattern =
  /\b(sync|synced|google calendar|send to google|calendar sync|ready to sync|start time|start times|needs time|prepare.*calendar|before syncing|what.*sync|still.*sync|fix.*sync)\b/i;
const scheduledItemQuestionPattern =
  /\b(appointments?|tasks?|reminders?|anything scheduled|anything on|what.*(?:today|tomorrow|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

export function isGreetingPrompt(prompt: string) {
  return greetingPattern.test(prompt.trim());
}

export function isVaguePrompt(prompt: string) {
  return vaguePromptPattern.test(prompt.trim());
}

export function hasPlanningIntent(prompt: string) {
  const normalizedPrompt = prompt.trim();

  return (
    planningIntentPattern.test(normalizedPrompt) ||
    googleSyncPromptPattern.test(normalizedPrompt) ||
    projectDraftPromptPattern.test(normalizedPrompt) ||
    projectUpdatePromptPattern.test(normalizedPrompt)
  );
}

export function hasGoogleSyncIntent(prompt: string) {
  return googleSyncPromptPattern.test(prompt.trim());
}

export function hasOpenTimeIntent(prompt: string) {
  return openTimePromptPattern.test(prompt.trim());
}

export function shouldGenerateAssistantActionCards(prompt: string) {
  const normalizedPrompt = prompt.trim();

  if (
    !normalizedPrompt ||
    isGreetingPrompt(normalizedPrompt) ||
    isVaguePrompt(normalizedPrompt)
  ) {
    return false;
  }

  if (projectDraftPromptPattern.test(normalizedPrompt)) {
    return true;
  }

  if (projectUpdatePromptPattern.test(normalizedPrompt)) {
    return true;
  }

  if (hasGoogleSyncIntent(normalizedPrompt)) {
    return (
      /\b(add|move|update|change|edit|set|shift|schedule|create)\b/i.test(
        normalizedPrompt,
      ) && !/\b(sync|send|push)\b.*\b(google|calendar)\b/i.test(normalizedPrompt)
    );
  }

  if (
    hasOpenTimeIntent(normalizedPrompt) &&
    !/\b(create|add|schedule|turn|make|generate)\b/i.test(normalizedPrompt)
  ) {
    return false;
  }

  if (
    (directQuestionPromptPattern.test(normalizedPrompt) ||
      analysisOnlyPromptPattern.test(normalizedPrompt)) &&
    !actionCardIntentPattern.test(normalizedPrompt)
  ) {
    return false;
  }

  return actionCardIntentPattern.test(normalizedPrompt);
}

function shouldAnswerWithoutActionCards(prompt: string) {
  const normalizedPrompt = prompt.trim();

  return (
    hasGoogleSyncIntent(normalizedPrompt) ||
    hasOpenTimeIntent(normalizedPrompt) ||
    focusPromptPattern.test(normalizedPrompt) ||
    directQuestionPromptPattern.test(normalizedPrompt) ||
    analysisOnlyPromptPattern.test(normalizedPrompt)
  ) && !shouldGenerateAssistantActionCards(normalizedPrompt);
}

function didRecentlyOfferPlanningDirections(
  recentMessages: readonly AssistantHistoryItem[] = [],
) {
  return recentMessages
    .slice(-4)
    .some(
      (message) =>
        message.role === "assistant" &&
        /plan your week|finding overloaded days|turn projects into schedule blocks|choose one of three things|find open time|top 3/i.test(
          message.content,
        ),
    );
}

function isSuggestionType(
  value: unknown,
  allowedTypes: readonly AssistantSuggestionType[] = assistantSuggestionTypes,
): value is AssistantSuggestionType {
  return (
    typeof value === "string" &&
    allowedTypes.includes(value as AssistantSuggestionType)
  );
}

function isSeverity(value: unknown): value is AssistantSuggestionSeverity {
  return value === "info" || value === "warning" || value === "important";
}

function isWeekDay(value: unknown): value is WeekDay {
  return typeof value === "string" && weekDays.includes(value as WeekDay);
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

function createSuggestionId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function getSuggestionPriority(suggestion: AssistantSuggestion) {
  if (suggestion.type === "new_project") {
    return 6;
  }

  if (suggestion.type === "update_project") {
    return 6;
  }

  if (suggestion.type === "suggested_scheduled_item") {
    return 5;
  }

  if (suggestion.type === "suggested_weekly_block") {
    return 5;
  }

  if (suggestion.type === "suggested_next_action") {
    return 4;
  }

  if (suggestion.type === "workload_warning") {
    return 3;
  }

  if (suggestion.type === "missing_deadline_warning") {
    return 2;
  }

  return 1;
}

function getSuggestionDedupeKey(suggestion: AssistantSuggestion) {
  const projectName = suggestion.projectName?.toLowerCase().trim() ?? "";
  const scheduledItemKey =
    suggestion.type === "suggested_scheduled_item"
      ? `${suggestion.itemDate ?? ""}:${suggestion.startTime ?? ""}:${
          suggestion.title
        }`
      : "";
  const titleRoot = suggestion.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");

  return `${suggestion.type}:${projectName}:${suggestion.day ?? ""}:${scheduledItemKey}:${titleRoot}`;
}

export function filterAssistantSuggestions(
  suggestions: AssistantSuggestion[],
  options: {
    maxCards?: number;
    maxWarnings?: number;
  } = {},
) {
  const maxCards = options.maxCards ?? maxDefaultAssistantCards;
  const maxWarnings = options.maxWarnings ?? maxDefaultWarningCards;
  const seenKeys = new Set<string>();
  let warningCount = 0;

  return [...suggestions]
    .sort((first, second) => {
      const priorityDifference =
        getSuggestionPriority(second) - getSuggestionPriority(first);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return second.confidence - first.confidence;
    })
    .filter((suggestion) => {
      const key = getSuggestionDedupeKey(suggestion);

      if (seenKeys.has(key)) {
        return false;
      }

      const isWarning =
        suggestion.type === "workload_warning" ||
        suggestion.type === "missing_deadline_warning" ||
        suggestion.type === "unclear_project_warning";

      if (isWarning) {
        if (warningCount >= maxWarnings) {
          return false;
        }

        warningCount += 1;
      }

      seenKeys.add(key);
      return true;
    })
    .slice(0, maxCards);
}

function getLeastLoadedDay(
  blocks: WeeklyPlanBlock[],
  workShifts: WorkShift[] = [],
  importedEvents: ImportedCalendarEvent[] = [],
): WeekDay {
  const externalImportedEvents = importedEvents.filter(
    (event) => !isScheduleBuilderExportedEvent(event),
  );
  const hoursByDay = new Map<WeekDay, number>(
    weekDays.map((day) => [day, 0]),
  );

  workShifts.forEach((shift) => {
    hoursByDay.set(
      shift.day,
      (hoursByDay.get(shift.day) ?? 0) + getWorkShiftDurationHours(shift),
    );
  });

  externalImportedEvents.forEach((event) => {
    const eventDate = new Date(event.startsAt);

    if (Number.isNaN(eventDate.getTime())) {
      return;
    }

    const day = weekDays.find((candidate) => {
      const index = weekDays.indexOf(candidate);
      const currentDate = new Date();
      const jsDay = currentDate.getDay();
      const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
      const weekDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate() + mondayOffset + index,
      );

      return weekDate.toDateString() === eventDate.toDateString();
    });

    if (!day) {
      return;
    }

    hoursByDay.set(
      day,
      (hoursByDay.get(day) ?? 0) +
        (event.allDay ? 8 : getImportedEventDurationHours(event)),
    );
  });

  blocks.forEach((block) => {
    hoursByDay.set(block.day, (hoursByDay.get(block.day) ?? 0) + block.estimatedHours);
  });

  return [...weekDays].sort(
    (first, second) =>
      (hoursByDay.get(first) ?? 0) - (hoursByDay.get(second) ?? 0),
  )[0];
}

function getWorkShiftRangesForDay(workShifts: WorkShift[], day: WeekDay) {
  return getDayWorkShiftRanges(workShifts, day);
}

function createWorkAwareBlockDescription({
  day,
  estimatedHours,
  nextAction,
  workShifts,
}: {
  day: WeekDay;
  estimatedHours: number;
  nextAction: string;
  workShifts: WorkShift[];
}) {
  const workRanges = getWorkShiftRangesForDay(workShifts, day);
  const baseDescription = `Add a ${estimatedHours} hr block on ${day} for "${nextAction}".`;

  if (workRanges.length === 0) {
    return baseDescription;
  }

  return `${baseDescription} Plan it outside your work shift (${workRanges.join(", ")}).`;
}

function normalizeSuggestion(
  value: unknown,
  index: number,
  allowedTypes?: readonly AssistantSuggestionType[],
): AssistantSuggestion | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<AssistantSuggestion>;
  const description =
    typeof candidate.description === "string"
      ? candidate.description.trim()
      : typeof candidate.summary === "string"
        ? candidate.summary.trim()
        : "";
  const rationale =
    typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : description;

  if (
    !isSuggestionType(candidate.type, allowedTypes) ||
    typeof candidate.title !== "string" ||
    !description
  ) {
    return null;
  }

  const confidence =
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence)
      ? Math.min(Math.max(candidate.confidence, 0), 1)
      : 0.6;

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim().slice(0, 80)
        : createSuggestionId("ai", index),
    type: candidate.type,
    title: candidate.title.trim().slice(0, 120),
    description: description.slice(0, 360),
    confidence,
    summary: description.slice(0, 360),
    rationale: rationale.slice(0, 420),
    severity: isSeverity(candidate.severity) ? candidate.severity : "info",
    category: isProjectCategory(candidate.category)
      ? candidate.category
      : undefined,
    conflictWarnings: Array.isArray(candidate.conflictWarnings)
      ? candidate.conflictWarnings
          .filter((warning): warning is string => typeof warning === "string")
          .map((warning) => warning.trim().slice(0, 180))
          .filter(Boolean)
          .slice(0, 4)
      : undefined,
    deadline:
      typeof candidate.deadline === "string"
        ? candidate.deadline.trim().slice(0, 120)
        : undefined,
    itemDate:
      typeof candidate.itemDate === "string"
        ? normalizeScheduledItemDate(candidate.itemDate) ?? undefined
        : undefined,
    itemType: isScheduledItemType(candidate.itemType)
      ? candidate.itemType
      : undefined,
    location:
      typeof candidate.location === "string"
        ? candidate.location.trim().slice(0, 160)
        : undefined,
    newProjectName:
      typeof candidate.newProjectName === "string"
        ? candidate.newProjectName.trim().slice(0, 120)
        : undefined,
    projectName:
      typeof candidate.projectName === "string"
        ? candidate.projectName.trim().slice(0, 120)
        : undefined,
    priority: isProjectPriority(candidate.priority)
      ? candidate.priority
      : undefined,
    day: isWeekDay(candidate.day) ? candidate.day : undefined,
    estimatedHours:
      typeof candidate.estimatedHours === "number" &&
      Number.isFinite(candidate.estimatedHours) &&
      candidate.estimatedHours > 0
        ? Math.min(candidate.estimatedHours, 8)
        : undefined,
    exceptionDate:
      typeof candidate.exceptionDate === "string"
        ? normalizeScheduledItemDate(candidate.exceptionDate) ?? undefined
        : undefined,
    exceptionType: isScheduleExceptionType(candidate.exceptionType)
      ? candidate.exceptionType
      : undefined,
    originalEndTime:
      typeof candidate.originalEndTime === "string"
        ? normalizeStartTime(candidate.originalEndTime) ?? undefined
        : undefined,
    originalStartTime:
      typeof candidate.originalStartTime === "string"
        ? normalizeStartTime(candidate.originalStartTime) ?? undefined
        : undefined,
    overrideEndTime:
      typeof candidate.overrideEndTime === "string"
        ? normalizeStartTime(candidate.overrideEndTime) ?? undefined
        : undefined,
    overrideStartTime:
      typeof candidate.overrideStartTime === "string"
        ? normalizeStartTime(candidate.overrideStartTime) ?? undefined
        : undefined,
    plannedTask:
      typeof candidate.plannedTask === "string"
        ? candidate.plannedTask.trim().slice(0, 220)
        : undefined,
    proposedNextAction:
      typeof candidate.proposedNextAction === "string"
        ? candidate.proposedNextAction.trim().slice(0, 220)
        : undefined,
    relatedWorkShiftId:
      typeof candidate.relatedWorkShiftId === "string"
        ? candidate.relatedWorkShiftId.trim().slice(0, 80)
        : undefined,
    startTime:
      typeof candidate.startTime === "string"
        ? normalizeStartTime(candidate.startTime) ?? undefined
        : undefined,
    weeklyHours:
      typeof candidate.weeklyHours === "number" &&
      Number.isFinite(candidate.weeklyHours) &&
      candidate.weeklyHours >= 0
        ? Math.min(candidate.weeklyHours, 60)
        : undefined,
    batchId:
      typeof candidate.batchId === "string"
        ? candidate.batchId.trim().slice(0, 100)
        : undefined,
    workflowId:
      typeof candidate.workflowId === "string"
        ? candidate.workflowId.trim().slice(0, 100)
        : undefined,
  };
}

export function createAssistantContextSummary(
  projects: Project[],
  weeklyPlanBlocks: WeeklyPlanBlock[],
  plannerType: PlannerType | "Unknown",
  workShifts: WorkShift[] = [],
  importedCalendarEvents: ImportedCalendarEvent[] = [],
  googleSync: AssistantGoogleSyncContext = createAssistantGoogleSyncContext({
    weeklyPlanBlocks,
  }),
): AssistantContextSummary {
  const externalImportedEvents = importedCalendarEvents.filter(
    (event) => !isScheduleBuilderExportedEvent(event),
  );
  const workConflicts = findWeeklyPlanWorkConflicts(
    weeklyPlanBlocks,
    workShifts,
  );
  const importedEventConflicts = findWeeklyPlanImportedEventConflicts(
    weeklyPlanBlocks,
    externalImportedEvents,
  );
  const deadlineBuckets = getProjectDeadlineBuckets(projects);

  return {
    activeProjectsCount: projects.filter((project) => !project.completed).length,
    calendarConflictCount: workConflicts.length + importedEventConflicts.length,
    deadlinesNeedingDatesCount: deadlineBuckets.deadlinesNeedingDates.length,
    deadlinesWithDatesCount: deadlineBuckets.exactDeadlines.length,
    googleSyncNeedsAttentionCount: googleSync.needsAttentionBlocks.length,
    googleSyncNeedsTimeCount: googleSync.needsTimeBlocks.length,
    googleSyncOvernightCount: googleSync.overnightBlocks.length,
    googleSyncReadyCount: googleSync.readyBlocks.length,
    googleSyncSyncedCount: googleSync.syncedBlocks.length,
    importedEventConflictCount: importedEventConflicts.length,
    importedEventsCount: externalImportedEvents.length,
    plannedWeeklyHours: getPlannedHours(projects),
    plannerType,
    totalWeeklyBlockHours: weeklyPlanBlocks.reduce(
      (sum, block) => sum + block.estimatedHours,
      0,
    ),
    weeklyBlocksCount: weeklyPlanBlocks.length,
    workScheduleHours: workShifts.reduce(
      (sum, shift) => sum + getWorkShiftDurationHours(shift),
      0,
    ),
    workShiftsCount: workShifts.length,
  };
}

export function createAssistantPlanningContext(
  projects: Project[],
  weeklyPlanBlocks: WeeklyPlanBlock[],
  plannerType: PlannerType | "Unknown",
  workShifts: WorkShift[] = [],
  importedCalendarEvents: ImportedCalendarEvent[] = [],
  googleSyncRows: AssistantGoogleSyncRow[] = [],
  googleSyncOptions: {
    scheduleExceptions?: ScheduleException[];
    scheduledItems?: ScheduledItem[];
    syncCalendarName?: string | null;
    syncEnabled?: boolean;
    timezone?: string;
    weekStartDate?: string;
  } = {},
): AssistantPlanningContext {
  const externalImportedEvents = importedCalendarEvents.filter(
    (event) => !isScheduleBuilderExportedEvent(event),
  );
  const calendarConflicts = findWeeklyPlanWorkConflicts(
    weeklyPlanBlocks,
    workShifts,
  );
  const importedEventConflicts = findWeeklyPlanImportedEventConflicts(
    weeklyPlanBlocks,
    externalImportedEvents,
  );
  const deadlineBuckets = getProjectDeadlineBuckets(projects);
  const scheduledItems = googleSyncOptions.scheduledItems ?? [];
  const scheduleExceptions = googleSyncOptions.scheduleExceptions ?? [];
  const googleSync = createAssistantGoogleSyncContext({
    importedCalendarEvents: externalImportedEvents,
    syncCalendarName: googleSyncOptions.syncCalendarName ?? null,
    syncEnabled: Boolean(googleSyncOptions.syncEnabled),
    syncRows: googleSyncRows,
    weekStartDate:
      googleSyncOptions.weekStartDate ?? getAssistantCurrentWeekStartInput(),
    weeklyPlanBlocks,
    workShifts,
  });

  return {
    ...createAssistantContextSummary(
      projects,
      weeklyPlanBlocks,
      plannerType,
      workShifts,
      externalImportedEvents,
      googleSync,
    ),
    calendarConflicts,
    deadlinesNeedingDates: deadlineBuckets.deadlinesNeedingDates,
    deadlinesWithDates: deadlineBuckets.exactDeadlines,
    googleSync,
    importedCalendarEvents: externalImportedEvents,
    importedEventConflicts,
    projects,
    scheduleExceptions,
    scheduledItems,
    timezone: googleSyncOptions.timezone ?? "America/Detroit",
    weeklyPlanBlocks,
    workScheduleSummary: getWorkScheduleSummary(workShifts),
    workShifts,
  };
}

export function normalizeAssistantSuggestions(
  value: unknown,
  allowedTypes?: readonly AssistantSuggestionType[],
): AssistantSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => normalizeSuggestion(item, index, allowedTypes))
    .filter((item): item is AssistantSuggestion => item !== null)
    .slice(0, 8);
}

function createAssistantResponseFromSuggestions({
  activeProjects,
  context,
  message,
  source = "fallback",
  suggestions,
}: {
  activeProjects: Project[];
  context: AssistantPlanningContext;
  message: string;
  source?: AssistantSource;
  suggestions: AssistantSuggestion[];
}): AssistantPlanReviewResponse {
  const filteredSuggestions = filterAssistantSuggestions(
    suggestions.sort((first, second) => {
      if (first.projectName && second.projectName) {
        const firstProject = activeProjects.find(
          (project) => project.name === first.projectName,
        );
        const secondProject = activeProjects.find(
          (project) => project.name === second.projectName,
        );

        return (
          (secondProject ? priorityScore[secondProject.priority] : 0) -
          (firstProject ? priorityScore[firstProject.priority] : 0)
        );
      }

      return 0;
    }),
  );

  return {
    actions: filteredSuggestions,
    assistantMessage: message,
    context: {
      activeProjectsCount: context.activeProjectsCount,
      calendarConflictCount: context.calendarConflictCount,
      deadlinesNeedingDatesCount: context.deadlinesNeedingDatesCount,
      deadlinesWithDatesCount: context.deadlinesWithDatesCount,
      googleSyncNeedsAttentionCount: context.googleSyncNeedsAttentionCount,
      googleSyncNeedsTimeCount: context.googleSyncNeedsTimeCount,
      googleSyncOvernightCount: context.googleSyncOvernightCount,
      googleSyncReadyCount: context.googleSyncReadyCount,
      googleSyncSyncedCount: context.googleSyncSyncedCount,
      importedEventConflictCount: context.importedEventConflictCount,
      importedEventsCount: context.importedEventsCount,
      plannedWeeklyHours: context.plannedWeeklyHours,
      plannerType: context.plannerType,
      totalWeeklyBlockHours: context.totalWeeklyBlockHours,
      weeklyBlocksCount: context.weeklyBlocksCount,
      workScheduleHours: context.workScheduleHours,
      workShiftsCount: context.workShiftsCount,
    },
    message,
    source,
    suggestions: filteredSuggestions,
  };
}

function createScheduleAnalysisInput(
  context: AssistantPlanningContext,
): AssistantScheduleAnalysisInput {
  return {
    importedCalendarEvents: context.importedCalendarEvents,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  };
}

export function createContextOnlyAssistantResponse(
  context: AssistantPlanningContext,
): AssistantPlanReviewResponse {
  const assistantMessage =
    "I’m ready to help. Tell me what you want to plan, and I’ll suggest practical next steps you can approve before anything changes.";

  return {
    actions: [],
    assistantMessage,
    context: {
      activeProjectsCount: context.activeProjectsCount,
      calendarConflictCount: context.calendarConflictCount,
      deadlinesNeedingDatesCount: context.deadlinesNeedingDatesCount,
      deadlinesWithDatesCount: context.deadlinesWithDatesCount,
      googleSyncNeedsAttentionCount: context.googleSyncNeedsAttentionCount,
      googleSyncNeedsTimeCount: context.googleSyncNeedsTimeCount,
      googleSyncOvernightCount: context.googleSyncOvernightCount,
      googleSyncReadyCount: context.googleSyncReadyCount,
      googleSyncSyncedCount: context.googleSyncSyncedCount,
      importedEventConflictCount: context.importedEventConflictCount,
      importedEventsCount: context.importedEventsCount,
      plannedWeeklyHours: context.plannedWeeklyHours,
      plannerType: context.plannerType,
      totalWeeklyBlockHours: context.totalWeeklyBlockHours,
      weeklyBlocksCount: context.weeklyBlocksCount,
      workScheduleHours: context.workScheduleHours,
      workShiftsCount: context.workShiftsCount,
    },
    message: assistantMessage,
    source: "fallback",
    suggestions: [],
  };
}

function getLightPlanningDays(context: AssistantPlanningContext, maxDays = 3) {
  const workHoursByDay = getWorkHoursByDay(context.workShifts);
  const importedHoursByDay = new Map<WeekDay, number>(
    weekDays.map((day) => [day, 0]),
  );

  context.importedCalendarEvents.forEach((event) => {
    const eventDate = new Date(event.startsAt);

    if (Number.isNaN(eventDate.getTime())) {
      return;
    }

    const day = weekDays[(eventDate.getDay() + 6) % 7];
    importedHoursByDay.set(
      day,
      (importedHoursByDay.get(day) ?? 0) +
        (event.allDay ? 8 : getImportedEventDurationHours(event)),
    );
  });

  return [...weekDays]
    .map((day) => {
      const planHours = context.weeklyPlanBlocks
        .filter((block) => block.day === day)
        .reduce((sum, block) => sum + block.estimatedHours, 0);
      const workHours = workHoursByDay.get(day) ?? 0;
      const importedHours = importedHoursByDay.get(day) ?? 0;

      return {
        day,
        totalHours: planHours + workHours + importedHours,
        workHours: workHours + importedHours,
      };
    })
    .sort((first, second) => {
      const totalDifference = first.totalHours - second.totalHours;

      if (totalDifference !== 0) {
        return totalDifference;
      }

      return first.workHours - second.workHours;
    })
    .slice(0, maxDays)
    .map((item) => item.day);
}

function formatDayOptions(days: WeekDay[]) {
  if (days.length === 0) {
    return "your lighter days";
  }

  if (days.length === 1) {
    return days[0];
  }

  if (days.length === 2) {
    return `${days[0]} or ${days[1]}`;
  }

  return `${days.slice(0, -1).join(", ")}, or ${days[days.length - 1]}`;
}

function inferProjectDraftName(prompt: string) {
  const quotedMatch = prompt.match(/["“”']([^"“”']{2,80})["“”']/);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const namedMatch = prompt.match(
    /\b(?:called|named|for|about)\s+([a-z0-9][a-z0-9\s/&-]{2,60})/i,
  );

  if (namedMatch?.[1]) {
    return namedMatch[1]
      .replace(/\b(before|by|due|with|and then|that|which)\b.*$/i, "")
      .trim();
  }

  return "New project";
}

function inferStandaloneBlockTitle(prompt: string) {
  const quotedMatch = prompt.match(/["“”']([^"“”']{2,80})["“”']/);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const cleanedPrompt = prompt
    .replace(
      /^\s*(?:can you\s+)?(?:please\s+)?(?:add|create|schedule|put|save)\s+(?:to\s+my\s+calendar\s+)?/i,
      "",
    )
    .replace(/\s+\b(?:on|for|at|this|next)\b.*$/i, "")
    .trim();

  if (cleanedPrompt.length >= 3) {
    return cleanedPrompt
      .replace(/^(?:my|a|an)\s+/i, "")
      .trim()
      .slice(0, 80);
  }

  return "Task / appointment";
}

function inferStandaloneBlockDay(prompt: string, context: AssistantPlanningContext) {
  const requestedDay = weekDays.find((day) =>
    new RegExp(`\\b${day}\\b`, "i").test(prompt),
  );

  return (
    requestedDay ??
    getLeastLoadedDay(
      context.weeklyPlanBlocks,
      context.workShifts,
      context.importedCalendarEvents,
    )
  );
}

function inferStandaloneBlockHours(prompt: string) {
  const durationMatch = prompt.match(
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/i,
  );
  const duration = durationMatch ? Number(durationMatch[1]) : 1;

  return Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 1;
}

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const jsWeekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const numberWords = new Map<string, number>([
  ["a", 1],
  ["an", 1],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
]);

function toTitleCaseLight(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");

  if (!cleaned) {
    return "";
  }

  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function parseDurationToken(value: string) {
  const normalized = value.trim().toLowerCase();
  const wordValue = numberWords.get(normalized);

  if (wordValue !== undefined) {
    return wordValue;
  }

  const numericValue = Number(normalized);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function parseNaturalDurationHours(prompt: string) {
  const hourMatch = prompt.match(
    /\b(?:for|lasting|duration(?: of)?)\s+(a|an|one|two|three|four|five|six|seven|eight|\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/i,
  );

  if (hourMatch?.[1]) {
    const hours = parseDurationToken(hourMatch[1]);

    if (hours && hours > 0) {
      return Math.min(hours, 12);
    }
  }

  const minuteMatch = prompt.match(
    /\b(?:for|lasting|duration(?: of)?)\s+(\d{1,3})\s*(?:minutes?|mins?|min)\b/i,
  );

  if (minuteMatch?.[1]) {
    const minutes = Number(minuteMatch[1]);

    if (Number.isFinite(minutes) && minutes > 0) {
      return Math.min(minutes / 60, 12);
    }
  }

  return null;
}

function parseNaturalStartTime(prompt: string) {
  const timeMatch = prompt.match(
    /\b(?:at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  ) ?? prompt.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)\b/i);

  if (!timeMatch) {
    return null;
  }

  let hour = Number(timeMatch[1]);
  const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  const meridiem = timeMatch[3]?.toLowerCase();

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    hour < 1 ||
    hour > 12 ||
    (meridiem !== "am" && meridiem !== "pm")
  ) {
    return null;
  }

  if (meridiem === "pm" && hour !== 12) {
    hour += 12;
  }

  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getJsWeekdayIndex(value: string) {
  return jsWeekdayNames.findIndex((day) => day === value.toLowerCase());
}

function getMonthIndex(value: string) {
  const normalized = value.toLowerCase().replace(/\.$/, "");

  return monthNames.findIndex(
    (month) => month === normalized || month.startsWith(normalized),
  );
}

function parseNaturalItemDate(
  prompt: string,
  referenceDate = new Date(),
): { date: string | null; message?: string } {
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const normalizedPrompt = prompt.toLowerCase();

  if (/\btoday\b/i.test(prompt)) {
    return { date: toInputDate(today) };
  }

  if (/\btomorrow\b/i.test(prompt)) {
    return { date: toInputDate(addDays(today, 1)) };
  }

  const monthDayMatch = normalizedPrompt.match(
    /\b(?:(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/i,
  );

  if (monthDayMatch?.[2] && monthDayMatch[3]) {
    const monthIndex = getMonthIndex(monthDayMatch[2]);
    const day = Number(monthDayMatch[3]);
    const explicitYear = monthDayMatch[4] ? Number(monthDayMatch[4]) : null;
    const year = explicitYear ?? today.getFullYear();
    const date = new Date(year, monthIndex, day);

    if (
      monthIndex < 0 ||
      !Number.isInteger(day) ||
      date.getFullYear() !== year ||
      date.getMonth() !== monthIndex ||
      date.getDate() !== day
    ) {
      return {
        date: null,
        message: "I could not read that date clearly. What exact date should I use?",
      };
    }

    if (!explicitYear && date.getTime() < today.getTime()) {
      return {
        date: null,
        message:
          "That date has already passed this year. What exact date and year should I use?",
      };
    }

    const requestedWeekday = monthDayMatch[1]
      ? getJsWeekdayIndex(monthDayMatch[1])
      : -1;

    if (requestedWeekday >= 0 && requestedWeekday !== date.getDay()) {
      return {
        date: null,
        message: `${toTitleCaseLight(
          monthDayMatch[2],
        )} ${day} does not fall on ${toTitleCaseLight(
          monthDayMatch[1],
        )} for ${year}. Which exact date should I use?`,
      };
    }

    return { date: toInputDate(date) };
  }

  const isoDateMatch = normalizedPrompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);

  if (isoDateMatch?.[1]) {
    const normalizedDate = normalizeScheduledItemDate(isoDateMatch[1]);

    return normalizedDate
      ? { date: normalizedDate }
      : {
          date: null,
          message: "I could not read that date clearly. What exact date should I use?",
        };
  }

  const relativeWeekdayMatch = normalizedPrompt.match(
    /\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  if (relativeWeekdayMatch?.[1] && relativeWeekdayMatch[2]) {
    const direction = relativeWeekdayMatch[1].toLowerCase();
    const targetDay = getJsWeekdayIndex(relativeWeekdayMatch[2]);
    const currentDay = today.getDay();
    let offset = (targetDay - currentDay + 7) % 7;

    if (direction === "next") {
      offset = offset === 0 ? 7 : offset + 7;
    }

    return { date: toInputDate(addDays(today, offset)) };
  }

  const bareWeekdayMatch = normalizedPrompt.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  if (bareWeekdayMatch?.[1]) {
    return {
      date: null,
      message: `When you say ${toTitleCaseLight(
        bareWeekdayMatch[1],
      )}, do you mean this week or next week?`,
    };
  }

  return {
    date: null,
    message: "What exact date should I use for this task or appointment?",
  };
}

function inferScheduledItemType(prompt: string): ScheduledItemType {
  return /\b(appointment|meeting|doctor|dentist|visit)\b/i.test(prompt)
    ? "appointment"
    : "task";
}

function inferScheduledItemTitle(prompt: string, itemType: ScheduledItemType) {
  const quotedMatch = prompt.match(/["“”']([^"“”']{2,80})["“”']/);

  if (quotedMatch?.[1]) {
    return toTitleCaseLight(quotedMatch[1]);
  }

  const cleanedPrompt = prompt
    .replace(/^\s*(?:can you\s+)?(?:please\s+)?/i, "")
    .replace(/^\s*remind me\s+(?:to\s+)?/i, "")
    .replace(
      /^\s*(?:add|create|schedule|put|save)\s+(?:to\s+my\s+calendar\s+)?(?:my\s+)?/i,
      "",
    )
    .replace(
      /\b(?:today|tomorrow|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i,
      "",
    )
    .replace(
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?.*$/i,
      "",
    )
    .replace(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?.*$/i,
      "",
    )
    .replace(/\b(?:on|at|for|from)\b.*$/i, "")
    .replace(/\b(?:task|appointment|calendar item|reminder|errand)\b$/i, "")
    .trim();

  if (cleanedPrompt.length >= 3) {
    return toTitleCaseLight(cleanedPrompt.replace(/^(?:my|a|an)\s+/i, ""));
  }

  return itemType === "appointment" ? "Appointment" : "Task";
}

function createScheduledItemPreviewFromSuggestion(
  suggestion: AssistantSuggestion,
): ScheduledItem | null {
  if (
    suggestion.type !== "suggested_scheduled_item" ||
    !suggestion.itemType ||
    !suggestion.itemDate ||
    !suggestion.estimatedHours
  ) {
    return null;
  }

  return {
    id: suggestion.id,
    itemType: suggestion.itemType,
    title: suggestion.title,
    description: suggestion.plannedTask ?? suggestion.description,
    itemDate: suggestion.itemDate,
    startTime: suggestion.startTime,
    estimatedHours: suggestion.estimatedHours,
    location: suggestion.location ?? "",
  };
}

function getScheduledItemConflictWarnings(
  suggestion: AssistantSuggestion,
  context: AssistantPlanningContext,
) {
  const previewItem = createScheduledItemPreviewFromSuggestion(suggestion);

  if (!previewItem) {
    return [];
  }

  return findScheduledItemConflicts({
    importedEvents: context.importedCalendarEvents,
    item: previewItem,
    planBlocks: context.weeklyPlanBlocks,
    scheduledItems: context.scheduledItems,
    workShifts: context.workShifts,
  })
    .map((conflict) => conflict.message)
    .slice(0, 4);
}

function withScheduledItemConflictWarnings(
  suggestion: AssistantSuggestion,
  context: AssistantPlanningContext,
): AssistantSuggestion {
  if (suggestion.type !== "suggested_scheduled_item") {
    return suggestion;
  }

  const conflictWarnings = [
    ...(suggestion.conflictWarnings ?? []),
    ...getScheduledItemConflictWarnings(suggestion, context),
  ];
  const uniqueWarnings = [...new Set(conflictWarnings)].slice(0, 4);

  return {
    ...suggestion,
    conflictWarnings: uniqueWarnings,
    severity: uniqueWarnings.length > 0 ? "warning" : suggestion.severity,
  };
}

export function addScheduledItemConflictWarningsToSuggestions(
  suggestions: AssistantSuggestion[],
  context: AssistantPlanningContext,
) {
  return suggestions.map((suggestion) =>
    withScheduledItemConflictWarnings(suggestion, context),
  );
}

function createFallbackScheduledItemSuggestion(
  context: AssistantPlanningContext,
  prompt: string,
  index: number,
):
  | { message: string; suggestion?: undefined }
  | { message: string; suggestion: AssistantSuggestion } {
  const itemType = inferScheduledItemType(prompt);
  const itemDate = parseNaturalItemDate(prompt);
  const startTime = parseNaturalStartTime(prompt);
  const durationHours = parseNaturalDurationHours(prompt);
  const title = inferScheduledItemTitle(prompt, itemType);
  const missingFields: string[] = [];

  if (!itemDate.date) {
    return {
      message:
        itemDate.message ??
        "What exact date should I use for this task or appointment?",
    };
  }

  if (itemType === "appointment" && !startTime) {
    missingFields.push("start time");
  }

  if (itemType === "appointment" && !durationHours) {
    missingFields.push("duration");
  }

  if (!title.trim()) {
    missingFields.push("title");
  }

  if (missingFields.length > 0) {
    return {
      message: `I can draft that ${itemType}, but I need the ${missingFields.join(
        " and ",
      )} first. What should I use?`,
    };
  }

  const estimatedHours = durationHours ?? 1;
  const typeLabel = itemType === "appointment" ? "appointment" : "task";
  const description =
    itemType === "task" && !startTime
      ? `Draft a flexible task for ${itemDate.date}. Duration is set to ${formatEstimatedHours(
          estimatedHours,
        )} so you can review it before saving.`
      : `Draft a ${typeLabel} for ${itemDate.date} at ${formatStartTime(
          startTime,
        )}.`;
  const suggestion = withScheduledItemConflictWarnings(
    {
      confidence: 0.78,
      description,
      estimatedHours,
      id: createSuggestionId("scheduled-item", index),
      itemDate: itemDate.date,
      itemType,
      location: "",
      plannedTask: prompt.trim(),
      rationale:
        "This is an exact-date standalone item, so it should be saved as a task or appointment rather than a project or weekly block.",
      severity: "important",
      startTime: startTime ?? undefined,
      summary: description,
      title,
      type: "suggested_scheduled_item",
    },
    context,
  );

  return {
    message: `I drafted ${title} as a ${typeLabel} for review. Nothing is saved until you apply the card.`,
    suggestion,
  };
}

function createFallbackStandaloneBlockSuggestion(
  context: AssistantPlanningContext,
  prompt: string,
  index: number,
): AssistantSuggestion {
  const title = inferStandaloneBlockTitle(prompt);
  const day = inferStandaloneBlockDay(prompt, context);
  const estimatedHours = inferStandaloneBlockHours(prompt);
  const description = `Add ${title} to ${day} as a ${estimatedHours} hr task / appointment block.`;

  return {
    confidence: 0.72,
    day,
    description,
    estimatedHours,
    id: createSuggestionId("task-block", index),
    plannedTask: prompt.trim() || title,
    projectName: title,
    rationale:
      "This sounds like a one-off task or appointment, so it can become a time block without creating a project.",
    severity: "important",
    summary: description,
    title: `Add ${title}`,
    type: "suggested_weekly_block",
  };
}

function formatDeadlineDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
  }).format(date);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getCurrentWeekStart(referenceDate = new Date()) {
  const localDate = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const day = localDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return addDays(localDate, mondayOffset);
}

function toInputDate(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getAssistantCurrentWeekStartInput(referenceDate = new Date()) {
  return toInputDate(getCurrentWeekStart(referenceDate));
}

export function getRelevantImportedCalendarEvents(
  importedCalendarEvents: ImportedCalendarEvent[],
  referenceDate = new Date(),
) {
  const rangeStart = getCurrentWeekStart(referenceDate).getTime();
  const rangeEnd = addDays(
    getCurrentWeekStart(referenceDate),
    importedEventLookaheadDays,
  ).getTime();

  return importedCalendarEvents
    .filter((event) => !isScheduleBuilderExportedEvent(event))
    .filter((event) => {
      const startsAt = new Date(event.startsAt).getTime();

      return (
        Number.isFinite(startsAt) &&
        startsAt >= rangeStart &&
        startsAt <= rangeEnd
      );
    })
    .sort(
      (first, second) =>
        new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime(),
    )
    .slice(0, 80);
}

function formatMinutesAsClock(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatMinutesAsInputTime(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getWeekDateKeyForDay(day: WeekDay, weekStart = getCurrentWeekStart()) {
  return toInputDate(addDays(weekStart, weekDays.indexOf(day)));
}

function getDateKey(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return toInputDate(date);
}

type OpenTimeWindow = {
  day: WeekDay;
  durationHours: number;
  endLabel: string;
  startLabel: string;
};

function addBusyRange(
  ranges: Array<{ end: number; start: number }>,
  start: number | null,
  end: number | null,
  dayStart: number,
  dayEnd: number,
) {
  if (start === null || end === null) {
    return;
  }

  const clampedStart = Math.max(start, dayStart);
  const clampedEnd = Math.min(end, dayEnd);

  if (clampedEnd > clampedStart) {
    ranges.push({ end: clampedEnd, start: clampedStart });
  }
}

function getOpenTimeWindows(
  context: AssistantPlanningContext,
  options: {
    dayEnd?: number;
    dayStart?: number;
    maxWindows?: number;
    minimumMinutes?: number;
  } = {},
) {
  const dayStart = options.dayStart ?? 8 * 60;
  const dayEnd = options.dayEnd ?? 22 * 60;
  const minimumMinutes = options.minimumMinutes ?? 60;
  const weekStart = getCurrentWeekStart();
  const windows: OpenTimeWindow[] = [];

  weekDays.forEach((day) => {
    const busyRanges: Array<{ end: number; start: number }> = [];
    const dayDateKey = getWeekDateKeyForDay(day, weekStart);

    context.workShifts
      .filter((shift) => shift.day === day)
      .forEach((shift) => {
        addBusyRange(
          busyRanges,
          parseStartTimeToMinutes(shift.startTime),
          parseStartTimeToMinutes(shift.endTime),
          dayStart,
          dayEnd,
        );
      });

    context.weeklyPlanBlocks
      .filter((block) => block.day === day)
      .forEach((block) => {
        const start = parseStartTimeToMinutes(block.startTime);

        addBusyRange(
          busyRanges,
          start,
          start === null ? null : start + block.estimatedHours * 60,
          dayStart,
          dayEnd,
        );
      });

    context.importedCalendarEvents.forEach((event) => {
      if (getDateKey(event.startsAt) !== dayDateKey) {
        return;
      }

      if (event.allDay) {
        busyRanges.push({ end: dayEnd, start: dayStart });
        return;
      }

      const startsAt = new Date(event.startsAt);
      const endsAt = event.endsAt ? new Date(event.endsAt) : null;

      if (Number.isNaN(startsAt.getTime())) {
        return;
      }

      const start = startsAt.getHours() * 60 + startsAt.getMinutes();
      const end =
        endsAt && !Number.isNaN(endsAt.getTime())
          ? endsAt.getHours() * 60 + endsAt.getMinutes()
          : start + 30;

      addBusyRange(busyRanges, start, end, dayStart, dayEnd);
    });

    context.scheduledItems
      .filter((item) => item.itemDate === dayDateKey)
      .forEach((item) => {
        const start = parseStartTimeToMinutes(item.startTime);

        addBusyRange(
          busyRanges,
          start,
          start === null ? null : start + item.estimatedHours * 60,
          dayStart,
          dayEnd,
        );
      });

    const mergedRanges = busyRanges
      .sort((first, second) => first.start - second.start)
      .reduce<Array<{ end: number; start: number }>>((merged, range) => {
        const previous = merged[merged.length - 1];

        if (!previous || range.start > previous.end) {
          merged.push({ ...range });
          return merged;
        }

        previous.end = Math.max(previous.end, range.end);
        return merged;
      }, []);

    let cursor = dayStart;

    mergedRanges.forEach((range) => {
      if (range.start - cursor >= minimumMinutes) {
        windows.push({
          day,
          durationHours: (range.start - cursor) / 60,
          endLabel: formatMinutesAsClock(range.start),
          startLabel: formatMinutesAsClock(cursor),
        });
      }

      cursor = Math.max(cursor, range.end);
    });

    if (dayEnd - cursor >= minimumMinutes) {
      windows.push({
        day,
        durationHours: (dayEnd - cursor) / 60,
        endLabel: formatMinutesAsClock(dayEnd),
        startLabel: formatMinutesAsClock(cursor),
      });
    }
  });

  return windows
    .sort((first, second) => {
      const durationDifference = second.durationHours - first.durationHours;

      if (durationDifference !== 0) {
        return durationDifference;
      }

      return weekDays.indexOf(first.day) - weekDays.indexOf(second.day);
    })
    .slice(0, options.maxWindows ?? 5);
}

function formatOpenTimeWindows(windows: OpenTimeWindow[]) {
  if (windows.length === 0) {
    return "";
  }

  return windows
    .map(
      (window) =>
        `${window.day} ${window.startLabel}-${window.endLabel} (${formatEstimatedHours(
          window.durationHours,
        )})`,
    )
    .join("; ");
}

function formatScheduledItemDateLabel(itemDate: string) {
  const date = parseScheduledItemDate(itemDate);

  if (!date) {
    return itemDate;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
}

function getCurrentWeekDateKeys(referenceDate = new Date()) {
  const weekStart = getCurrentWeekStart(referenceDate);

  return new Set(weekDays.map((day) => getWeekDateKeyForDay(day, weekStart)));
}

function getRequestedScheduledItemDateKey(prompt: string) {
  if (/\bthis week\b/i.test(prompt)) {
    return null;
  }

  if (/\btoday\b/i.test(prompt)) {
    return toInputDate(new Date());
  }

  if (/\btomorrow\b/i.test(prompt)) {
    return toInputDate(addDays(new Date(), 1));
  }

  const requestedDay = weekDays.find((day) =>
    new RegExp(`\\b${day}\\b`, "i").test(prompt),
  );

  if (!requestedDay) {
    return null;
  }

  return getWeekDateKeyForDay(requestedDay);
}

function formatScheduledItemList(items: ScheduledItem[]) {
  return items
    .slice(0, 5)
    .map((item) => {
      const typeLabel = item.itemType === "appointment" ? "appointment" : "task";

      return `${item.title} (${typeLabel}, ${formatScheduledItemDateLabel(
        item.itemDate,
      )}, ${formatScheduledItemTimeLabel(item)})`;
    })
    .join("; ");
}

function createScheduledItemsFallbackMessage(
  context: AssistantPlanningContext,
  prompt: string,
) {
  const requestedDateKey = getRequestedScheduledItemDateKey(prompt);
  const weekDateKeys = getCurrentWeekDateKeys();
  const scopedItems = context.scheduledItems.filter((item) =>
    requestedDateKey ? item.itemDate === requestedDateKey : weekDateKeys.has(item.itemDate),
  );
  const appointmentOnly = /\bappointments?\b/i.test(prompt);
  const taskOnly = /\btasks?|reminders?\b/i.test(prompt) && !appointmentOnly;
  const filteredItems = scopedItems.filter((item) => {
    if (appointmentOnly) {
      return item.itemType === "appointment";
    }

    if (taskOnly) {
      return item.itemType === "task";
    }

    return true;
  });
  const scopeLabel = requestedDateKey
    ? formatScheduledItemDateLabel(requestedDateKey)
    : "this week";

  if (filteredItems.length === 0) {
    return `I don’t see any ${appointmentOnly ? "appointments" : taskOnly ? "tasks" : "tasks or appointments"} on ${scopeLabel}.`;
  }

  return `Here’s what I see on ${scopeLabel}: ${formatScheduledItemList(
    filteredItems,
  )}.`;
}

function createGoogleSyncBlock(
  block: WeeklyPlanBlock,
  warnings: string[] = [],
): AssistantGoogleSyncBlock {
  return {
    day: block.day,
    durationHours: block.estimatedHours,
    id: block.id,
    plannedTask: block.plannedTask,
    projectName: block.projectName,
    startTime: block.startTime ?? null,
    warnings,
  };
}

function createGoogleSyncBlockSnapshot(block: WeeklyPlanBlock) {
  return {
    day: block.day,
    estimatedHours: block.estimatedHours,
    id: block.id,
    plannedTask: block.plannedTask,
    projectName: block.projectName,
    startTime: block.startTime ?? "",
  };
}

function googleSyncSnapshotMatches(
  snapshot: unknown,
  block: WeeklyPlanBlock | undefined,
) {
  if (!block || typeof snapshot !== "object" || snapshot === null) {
    return false;
  }

  const expected = createGoogleSyncBlockSnapshot(block);
  const candidate = snapshot as Partial<typeof expected>;

  return (
    candidate.day === expected.day &&
    Number(candidate.estimatedHours) === expected.estimatedHours &&
    candidate.id === expected.id &&
    candidate.plannedTask === expected.plannedTask &&
    candidate.projectName === expected.projectName &&
    (candidate.startTime ?? "") === expected.startTime
  );
}

function googleSyncBlockEndsAfterMidnight(block: WeeklyPlanBlock) {
  const startMinutes = parseStartTimeToMinutes(block.startTime);

  return Boolean(startMinutes !== null && startMinutes + block.estimatedHours * 60 > 1440);
}

function getGoogleSyncBlockWarnings({
  block,
  importedEvents,
  weekStart,
  workShifts,
}: {
  block: WeeklyPlanBlock;
  importedEvents: ImportedCalendarEvent[];
  weekStart: Date;
  workShifts: WorkShift[];
}) {
  const warnings: string[] = [];
  const workConflict = getWeeklyPlanWorkConflictForBlock(block, workShifts);
  const importedConflict = getWeeklyPlanImportedEventConflictForBlock(
    block,
    importedEvents,
    weekStart,
  );

  if (workConflict) {
    warnings.push(`May overlap with work shift (${workConflict.shiftRangeLabel})`);
  }

  if (importedConflict) {
    warnings.push(`May overlap with ${importedConflict.event.title}`);
  }

  if (googleSyncBlockEndsAfterMidnight(block)) {
    warnings.push("This block ends after midnight.");
  }

  return warnings;
}

export function createAssistantGoogleSyncContext({
  importedCalendarEvents = [],
  syncCalendarName = null,
  syncEnabled = false,
  syncRows = [],
  weekStartDate = getAssistantCurrentWeekStartInput(),
  weeklyPlanBlocks,
  workShifts = [],
}: {
  importedCalendarEvents?: ImportedCalendarEvent[];
  syncCalendarName?: string | null;
  syncEnabled?: boolean;
  syncRows?: AssistantGoogleSyncRow[];
  weekStartDate?: string;
  weeklyPlanBlocks: WeeklyPlanBlock[];
  workShifts?: WorkShift[];
}): AssistantGoogleSyncContext {
  const weekStart = new Date(`${weekStartDate}T00:00:00`);
  const blocksById = new Map(
    weeklyPlanBlocks.map((block) => [block.id, block]),
  );
  const syncStatusByBlockId = new Map<
    string,
    "synced" | "needs_attention"
  >();
  const removedSyncedEvents: AssistantGoogleSyncContext["removedSyncedEvents"] =
    [];

  syncRows.forEach((row) => {
    const block = row.weeklyPlanBlockId
      ? blocksById.get(row.weeklyPlanBlockId)
      : undefined;

    if (!row.weeklyPlanBlockId || !block) {
      removedSyncedEvents.push({
        googleEventHtmlLink: row.googleEventHtmlLink,
        syncedTitle: row.syncedTitle,
      });
      return;
    }

    const syncStatus =
      row.syncStatus === "synced" &&
      !googleSyncSnapshotMatches(row.blockSnapshot, block)
        ? "needs_attention"
        : row.syncStatus;

    syncStatusByBlockId.set(row.weeklyPlanBlockId, syncStatus);
  });

  const context: AssistantGoogleSyncContext = {
    conflictBlocks: [],
    currentWeekStart: weekStartDate,
    needsAttentionBlocks: [],
    needsTimeBlocks: [],
    overnightBlocks: [],
    readyBlocks: [],
    removedSyncedEvents,
    syncCalendarName,
    syncEnabled,
    syncedBlocks: [],
  };

  weeklyPlanBlocks.forEach((block) => {
    const warnings = getGoogleSyncBlockWarnings({
      block,
      importedEvents: importedCalendarEvents,
      weekStart,
      workShifts,
    });
    const syncBlock = createGoogleSyncBlock(block, warnings);
    const syncStatus = syncStatusByBlockId.get(block.id);
    const hasStartTime = parseStartTimeToMinutes(block.startTime) !== null;

    if (warnings.length > 0) {
      context.conflictBlocks.push(syncBlock);
    }

    if (googleSyncBlockEndsAfterMidnight(block)) {
      context.overnightBlocks.push(syncBlock);
    }

    if (syncStatus === "synced") {
      context.syncedBlocks.push(syncBlock);
      return;
    }

    if (syncStatus === "needs_attention") {
      context.needsAttentionBlocks.push(syncBlock);
      return;
    }

    if (hasStartTime) {
      context.readyBlocks.push(syncBlock);
      return;
    }

    context.needsTimeBlocks.push(syncBlock);
  });

  return context;
}

function normalizeProjectSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\bscheduler\b/g, "schedule")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findPromptProject(projects: Project[], prompt: string) {
  const normalizedPrompt = normalizeProjectSearchText(prompt);
  const activeProjects = projects.filter((project) => !project.completed);
  const exactMatch = [...activeProjects]
    .sort((first, second) => second.name.length - first.name.length)
    .find((project) =>
      normalizedPrompt.includes(normalizeProjectSearchText(project.name)),
    );

  if (exactMatch) {
    return exactMatch;
  }

  if (activeProjects.length === 1) {
    return activeProjects[0];
  }

  return null;
}

function extractRequestedDeadline(prompt: string, currentDeadline: string) {
  const explicitDateMatch = prompt.match(
    /\b(?:to|on|by|for|be|as)\s+((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
  );

  if (explicitDateMatch?.[1]) {
    return explicitDateMatch[1].trim();
  }

  const relativeDateMatch = prompt.match(
    /\b(\d{1,2})\s+days?\s+(later|after|out|earlier|before)\b/i,
  );

  if (!relativeDateMatch) {
    return null;
  }

  const currentDate = getExactProjectDeadlineDate(currentDeadline);

  if (!currentDate) {
    return null;
  }

  const amount = Number(relativeDateMatch[1]);
  const direction = /earlier|before/i.test(relativeDateMatch[2]) ? -1 : 1;

  return formatDeadlineDate(addDays(currentDate, amount * direction));
}

function createFallbackProjectUpdateSuggestion(
  context: AssistantPlanningContext,
  prompt: string,
): AssistantSuggestion | null {
  if (!projectUpdatePromptPattern.test(prompt)) {
    return null;
  }

  const project = findPromptProject(context.projects, prompt);

  if (!project) {
    return null;
  }

  const nextDeadline = extractRequestedDeadline(prompt, project.deadline);

  if (!nextDeadline) {
    return null;
  }

  const description = `Update ${project.name}'s deadline from ${
    project.deadline || "No deadline"
  } to ${nextDeadline}.`;

  return {
    id: "project-update-deadline",
    type: "update_project",
    title: `Update ${project.name}`,
    description,
    confidence: 0.82,
    summary: description,
    rationale:
      "Project edits need your approval so the assistant never changes deadlines automatically.",
    severity: "important",
    deadline: nextDeadline,
    projectName: project.name,
  };
}

export function createCalendarConflictSuggestions(
  context: AssistantPlanningContext,
) {
  const workWarnings = context.calendarConflicts.slice(0, 2).map((conflict, index) => {
    const description =
      "This block may overlap with your saved work shift. Review the time before relying on this plan.";

    return {
      id: createSuggestionId("work-conflict", index),
      type: "workload_warning",
      title: `${conflict.day} block may overlap work`,
      description,
      confidence: 0.9,
      summary: description,
      rationale: describeWeeklyPlanWorkConflict(conflict),
      severity: "warning",
      day: conflict.day,
      projectName: conflict.block.projectName,
    } satisfies AssistantSuggestion;
  });
  const importedWarnings = context.importedEventConflicts
    .slice(0, 2)
    .map((conflict, index) => {
      const description =
        "This block may overlap with an imported calendar event. Review the time before relying on this plan.";

      return {
        id: createSuggestionId("imported-conflict", index),
        type: "workload_warning",
        title: `${conflict.day} block may overlap calendar`,
        description,
        confidence: 0.9,
        summary: description,
        rationale: describeWeeklyPlanImportedEventConflict(conflict),
        severity: "warning",
        day: conflict.day,
        projectName: conflict.block.projectName,
      } satisfies AssistantSuggestion;
    });

  return [...workWarnings, ...importedWarnings];
}

function formatGoogleSyncBlock(block: AssistantGoogleSyncBlock) {
  const timeText = block.startTime ? formatStartTime(block.startTime) : "Anytime";

  return `${block.projectName} on ${block.day} at ${timeText} (${formatEstimatedHours(
    block.durationHours,
  )})`;
}

function formatGoogleSyncBlockList(blocks: AssistantGoogleSyncBlock[]) {
  if (blocks.length === 0) {
    return "";
  }

  const labels = blocks.slice(0, 3).map(formatGoogleSyncBlock);
  const remainder = blocks.length - labels.length;

  return `${labels.join("; ")}${remainder > 0 ? `; +${remainder} more` : ""}`;
}

function createGoogleSyncFallbackSuggestions(
  context: AssistantPlanningContext,
) {
  const suggestions: AssistantSuggestion[] = [];

  if (context.googleSync.needsTimeBlocks.length > 0) {
    const description = `${formatGoogleSyncBlockList(
      context.googleSync.needsTimeBlocks,
    )} need start times before they can be selected for Google Calendar sync.`;

    suggestions.push({
      id: "google-sync-needs-time",
      type: "workload_warning",
      title: "Add start times before syncing",
      description,
      confidence: 0.9,
      summary: description,
      rationale:
        "Flexible blocks are not sent to Google Calendar until the user adds start times.",
      severity: "warning",
    });
  }

  if (context.googleSync.overnightBlocks.length > 0) {
    const description = `${formatGoogleSyncBlockList(
      context.googleSync.overnightBlocks,
    )} end after midnight. Review the time before syncing.`;

    suggestions.push({
      id: "google-sync-overnight",
      type: "workload_warning",
      title: "Review overnight blocks",
      description,
      confidence: 0.88,
      summary: description,
      rationale:
        "Blocks that cross midnight can be valid, but users should confirm the intended calendar date.",
      severity: "warning",
    });
  }

  if (context.googleSync.needsAttentionBlocks.length > 0) {
    const description = `${formatGoogleSyncBlockList(
      context.googleSync.needsAttentionBlocks,
    )} changed after syncing. Google Calendar may still have the older version.`;

    suggestions.push({
      id: "google-sync-needs-attention",
      type: "workload_warning",
      title: "Review changed synced blocks",
      description,
      confidence: 0.9,
      summary: description,
      rationale:
        "Google sync is manual and one-way, so edited blocks are not updated in Google Calendar automatically.",
      severity: "warning",
    });
  }

  const conflictedBlocks = context.googleSync.conflictBlocks.filter(
    (block) => block.warnings.length > 0,
  );

  if (conflictedBlocks.length > 0) {
    const description = `${formatGoogleSyncBlockList(
      conflictedBlocks,
    )} may overlap existing commitments. Review warnings on the Weekly Plan page before syncing.`;

    suggestions.push({
      id: "google-sync-conflicts",
      type: "workload_warning",
      title: "Check conflicts before syncing",
      description,
      confidence: 0.86,
      summary: description,
      rationale:
        "The assistant can flag possible overlaps, but it does not move or sync calendar events.",
      severity: "warning",
    });
  }

  return suggestions;
}

function createGoogleSyncFallbackMessage(
  context: AssistantPlanningContext,
  prompt: string,
) {
  const sync = context.googleSync;
  const manualSyncNote =
    "Nothing is sent to Google Calendar unless you select blocks and sync them from the Weekly Plan page.";
  const asksToSync =
    /\b(sync|send|push)\b/i.test(prompt) &&
    !/\b(what|which|why|how|status|ready|need|needs|mean|meaning)\b/i.test(
      prompt,
    );
  const asksForStartTimes = /\b(start time|start times|needs time)\b/i.test(
    prompt,
  );
  const asksMeaning =
    /\bwhat (does|is).*synced|synced mean|why.*needs attention|what.*needs attention\b/i.test(
      prompt,
    );

  if (asksMeaning) {
    return `Synced means the block has already been added to your dedicated Schedule Builder Google Calendar. Needs attention means the Schedule Builder block changed after syncing, so Google Calendar may still have the older version. ${manualSyncNote}`;
  }

  if (asksForStartTimes) {
    return sync.needsTimeBlocks.length > 0
      ? `These blocks still need start times before Google sync: ${formatGoogleSyncBlockList(
          sync.needsTimeBlocks,
        )}. ${manualSyncNote}`
      : `All current unsynced blocks that can be sent to Google Calendar already have start times. You have ${sync.readyBlocks.length} ready to sync. ${manualSyncNote}`;
  }

  const statusParts = [
    `${sync.readyBlocks.length} ready to sync`,
    `${sync.syncedBlocks.length} already synced`,
    `${sync.needsTimeBlocks.length} need start times`,
    `${sync.needsAttentionBlocks.length} need attention`,
  ];

  if (sync.overnightBlocks.length > 0) {
    statusParts.push(`${sync.overnightBlocks.length} end after midnight`);
  }

  if (sync.conflictBlocks.length > 0) {
    statusParts.push(`${sync.conflictBlocks.length} may overlap commitments`);
  }

  const reviewNote =
    sync.overnightBlocks.length > 0
      ? ` I’d review ${formatGoogleSyncBlockList(
          sync.overnightBlocks,
        )} because it ends after midnight.`
      : sync.needsTimeBlocks.length > 0
        ? ` Add start times to ${formatGoogleSyncBlockList(
            sync.needsTimeBlocks,
          )} before syncing.`
        : "";

  if (asksToSync) {
    return `I can help you review what is ready, but Google sync is manual. You have ${statusParts.join(
      ", ",
    )}.${reviewNote} ${manualSyncNote}`;
  }

  return `Here’s the Google Calendar sync check: ${statusParts.join(
    ", ",
  )}.${reviewNote} ${manualSyncNote}`;
}

function isSimpleConfirmationPrompt(prompt: string) {
  return /^(yes|yeah|yep|sure|please|do it|sounds good|ok|okay|alright|all right)(?:[\s,!.]*)?$/i.test(
    prompt.trim(),
  );
}

function parseDisplayClockToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):([0-5]\d)\s*([AP]M)$/i);

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
    return null;
  }

  if (period === "PM" && hour !== 12) {
    hour += 12;
  }

  if (period === "AM" && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function getPurposeFromUserPrompt(prompt: string) {
  if (/\bkhutba|sermon\b/i.test(prompt)) {
    return {
      task: "write the khutba speech",
      title: "Khutba speech",
    };
  }

  if (/\bspeech\b/i.test(prompt)) {
    return {
      task: "write the speech",
      title: "Speech prep",
    };
  }

  if (/\bstudy|exam\b/i.test(prompt)) {
    return {
      task: "study or prepare for the exam",
      title: "Study block",
    };
  }

  if (/\bpresentation|slides\b/i.test(prompt)) {
    return {
      task: "prepare the presentation",
      title: "Presentation prep",
    };
  }

  const fallbackTitle = inferStandaloneBlockTitle(prompt);

  return {
    task: prompt.trim() || fallbackTitle,
    title: fallbackTitle,
  };
}

function getLastOpenTimeAssistantMessage(
  recentMessages: readonly AssistantHistoryItem[] = [],
) {
  return [...recentMessages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        /Want me to turn one of these into a time block\?/i.test(message.content) &&
        /^-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/im.test(
          message.content,
        ),
    )?.content;
}

function getLastOpenTimeUserPrompt(
  recentMessages: readonly AssistantHistoryItem[] = [],
) {
  return [...recentMessages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        /\b(open|free|available|availability|fit|khutba|speech|sermon|study|exam|presentation|slides)\b/i.test(
          message.content,
        ),
    )?.content;
}

function createFollowUpTimeBlockSuggestion(
  context: AssistantPlanningContext,
  prompt: string,
  recentMessages: readonly AssistantHistoryItem[] = [],
) {
  if (!isSimpleConfirmationPrompt(prompt)) {
    return null;
  }

  const assistantMessage = getLastOpenTimeAssistantMessage(recentMessages);
  const userPrompt = getLastOpenTimeUserPrompt(recentMessages);

  if (!assistantMessage || !userPrompt) {
    return null;
  }

  const windowMatch = assistantMessage.match(
    /^-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b[^:]*:\s*(?:after\s+)?(\d{1,2}:\d{2}\s+[AP]M)(?:-(\d{1,2}:\d{2}\s+[AP]M))?\s+-\s+(\d+(?:\.\d+)?)\s*hrs?/im,
  );

  if (!windowMatch) {
    return null;
  }

  const day = windowMatch[1] as WeekDay;
  const startMinutes = parseDisplayClockToMinutes(windowMatch[2]);
  const windowHours = Number(windowMatch[4]);

  if (startMinutes === null || !Number.isFinite(windowHours) || windowHours <= 0) {
    return null;
  }

  const requestedHours = inferStandaloneBlockHours(userPrompt);
  const estimatedHours = Math.max(0.25, Math.min(requestedHours, windowHours, 3));
  const purpose = getPurposeFromUserPrompt(userPrompt);
  const title = purpose.title;
  const description = `Draft ${formatEstimatedHours(
    estimatedHours,
  )} on ${day} at ${formatMinutesAsClock(startMinutes)} for ${purpose.task}.`;

  return createAssistantResponseFromSuggestions({
    activeProjects: sortProjectsForFocus(context.projects),
    context,
    message: `I drafted the first open window as a reviewable time block. Nothing changes unless you apply it.`,
    suggestions: [
      {
        confidence: 0.78,
        day,
        description,
        estimatedHours,
        id: "follow-up-open-window",
        plannedTask: purpose.task,
        projectName: title,
        rationale:
          "You confirmed the open-window suggestion, so this keeps the earlier date and time constraints instead of starting a new schedule search.",
        severity: "important",
        startTime: formatMinutesAsInputTime(startMinutes),
        summary: description,
        title: `Add ${title}`,
        type: "suggested_weekly_block",
      },
    ],
  });
}

function createOpenTimeFallbackMessage(context: AssistantPlanningContext) {
  const deterministicMessage = createDeterministicScheduleAnswer({
    input: createScheduleAnalysisInput(context),
    prompt: "Find open time this week.",
  });

  if (deterministicMessage) {
    return deterministicMessage;
  }

  const windows = getOpenTimeWindows(context);
  const flexibleBlocks = context.weeklyPlanBlocks.filter(
    (block) => !block.startTime,
  );
  const contextNote =
    context.workShiftsCount > 0 || context.importedEventsCount > 0
      ? "I treated work shifts, scheduled time blocks, and external calendar events as commitments."
      : "I treated your scheduled time blocks as commitments.";
  const flexibleNote =
    flexibleBlocks.length > 0
      ? ` You also have ${flexibleBlocks.length} flexible block${
          flexibleBlocks.length === 1 ? "" : "s"
        } that can still move around.`
      : "";

  if (windows.length === 0) {
    return `${contextNote} I don’t see a clean one-hour opening between 8:00 AM and 10:00 PM this week.${flexibleNote} Want me to help loosen the week or turn a flexible block into a timed one?`;
  }

  return `${contextNote} The clearest open windows I see are ${formatOpenTimeWindows(
    windows,
  )}.${flexibleNote} Want me to turn one of these into a time block?`;
}

function createAnalysisFallbackMessage(
  context: AssistantPlanningContext,
  prompt: string,
) {
  const activeProjects = sortProjectsForFocus(context.projects);
  const topProject = activeProjects[0];

  if (/\btop 3\b/i.test(prompt)) {
    const topProjects = activeProjects.slice(0, 3);

    if (topProjects.length === 0) {
      return "I don’t see active projects to rank yet. Add a project first, and I can help pick your Top 3 from priority, deadline, and next action.";
    }

    return `I’d make your Top ${topProjects.length}: ${topProjects
      .map(
        (project, index) =>
          `${index + 1}. ${project.name} (${project.priority}, next: ${
            project.nextAction
          })`,
      )
      .join("; ")}. Want me to turn those into weekly blocks?`;
  }

  if (focusPromptPattern.test(prompt) && topProject) {
    return `I’d focus on ${topProject.name} first. It has the strongest priority signal right now, and the next action is: ${topProject.nextAction}. Want me to turn that into a specific work block?`;
  }

  const watchouts: string[] = [];

  if (context.calendarConflictCount > 0) {
    watchouts.push(
      `${context.calendarConflictCount} timed block${
        context.calendarConflictCount === 1 ? "" : "s"
      } may overlap work shifts or external calendar events`,
    );
  }

  if (context.googleSyncNeedsTimeCount > 0) {
    watchouts.push(
      `${context.googleSyncNeedsTimeCount} block${
        context.googleSyncNeedsTimeCount === 1 ? "" : "s"
      } need start times before Google sync`,
    );
  }

  if (context.googleSyncNeedsAttentionCount > 0) {
    watchouts.push(
      `${context.googleSyncNeedsAttentionCount} synced block${
        context.googleSyncNeedsAttentionCount === 1 ? "" : "s"
      } need attention because they changed after syncing`,
    );
  }

  if (context.googleSyncOvernightCount > 0) {
    watchouts.push(
      `${context.googleSyncOvernightCount} block${
        context.googleSyncOvernightCount === 1 ? "" : "s"
      } end after midnight`,
    );
  }

  if (context.deadlinesNeedingDatesCount > 0) {
    watchouts.push(
      `${context.deadlinesNeedingDatesCount} project deadline${
        context.deadlinesNeedingDatesCount === 1 ? "" : "s"
      } need exact dates`,
    );
  }

  const overloadedDays = weekDays
    .map((day) => ({
      day,
      hours: context.weeklyPlanBlocks
        .filter((block) => block.day === day)
        .reduce((sum, block) => sum + block.estimatedHours, 0),
    }))
    .filter((item) => item.hours > 6);

  if (overloadedDays.length > 0) {
    watchouts.push(
      `${overloadedDays
        .slice(0, 2)
        .map((item) => `${item.day} has ${formatEstimatedHours(item.hours)}`)
        .join(" and ")}`,
    );
  }

  if (watchouts.length === 0) {
    return "Your week looks workable from what I can see. I don’t see obvious conflicts, overloaded days, or sync issues right now. Want me to turn that into a more detailed plan?";
  }

  return `Here’s what I’d watch: ${watchouts.join(
    "; ",
  )}. I’d review those before adding more blocks. Want me to propose specific edits?`;
}

function createNoObviousFindingsMessage({
  activeProjects,
  context,
  importedCalendarText,
  lightPlanningDayText,
  prompt,
  workScheduleSummary,
}: {
  activeProjects: Project[];
  context: AssistantPlanningContext;
  importedCalendarText: string | null;
  lightPlanningDayText: string;
  prompt: string;
  workScheduleSummary: string | null;
}) {
  const topProject = activeProjects[0];

  if (/\btop 3\b/i.test(prompt)) {
    return createAnalysisFallbackMessage(context, prompt);
  }

  if (studyPromptPattern.test(prompt)) {
    const studyProjects = activeProjects.filter((project) =>
      [project.name, project.nextAction, project.deadline]
        .join(" ")
        .match(studyPromptPattern),
    );

    if (studyProjects.length > 0) {
      return `For study time, I’d start with ${studyProjects
        .slice(0, 2)
        .map((project) => project.name)
        .join(" and ")}. ${
        workScheduleSummary
          ? `Since your work schedule is ${workScheduleSummary}, I’d use ${lightPlanningDayText} or an evening opening.`
          : `I’d look at ${lightPlanningDayText} first.`
      } Want me to create specific study blocks for those?`;
    }

    return `I can help create study blocks, but I don’t see a study/class project in your active list yet. Tell me the class or exam, or add it as a project, and I’ll turn it into focused blocks.`;
  }

  if (balancePromptPattern.test(prompt)) {
    return workScheduleSummary
      ? `Your balance looks manageable right now. I’d keep work fixed (${workScheduleSummary}) and place project or school focus on ${lightPlanningDayText}${
          importedCalendarText ? ` while respecting your ${importedCalendarText}` : ""
        }. Want me to draft a few blocks around that?`
      : `Your week doesn’t show obvious overload right now. I’d use ${lightPlanningDayText} for deeper focus and keep the rest flexible. Want me to draft a few blocks?`;
  }

  if (planWeekPromptPattern.test(prompt)) {
    return topProject
      ? `For this week, I’d anchor around ${topProject.name} first, then keep the rest light so the plan stays realistic. ${lightPlanningDayText} look like the easiest places to add structure. Want me to create the actual blocks?`
      : `I don’t see active projects to build a week around yet. Add one project, and I’ll help shape it into a weekly plan.`;
  }

  if (overloadPromptPattern.test(prompt)) {
    return `I don’t see a major overload signal right now. The week looks stable enough; if you want a deeper check, I can focus specifically on conflicts, deadlines, or Google sync readiness.`;
  }

  return "I don’t see an obvious scheduling problem from this angle. Try asking about open time, sync readiness, deadlines, or your Top 3 and I’ll narrow the answer instead of giving you the same broad check.";
}

export function createFallbackAssistantResponse(
  context: AssistantPlanningContext,
  prompt: string,
  recentMessages: readonly AssistantHistoryItem[] = [],
): AssistantPlanReviewResponse {
  if (isGreetingPrompt(prompt)) {
    const message = didRecentlyOfferPlanningDirections(recentMessages)
      ? "Hey again — we can keep it simple. Do you want to plan your week, find open time, or pick your Top 3?"
      : "Hey — I can help you plan your week, balance your workload, or turn projects into schedule blocks. What would you like to work on?";

    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message,
      suggestions: [],
    });
  }

  if (isVaguePrompt(prompt)) {
    const message = didRecentlyOfferPlanningDirections(recentMessages)
      ? "No problem — I can start by helping you choose one of three things: plan your week, find open time, or decide your Top 3. Which one sounds most useful?"
      : "Sure — do you want me to help you plan your week, find open time, or decide what to focus on first?";

    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message,
      suggestions: [],
    });
  }

  const followUpTimeBlockResponse = createFollowUpTimeBlockSuggestion(
    context,
    prompt,
    recentMessages,
  );

  if (followUpTimeBlockResponse) {
    return followUpTimeBlockResponse;
  }

  const deterministicScheduleMessage =
    !shouldGenerateAssistantActionCards(prompt)
      ? createDeterministicScheduleAnswer({
          input: createScheduleAnalysisInput(context),
          prompt,
          recentMessages,
        })
      : null;

  if (deterministicScheduleMessage) {
    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message: deterministicScheduleMessage,
      suggestions: [],
    });
  }

  if (hasGoogleSyncIntent(prompt)) {
    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message: createGoogleSyncFallbackMessage(context, prompt),
      suggestions: shouldGenerateAssistantActionCards(prompt)
        ? createGoogleSyncFallbackSuggestions(context)
        : [],
    });
  }

  if (
    hasOpenTimeIntent(prompt) &&
    !shouldGenerateAssistantActionCards(prompt)
  ) {
    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message: createOpenTimeFallbackMessage(context),
      suggestions: [],
    });
  }

  if (
    scheduledItemQuestionPattern.test(prompt) &&
    !shouldGenerateAssistantActionCards(prompt)
  ) {
    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message: createScheduledItemsFallbackMessage(context, prompt),
      suggestions: [],
    });
  }

  if (shouldAnswerWithoutActionCards(prompt)) {
    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message: createAnalysisFallbackMessage(context, prompt),
      suggestions: [],
    });
  }

  if (!hasPlanningIntent(prompt)) {
    const message = didRecentlyOfferPlanningDirections(recentMessages)
      ? "No problem — I can start by helping you choose one of three things: plan your week, find open time, or decide your Top 3. Which one sounds most useful?"
      : "Sure — do you want me to help you plan your week, find open time, or decide what to focus on first?";

    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message,
      suggestions: [],
    });
  }

  const suggestions: AssistantSuggestion[] = [];
  const activeProjects = sortProjectsForFocus(context.projects);
  const topProject = activeProjects[0];
  const lightPlanningDays = getLightPlanningDays(context);
  const lightPlanningDayText = formatDayOptions(lightPlanningDays);
  const workScheduleSummary = context.workScheduleSummary;
  const existingBlockProjectNames = new Set(
    context.weeklyPlanBlocks.map((block) => block.projectName.toLowerCase()),
  );
  const highPriorityUnscheduledProjects = activeProjects
    .filter((project) => project.priority === "High")
    .filter((project) => !existingBlockProjectNames.has(project.name.toLowerCase()))
    .slice(0, 2);
  const projectUpdateSuggestion = createFallbackProjectUpdateSuggestion(
    context,
    prompt,
  );

  if (projectUpdateSuggestion) {
    suggestions.push(projectUpdateSuggestion);
  }

  if (
    standaloneBlockPromptPattern.test(prompt) &&
    shouldGenerateAssistantActionCards(prompt)
  ) {
    const shouldUseExactDateItem =
      /\b(today|tomorrow|this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2}|\d{4}-\d{2}-\d{2})\b/i.test(
        prompt,
      ) || /\b(appointment|remind me)\b/i.test(prompt);

    if (shouldUseExactDateItem) {
      const scheduledItemResult = createFallbackScheduledItemSuggestion(
        context,
        prompt,
        suggestions.length,
      );

      if (!scheduledItemResult.suggestion) {
        return createAssistantResponseFromSuggestions({
          activeProjects,
          context,
          message: scheduledItemResult.message,
          suggestions: [],
        });
      }

      suggestions.push(scheduledItemResult.suggestion);
    } else {
      suggestions.push(
        createFallbackStandaloneBlockSuggestion(
          context,
          prompt,
          suggestions.length,
        ),
      );
    }
  }

  if (
    projectDraftPromptPattern.test(prompt) &&
    !standaloneBlockPromptPattern.test(prompt)
  ) {
    const projectName = inferProjectDraftName(prompt);
    const alreadyExists = activeProjects.some(
      (project) => project.name.toLowerCase() === projectName.toLowerCase(),
    );

    if (!alreadyExists) {
      const description =
        "I drafted a project you can review and save. Nothing is added until you apply it.";

      suggestions.push({
        id: createSuggestionId("new-project", suggestions.length),
        type: "new_project",
        title: `Create ${projectName}`,
        description,
        confidence: 0.74,
        summary: description,
        rationale:
          "Project drafts need your approval so the assistant never creates work automatically.",
        severity: "important",
        category: "Growth",
        deadline: "",
        priority: "Medium",
        projectName,
        proposedNextAction: "Define the next concrete step",
        weeklyHours: 2,
      });
    }
  }

  highPriorityUnscheduledProjects.forEach((project, index) => {
    const day = getLeastLoadedDay([
      ...context.weeklyPlanBlocks,
      ...suggestions
        .filter((suggestion) => suggestion.type === "suggested_weekly_block")
        .map((suggestion) => ({
          id: suggestion.id,
          day: suggestion.day ?? "Monday",
          projectName: suggestion.projectName ?? "",
          plannedTask: suggestion.plannedTask ?? "",
          estimatedHours: suggestion.estimatedHours ?? 1,
        })),
    ], context.workShifts, context.importedCalendarEvents);
    const estimatedHours = Math.max(1, Math.min(2, project.weeklyHours));
    const description = createWorkAwareBlockDescription({
      day,
      estimatedHours,
      nextAction: project.nextAction,
      workShifts: context.workShifts,
    });

    suggestions.push({
      id: createSuggestionId("weekly-block", suggestions.length),
      type: "suggested_weekly_block",
      title: `Schedule ${project.name}`,
      description,
      confidence: 0.8,
      summary: description,
      rationale:
        getWorkShiftRangesForDay(context.workShifts, day).length > 0
          ? "This project is high priority and does not yet appear in your weekly time blocks. The suggested day includes work hours, so keep the block outside that shift."
          : "This project is high priority and does not yet appear in your weekly time blocks.",
      severity: "important",
      projectName: project.name,
      day,
      estimatedHours,
      plannedTask: project.nextAction,
    });
  });

  suggestions.push(...createCalendarConflictSuggestions(context));

  activeProjects
    .filter((project) => !project.deadline.trim())
    .slice(0, 2)
    .forEach((project) => {
      suggestions.push({
        id: createSuggestionId("missing-deadline", suggestions.length),
        type: "missing_deadline_warning",
        title: `Add a deadline for ${project.name}`,
        description:
          "This project does not have a deadline, so it may be harder to rank against urgent work.",
        confidence: 0.7,
        summary:
          "This project does not have a deadline, so it may be harder to rank against urgent work.",
        rationale:
          "Deadlines help Schedule Builder prioritize what needs attention first.",
        severity: "warning",
        projectName: project.name,
      });
    });

  activeProjects
    .filter((project) => project.nextAction.trim().length < 8)
    .slice(0, 1)
    .forEach((project) => {
      suggestions.push({
        id: createSuggestionId("next-action", suggestions.length),
        type: "suggested_next_action",
        title: `Clarify the next action for ${project.name}`,
        description:
          "Rewrite the next action so it starts with a concrete verb and can fit into one work block.",
        confidence: 0.65,
        summary:
          "Rewrite the next action so it starts with a concrete verb and can fit into one work block.",
        rationale:
          "Specific next actions make weekly planning faster and reduce decision fatigue.",
        severity: "info",
        projectName: project.name,
        proposedNextAction: `Define the next concrete step for ${project.name}`,
      });
    });

  if (context.plannedWeeklyHours >= 35) {
    suggestions.push({
      id: createSuggestionId("workload", suggestions.length),
      type: "workload_warning",
      title: "Review weekly workload",
      description: `You have ${context.plannedWeeklyHours} planned project hours. Consider protecting focus time or moving lower-priority work.`,
      confidence: 0.75,
      summary: `You have ${context.plannedWeeklyHours} planned project hours. Consider protecting focus time or moving lower-priority work.`,
      rationale:
        "High planned workload can make the week brittle if meetings, classes, or unexpected tasks appear.",
      severity: "warning",
    });
  }

  weekDays.forEach((day) => {
    const dayHours = context.weeklyPlanBlocks
      .filter((block) => block.day === day)
      .reduce((sum, block) => sum + block.estimatedHours, 0);
    const workHours = context.workShifts
      .filter((shift) => shift.day === day)
      .reduce((sum, shift) => sum + getWorkShiftDurationHours(shift), 0);

    if (dayHours > 6) {
      suggestions.push({
        id: createSuggestionId(`workload-${day.toLowerCase()}`, suggestions.length),
        type: "workload_warning",
        title: `${day} may be overloaded`,
        description: `${day} has ${dayHours} hrs of planned blocks. Consider moving one block to a lighter day.`,
        confidence: 0.75,
        summary: `${day} has ${dayHours} hrs of planned blocks. Consider moving one block to a lighter day.`,
        rationale:
          "Daily overload warnings are review-only and will not move anything automatically.",
        severity: "warning",
        day,
      });
    }

    if (workHours > 0 && dayHours + workHours > 10) {
      suggestions.push({
        id: createSuggestionId(`work-aware-${day.toLowerCase()}`, suggestions.length),
        type: "workload_warning",
        title: `${day} has work plus project blocks`,
        description: `${day} already includes ${workHours} hrs of work and ${dayHours} hrs of planned blocks. Keep project work outside shifts or move a block to a lighter day.`,
        confidence: 0.72,
        summary: `${day} has work hours and project blocks. Avoid stacking project work during work shifts.`,
        rationale:
          "Work shifts are read-only context. Schedule Builder will not move anything automatically.",
        severity: "warning",
        day,
      });
    }
  });

  const hasNoObviousFindings = suggestions.length === 0;
  const importedCalendarText =
    context.importedEventsCount > 0
      ? `${context.importedEventsCount} imported calendar event${
          context.importedEventsCount === 1 ? "" : "s"
        }`
      : null;

  const assistantMessage =
    hasNoObviousFindings
      ? createNoObviousFindingsMessage({
          activeProjects,
          context,
          importedCalendarText,
          lightPlanningDayText,
          prompt,
          workScheduleSummary,
        })
      : openTimePromptPattern.test(prompt) && workScheduleSummary && importedCalendarText
      ? `Based on your saved work schedule (${workScheduleSummary}) and ${importedCalendarText}, I’d look for open project time around ${lightPlanningDayText} first. I’ll keep suggestions away from fixed commitments unless you choose a flexible block.`
      : openTimePromptPattern.test(prompt) && workScheduleSummary
      ? `Based on your saved work schedule (${workScheduleSummary}), I’d look for open project time around ${lightPlanningDayText} first. I’ll keep any suggestions away from your work hours unless you choose a flexible block.`
      : openTimePromptPattern.test(prompt) && importedCalendarText
      ? `I’m treating your ${importedCalendarText} as fixed commitments. I’d look for open time around ${lightPlanningDayText} first and keep project blocks away from imported events.`
      : openTimePromptPattern.test(prompt)
      ? `I’d look for open time around ${lightPlanningDayText} first. Those days have the lightest mix of time blocks and fixed commitments right now.`
      : focusPromptPattern.test(prompt) && topProject
      ? `I’d start with ${topProject.name}. It has the strongest priority signal right now, so I’d make the next action visible first and keep the rest of the plan lighter around it.`
      : projectUpdateSuggestion
      ? "I drafted the project edit for review. Use the review card to apply it, and then the Projects and Calendar pages will update from Supabase."
      : projectDraftPromptPattern.test(prompt)
      ? "I drafted a project card you can review first. If it looks right, apply it and I’ll save it to your Projects list."
      : balancePromptPattern.test(prompt) && workScheduleSummary
      ? `I’d treat your work schedule (${workScheduleSummary})${
          importedCalendarText ? ` and ${importedCalendarText}` : ""
        } as locked, then place school or project work on ${lightPlanningDayText} and in smaller blocks around those commitments.`
      : balancePromptPattern.test(prompt)
      ? `I’d balance this by protecting fixed commitments first, then placing one or two high-priority project blocks on ${lightPlanningDayText}.`
      : overloadPromptPattern.test(prompt) && context.calendarConflicts.length > 0
      ? "I found at least one scheduled time block that may overlap your saved work hours. I won’t move anything automatically, but I’d review those conflicts first before adding more blocks."
      : overloadPromptPattern.test(prompt)
      ? "I checked for pressure points first. The most useful move is to spot days where work plus project blocks are stacked too tightly, then shift one lower-priority block away."
      : planWeekPromptPattern.test(prompt) && workScheduleSummary
      ? `Since you work ${workScheduleSummary}${
          importedCalendarText ? ` and have ${importedCalendarText}` : ""
        }, I’d keep project work on ${lightPlanningDayText} or outside those commitments. I picked a few small blocks so the week stays realistic instead of crowded.`
      : planWeekPromptPattern.test(prompt) && importedCalendarText
      ? `I’ll treat your ${importedCalendarText} as fixed calendar commitments, then build the week around ${lightPlanningDayText}. I picked a few small blocks so the plan stays realistic.`
      : planWeekPromptPattern.test(prompt)
      ? "For this week, I’d anchor the plan around your highest-priority active projects and keep the blocks small enough that the schedule still feels doable."
      : suggestions.length > 0
      ? "Absolutely — I’d keep this focused. I picked the highest-impact next steps first so your plan stays realistic instead of crowded."
      : "Tell me what feels most important, and I’ll help turn it into a simple plan.";

  return createAssistantResponseFromSuggestions({
    activeProjects,
    context,
    message: assistantMessage,
    suggestions,
  });
}
