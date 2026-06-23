import {
  formatImportedEventSource,
  isScheduleBuilderExportedEvent,
  type ImportedCalendarEvent,
} from "@/lib/imported-calendar";
import type { ScheduledItem } from "@/lib/scheduled-items";
import {
  formatEstimatedHours,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import { type WorkShift } from "@/lib/work-schedule";

const dayStartDefault = 8 * 60;
const dayEndDefault = 22 * 60;
const usefulWindowMinimumMinutes = 30;

const dayNameByIndex: Record<number, WeekDay> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const dayPatternByDay = new Map(
  weekDays.map((day) => [day, new RegExp(`\\b${day}\\b`, "i")]),
);

export type NormalizedScheduleCommitment = {
  allDay: boolean;
  commitmentType:
    | "external_event"
    | "read_only_google_event"
    | "standalone_item"
    | "time_block"
    | "work_shift";
  date: string;
  endMinutes: number | null;
  endsAt: string | null;
  id: string;
  source:
    | "google_event"
    | "imported_event"
    | "scheduled_item"
    | "time_block"
    | "work_shift";
  sourceLabel: string;
  startMinutes: number | null;
  startsAt: string | null;
  timed: boolean;
  title: string;
};

export type AssistantOpenWindow = {
  date: string;
  day: WeekDay;
  durationMinutes: number;
  endLabel: string;
  endMinutes: number;
  startLabel: string;
  startMinutes: number;
};

export type AssistantScheduleAnalysisInput = {
  importedCalendarEvents: ImportedCalendarEvent[];
  scheduledItems: ScheduledItem[];
  weekStartDate?: string;
  weeklyPlanBlocks: WeeklyPlanBlock[];
  workShifts: WorkShift[];
};

type DateScope = {
  date: string;
  day: WeekDay;
};

type ScheduleRequest = {
  durationMinutes: number | null;
  endMinutes: number;
  isPointCheck: boolean;
  minimumWindowMinutes: number;
  scopes: DateScope[];
  startMinutes: number;
  timeLabel: string;
};

type BlockingCommitment = NormalizedScheduleCommitment & {
  endMinutes: number;
  startMinutes: number;
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
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getWeekStart(weekStartDate?: string) {
  if (weekStartDate) {
    const parsed = new Date(`${weekStartDate}T00:00:00`);

    if (!Number.isNaN(parsed.getTime())) {
      return toLocalDate(parsed);
    }
  }

  const today = toLocalDate(new Date());
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return addDays(today, mondayOffset);
}

function getDayFromDate(date: Date): WeekDay {
  return dayNameByIndex[date.getDay()];
}

function getDateScopeForDay(day: WeekDay, weekStart: Date): DateScope {
  const date = addDays(weekStart, weekDays.indexOf(day));

  return {
    date: toIsoDate(date),
    day,
  };
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMinutes(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatWindowLabel(window: AssistantOpenWindow) {
  if (window.endMinutes === dayEndDefault && window.startMinutes > dayStartDefault) {
    return `after ${window.startLabel}`;
  }

  return `${window.startLabel}-${window.endLabel}`;
}

function normalizePromptHour(hour: number, suffix: string | undefined) {
  const normalizedSuffix = suffix?.replace(/\./g, "").toLowerCase();

  if (normalizedSuffix === "am") {
    return hour === 12 ? 0 : hour;
  }

  if (normalizedSuffix === "pm") {
    return hour === 12 ? 12 : hour + 12;
  }

  // In planning language, "after 5" almost always means after work, not dawn.
  if (hour >= 1 && hour <= 7) {
    return hour + 12;
  }

  return hour;
}

function parseTimeMatch(match: RegExpMatchArray | null) {
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return normalizePromptHour(hour, match[3]) * 60 + minute;
}

function parseRequestedTime(prompt: string) {
  const afterMatch = prompt.match(
    /\bafter\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i,
  );
  const atMatch = prompt.match(
    /\bat\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i,
  );

  if (afterMatch) {
    return {
      isPointCheck: false,
      startMinutes: parseTimeMatch(afterMatch),
    };
  }

  if (atMatch) {
    return {
      isPointCheck: true,
      startMinutes: parseTimeMatch(atMatch),
    };
  }

  if (/\bevening\b/i.test(prompt)) {
    return {
      isPointCheck: false,
      startMinutes: 17 * 60,
    };
  }

  if (/\bafternoon\b/i.test(prompt)) {
    return {
      isPointCheck: false,
      startMinutes: 12 * 60,
    };
  }

  return {
    isPointCheck: false,
    startMinutes: null,
  };
}

function parseDurationMinutes(prompt: string) {
  const numericMatch = prompt.match(
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
  );

  if (numericMatch) {
    const hours = Number(numericMatch[1]);

    return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
  }

  const wordMatch = prompt.match(
    /\b(one|two|three|four|five|six|seven|eight)\s*[- ]?(?:hours?|hour)\b/i,
  );

  if (!wordMatch) {
    return null;
  }

  const wordToHours: Record<string, number> = {
    eight: 8,
    five: 5,
    four: 4,
    one: 1,
    seven: 7,
    six: 6,
    three: 3,
    two: 2,
  };

  return wordToHours[wordMatch[1].toLowerCase()] * 60;
}

function parseDateScopes(prompt: string, weekStart: Date) {
  const lowerPrompt = prompt.toLowerCase();
  const mentionedDays = weekDays.filter((day) =>
    dayPatternByDay.get(day)?.test(prompt),
  );
  const rangeMatch = prompt.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:through|thru|to|-)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  if (rangeMatch) {
    const startDay = weekDays.find(
      (day) => day.toLowerCase() === rangeMatch[1].toLowerCase(),
    );
    const endDay = weekDays.find(
      (day) => day.toLowerCase() === rangeMatch[2].toLowerCase(),
    );

    if (startDay && endDay) {
      const startIndex = weekDays.indexOf(startDay);
      const endIndex = weekDays.indexOf(endDay);
      const indexes =
        startIndex <= endIndex
          ? weekDays.slice(startIndex, endIndex + 1)
          : [...weekDays.slice(startIndex), ...weekDays.slice(0, endIndex + 1)];

      return indexes.map((day) => getDateScopeForDay(day, weekStart));
    }
  }

  if (mentionedDays.length > 0) {
    return mentionedDays.map((day) => getDateScopeForDay(day, weekStart));
  }

  if (/\btomorrow\b/i.test(prompt)) {
    const date = addDays(toLocalDate(new Date()), 1);

    return [{ date: toIsoDate(date), day: getDayFromDate(date) }];
  }

  if (/\btoday\b/i.test(prompt)) {
    const date = toLocalDate(new Date());

    return [{ date: toIsoDate(date), day: getDayFromDate(date) }];
  }

  if (
    lowerPrompt.includes("this week") ||
    lowerPrompt.includes("week") ||
    hasOpenTimeQuestionIntent(prompt)
  ) {
    return weekDays.map((day) => getDateScopeForDay(day, weekStart));
  }

  return weekDays.map((day) => getDateScopeForDay(day, weekStart));
}

function createScheduleRequest(prompt: string, weekStartDate?: string): ScheduleRequest {
  const weekStart = getWeekStart(weekStartDate);
  const requestedTime = parseRequestedTime(prompt);
  const durationMinutes = parseDurationMinutes(prompt);
  const startMinutes = Math.max(
    dayStartDefault,
    requestedTime.startMinutes ?? dayStartDefault,
  );
  const isPointCheck = Boolean(
    requestedTime.isPointCheck && requestedTime.startMinutes !== null,
  );
  const endMinutes = isPointCheck
    ? Math.min(
        dayEndDefault,
        startMinutes + (durationMinutes ?? usefulWindowMinimumMinutes),
      )
    : dayEndDefault;

  return {
    durationMinutes,
    endMinutes,
    isPointCheck,
    minimumWindowMinutes: durationMinutes ?? usefulWindowMinimumMinutes,
    scopes: parseDateScopes(prompt, weekStart),
    startMinutes,
    timeLabel: isPointCheck
      ? `at ${formatMinutes(startMinutes)}`
      : startMinutes > dayStartDefault
        ? `after ${formatMinutes(startMinutes)}`
        : "during the planning day",
  };
}

function addCommitmentSegments({
  baseDate,
  baseId,
  commitmentType,
  endMinutes,
  source,
  sourceLabel,
  startMinutes,
  timed,
  title,
}: {
  baseDate: string;
  baseId: string;
  commitmentType: NormalizedScheduleCommitment["commitmentType"];
  endMinutes: number;
  source: NormalizedScheduleCommitment["source"];
  sourceLabel: string;
  startMinutes: number;
  timed: boolean;
  title: string;
}) {
  const commitments: NormalizedScheduleCommitment[] = [];
  const date = parseIsoDate(baseDate);

  if (!date || endMinutes <= startMinutes) {
    return commitments;
  }

  let cursor = startMinutes;

  while (cursor < endMinutes) {
    const dayOffset = Math.floor(cursor / 1440);
    const segmentDate = addDays(date, dayOffset);
    const segmentEndBoundary = (dayOffset + 1) * 1440;
    const segmentStart = cursor - dayOffset * 1440;
    const segmentEnd = Math.min(endMinutes, segmentEndBoundary) - dayOffset * 1440;

    if (segmentEnd > segmentStart) {
      commitments.push({
        allDay: false,
        commitmentType,
        date: toIsoDate(segmentDate),
        endMinutes: segmentEnd,
        endsAt: null,
        id: `${baseId}:${toIsoDate(segmentDate)}:${segmentStart}`,
        source,
        sourceLabel,
        startMinutes: segmentStart,
        startsAt: null,
        timed,
        title,
      });
    }

    cursor = segmentEndBoundary;
  }

  return commitments;
}

function addImportedEventSegments(event: ImportedCalendarEvent) {
  if (isScheduleBuilderOwnedExternalEvent(event)) {
    return [] as NormalizedScheduleCommitment[];
  }

  const startsAt = new Date(event.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    return [];
  }

  const sourceLabel = getImportedSourceLabel(event);

  if (event.allDay) {
    return [
      {
        allDay: true,
        commitmentType:
          event.source === "google_calendar"
            ? "read_only_google_event"
            : "external_event",
        date: toIsoDate(startsAt),
        endMinutes: null,
        endsAt: event.endsAt,
        id: event.id,
        source:
          event.source === "google_calendar" ? "google_event" : "imported_event",
        sourceLabel,
        startMinutes: null,
        startsAt: event.startsAt,
        timed: false,
        title: event.title,
      } satisfies NormalizedScheduleCommitment,
    ];
  }

  const endsAt = event.endsAt ? new Date(event.endsAt) : null;
  const safeEnd =
    endsAt && !Number.isNaN(endsAt.getTime()) && endsAt > startsAt
      ? endsAt
      : new Date(startsAt.getTime() + 30 * 60 * 1000);
  const commitments: NormalizedScheduleCommitment[] = [];
  let dayCursor = toLocalDate(startsAt);

  while (dayCursor < safeEnd) {
    const nextDay = addDays(dayCursor, 1);
    const segmentStartDate =
      startsAt > dayCursor ? startsAt : new Date(dayCursor);
    const segmentEndDate = safeEnd < nextDay ? safeEnd : nextDay;
    const startMinutes =
      segmentStartDate.getHours() * 60 + segmentStartDate.getMinutes();
    const endMinutes = segmentEndDate.getHours() * 60 + segmentEndDate.getMinutes();
    const segmentEndMinutes = segmentEndDate.getTime() === nextDay.getTime()
      ? 1440
      : endMinutes;

    if (segmentEndMinutes > startMinutes) {
      commitments.push({
        allDay: false,
        commitmentType:
          event.source === "google_calendar"
            ? "read_only_google_event"
            : "external_event",
        date: toIsoDate(dayCursor),
        endMinutes: segmentEndMinutes,
        endsAt: event.endsAt,
        id: `${event.id}:${toIsoDate(dayCursor)}:${startMinutes}`,
        source:
          event.source === "google_calendar" ? "google_event" : "imported_event",
        sourceLabel,
        startMinutes,
        startsAt: event.startsAt,
        timed: true,
        title: event.title,
      });
    }

    dayCursor = nextDay;
  }

  return commitments;
}

function isScheduleBuilderOwnedExternalEvent(event: ImportedCalendarEvent) {
  if (isScheduleBuilderExportedEvent(event)) {
    return true;
  }

  if (event.source !== "google_calendar") {
    return false;
  }

  return (
    /^schedule builder:/i.test(event.title.trim()) ||
    /synced from weekly plan|source:\s*schedule builder/i.test(event.description)
  );
}

function getImportedSourceLabel(event: ImportedCalendarEvent) {
  if (event.source === "google_calendar") {
    return "Read-only Google Calendar event";
  }

  if (event.source === "canvas_ics") {
    return "Imported Canvas event";
  }

  if (event.source === "d2l_ics" || event.source === "brightspace_ics") {
    return "Imported D2L / Brightspace event";
  }

  if (event.source === "school_ics" || event.source === "generic_school_ics") {
    return "School calendar event";
  }

  if (event.source === "ics") {
    return "Imported ICS event";
  }

  return `${formatImportedEventSource(event)} event`;
}

export function buildNormalizedScheduleTimeline({
  importedCalendarEvents,
  scheduledItems,
  weekStartDate,
  weeklyPlanBlocks,
  workShifts,
}: AssistantScheduleAnalysisInput) {
  const weekStart = getWeekStart(weekStartDate);
  const commitments: NormalizedScheduleCommitment[] = [];

  workShifts.forEach((shift) => {
    const startMinutes = parseStartTimeToMinutes(shift.startTime);
    const rawEndMinutes = parseStartTimeToMinutes(shift.endTime);

    if (startMinutes === null || rawEndMinutes === null) {
      return;
    }

    const endMinutes =
      rawEndMinutes <= startMinutes ? rawEndMinutes + 1440 : rawEndMinutes;
    const date = getDateScopeForDay(shift.day, weekStart).date;

    commitments.push(
      ...addCommitmentSegments({
        baseDate: date,
        baseId: `work-shift:${shift.id}`,
        commitmentType: "work_shift",
        endMinutes,
        source: "work_shift",
        sourceLabel: "Work shift",
        startMinutes,
        timed: true,
        title: shift.location ? `Work shift at ${shift.location}` : "Work shift",
      }),
    );
  });

  weeklyPlanBlocks.forEach((block) => {
    const startMinutes = parseStartTimeToMinutes(block.startTime);

    if (startMinutes === null) {
      return;
    }

    const date = getDateScopeForDay(block.day, weekStart).date;

    commitments.push(
      ...addCommitmentSegments({
        baseDate: date,
        baseId: `time-block:${block.id}`,
        commitmentType: "time_block",
        endMinutes: startMinutes + block.estimatedHours * 60,
        source: "time_block",
        sourceLabel: "Weekly Plan time block",
        startMinutes,
        timed: true,
        title: block.projectName,
      }),
    );
  });

  scheduledItems.forEach((item) => {
    const startMinutes = parseStartTimeToMinutes(item.startTime);

    if (startMinutes === null) {
      return;
    }

    commitments.push(
      ...addCommitmentSegments({
        baseDate: item.itemDate,
        baseId: `scheduled-item:${item.id}`,
        commitmentType: "standalone_item",
        endMinutes: startMinutes + item.estimatedHours * 60,
        source: "scheduled_item",
        sourceLabel: item.itemType === "appointment" ? "Appointment" : "Task",
        startMinutes,
        timed: true,
        title: item.title,
      }),
    );
  });

  importedCalendarEvents.forEach((event) => {
    commitments.push(...addImportedEventSegments(event));
  });

  return commitments.sort((first, second) => {
    if (first.date !== second.date) {
      return first.date.localeCompare(second.date);
    }

    return (first.startMinutes ?? 0) - (second.startMinutes ?? 0);
  });
}

function getBlockingCommitments(
  commitments: NormalizedScheduleCommitment[],
  date: string,
) {
  return commitments.filter(
    (commitment): commitment is BlockingCommitment =>
      commitment.date === date &&
      commitment.timed &&
      !commitment.allDay &&
      commitment.startMinutes !== null &&
      commitment.endMinutes !== null,
  );
}

function mergeBlockingRanges(commitments: BlockingCommitment[]) {
  return commitments
    .map((commitment) => ({
      commitment,
      end: Math.min(dayEndDefault, commitment.endMinutes),
      start: Math.max(dayStartDefault, commitment.startMinutes),
    }))
    .filter((range) => range.end > range.start)
    .sort((first, second) => first.start - second.start)
    .reduce<Array<{ commitments: BlockingCommitment[]; end: number; start: number }>>(
      (merged, range) => {
        const previous = merged[merged.length - 1];

        if (!previous || range.start > previous.end) {
          merged.push({
            commitments: [range.commitment],
            end: range.end,
            start: range.start,
          });
          return merged;
        }

        previous.end = Math.max(previous.end, range.end);
        previous.commitments.push(range.commitment);
        return merged;
      },
      [],
    );
}

export function calculateOpenWindows({
  commitments,
  minimumMinutes = usefulWindowMinimumMinutes,
  scopes,
  startMinutes = dayStartDefault,
}: {
  commitments: NormalizedScheduleCommitment[];
  minimumMinutes?: number;
  scopes: DateScope[];
  startMinutes?: number;
}) {
  const windows: AssistantOpenWindow[] = [];

  scopes.forEach((scope) => {
    const mergedRanges = mergeBlockingRanges(
      getBlockingCommitments(commitments, scope.date),
    );
    let cursor = Math.max(dayStartDefault, startMinutes);

    mergedRanges.forEach((range) => {
      if (range.end <= cursor) {
        return;
      }

      if (range.start - cursor >= minimumMinutes) {
        windows.push({
          date: scope.date,
          day: scope.day,
          durationMinutes: range.start - cursor,
          endLabel: formatMinutes(range.start),
          endMinutes: range.start,
          startLabel: formatMinutes(cursor),
          startMinutes: cursor,
        });
      }

      cursor = Math.max(cursor, range.end);
    });

    if (dayEndDefault - cursor >= minimumMinutes) {
      windows.push({
        date: scope.date,
        day: scope.day,
        durationMinutes: dayEndDefault - cursor,
        endLabel: formatMinutes(dayEndDefault),
        endMinutes: dayEndDefault,
        startLabel: formatMinutes(cursor),
        startMinutes: cursor,
      });
    }
  });

  return windows;
}

function findBlockersForRange({
  commitments,
  date,
  endMinutes,
  isPointCheck,
  startMinutes,
}: {
  commitments: NormalizedScheduleCommitment[];
  date: string;
  endMinutes: number;
  isPointCheck: boolean;
  startMinutes: number;
}) {
  return getBlockingCommitments(commitments, date).filter((commitment) => {
    if (isPointCheck) {
      return (
        commitment.startMinutes <= startMinutes && commitment.endMinutes > startMinutes
      );
    }

    return commitment.startMinutes < endMinutes && commitment.endMinutes > startMinutes;
  });
}

function formatDateScope(scope: DateScope) {
  const date = parseIsoDate(scope.date);

  if (!date) {
    return scope.day;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    weekday: "long",
  }).format(date);
}

function formatScopeList(scopes: DateScope[]) {
  if (scopes.length === 1) {
    return formatDateScope(scopes[0]);
  }

  const labels = scopes.map((scope) => scope.day);

  if (scopes.length > 2 && weekDays.indexOf(scopes[0].day) + scopes.length - 1 === weekDays.indexOf(scopes[scopes.length - 1].day)) {
    return `${scopes[0].day} through ${scopes[scopes.length - 1].day}`;
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function formatCommitment(commitment: BlockingCommitment) {
  return `${commitment.sourceLabel}: ${commitment.title} (${formatMinutes(
    commitment.startMinutes,
  )}-${formatMinutes(commitment.endMinutes)})`;
}

function formatCommitmentList(commitments: BlockingCommitment[]) {
  const labels = commitments.slice(0, 3).map(formatCommitment);
  const remainingCount = commitments.length - labels.length;

  return `${labels.join("; ")}${remainingCount > 0 ? `; +${remainingCount} more` : ""}`;
}

function formatOpenWindowList(windows: AssistantOpenWindow[]) {
  const windowsByDate = new Map<string, AssistantOpenWindow[]>();

  windows.forEach((window) => {
    const existing = windowsByDate.get(window.date) ?? [];
    existing.push(window);
    windowsByDate.set(window.date, existing);
  });

  return [...windowsByDate.entries()]
    .map(([date, dateWindows]) => {
      const scope = {
        date,
        day: dateWindows[0].day,
      };

      return `- ${formatDateScope(scope)}: ${dateWindows
        .map(formatWindowLabel)
        .join(", ")}`;
    })
    .join("\n");
}

function getAllDayNotes(
  commitments: NormalizedScheduleCommitment[],
  scopes: DateScope[],
) {
  const scopeDateSet = new Set(scopes.map((scope) => scope.date));

  return commitments.filter(
    (commitment) => commitment.allDay && scopeDateSet.has(commitment.date),
  );
}

function getCheckedSourceSummary(input: AssistantScheduleAnalysisInput) {
  const sources = ["Weekly Plan time blocks"];

  if (input.workShifts.length > 0) {
    sources.push("work shifts");
  }

  if (input.scheduledItems.length > 0) {
    sources.push("tasks and appointments");
  }

  if (input.importedCalendarEvents.length > 0) {
    sources.push("external calendar events");
  }

  return sources.join(", ");
}

function createAllDayNote(notes: NormalizedScheduleCommitment[]) {
  if (notes.length === 0) {
    return "";
  }

  const labels = notes
    .slice(0, 2)
    .map((note) => `${note.title} on ${note.date}`)
    .join("; ");
  const remainder = notes.length > 2 ? `; +${notes.length - 2} more` : "";

  return ` I also saw all-day item${notes.length === 1 ? "" : "s"} (${labels}${remainder}); I did not treat those as precise timed blockers.`;
}

function createMissingContextNote(loadWarning?: string | null) {
  return loadWarning
    ? " Some calendar or schedule data did not load, so this answer may be incomplete."
    : "";
}

function hasOpenTimeQuestionIntent(prompt: string) {
  return /\b(find|show|where|what)\b.*\b(open|free|available|availability|fit)\b/i.test(
    prompt,
  ) || /\b(open time|open slots|free time|available time|availability)\b/i.test(prompt);
}

function hasAvailabilityQuestionIntent(prompt: string) {
  return /\b(am i free|am i available|are .*free|is .*clear|any conflicts|are there .*conflicts?|do i have .*conflicts?|overlap|conflicts?)\b/i.test(
    prompt,
  );
}

function hasBlockingQuestionIntent(prompt: string) {
  return /\b(what(?:'s| is)? blocking|what .*blocked|what .*commitments|what do i have)\b/i.test(
    prompt,
  );
}

export function hasDeterministicScheduleQuestionIntent(prompt: string) {
  const normalizedPrompt = prompt.trim();

  return (
    hasOpenTimeQuestionIntent(normalizedPrompt) ||
    hasAvailabilityQuestionIntent(normalizedPrompt) ||
    hasBlockingQuestionIntent(normalizedPrompt)
  );
}

export function createAssistantScheduleAnalysisSnapshot(
  input: AssistantScheduleAnalysisInput,
) {
  const commitments = buildNormalizedScheduleTimeline(input);
  const weekStart = getWeekStart(input.weekStartDate);
  const scopes = weekDays.map((day) => getDateScopeForDay(day, weekStart));

  return {
    allDayItems: commitments
      .filter((commitment) => commitment.allDay)
      .map((commitment) => ({
        date: commitment.date,
        source: commitment.sourceLabel,
        title: commitment.title,
      })),
    normalizedCommitments: commitments
      .filter((commitment) => commitment.timed)
      .slice(0, 80)
      .map((commitment) => ({
        date: commitment.date,
        end: commitment.endMinutes === null ? null : formatMinutes(commitment.endMinutes),
        source: commitment.sourceLabel,
        start:
          commitment.startMinutes === null
            ? null
            : formatMinutes(commitment.startMinutes),
        title: commitment.title,
        type: commitment.commitmentType,
      })),
    openWindows: calculateOpenWindows({
      commitments,
      minimumMinutes: 60,
      scopes,
    })
      .slice(0, 28)
      .map((window) => ({
        date: window.date,
        day: window.day,
        duration: formatEstimatedHours(window.durationMinutes / 60),
        window: formatWindowLabel(window),
      })),
  };
}

function createOpenTimeAnswer({
  input,
  loadWarning,
  prompt,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
}) {
  const request = createScheduleRequest(prompt, input.weekStartDate);
  const commitments = buildNormalizedScheduleTimeline(input);
  const windows = calculateOpenWindows({
    commitments,
    minimumMinutes: request.minimumWindowMinutes,
    scopes: request.scopes,
    startMinutes: request.startMinutes,
  });
  const allDayNote = createAllDayNote(getAllDayNotes(commitments, request.scopes));
  const missingContextNote = createMissingContextNote(loadWarning);
  const sourceSummary = getCheckedSourceSummary(input);
  const durationNote = request.durationMinutes
    ? ` I only listed windows that can fit ${formatEstimatedHours(
        request.durationMinutes / 60,
      )}.`
    : "";

  if (windows.length === 0) {
    return `I checked ${sourceSummary}. I do not see an open window ${request.timeLabel} between ${formatMinutes(
      dayStartDefault,
    )} and ${formatMinutes(dayEndDefault)} for ${formatScopeList(
      request.scopes,
    )}.${durationNote}${allDayNote}${missingContextNote}`;
  }

  const countLabel = `${windows.length} useful opening${
    windows.length === 1 ? "" : "s"
  }`;

  return `I found ${countLabel} after checking ${sourceSummary}:\n\n${formatOpenWindowList(
    windows,
  )}${durationNote}${allDayNote}${missingContextNote}\n\nWant me to turn one of these into a time block?`;
}

function createAvailabilityAnswer({
  input,
  loadWarning,
  prompt,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
}) {
  const request = createScheduleRequest(prompt, input.weekStartDate);
  const commitments = buildNormalizedScheduleTimeline(input);
  const blockedByScope = request.scopes.map((scope) => ({
    blockers: findBlockersForRange({
      commitments,
      date: scope.date,
      endMinutes: request.endMinutes,
      isPointCheck: request.isPointCheck,
      startMinutes: request.startMinutes,
    }),
    scope,
  }));
  const blockedScopes = blockedByScope.filter((item) => item.blockers.length > 0);
  const clearScopes = blockedByScope.filter((item) => item.blockers.length === 0);
  const missingContextNote = createMissingContextNote(loadWarning);
  const allDayNote = createAllDayNote(getAllDayNotes(commitments, request.scopes));
  const asksFree = /\b(am i free|am i available|free|available|clear)\b/i.test(prompt);

  if (blockedScopes.length === 0) {
    const directAnswer = asksFree ? "Yes" : "No";

    return `${directAnswer} - ${formatScopeList(request.scopes)} ${
      request.timeLabel
    } is clear based on the loaded schedule sources.${allDayNote}${missingContextNote}`;
  }

  const blockerLines = blockedScopes
    .map(
      ({ blockers, scope }) =>
        `- ${formatDateScope(scope)}: ${formatCommitmentList(blockers)}`,
    )
    .join("\n");

  if (clearScopes.length > 0) {
    return `Partly - ${formatScopeList(
      clearScopes.map((item) => item.scope),
    )} ${request.timeLabel} is clear, but I found blockers on ${
      blockedScopes.length
    } day${blockedScopes.length === 1 ? "" : "s"}:\n\n${blockerLines}${allDayNote}${missingContextNote}`;
  }

  const directAnswer = asksFree ? "No" : "Yes";

  return `${directAnswer} - I found ${
    blockedScopes.length === 1 ? "a blocker" : "blockers"
  } ${request.timeLabel}:\n\n${blockerLines}${allDayNote}${missingContextNote}`;
}

function createBlockingAnswer({
  input,
  loadWarning,
  prompt,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
}) {
  const request = createScheduleRequest(prompt, input.weekStartDate);
  const commitments = buildNormalizedScheduleTimeline(input);
  const blockers = request.scopes.flatMap((scope) =>
    findBlockersForRange({
      commitments,
      date: scope.date,
      endMinutes: request.endMinutes,
      isPointCheck: request.isPointCheck,
      startMinutes: request.startMinutes,
    }).map((commitment) => ({ commitment, scope })),
  );
  const missingContextNote = createMissingContextNote(loadWarning);
  const allDayNote = createAllDayNote(getAllDayNotes(commitments, request.scopes));

  if (blockers.length === 0) {
    return `I do not see anything blocking ${formatScopeList(request.scopes)} ${
      request.timeLabel
    } in the loaded schedule sources.${allDayNote}${missingContextNote}`;
  }

  const lines = blockers
    .slice(0, 8)
    .map(
      ({ commitment, scope }) =>
        `- ${formatDateScope(scope)}: ${formatCommitment(commitment)}`,
    )
    .join("\n");
  const remainder = blockers.length > 8 ? `\n- +${blockers.length - 8} more` : "";

  return `Here is what is blocking ${formatScopeList(request.scopes)} ${
    request.timeLabel
  }:\n\n${lines}${remainder}${allDayNote}${missingContextNote}`;
}

export function createDeterministicScheduleAnswer({
  input,
  loadWarning,
  prompt,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
}) {
  if (!hasDeterministicScheduleQuestionIntent(prompt)) {
    return null;
  }

  if (hasOpenTimeQuestionIntent(prompt)) {
    return createOpenTimeAnswer({ input, loadWarning, prompt });
  }

  if (hasBlockingQuestionIntent(prompt)) {
    return createBlockingAnswer({ input, loadWarning, prompt });
  }

  return createAvailabilityAnswer({ input, loadWarning, prompt });
}
