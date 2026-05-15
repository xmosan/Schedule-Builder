import {
  formatEstimatedHours,
  formatStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import {
  formatImportedEventTimeRange,
  isScheduleBuilderExportedEvent,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import {
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  type WorkShift,
} from "@/lib/work-schedule";

export type WeeklyPlanWorkConflict = {
  block: WeeklyPlanBlock;
  blockEndLabel: string;
  blockStartLabel: string;
  day: WeekDay;
  message: string;
  shift: WorkShift;
  shiftRangeLabel: string;
};

export type WeeklyPlanImportedEventConflict = {
  block: WeeklyPlanBlock;
  blockEndLabel: string;
  blockStartLabel: string;
  day: WeekDay;
  event: ImportedCalendarEvent;
  eventRangeLabel: string;
  message: string;
};

function formatDayList(days: WeekDay[]) {
  const sortedDays = [...days].sort(
    (first, second) => weekDays.indexOf(first) - weekDays.indexOf(second),
  );

  if (sortedDays.length === 0) {
    return "";
  }

  if (sortedDays.length === 1) {
    return sortedDays[0];
  }

  const firstIndex = weekDays.indexOf(sortedDays[0]);
  const isConsecutive = sortedDays.every(
    (day, index) => weekDays.indexOf(day) === firstIndex + index,
  );

  if (isConsecutive && sortedDays.length > 2) {
    return `${sortedDays[0]} through ${sortedDays[sortedDays.length - 1]}`;
  }

  if (sortedDays.length === 2) {
    return `${sortedDays[0]} and ${sortedDays[1]}`;
  }

  return `${sortedDays.slice(0, -1).join(", ")}, and ${
    sortedDays[sortedDays.length - 1]
  }`;
}

function formatMinutesAsTimeLabel(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function toLocalDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCurrentWeekStart(referenceDate = new Date()) {
  const localDate = toLocalDate(referenceDate);
  const day = localDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return addDays(localDate, mondayOffset);
}

function getWeekDateForDay(day: WeekDay, weekStart = getCurrentWeekStart()) {
  return addDays(weekStart, weekDays.indexOf(day));
}

export function getWorkScheduleSummary(workShifts: WorkShift[]) {
  if (workShifts.length === 0) {
    return null;
  }

  const groups = new Map<string, { days: WeekDay[]; range: string }>();

  workShifts.forEach((shift) => {
    const key = `${shift.startTime}-${shift.endTime}`;
    const existing = groups.get(key);

    if (existing) {
      existing.days.push(shift.day);
      return;
    }

    groups.set(key, {
      days: [shift.day],
      range: formatWorkShiftRange(shift),
    });
  });

  return [...groups.values()]
    .map((group) => `${formatDayList(group.days)} from ${group.range}`)
    .join("; ");
}

export function getDayWorkShiftRanges(workShifts: WorkShift[], day: WeekDay) {
  return workShifts
    .filter((shift) => shift.day === day)
    .sort((first, second) => first.startTime.localeCompare(second.startTime))
    .map(formatWorkShiftRange);
}

export function getWorkHoursByDay(workShifts: WorkShift[]) {
  return new Map<WeekDay, number>(
    weekDays.map((day) => [
      day,
      workShifts
        .filter((shift) => shift.day === day)
        .reduce((sum, shift) => sum + getWorkShiftDurationHours(shift), 0),
    ]),
  );
}

export function weeklyPlanBlockOverlapsWorkShift(
  block: WeeklyPlanBlock,
  shift: WorkShift,
) {
  if (block.day !== shift.day) {
    return false;
  }

  const blockStart = parseStartTimeToMinutes(block.startTime);
  const shiftStart = parseStartTimeToMinutes(shift.startTime);
  const shiftEnd = parseStartTimeToMinutes(shift.endTime);

  if (blockStart === null || shiftStart === null || shiftEnd === null) {
    return false;
  }

  const blockEnd = blockStart + block.estimatedHours * 60;

  return blockStart < shiftEnd && blockEnd > shiftStart;
}

export function getWeeklyPlanWorkConflictForBlock(
  block: WeeklyPlanBlock,
  workShifts: WorkShift[],
): WeeklyPlanWorkConflict | null {
  const shift = workShifts.find((candidate) =>
    weeklyPlanBlockOverlapsWorkShift(block, candidate),
  );

  if (!shift) {
    return null;
  }

  const blockStart = parseStartTimeToMinutes(block.startTime) ?? 0;
  const blockEnd = blockStart + block.estimatedHours * 60;
  const blockStartLabel = formatStartTime(block.startTime);
  const blockEndLabel = formatMinutesAsTimeLabel(blockEnd);
  const shiftRangeLabel = formatWorkShiftRange(shift);

  return {
    block,
    blockEndLabel,
    blockStartLabel,
    day: block.day,
    message: `This block may overlap with your saved work shift (${shiftRangeLabel}).`,
    shift,
    shiftRangeLabel,
  };
}

export function findWeeklyPlanWorkConflicts(
  blocks: WeeklyPlanBlock[],
  workShifts: WorkShift[],
) {
  return blocks
    .map((block) => getWeeklyPlanWorkConflictForBlock(block, workShifts))
    .filter((conflict): conflict is WeeklyPlanWorkConflict => conflict !== null);
}

export function weeklyPlanBlockOverlapsImportedEvent(
  block: WeeklyPlanBlock,
  event: ImportedCalendarEvent,
  weekStart = getCurrentWeekStart(),
) {
  if (isScheduleBuilderExportedEvent(event)) {
    return false;
  }

  const blockStartMinutes = parseStartTimeToMinutes(block.startTime);

  if (blockStartMinutes === null) {
    return false;
  }

  const blockDate = getWeekDateForDay(block.day, weekStart);
  const eventStart = new Date(event.startsAt);

  if (Number.isNaN(eventStart.getTime())) {
    return false;
  }

  if (toIsoDate(blockDate) !== toIsoDate(eventStart)) {
    return false;
  }

  if (event.allDay) {
    return true;
  }

  const eventEnd = event.endsAt ? new Date(event.endsAt) : null;
  const eventStartMinutes = eventStart.getHours() * 60 + eventStart.getMinutes();
  const eventEndMinutes =
    eventEnd && !Number.isNaN(eventEnd.getTime())
      ? eventEnd.getHours() * 60 + eventEnd.getMinutes()
      : eventStartMinutes + 30;
  const blockEndMinutes = blockStartMinutes + block.estimatedHours * 60;

  return blockStartMinutes < eventEndMinutes && blockEndMinutes > eventStartMinutes;
}

export function getWeeklyPlanImportedEventConflictForBlock(
  block: WeeklyPlanBlock,
  importedEvents: ImportedCalendarEvent[],
  weekStart = getCurrentWeekStart(),
): WeeklyPlanImportedEventConflict | null {
  const event = importedEvents.find((candidate) =>
    weeklyPlanBlockOverlapsImportedEvent(block, candidate, weekStart),
  );

  if (!event) {
    return null;
  }

  const blockStart = parseStartTimeToMinutes(block.startTime) ?? 0;
  const blockEnd = blockStart + block.estimatedHours * 60;
  const blockStartLabel = formatStartTime(block.startTime);
  const blockEndLabel = formatMinutesAsTimeLabel(blockEnd);
  const eventRangeLabel = formatImportedEventTimeRange(event);

  return {
    block,
    blockEndLabel,
    blockStartLabel,
    day: block.day,
    event,
    eventRangeLabel,
    message: `This block may overlap with an imported calendar event (${event.title}, ${eventRangeLabel}).`,
  };
}

export function findWeeklyPlanImportedEventConflicts(
  blocks: WeeklyPlanBlock[],
  importedEvents: ImportedCalendarEvent[],
  weekStart = getCurrentWeekStart(),
) {
  return blocks
    .map((block) =>
      getWeeklyPlanImportedEventConflictForBlock(block, importedEvents, weekStart),
    )
    .filter(
      (conflict): conflict is WeeklyPlanImportedEventConflict =>
        conflict !== null,
    );
}

export function describeWeeklyPlanWorkConflict(
  conflict: WeeklyPlanWorkConflict,
) {
  return `${conflict.block.projectName} on ${conflict.day} is scheduled ${conflict.blockStartLabel} - ${conflict.blockEndLabel} (${formatEstimatedHours(
    conflict.block.estimatedHours,
  )}) and may overlap your work shift ${conflict.shiftRangeLabel}.`;
}

export function describeWeeklyPlanImportedEventConflict(
  conflict: WeeklyPlanImportedEventConflict,
) {
  return `${conflict.block.projectName} on ${conflict.day} is scheduled ${conflict.blockStartLabel} - ${conflict.blockEndLabel} (${formatEstimatedHours(
    conflict.block.estimatedHours,
  )}) and may overlap imported event "${conflict.event.title}" (${conflict.eventRangeLabel}).`;
}
