import {
  formatEstimatedHours,
  formatStartTime,
  normalizeStartTime,
  parseStartTimeToMinutes,
} from "@/lib/weekly-plan";

export const scheduledItemTypes = ["task", "appointment"] as const;

export type ScheduledItemType = (typeof scheduledItemTypes)[number];

export type ScheduledItem = {
  id: string;
  itemType: ScheduledItemType;
  title: string;
  description: string;
  itemDate: string;
  startTime?: string;
  estimatedHours: number;
  location: string;
  insertedAt?: string;
  updatedAt?: string;
};

export type ScheduledItemDraft = {
  itemType: ScheduledItemType;
  title: string;
  description: string;
  itemDate: string;
  startTime?: string;
  estimatedHours: string;
  location: string;
};

export function isScheduledItemType(
  value: unknown,
): value is ScheduledItemType {
  return (
    typeof value === "string" &&
    scheduledItemTypes.includes(value as ScheduledItemType)
  );
}

export function normalizeScheduledItemDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseScheduledItemDate(value: unknown) {
  const normalizedDate = normalizeScheduledItemDate(value);

  if (!normalizedDate) {
    return null;
  }

  const [year, month, day] = normalizedDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function createDefaultScheduledItemDraft(
  itemDate: string,
  itemType: ScheduledItemType = "task",
): ScheduledItemDraft {
  return {
    itemType,
    title: "",
    description: "",
    itemDate,
    startTime: "",
    estimatedHours: "1",
    location: "",
  };
}

export function validateScheduledItemDraft(draft: ScheduledItemDraft) {
  if (!isScheduledItemType(draft.itemType)) {
    return "Choose Task or Appointment.";
  }

  if (!draft.title.trim()) {
    return "Title is required.";
  }

  if (!normalizeScheduledItemDate(draft.itemDate)) {
    return "Choose a valid date.";
  }

  const estimatedHours = Number(draft.estimatedHours);

  if (!Number.isFinite(estimatedHours) || estimatedHours <= 0) {
    return "Duration must be greater than 0.";
  }

  const hasStartTime = Boolean(draft.startTime?.trim());
  const startTime = normalizeStartTime(draft.startTime ?? "");

  if (hasStartTime && !startTime) {
    return "Choose a valid start time.";
  }

  if (draft.itemType === "appointment" && !startTime) {
    return "Appointments need a start time.";
  }

  return null;
}

export function createScheduledItemPayload(draft: ScheduledItemDraft) {
  const startTime = normalizeStartTime(draft.startTime ?? "");

  return {
    itemType: draft.itemType,
    title: draft.title.trim(),
    description: draft.description.trim(),
    itemDate: normalizeScheduledItemDate(draft.itemDate) ?? draft.itemDate,
    startTime: startTime ?? undefined,
    estimatedHours: Number(draft.estimatedHours),
    location: draft.location.trim(),
  } satisfies Omit<ScheduledItem, "id" | "insertedAt" | "updatedAt">;
}

export function formatScheduledItemTypeLabel(type: ScheduledItemType) {
  return type === "appointment" ? "Appointment" : "Task";
}

export function formatScheduledItemTimeLabel(
  item: Pick<ScheduledItem, "estimatedHours" | "startTime">,
) {
  return `${formatStartTime(item.startTime)} • ${formatEstimatedHours(
    item.estimatedHours,
  )}`;
}

export function getScheduledItemStartMinutes(
  item: Pick<ScheduledItem, "startTime">,
) {
  return parseStartTimeToMinutes(item.startTime);
}

export function sortScheduledItems(items: ScheduledItem[]) {
  return [...items].sort((first, second) => {
    if (first.itemDate !== second.itemDate) {
      return first.itemDate.localeCompare(second.itemDate);
    }

    const firstStart = getScheduledItemStartMinutes(first);
    const secondStart = getScheduledItemStartMinutes(second);

    if (firstStart !== null && secondStart !== null) {
      return firstStart - secondStart;
    }

    if (firstStart !== null) {
      return -1;
    }

    if (secondStart !== null) {
      return 1;
    }

    return first.title.localeCompare(second.title);
  });
}
