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

function getDefaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Detroit";
  } catch {
    return "America/Detroit";
  }
}

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
  timezone?: string;
  weekStartDate?: string;
  weeklyPlanBlocks: WeeklyPlanBlock[];
  workShifts: WorkShift[];
};

type DateScope = {
  date: string;
  day: WeekDay;
  searchEndMinutes?: number;
  searchStartMinutes?: number;
};

export type SchedulingQuery = {
  ambiguityFlags: string[];
  conversationConstraints: {
    hardDeadline?: string;
    inheritedDateRange?: {
      end: string;
      endInclusive: boolean;
      start: string;
      startInclusive: boolean;
    };
    inheritedDuration?: number;
    inheritedPurpose?: string;
  };
  intent:
    | "check_availability"
    | "check_conflicts"
    | "explain_blockers"
    | "find_open_time"
    | "general_question"
    | "schedule_request"
    | "summarize_week"
    | "sync_question";
  preferredDurationMinutes?: number;
  requestedDays?: WeekDay[];
  requestedRange?: {
    end: string;
    endInclusive: boolean;
    start: string;
    startInclusive: boolean;
  };
  requiredDurationMinutes?: number;
  targetEvent?: {
    deadline?: string;
    startsAt?: string;
    title?: string;
  };
  timeBoundary?: {
    endTime?: string;
    relation: "after" | "at" | "before" | "between" | "by" | "on" | "until";
    startTime?: string;
  };
  timezone: string;
};

type ScheduleRequest = {
  durationMinutes: number | null;
  endMinutes: number;
  hardDeadlineLabel: string | null;
  isPointCheck: boolean;
  minimumWindowMinutes: number;
  query: SchedulingQuery;
  scopes: DateScope[];
  startMinutes: number;
  timeLabel: string;
};

type BlockingCommitment = NormalizedScheduleCommitment & {
  endMinutes: number;
  startMinutes: number;
};

type AssistantScheduleMessage = {
  content: string;
  role: "assistant" | "user";
};

function getDatePartsInTimeZone(date: Date, timezone = getDefaultTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    day: getPart("day"),
    hour: getPart("hour") % 24,
    minute: getPart("minute"),
    month: getPart("month"),
    year: getPart("year"),
  };
}

function toLocalDate(date: Date, timezone = getDefaultTimeZone()) {
  const parts = getDatePartsInTimeZone(date, timezone);

  return new Date(parts.year, parts.month - 1, parts.day);
}

function getMinutesInTimeZone(date: Date, timezone = getDefaultTimeZone()) {
  const parts = getDatePartsInTimeZone(date, timezone);

  return parts.hour * 60 + parts.minute;
}

function getIsoDateInTimeZone(date: Date, timezone = getDefaultTimeZone()) {
  const parts = getDatePartsInTimeZone(date, timezone);

  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
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

function getWeekStart(weekStartDate?: string, timezone = getDefaultTimeZone()) {
  if (weekStartDate) {
    const parsed = new Date(`${weekStartDate}T00:00:00`);

    if (!Number.isNaN(parsed.getTime())) {
      return toLocalDate(parsed);
    }
  }

  const today = toLocalDate(new Date(), timezone);
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
  if (/\bafter\s+noon\b/i.test(prompt)) {
    return {
      isPointCheck: false,
      startMinutes: 12 * 60,
    };
  }

  if (/\bat\s+noon\b/i.test(prompt)) {
    return {
      isPointCheck: true,
      startMinutes: 12 * 60,
    };
  }

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

function getWeekdayBoundary(prompt: string) {
  const boundaryMatch = prompt.match(
    /\b(before|after|on|by|until)\s+(?:(?:this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  if (!boundaryMatch) {
    return null;
  }

  const day = weekDays.find(
    (candidate) => candidate.toLowerCase() === boundaryMatch[2].toLowerCase(),
  );

  if (!day) {
    return null;
  }

  return {
    day,
    relation: boundaryMatch[1].toLowerCase() as
      | "after"
      | "before"
      | "by"
      | "on"
      | "until",
  };
}

function parseExplicitBoundaryTime(prompt: string) {
  if (/\b(?:at|by|before)\s+noon\b/i.test(prompt)) {
    return 12 * 60;
  }

  if (/\b(?:at|by|before)\s+midnight\b/i.test(prompt)) {
    return 0;
  }

  return parseTimeMatch(
    prompt.match(
      /\b(?:at|by|before)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i,
    ),
  );
}

function makeDateRange(
  scopes: DateScope[],
  startInclusive = true,
  endInclusive = true,
) {
  if (scopes.length === 0) {
    return undefined;
  }

  return {
    end: scopes[scopes.length - 1].date,
    endInclusive,
    start: scopes[0].date,
    startInclusive,
  };
}

function parseDateScopes(
  prompt: string,
  weekStart: Date,
  timezone = getDefaultTimeZone(),
) {
  const lowerPrompt = prompt.toLowerCase();
  const mentionedDays = weekDays.filter((day) =>
    dayPatternByDay.get(day)?.test(prompt),
  );
  const boundary = getWeekdayBoundary(prompt);
  const boundaryTime = parseExplicitBoundaryTime(prompt);

  if (boundary) {
    const boundaryIndex = weekDays.indexOf(boundary.day);

    if (boundary.relation === "before") {
      const daysBefore = weekDays.slice(0, boundaryIndex);

      if (boundaryTime !== null) {
        return [
          ...daysBefore.map((day) => getDateScopeForDay(day, weekStart)),
          {
            ...getDateScopeForDay(boundary.day, weekStart),
            searchEndMinutes: boundaryTime,
          },
        ];
      }

      return daysBefore.map((day) => getDateScopeForDay(day, weekStart));
    }

    if (boundary.relation === "after") {
      return weekDays
        .slice(boundaryIndex + 1)
        .map((day) => getDateScopeForDay(day, weekStart));
    }

    if (boundary.relation === "on") {
      return [getDateScopeForDay(boundary.day, weekStart)];
    }

    if (boundary.relation === "by" || boundary.relation === "until") {
      return weekDays
        .slice(0, boundaryIndex + 1)
        .map((day) => getDateScopeForDay(day, weekStart));
    }
  }
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
    const date = addDays(toLocalDate(new Date(), timezone), 1);

    return [{ date: toIsoDate(date), day: getDayFromDate(date) }];
  }

  if (/\btoday\b/i.test(prompt)) {
    const date = toLocalDate(new Date(), timezone);

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

function getRecentSchedulingUserPrompt(
  recentMessages: readonly AssistantScheduleMessage[] = [],
) {
  return [...recentMessages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        /\b(before|after|on|by|until|khutba|speech|prepare|open time|free|available|conflict|schedule|block|appointment|task)\b/i.test(
          message.content,
        ),
    )?.content;
}

function createPromptForConstraintParsing(
  prompt: string,
  recentMessages: readonly AssistantScheduleMessage[] = [],
) {
  if (getWeekdayBoundary(prompt) || /\b(today|tomorrow|this week|next week)\b/i.test(prompt)) {
    return prompt;
  }

  const recentSchedulingPrompt = getRecentSchedulingUserPrompt(recentMessages);

  if (!recentSchedulingPrompt) {
    return prompt;
  }

  return `${recentSchedulingPrompt} ${prompt}`;
}

function getPurposeFromText(text: string) {
  if (/\bkhutba|speech|sermon\b/i.test(text)) {
    return "write khutba speech";
  }

  if (/\bstudy|exam|assignment\b/i.test(text)) {
    return "study or finish school work";
  }

  if (/\bslides|presentation\b/i.test(text)) {
    return "prepare presentation";
  }

  return undefined;
}

function createSchedulingQuery({
  prompt,
  promptForConstraints,
  recentMessages = [],
  scopes,
  timezone,
}: {
  prompt: string;
  promptForConstraints: string;
  recentMessages?: readonly AssistantScheduleMessage[];
  scopes: DateScope[];
  timezone: string;
}): SchedulingQuery {
  const durationMinutes = parseDurationMinutes(prompt);
  const inheritedPrompt = getRecentSchedulingUserPrompt(recentMessages);
  const purpose = getPurposeFromText(prompt) ?? (inheritedPrompt ? getPurposeFromText(inheritedPrompt) : undefined);
  const boundary = getWeekdayBoundary(promptForConstraints);
  const boundaryTime = parseExplicitBoundaryTime(promptForConstraints);
  const deadlineScope = boundary
    ? scopes.find((scope) => scope.day === boundary.day)
    : undefined;
  const ambiguityFlags: string[] = [];

  if (boundary?.relation === "by" && boundaryTime === null) {
    ambiguityFlags.push(
      "The phrase 'by' can include the target day; clarify if that changes the recommendation.",
    );
  }

  return {
    ambiguityFlags,
    conversationConstraints: {
      inheritedDateRange:
        inheritedPrompt && promptForConstraints !== prompt
          ? makeDateRange(scopes, true, boundary?.relation !== "before")
          : undefined,
      inheritedDuration:
        inheritedPrompt && durationMinutes ? durationMinutes : undefined,
      inheritedPurpose: purpose,
    },
    intent: hasOpenTimeQuestionIntent(prompt)
      ? "find_open_time"
      : hasBlockingQuestionIntent(prompt)
        ? "explain_blockers"
        : hasAvailabilityQuestionIntent(prompt)
          ? /\bconflicts?|overlap\b/i.test(prompt)
            ? "check_conflicts"
            : "check_availability"
          : "general_question",
    preferredDurationMinutes: durationMinutes ?? undefined,
    requestedDays: scopes.map((scope) => scope.day),
    requestedRange: makeDateRange(scopes, true, boundary?.relation !== "before"),
    requiredDurationMinutes: durationMinutes ?? undefined,
    targetEvent:
      purpose || boundary
        ? {
            deadline:
              deadlineScope && boundaryTime !== null
                ? `${deadlineScope.date}T${String(
                    Math.floor(boundaryTime / 60),
                  ).padStart(2, "0")}:${String(boundaryTime % 60).padStart(
                    2,
                    "0",
                  )}:00`
                : undefined,
            title: purpose,
          }
        : undefined,
    timeBoundary: boundary
      ? {
          relation: boundary.relation === "until" ? "until" : boundary.relation,
          startTime:
            boundaryTime !== null ? formatMinutes(boundaryTime) : undefined,
        }
      : undefined,
    timezone,
  };
}

function createScheduleRequest(
  prompt: string,
  weekStartDate?: string,
  recentMessages: readonly AssistantScheduleMessage[] = [],
  timezone = getDefaultTimeZone(),
): ScheduleRequest {
  const weekStart = getWeekStart(weekStartDate, timezone);
  const promptForConstraints = createPromptForConstraintParsing(
    prompt,
    recentMessages,
  );
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

  const scopes = parseDateScopes(promptForConstraints, weekStart, timezone);
  const query = createSchedulingQuery({
    prompt,
    promptForConstraints,
    recentMessages,
    scopes,
    timezone,
  });

  return {
    durationMinutes,
    endMinutes,
    hardDeadlineLabel:
      scopes.some((scope) => typeof scope.searchEndMinutes === "number")
        ? formatScopeList(
            scopes.filter(
              (scope) => typeof scope.searchEndMinutes === "number",
            ),
          )
        : null,
    isPointCheck,
    minimumWindowMinutes: durationMinutes ?? usefulWindowMinimumMinutes,
    query,
    scopes,
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

function addImportedEventSegments(
  event: ImportedCalendarEvent,
  timezone = getDefaultTimeZone(),
) {
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
        date: getIsoDateInTimeZone(startsAt, timezone),
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
  let dayCursor = toLocalDate(startsAt, timezone);
  const endDate = toLocalDate(safeEnd, timezone);

  while (dayCursor <= endDate) {
    const nextDay = addDays(dayCursor, 1);
    const dayIso = toIsoDate(dayCursor);
    const startIso = getIsoDateInTimeZone(startsAt, timezone);
    const endIso = getIsoDateInTimeZone(safeEnd, timezone);
    const startMinutes =
      dayIso === startIso ? getMinutesInTimeZone(startsAt, timezone) : 0;
    const segmentEndMinutes =
      dayIso === endIso ? getMinutesInTimeZone(safeEnd, timezone) : 1440;

    if (segmentEndMinutes > startMinutes) {
      commitments.push({
        allDay: false,
        commitmentType:
          event.source === "google_calendar"
            ? "read_only_google_event"
            : "external_event",
        date: dayIso,
        endMinutes: segmentEndMinutes,
        endsAt: event.endsAt,
        id: `${event.id}:${dayIso}:${startMinutes}`,
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
  timezone = getDefaultTimeZone(),
  weekStartDate,
  weeklyPlanBlocks,
  workShifts,
}: AssistantScheduleAnalysisInput) {
  const weekStart = getWeekStart(weekStartDate, timezone);
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
    commitments.push(...addImportedEventSegments(event, timezone));
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
    const scopedDayStart = Math.max(
      dayStartDefault,
      scope.searchStartMinutes ?? startMinutes,
    );
    const scopedDayEnd = Math.min(dayEndDefault, scope.searchEndMinutes ?? dayEndDefault);
    const mergedRanges = mergeBlockingRanges(
      getBlockingCommitments(commitments, scope.date),
    );
    let cursor = scopedDayStart;

    mergedRanges.forEach((range) => {
      const rangeStart = Math.max(range.start, scopedDayStart);
      const rangeEnd = Math.min(range.end, scopedDayEnd);

      if (rangeEnd <= scopedDayStart || rangeStart >= scopedDayEnd) {
        return;
      }

      if (rangeEnd <= cursor) {
        return;
      }

      if (rangeStart - cursor >= minimumMinutes) {
        windows.push({
          date: scope.date,
          day: scope.day,
          durationMinutes: rangeStart - cursor,
          endLabel: formatMinutes(rangeStart),
          endMinutes: rangeStart,
          startLabel: formatMinutes(cursor),
          startMinutes: cursor,
        });
      }

      cursor = Math.max(cursor, rangeEnd);
    });

    if (scopedDayEnd - cursor >= minimumMinutes) {
      windows.push({
        date: scope.date,
        day: scope.day,
        durationMinutes: scopedDayEnd - cursor,
        endLabel: formatMinutes(scopedDayEnd),
        endMinutes: scopedDayEnd,
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
  return windows
    .map((window) => {
      const scope = {
        date: window.date,
        day: window.day,
      };

      return `- ${formatDateScope(scope)}: ${formatWindowLabel(
        window,
      )} - ${formatEstimatedHours(window.durationMinutes / 60)}`;
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

function createClarificationForAmbiguousQuery(query: SchedulingQuery) {
  if (
    query.ambiguityFlags.length > 0 &&
    query.timeBoundary?.relation === "by" &&
    !query.timeBoundary.startTime
  ) {
    return "Should Friday itself count, or do you need this finished before Friday begins?";
  }

  return null;
}

function createConstraintNote(request: ScheduleRequest) {
  const boundary = request.query.timeBoundary;

  if (boundary?.relation === "before") {
    if (boundary.startTime) {
      return ` I treated ${boundary.startTime} as the cutoff on the target day.`;
    }

    return " I treated “before” as exclusive, so I excluded the target day.";
  }

  if (request.hardDeadlineLabel) {
    return ` I capped the final day at ${request.hardDeadlineLabel}.`;
  }

  return "";
}

function createSubstantialWorkNote(request: ScheduleRequest) {
  const purpose = request.query.conversationConstraints.inheritedPurpose;

  if (request.durationMinutes || !purpose) {
    return "";
  }

  if (!/\b(khutba|speech|sermon|study|school|presentation|slides|exam|assignment)\b/i.test(purpose)) {
    return "";
  }

  return " Because that sounds like substantial work, I’d favor the longer openings and avoid relying on short gaps unless you only need a quick outline.";
}

function windowOverlapsCommitment(
  window: AssistantOpenWindow,
  commitment: BlockingCommitment,
) {
  return (
    window.date === commitment.date &&
    window.startMinutes < commitment.endMinutes &&
    window.endMinutes > commitment.startMinutes
  );
}

function validateOpenWindows(
  windows: AssistantOpenWindow[],
  request: ScheduleRequest,
  commitments: NormalizedScheduleCommitment[],
) {
  const scopeByDate = new Map(request.scopes.map((scope) => [scope.date, scope]));
  const blockers = request.scopes.flatMap((scope) =>
    getBlockingCommitments(commitments, scope.date),
  );

  return windows.filter((window) => {
    const scope = scopeByDate.get(window.date);

    if (!scope || window.endMinutes <= window.startMinutes) {
      return false;
    }

    if (window.durationMinutes < request.minimumWindowMinutes) {
      return false;
    }

    if (window.startMinutes < (scope.searchStartMinutes ?? request.startMinutes)) {
      return false;
    }

    if (window.endMinutes > (scope.searchEndMinutes ?? dayEndDefault)) {
      return false;
    }

    return !blockers.some((blocker) => windowOverlapsCommitment(window, blocker));
  });
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
  const timezone = input.timezone ?? getDefaultTimeZone();
  const weekStart = getWeekStart(input.weekStartDate, timezone);
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
  recentMessages,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
  recentMessages?: readonly AssistantScheduleMessage[];
}) {
  const request = createScheduleRequest(
    prompt,
    input.weekStartDate,
    recentMessages,
    input.timezone,
  );
  const clarification = createClarificationForAmbiguousQuery(request.query);

  if (clarification) {
    return clarification;
  }

  const commitments = buildNormalizedScheduleTimeline(input);
  const rawWindows = calculateOpenWindows({
    commitments,
    minimumMinutes: request.minimumWindowMinutes,
    scopes: request.scopes,
    startMinutes: request.startMinutes,
  });
  const windows = validateOpenWindows(rawWindows, request, commitments);
  const allDayNote = createAllDayNote(getAllDayNotes(commitments, request.scopes));
  const constraintNote = createConstraintNote(request);
  const missingContextNote = createMissingContextNote(loadWarning);
  const sourceSummary = getCheckedSourceSummary(input);
  const substantialWorkNote = createSubstantialWorkNote(request);
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
    )}.${constraintNote}${durationNote}${substantialWorkNote}${allDayNote}${missingContextNote}`;
  }

  const countLabel = `${windows.length} useful opening${
    windows.length === 1 ? "" : "s"
  }`;

  return `I found ${countLabel} after checking ${sourceSummary}:\n\n${formatOpenWindowList(
    windows,
  )}${constraintNote}${durationNote}${substantialWorkNote}${allDayNote}${missingContextNote}\n\nWant me to turn one of these into a time block?`;
}

function createAvailabilityAnswer({
  input,
  loadWarning,
  prompt,
  recentMessages,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
  recentMessages?: readonly AssistantScheduleMessage[];
}) {
  const request = createScheduleRequest(
    prompt,
    input.weekStartDate,
    recentMessages,
    input.timezone,
  );
  const clarification = createClarificationForAmbiguousQuery(request.query);

  if (clarification) {
    return clarification;
  }

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
  const constraintNote = createConstraintNote(request);
  const allDayNote = createAllDayNote(getAllDayNotes(commitments, request.scopes));
  const asksFree = /\b(am i free|am i available|free|available|clear)\b/i.test(prompt);

  if (blockedScopes.length === 0) {
    const directAnswer = asksFree ? "Yes" : "No";

    return `${directAnswer} - ${formatScopeList(request.scopes)} ${
      request.timeLabel
    } is clear based on the loaded schedule sources.${constraintNote}${allDayNote}${missingContextNote}`;
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
    } day${blockedScopes.length === 1 ? "" : "s"}:\n\n${blockerLines}${constraintNote}${allDayNote}${missingContextNote}`;
  }

  const directAnswer = asksFree ? "No" : "Yes";

  return `${directAnswer} - I found ${
    blockedScopes.length === 1 ? "a blocker" : "blockers"
  } ${request.timeLabel}:\n\n${blockerLines}${constraintNote}${allDayNote}${missingContextNote}`;
}

function createBlockingAnswer({
  input,
  loadWarning,
  prompt,
  recentMessages,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
  recentMessages?: readonly AssistantScheduleMessage[];
}) {
  const request = createScheduleRequest(
    prompt,
    input.weekStartDate,
    recentMessages,
    input.timezone,
  );
  const clarification = createClarificationForAmbiguousQuery(request.query);

  if (clarification) {
    return clarification;
  }

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
  const constraintNote = createConstraintNote(request);
  const allDayNote = createAllDayNote(getAllDayNotes(commitments, request.scopes));

  if (blockers.length === 0) {
    return `I do not see anything blocking ${formatScopeList(request.scopes)} ${
      request.timeLabel
    } in the loaded schedule sources.${constraintNote}${allDayNote}${missingContextNote}`;
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
  }:\n\n${lines}${remainder}${constraintNote}${allDayNote}${missingContextNote}`;
}

export function createDeterministicScheduleAnswer({
  input,
  loadWarning,
  prompt,
  recentMessages,
}: {
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
  recentMessages?: readonly AssistantScheduleMessage[];
}) {
  if (!hasDeterministicScheduleQuestionIntent(prompt)) {
    return null;
  }

  if (hasOpenTimeQuestionIntent(prompt)) {
    return createOpenTimeAnswer({ input, loadWarning, prompt, recentMessages });
  }

  if (hasBlockingQuestionIntent(prompt)) {
    return createBlockingAnswer({ input, loadWarning, prompt, recentMessages });
  }

  return createAvailabilityAnswer({ input, loadWarning, prompt, recentMessages });
}
