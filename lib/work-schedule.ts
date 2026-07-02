import { weekDays, type WeekDay } from "@/lib/weekly-plan";

export type WorkShift = {
  id: string;
  day: WeekDay;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  recurring: boolean;
  exceptionDate?: string;
  exceptionId?: string;
  exceptionType?: "modify_shift" | "extra_shift" | "blocked_time";
  isException?: boolean;
};

export type WorkShiftDraft = {
  day: WeekDay;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  recurring: boolean;
};

export const defaultWorkShiftDraft: WorkShiftDraft = {
  day: "Monday",
  startTime: "09:00",
  endTime: "17:00",
  location: "",
  notes: "",
  recurring: true,
};

export function isWeekDay(value: unknown): value is WeekDay {
  return typeof value === "string" && weekDays.includes(value as WeekDay);
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

export function validateWorkShiftDraft(draft: WorkShiftDraft) {
  if (!isWeekDay(draft.day)) {
    return "Choose a valid day.";
  }

  const startMinutes = parseTimeToMinutes(draft.startTime);
  const endMinutes = parseTimeToMinutes(draft.endTime);

  if (startMinutes === null || endMinutes === null) {
    return "Start time and end time are required.";
  }

  if (endMinutes <= startMinutes) {
    return "End time must be after start time.";
  }

  return null;
}

export function getWorkShiftDurationHours(shift: Pick<WorkShift, "startTime" | "endTime">) {
  const startMinutes = parseTimeToMinutes(shift.startTime);
  const endMinutes = parseTimeToMinutes(shift.endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return 0;
  }

  return (endMinutes - startMinutes) / 60;
}

export function formatTimeLabel(value: string) {
  const minutes = parseTimeToMinutes(value);

  if (minutes === null) {
    return value;
  }

  const hours = Math.floor(minutes / 60);
  const minuteValue = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${displayHour}:${String(minuteValue).padStart(2, "0")} ${suffix}`;
}

export function formatWorkShiftRange(shift: Pick<WorkShift, "startTime" | "endTime">) {
  return `${formatTimeLabel(shift.startTime)} - ${formatTimeLabel(shift.endTime)}`;
}

export function sortWorkShifts(shifts: WorkShift[]) {
  return [...shifts].sort((first, second) => {
    const dayDifference = weekDays.indexOf(first.day) - weekDays.indexOf(second.day);

    if (dayDifference !== 0) {
      return dayDifference;
    }

    return first.startTime.localeCompare(second.startTime);
  });
}
