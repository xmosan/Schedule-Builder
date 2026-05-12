import type { Project } from "@/lib/projects";
import {
  formatStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import type { WorkShift } from "@/lib/work-schedule";

export type CalendarDeadline = {
  deadlineText: string;
  projectId: number;
  projectName: string;
};

export type CalendarDaySchedule = {
  date: Date;
  dateLabel: string;
  day: WeekDay;
  deadlines: CalendarDeadline[];
  isoDate: string;
  planBlocks: WeeklyPlanBlock[];
  workShifts: WorkShift[];
};

type BuildCalendarDaysOptions = {
  planBlocks: WeeklyPlanBlock[];
  projects: Project[];
  weekStart?: Date;
  workShifts: WorkShift[];
};

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

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getDateForWeekDay(day: WeekDay, weekDates: CalendarDaySchedule[]) {
  return weekDates.find((weekDate) => weekDate.day === day) ?? null;
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

function getDeadlineWeekDay(value: string, weekDates: CalendarDaySchedule[]) {
  const normalizedValue = value.trim().toLowerCase();
  const matchedDay = weekDays.find((day) =>
    new RegExp(`\\b${day.toLowerCase()}\\b`).test(normalizedValue),
  );

  if (matchedDay) {
    return matchedDay;
  }

  const parsedDate = parseDeadlineDate(value, weekDates[0]?.date ?? new Date());

  if (!parsedDate || !isSameWeekDate(parsedDate, weekDates)) {
    return null;
  }

  return getWeekDayFromDate(parsedDate);
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

export function getCurrentWeekStart(referenceDate = new Date()) {
  const localDate = toLocalDate(referenceDate);
  const day = localDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(localDate, mondayOffset);
}

export function getWeekDates(weekStart = getCurrentWeekStart()) {
  return weekDays.map((day, index) => {
    const date = addDays(weekStart, index);

    return {
      date,
      dateLabel: formatDateLabel(date),
      day,
      deadlines: [],
      isoDate: toIsoDate(date),
      planBlocks: [],
      workShifts: [],
    } satisfies CalendarDaySchedule;
  });
}

export function getWeekRangeLabel(weekDates: Pick<CalendarDaySchedule, "date">[]) {
  const firstDay = weekDates[0]?.date;
  const lastDay = weekDates[weekDates.length - 1]?.date;

  if (!firstDay || !lastDay) {
    return "This week";
  }

  return `${formatDateLabel(firstDay)} - ${formatDateLabel(lastDay)}`;
}

export function buildCalendarDays({
  planBlocks,
  projects,
  weekStart = getCurrentWeekStart(),
  workShifts,
}: BuildCalendarDaysOptions) {
  const weekDates = getWeekDates(weekStart);
  const upcomingDeadlines: CalendarDeadline[] = [];

  const days = weekDates.map((weekDate) => {
    const dayPlanBlocks = planBlocks
      .filter((block) => block.day === weekDate.day)
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

    const dayWorkShifts = workShifts
      .filter((shift) => shift.day === weekDate.day)
      .sort((first, second) => first.startTime.localeCompare(second.startTime));

    return {
      ...weekDate,
      planBlocks: dayPlanBlocks,
      workShifts: dayWorkShifts,
    };
  });

  projects
    .filter((project) => !project.completed && !isIgnorableDeadline(project.deadline))
    .forEach((project) => {
      const deadline: CalendarDeadline = {
        deadlineText: project.deadline,
        projectId: project.id,
        projectName: project.name,
      };
      const deadlineDay = getDeadlineWeekDay(project.deadline, weekDates);
      const matchedDay = deadlineDay ? getDateForWeekDay(deadlineDay, days) : null;

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

export function getPlanBlockTimeLabel(block: WeeklyPlanBlock) {
  return `${formatStartTime(block.startTime)} • ${
    block.estimatedHours
  } ${block.estimatedHours === 1 ? "hr" : "hrs"}`;
}
