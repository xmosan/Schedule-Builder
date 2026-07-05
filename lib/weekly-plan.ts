export const weekDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const weeklyPlanStorageKeyBase = "project-schedule-dashboard:weekly-plan";

export function getWeeklyPlanStorageKey(userId?: string) {
  return userId
    ? `${weeklyPlanStorageKeyBase}:${userId}`
    : weeklyPlanStorageKeyBase;
}

export type WeekDay = (typeof weekDays)[number];

export type WeeklyPlanBlock = {
  id: string;
  day: WeekDay;
  projectName: string;
  plannedTask: string;
  estimatedHours: number;
  startTime?: string;
  scheduledDate?: string;
  seriesId?: string;
};

export type WeeklyPlanBlockDraft = {
  day: WeekDay;
  projectName: string;
  plannedTask: string;
  estimatedHours: string;
  startTime?: string;
  scheduledDate?: string;
  seriesId?: string;
};

function isWeekDay(value: unknown): value is WeekDay {
  return typeof value === "string" && weekDays.includes(value as WeekDay);
}

export function normalizeStartTime(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);

  if (!match) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

export function parseStartTimeToMinutes(value: unknown) {
  const normalizedTime = normalizeStartTime(value);

  if (!normalizedTime) {
    return null;
  }

  const [hours, minutes] = normalizedTime.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatStartTime(value: unknown) {
  const normalizedTime = normalizeStartTime(value);

  if (!normalizedTime) {
    return "Flexible";
  }

  const [rawHours, minutes] = normalizedTime.split(":").map(Number);
  const period = rawHours >= 12 ? "PM" : "AM";
  const displayHours = rawHours % 12 || 12;

  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function isWeeklyPlanBlock(value: unknown): value is WeeklyPlanBlock {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<WeeklyPlanBlock>;
  const hasValidStartTime =
    candidate.startTime == null ||
    candidate.startTime === "" ||
    normalizeStartTime(candidate.startTime) !== null;
  const hasValidScheduledDate =
    candidate.scheduledDate == null ||
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.scheduledDate);

  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    isWeekDay(candidate.day) &&
    typeof candidate.projectName === "string" &&
    typeof candidate.plannedTask === "string" &&
    typeof candidate.estimatedHours === "number" &&
    Number.isFinite(candidate.estimatedHours) &&
    candidate.estimatedHours > 0 &&
    hasValidStartTime &&
    hasValidScheduledDate
  );
}

export function createWeeklyPlanBlock(
  draft: WeeklyPlanBlockDraft,
): WeeklyPlanBlock | null {
  const estimatedHours = Number(draft.estimatedHours);
  const startTime = normalizeStartTime(draft.startTime ?? "");

  if (
    !draft.projectName.trim() ||
    !draft.plannedTask.trim() ||
    !Number.isFinite(estimatedHours) ||
    estimatedHours <= 0 ||
    (draft.startTime?.trim() && !startTime)
  ) {
    return null;
  }

  const block: WeeklyPlanBlock = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    day: draft.day,
    projectName: draft.projectName.trim(),
    plannedTask: draft.plannedTask.trim(),
    estimatedHours,
  };

  if (startTime) {
    block.startTime = startTime;
  }
  if (draft.scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.scheduledDate)) {
    block.scheduledDate = draft.scheduledDate;
  }
  if (draft.seriesId?.trim()) {
    block.seriesId = draft.seriesId.trim();
  }

  return block;
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
