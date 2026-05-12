import type { PlannerType } from "@/lib/onboarding";
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
  findWeeklyPlanWorkConflicts,
  getDayWorkShiftRanges,
  getWorkHoursByDay,
  getWorkScheduleSummary,
  type WeeklyPlanWorkConflict,
} from "@/lib/schedule-conflicts";
import {
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import {
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";

export const assistantSuggestionTypes = [
  "new_project",
  "update_project",
  "suggested_weekly_block",
  "suggested_next_action",
  "workload_warning",
  "missing_deadline_warning",
  "unclear_project_warning",
] as const;

export const assistantPlanningSuggestionTypes = [
  "new_project",
  "update_project",
  "suggested_weekly_block",
  "suggested_next_action",
  "workload_warning",
  "missing_deadline_warning",
  "unclear_project_warning",
] as const;

export type AssistantSuggestionType = (typeof assistantSuggestionTypes)[number];
export type AssistantSuggestionSeverity = "info" | "warning" | "important";
export type AssistantSource = "ai" | "fallback";

export type AssistantContextSummary = {
  activeProjectsCount: number;
  calendarConflictCount: number;
  deadlinesNeedingDatesCount: number;
  deadlinesWithDatesCount: number;
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
  projects: Project[];
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
  deadline?: string;
  newProjectName?: string;
  projectName?: string;
  priority?: ProjectPriority;
  day?: WeekDay;
  estimatedHours?: number;
  plannedTask?: string;
  proposedNextAction?: string;
  weeklyHours?: number;
};

export type AssistantPlanReviewResponse = {
  actions: AssistantSuggestion[];
  assistantMessage: string;
  context: AssistantContextSummary;
  message: string;
  source: AssistantSource;
  suggestions: AssistantSuggestion[];
};

export type AssistantApplyResultStatus = "applied" | "error" | "skipped";

export type AssistantApplyResult = {
  suggestionId: string;
  suggestionTitle: string;
  type: AssistantSuggestionType;
  status: AssistantApplyResultStatus;
  message: string;
};

export type AssistantApplyResponse = {
  context: AssistantContextSummary;
  message: string;
  results: AssistantApplyResult[];
};

type AssistantHistoryItem = {
  content: string;
  role: "assistant" | "user";
};

const maxDefaultAssistantCards = 4;
const maxDefaultWarningCards = 2;

const greetingPattern = /^(hey|hello|hi|salam|assalamu alaikum|yo|sup|good morning|good afternoon|good evening)[\s!.?]*$/i;
const vaguePromptPattern = /^(anything|whatever|what now|now what|help|idk|i don't know|not sure|surprise me)[\s!.?]*$/i;
const planningIntentPattern =
  /\b(plan|schedule|week|weekly|block|blocks|overlap|conflict|conflicts|overload|overloaded|priority|priorities|top 3|study|balance|deadline|deadlines|next action|project|projects|workload|time|focus|first|open time|open|study)\b/i;
const focusPromptPattern = /\b(focus|first|top 3|top priority|priorit|what should i do)\b/i;
const balancePromptPattern = /\bbalance\b/i;
const overloadPromptPattern = /\b(overload|overloaded|too much|busy|overlap|conflict|conflicts)\b/i;
const planWeekPromptPattern = /\b(plan my week|plan this week|weekly plan|week)\b/i;
const openTimePromptPattern =
  /\b(find open time|open time|open slots|free time|available time|availability)\b/i;
const projectDraftPromptPattern =
  /\b(create|add|start|draft|make|save)\b.*\b(project|goal|initiative|class|course|work)\b|\bnew project\b/i;
const projectUpdatePromptPattern =
  /\b(change|update|edit|move|set|shift|rename|adjust|confirm)\b.*\b(project|deadline|due date|priority|category|weekly hours|hours|next action|name)\b|\b(due date|deadline)\b.*\b(later|earlier|after|before|to|on|by)\b/i;

export function isGreetingPrompt(prompt: string) {
  return greetingPattern.test(prompt.trim());
}

export function isVaguePrompt(prompt: string) {
  return vaguePromptPattern.test(prompt.trim());
}

export function hasPlanningIntent(prompt: string) {
  return planningIntentPattern.test(prompt.trim());
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
  const titleRoot = suggestion.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");

  return `${suggestion.type}:${projectName}:${suggestion.day ?? ""}:${titleRoot}`;
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
): WeekDay {
  const hoursByDay = new Map<WeekDay, number>(
    weekDays.map((day) => [day, 0]),
  );

  workShifts.forEach((shift) => {
    hoursByDay.set(
      shift.day,
      (hoursByDay.get(shift.day) ?? 0) + getWorkShiftDurationHours(shift),
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
    deadline:
      typeof candidate.deadline === "string"
        ? candidate.deadline.trim().slice(0, 120)
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
    plannedTask:
      typeof candidate.plannedTask === "string"
        ? candidate.plannedTask.trim().slice(0, 220)
        : undefined,
    proposedNextAction:
      typeof candidate.proposedNextAction === "string"
        ? candidate.proposedNextAction.trim().slice(0, 220)
        : undefined,
    weeklyHours:
      typeof candidate.weeklyHours === "number" &&
      Number.isFinite(candidate.weeklyHours) &&
      candidate.weeklyHours >= 0
        ? Math.min(candidate.weeklyHours, 60)
        : undefined,
  };
}

export function createAssistantContextSummary(
  projects: Project[],
  weeklyPlanBlocks: WeeklyPlanBlock[],
  plannerType: PlannerType | "Unknown",
  workShifts: WorkShift[] = [],
): AssistantContextSummary {
  const calendarConflicts = findWeeklyPlanWorkConflicts(
    weeklyPlanBlocks,
    workShifts,
  );
  const deadlineBuckets = getProjectDeadlineBuckets(projects);

  return {
    activeProjectsCount: projects.filter((project) => !project.completed).length,
    calendarConflictCount: calendarConflicts.length,
    deadlinesNeedingDatesCount: deadlineBuckets.deadlinesNeedingDates.length,
    deadlinesWithDatesCount: deadlineBuckets.exactDeadlines.length,
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
): AssistantPlanningContext {
  const calendarConflicts = findWeeklyPlanWorkConflicts(
    weeklyPlanBlocks,
    workShifts,
  );
  const deadlineBuckets = getProjectDeadlineBuckets(projects);

  return {
    ...createAssistantContextSummary(
      projects,
      weeklyPlanBlocks,
      plannerType,
      workShifts,
    ),
    calendarConflicts,
    deadlinesNeedingDates: deadlineBuckets.deadlinesNeedingDates,
    deadlinesWithDates: deadlineBuckets.exactDeadlines,
    projects,
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

  return [...weekDays]
    .map((day) => {
      const planHours = context.weeklyPlanBlocks
        .filter((block) => block.day === day)
        .reduce((sum, block) => sum + block.estimatedHours, 0);
      const workHours = workHoursByDay.get(day) ?? 0;

      return {
        day,
        totalHours: planHours + workHours,
        workHours,
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

function findPromptProject(projects: Project[], prompt: string) {
  const normalizedPrompt = prompt.toLowerCase();
  const activeProjects = projects.filter((project) => !project.completed);
  const exactMatch = [...activeProjects]
    .sort((first, second) => second.name.length - first.name.length)
    .find((project) => normalizedPrompt.includes(project.name.toLowerCase()));

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
  return context.calendarConflicts.slice(0, 2).map((conflict, index) => {
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

  if (isVaguePrompt(prompt) || !hasPlanningIntent(prompt)) {
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

  if (projectDraftPromptPattern.test(prompt)) {
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
    ], context.workShifts);
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
          ? "This project is high priority and does not yet appear in your weekly plan blocks. The suggested day includes work hours, so keep the block outside that shift."
          : "This project is high priority and does not yet appear in your weekly plan blocks.",
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

  if (hasNoObviousFindings) {
    suggestions.push({
      id: "fallback-good-shape",
      type: "workload_warning",
      title: "Your plan looks workable",
      description:
        "I did not find obvious missing deadlines, overloaded days, or high-priority projects without weekly blocks.",
      confidence: 0.6,
      summary:
        "I did not find obvious missing deadlines, overloaded days, or high-priority projects without weekly blocks.",
      rationale:
        prompt.trim().length > 0
          ? "I checked your current projects and weekly plan for obvious planning gaps."
          : "Ask for a specific planning review to get more targeted suggestions.",
      severity: "info",
    });
  }

  const assistantMessage =
    hasNoObviousFindings
      ? "Your plan looks pretty workable from what I can see. If you want a sharper review, ask me to focus on deadlines, open time, or your Top 3."
      : openTimePromptPattern.test(prompt) && workScheduleSummary
      ? `Based on your saved work schedule (${workScheduleSummary}), I’d look for open project time around ${lightPlanningDayText} first. I’ll keep any suggestions away from your work hours unless you choose a flexible block.`
      : openTimePromptPattern.test(prompt)
      ? `I’d look for open time around ${lightPlanningDayText} first. Those days have the lightest mix of plan blocks and fixed commitments right now.`
      : focusPromptPattern.test(prompt) && topProject
      ? `I’d start with ${topProject.name}. It has the strongest priority signal right now, so I’d make the next action visible first and keep the rest of the plan lighter around it.`
      : projectUpdateSuggestion
      ? "I drafted the project edit for review. Use the review card to apply it, and then the Projects and Calendar pages will update from Supabase."
      : projectDraftPromptPattern.test(prompt)
      ? "I drafted a project card you can review first. If it looks right, apply it and I’ll save it to your Projects list."
      : balancePromptPattern.test(prompt) && workScheduleSummary
      ? `I’d treat your work schedule (${workScheduleSummary}) as locked, then place school or project work on ${lightPlanningDayText} and in smaller evening blocks.`
      : balancePromptPattern.test(prompt)
      ? `I’d balance this by protecting fixed commitments first, then placing one or two high-priority project blocks on ${lightPlanningDayText}.`
      : overloadPromptPattern.test(prompt) && context.calendarConflicts.length > 0
      ? "I found at least one timed plan block that may overlap your saved work hours. I won’t move anything automatically, but I’d review those conflicts first before adding more blocks."
      : overloadPromptPattern.test(prompt)
      ? "I checked for pressure points first. The most useful move is to spot days where work plus project blocks are stacked too tightly, then shift one lower-priority block away."
      : planWeekPromptPattern.test(prompt) && workScheduleSummary
      ? `Since you work ${workScheduleSummary}, I’d keep project work on ${lightPlanningDayText} or outside those shifts. I picked a few small blocks so the week stays realistic instead of crowded.`
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
