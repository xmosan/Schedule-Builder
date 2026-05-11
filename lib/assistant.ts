import type { PlannerType } from "@/lib/onboarding";
import {
  getPlannedHours,
  priorityScore,
  sortProjectsForFocus,
  type Project,
} from "@/lib/projects";
import {
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import {
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";

export const assistantSuggestionTypes = [
  "suggested_weekly_block",
  "suggested_next_action",
  "workload_warning",
  "missing_deadline_warning",
  "unclear_project_warning",
] as const;

export const assistantPlanningSuggestionTypes = [
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
  plannedWeeklyHours: number;
  plannerType: PlannerType | "Unknown";
  totalWeeklyBlockHours: number;
  weeklyBlocksCount: number;
  workScheduleHours: number;
  workShiftsCount: number;
};

export type AssistantPlanningContext = AssistantContextSummary & {
  projects: Project[];
  weeklyPlanBlocks: WeeklyPlanBlock[];
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
  projectName?: string;
  day?: WeekDay;
  estimatedHours?: number;
  plannedTask?: string;
  proposedNextAction?: string;
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

const maxDefaultAssistantCards = 4;
const maxDefaultWarningCards = 2;

const greetingPattern = /^(hey|hello|hi|salam|assalamu alaikum|yo|sup|good morning|good afternoon|good evening)[\s!.?]*$/i;
const planningIntentPattern =
  /\b(plan|schedule|week|weekly|block|blocks|overload|overloaded|priority|priorities|top 3|study|balance|deadline|deadlines|next action|project|projects|workload|time)\b/i;

export function isGreetingPrompt(prompt: string) {
  return greetingPattern.test(prompt.trim());
}

export function hasPlanningIntent(prompt: string) {
  return planningIntentPattern.test(prompt.trim());
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

function createSuggestionId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function getSuggestionPriority(suggestion: AssistantSuggestion) {
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
  return workShifts
    .filter((shift) => shift.day === day)
    .map(formatWorkShiftRange);
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
    projectName:
      typeof candidate.projectName === "string"
        ? candidate.projectName.trim().slice(0, 120)
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
  };
}

export function createAssistantContextSummary(
  projects: Project[],
  weeklyPlanBlocks: WeeklyPlanBlock[],
  plannerType: PlannerType | "Unknown",
  workShifts: WorkShift[] = [],
): AssistantContextSummary {
  return {
    activeProjectsCount: projects.filter((project) => !project.completed).length,
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
  return {
    ...createAssistantContextSummary(
      projects,
      weeklyPlanBlocks,
      plannerType,
      workShifts,
    ),
    projects,
    weeklyPlanBlocks,
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

export function createFallbackAssistantResponse(
  context: AssistantPlanningContext,
  prompt: string,
): AssistantPlanReviewResponse {
  if (isGreetingPrompt(prompt)) {
    const message =
      "Hey — I can help you plan your week, balance your workload, or turn projects into schedule blocks. What would you like to work on?";

    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message,
      suggestions: [],
    });
  }

  if (!hasPlanningIntent(prompt)) {
    const message =
      "I can help with that. If you want, tell me what you are trying to plan or what feels messy right now, and I’ll turn it into a few practical next steps.";

    return createAssistantResponseFromSuggestions({
      activeProjects: sortProjectsForFocus(context.projects),
      context,
      message,
      suggestions: [],
    });
  }

  const suggestions: AssistantSuggestion[] = [];
  const activeProjects = sortProjectsForFocus(context.projects);
  const existingBlockProjectNames = new Set(
    context.weeklyPlanBlocks.map((block) => block.projectName.toLowerCase()),
  );
  const highPriorityUnscheduledProjects = activeProjects
    .filter((project) => project.priority === "High")
    .filter((project) => !existingBlockProjectNames.has(project.name.toLowerCase()))
    .slice(0, 2);

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
