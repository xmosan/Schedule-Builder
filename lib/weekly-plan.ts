export const weekDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const weeklyPlanStorageKey = "project-schedule-dashboard:weekly-plan";

export type WeekDay = (typeof weekDays)[number];

export type WeeklyPlanBlock = {
  id: string;
  day: WeekDay;
  projectName: string;
  plannedTask: string;
  estimatedHours: number;
};

export type WeeklyPlanBlockDraft = {
  day: WeekDay;
  projectName: string;
  plannedTask: string;
  estimatedHours: string;
};

function isWeekDay(value: unknown): value is WeekDay {
  return typeof value === "string" && weekDays.includes(value as WeekDay);
}

function isWeeklyPlanBlock(value: unknown): value is WeeklyPlanBlock {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<WeeklyPlanBlock>;

  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    isWeekDay(candidate.day) &&
    typeof candidate.projectName === "string" &&
    typeof candidate.plannedTask === "string" &&
    typeof candidate.estimatedHours === "number" &&
    Number.isFinite(candidate.estimatedHours) &&
    candidate.estimatedHours > 0
  );
}

export function createWeeklyPlanBlock(
  draft: WeeklyPlanBlockDraft,
): WeeklyPlanBlock | null {
  const estimatedHours = Number(draft.estimatedHours);

  if (
    !draft.projectName.trim() ||
    !draft.plannedTask.trim() ||
    !Number.isFinite(estimatedHours) ||
    estimatedHours <= 0
  ) {
    return null;
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    day: draft.day,
    projectName: draft.projectName.trim(),
    plannedTask: draft.plannedTask.trim(),
    estimatedHours,
  };
}

export function parseStoredWeeklyPlan(
  value: string | null,
): WeeklyPlanBlock[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return null;
    }

    const blocks = parsed.filter(isWeeklyPlanBlock);
    return blocks.length === parsed.length ? blocks : null;
  } catch {
    return null;
  }
}

export function formatEstimatedHours(hours: number) {
  return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
}
