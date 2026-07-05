import type { Project } from "@/lib/projects";
import type { ImportedCalendarEvent } from "@/lib/imported-calendar";
import { sortScheduledItems, type ScheduledItem } from "@/lib/scheduled-items";
import {
  formatStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import type { WorkShift } from "@/lib/work-schedule";
import {
  getEffectiveWorkShiftsForDate,
  type ScheduleException,
} from "@/lib/schedule-exceptions";

export type CalendarDeadline = {
  deadlineText: string;
  isoDate?: string;
  projectId: number;
  projectName: string;
};

export type CalendarDaySchedule = {
  date: Date;
  dateLabel: string;
  day: WeekDay;
  deadlines: CalendarDeadline[];
  importedEvents: ImportedCalendarEvent[];
  isoDate: string;
  planBlocks: WeeklyPlanBlock[];
  scheduledItems: ScheduledItem[];
  workShifts: WorkShift[];
};

export type CalendarMonthDaySchedule = CalendarDaySchedule & {
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

type BuildCalendarDaysOptions = {
  importedEvents: ImportedCalendarEvent[];
  planBlocks: WeeklyPlanBlock[];
  projects: Project[];
  scheduledItems?: ScheduledItem[];
  scheduleExceptions?: ScheduleException[];
  weekStart?: Date;
  workShifts: WorkShift[];
};

type BuildCalendarMonthOptions = BuildCalendarDaysOptions & {
  monthDate?: Date;
};

export const calendarWeekDays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const satisfies readonly WeekDay[];

const jsDayToWeekDay: Record<number, WeekDay> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const monthIndexes: Record<string, number> = {
  apr: 3,
  april: 3,
  aug: 7,
  august: 7,
  dec: 11,
  december: 11,
  feb: 1,
  february: 1,
  jan: 0,
  january: 0,
  jul: 6,
  july: 6,
  jun: 5,
  june: 5,
  mar: 2,
  march: 2,
  may: 4,
  nov: 10,
  november: 10,
  oct: 9,
  october: 9,
  sep: 8,
  sept: 8,
  september: 8,
};

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

function isSameWeekDate(date: Date, weekDates: CalendarDaySchedule[]) {
  const isoDate = toIsoDate(date);
  return weekDates.some((weekDate) => weekDate.isoDate === isoDate);
}

function isSameMonthDate(date: Date, monthDate: Date) {
  return (
    date.getFullYear() === monthDate.getFullYear() &&
    date.getMonth() === monthDate.getMonth()
  );
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getWeekDayFromDate(date: Date) {
  return jsDayToWeekDay[date.getDay()];
}

function parseSlashDate(value: string, fallbackYear: number) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = match[3] ? Number(match[3]) : fallbackYear;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseMonthNameDate(value: string, fallbackYear: number) {
  const match = value
    .toLowerCase()
    .match(
      /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/,
    );

  if (!match) {
    return null;
  }

  const month = monthIndexes[match[1]];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : fallbackYear;
  const date = new Date(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

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

  return date;
}

function parseDeadlineDate(value: string, weekStart: Date) {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "today") {
    return toLocalDate(new Date());
  }

  if (normalizedValue === "tomorrow") {
    return addDays(toLocalDate(new Date()), 1);
  }

  return (
    parseIsoDate(value.trim()) ??
    parseSlashDate(value.trim(), weekStart.getFullYear()) ??
    parseMonthNameDate(value.trim(), weekStart.getFullYear())
  );
}

function getExactDeadlineDate(value: string, referenceDate: Date) {
  return parseDeadlineDate(value, referenceDate);
}

function isIgnorableDeadline(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  return (
    !normalizedValue ||
    normalizedValue === "long-term" ||
    normalizedValue === "none" ||
    normalizedValue === "n/a" ||
    normalizedValue === "no deadline"
  );
}

export function getExactProjectDeadlineDate(
  deadline: string,
  referenceDate = new Date(),
) {
  if (isIgnorableDeadline(deadline)) {
    return null;
  }

  return getExactDeadlineDate(deadline, referenceDate);
}

export function getProjectDeadlineBuckets(
  projects: Project[],
  referenceDate = new Date(),
) {
  const exactDeadlines: CalendarDeadline[] = [];
  const deadlinesNeedingDates: CalendarDeadline[] = [];

  projects
    .filter((project) => !project.completed && !isIgnorableDeadline(project.deadline))
    .forEach((project) => {
      const exactDate = getExactProjectDeadlineDate(
        project.deadline,
        referenceDate,
      );

      if (exactDate) {
        exactDeadlines.push({
          deadlineText: project.deadline,
          isoDate: toIsoDate(exactDate),
          projectId: project.id,
          projectName: project.name,
        });
        return;
      }

      deadlinesNeedingDates.push({
        deadlineText: project.deadline,
        projectId: project.id,
        projectName: project.name,
      });
    });

  return {
    deadlinesNeedingDates,
    exactDeadlines,
  };
}

export function getCurrentWeekStart(referenceDate = new Date()) {
  const localDate = toLocalDate(referenceDate);
  const day = localDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(localDate, mondayOffset);
}

export function getCurrentMonthStart(referenceDate = new Date()) {
  const localDate = toLocalDate(referenceDate);
  return new Date(localDate.getFullYear(), localDate.getMonth(), 1);
}

export function getWeekDates(
  weekStart = getCurrentWeekStart(),
): CalendarDaySchedule[] {
  return weekDays.map((day, index) => {
    const date = addDays(weekStart, index);

    return {
      date,
      dateLabel: formatDateLabel(date),
      day,
      deadlines: [],
      importedEvents: [],
      isoDate: toIsoDate(date),
      planBlocks: [],
      scheduledItems: [],
      workShifts: [],
    } satisfies CalendarDaySchedule;
  });
}

export function getMonthLabel(monthDate = getCurrentMonthStart()) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(monthDate);
}

export function getMonthDates(
  monthDate = getCurrentMonthStart(),
): CalendarMonthDaySchedule[] {
  const monthStart = getCurrentMonthStart(monthDate);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const todayIsoDate = toIsoDate(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);

    return {
      date,
      dateLabel: formatDateLabel(date),
      day: getWeekDayFromDate(date),
      dayNumber: date.getDate(),
      deadlines: [],
      importedEvents: [],
      isCurrentMonth: isSameMonthDate(date, monthStart),
      isToday: toIsoDate(date) === todayIsoDate,
      isoDate: toIsoDate(date),
      planBlocks: [],
      scheduledItems: [],
      workShifts: [],
    } satisfies CalendarMonthDaySchedule;
  });
}

export function getWeekRangeLabel(weekDates: Pick<CalendarDaySchedule, "date">[]) {
  const firstDay = weekDates[0]?.date;
  const lastDay = weekDates[weekDates.length - 1]?.date;

  if (!firstDay || !lastDay) {
    return "This week";
  }

  const sameYear = firstDay.getFullYear() === lastDay.getFullYear();
  const sameMonth = sameYear && firstDay.getMonth() === lastDay.getMonth();

  if (sameMonth) {
    const monthLabel = new Intl.DateTimeFormat(undefined, {
      month: "short",
    }).format(firstDay);

    return `${monthLabel} ${firstDay.getDate()} - ${lastDay.getDate()}, ${firstDay.getFullYear()}`;
  }

  if (sameYear) {
    const firstLabel = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
    }).format(firstDay);
    const lastLabel = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
    }).format(lastDay);

    return `${firstLabel} - ${lastLabel}, ${firstDay.getFullYear()}`;
  }

  return `${formatDateLabel(firstDay)} - ${formatDateLabel(lastDay)}`;
}

export function buildCalendarDays({
  importedEvents,
  planBlocks,
  projects,
  scheduledItems = [],
  scheduleExceptions = [],
  weekStart = getCurrentWeekStart(),
  workShifts,
}: BuildCalendarDaysOptions) {
  const weekDates = getWeekDates(weekStart);
  const upcomingDeadlines: CalendarDeadline[] = [];

  const days = weekDates.map((weekDate) => {
    const dayPlanBlocks = planBlocks
      .filter((block) =>
        block.scheduledDate
          ? block.scheduledDate === weekDate.isoDate
          : block.day === weekDate.day,
      )
      .sort((first, second) => {
        const firstStart = parseStartTimeToMinutes(first.startTime);
        const secondStart = parseStartTimeToMinutes(second.startTime);

        if (firstStart !== null && secondStart !== null) {
          return firstStart - secondStart;
        }

        if (firstStart !== null) {
          return -1;
        }

        if (secondStart !== null) {
          return 1;
        }

        return first.projectName.localeCompare(second.projectName);
      });

    const dayWorkShifts = getEffectiveWorkShiftsForDate(
      workShifts,
      scheduleExceptions,
      weekDate.isoDate,
      weekDate.day,
    );
    const dayImportedEvents = importedEvents
      .filter((event) => toIsoDate(new Date(event.startsAt)) === weekDate.isoDate)
      .sort(
        (first, second) =>
          new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime(),
      );
    const dayScheduledItems = sortScheduledItems(
      scheduledItems.filter((item) => item.itemDate === weekDate.isoDate),
    );

    return {
      ...weekDate,
      importedEvents: dayImportedEvents,
      planBlocks: dayPlanBlocks,
      scheduledItems: dayScheduledItems,
      workShifts: dayWorkShifts,
    };
  });

  projects
    .filter((project) => !project.completed && !isIgnorableDeadline(project.deadline))
    .forEach((project) => {
      const exactDate = getExactDeadlineDate(
        project.deadline,
        weekDates[0]?.date ?? new Date(),
      );
      const deadline: CalendarDeadline = {
        deadlineText: project.deadline,
        isoDate: exactDate ? toIsoDate(exactDate) : undefined,
        projectId: project.id,
        projectName: project.name,
      };
      const matchedDay =
        exactDate && isSameWeekDate(exactDate, weekDates)
          ? days.find((day) => day.isoDate === toIsoDate(exactDate)) ?? null
          : null;

      if (matchedDay) {
        matchedDay.deadlines.push(deadline);
        return;
      }

      upcomingDeadlines.push(deadline);
    });

  return {
    days,
    upcomingDeadlines,
    weekRangeLabel: getWeekRangeLabel(weekDates),
  };
}

export function buildCalendarMonth({
  importedEvents,
  monthDate = getCurrentMonthStart(),
  planBlocks,
  projects,
  scheduledItems = [],
  scheduleExceptions = [],
  weekStart = getCurrentWeekStart(),
  workShifts,
}: BuildCalendarMonthOptions) {
  const monthStart = getCurrentMonthStart(monthDate);
  const monthDates = getMonthDates(monthStart);
  const currentWeekDates = getWeekDates(weekStart);
  const currentWeekDatesByIso = new Map(
    currentWeekDates.map((weekDate) => [weekDate.isoDate, weekDate]),
  );
  const upcomingDeadlines: CalendarDeadline[] = [];

  const days = monthDates.map((monthDay) => {
    if (!monthDay.isCurrentMonth) {
      return monthDay;
    }

    const weekDate = currentWeekDatesByIso.get(monthDay.isoDate);
    const datedPlanBlocks = planBlocks.filter(
      (block) => block.scheduledDate === monthDay.isoDate,
    );
    const dayPlanBlocks = weekDate
      ? [...datedPlanBlocks, ...planBlocks.filter(
          (block) => !block.scheduledDate && block.day === weekDate.day,
        )]
          .sort((first, second) => {
            const firstStart = parseStartTimeToMinutes(first.startTime);
            const secondStart = parseStartTimeToMinutes(second.startTime);

            if (firstStart !== null && secondStart !== null) {
              return firstStart - secondStart;
            }

            if (firstStart !== null) {
              return -1;
            }

            if (secondStart !== null) {
              return 1;
            }

            return first.projectName.localeCompare(second.projectName);
          })
      : datedPlanBlocks;

    const dayWorkShifts = getEffectiveWorkShiftsForDate(
      workShifts,
      scheduleExceptions,
      monthDay.isoDate,
      monthDay.day,
    );
    const dayImportedEvents = importedEvents
      .filter((event) => toIsoDate(new Date(event.startsAt)) === monthDay.isoDate)
      .sort(
        (first, second) =>
          new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime(),
      );
    const dayScheduledItems = sortScheduledItems(
      scheduledItems.filter((item) => item.itemDate === monthDay.isoDate),
    );

    return {
      ...monthDay,
      importedEvents: dayImportedEvents,
      planBlocks: dayPlanBlocks,
      scheduledItems: dayScheduledItems,
      workShifts: dayWorkShifts,
    };
  });

  projects
    .filter((project) => !project.completed && !isIgnorableDeadline(project.deadline))
    .forEach((project) => {
      const deadlineDate = getExactDeadlineDate(project.deadline, monthStart);
      const deadline: CalendarDeadline = {
        deadlineText: project.deadline,
        isoDate: deadlineDate ? toIsoDate(deadlineDate) : undefined,
        projectId: project.id,
        projectName: project.name,
      };

      if (deadlineDate && isSameMonthDate(deadlineDate, monthStart)) {
        const matchedDay = days.find(
          (day) => day.isoDate === toIsoDate(deadlineDate),
        );

        if (matchedDay) {
          matchedDay.deadlines.push(deadline);
          return;
        }
      }

      upcomingDeadlines.push(deadline);
    });

  return {
    days,
    monthLabel: getMonthLabel(monthStart),
    upcomingDeadlines,
  };
}

export function getPlanBlockTimeLabel(block: WeeklyPlanBlock) {
  return `${formatStartTime(block.startTime)} • ${
    block.estimatedHours
  } ${block.estimatedHours === 1 ? "hr" : "hrs"}`;
}
