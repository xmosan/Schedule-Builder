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
import {
  getEffectiveWorkShiftsForDate,
  type ScheduleException,
} from "@/lib/schedule-exceptions";
import type { Project } from "@/lib/projects";
import {
  createConsolidatedClarification,
  extractPlanningItems,
  isAssistantStatusQuestion,
  isExplicitMutationRequest,
  isExplicitSchedulingRequest,
  isRecurringPlanningRequest,
  parseExplicitDurationMinutes,
  parseRequestedSessionCount,
  type ExtractedPlanningItem,
} from "@/lib/assistant-intelligence";
import {
  acceptRecommendedConstraintResolution,
  acceptRecommendedWeeklyPattern,
  calculateWeeklyProposalMinutes,
  extractSemanticPlanningRequest,
  hasUnresolvedConstraintConflict,
  normalizeRecurringSeriesProposal,
  normalizeSemanticPlanningRequest,
  rejectRecommendedWeeklyPattern,
  type RecurringSeriesProposal,
  type SemanticPlanningRequest,
} from "@/lib/assistant-semantics";

const dayStartDefault = 8 * 60;
const dayEndDefault = 22 * 60;
const usefulWindowMinimumMinutes = 30;

function formatSmallNumber(value: number) {
  return (
    {
      1: "one",
      2: "two",
      3: "three",
      4: "four",
      5: "five",
      6: "six",
      7: "seven",
      8: "eight",
    } as Record<number, string>
  )[value] ?? String(value);
}

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
const monthIndexByName: Record<string, number> = {
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
  endsAt: string;
  id: string;
  label: string;
  startLabel: string;
  startMinutes: number;
  startsAt: string;
};

function createAssistantOpenWindow({
  date,
  day,
  endMinutes,
  startMinutes,
}: {
  date: string;
  day: WeekDay;
  endMinutes: number;
  startMinutes: number;
}): AssistantOpenWindow {
  const startTime = minutesToTimeInput(startMinutes);
  const endTime = minutesToTimeInput(endMinutes);
  const startsAt = `${date}T${startTime}:00`;
  const endsAt = `${date}T${endTime}:00`;
  const startLabel = formatMinutes(startMinutes);
  const endLabel = formatMinutes(endMinutes);

  return {
    date,
    day,
    durationMinutes: endMinutes - startMinutes,
    endLabel,
    endMinutes,
    endsAt,
    id: `${startsAt}__${endsAt}`,
    label:
      endMinutes === dayEndDefault && startMinutes > dayStartDefault
        ? `${day} after ${startLabel}`
        : `${day}, ${startLabel}-${endLabel}`,
    startLabel,
    startMinutes,
    startsAt,
  };
}

export type AssistantWorkflowState =
  | "idle"
  | "calculating_availability"
  | "awaiting_window_selection"
  | "awaiting_duration"
  | "awaiting_session_details"
  | "awaiting_title"
  | "proposal_ready"
  | "awaiting_apply"
  | "applied"
  | "needs_clarification"
  | "failed";

export type AssistantPendingTimeBlockProposal = {
  actionType: "create_time_block";
  date: string;
  details: string;
  durationMinutes: number | null;
  selectedWindowEnd: string;
  sourceConversationId: string | null;
  startTime: string;
  status: "needs_duration" | "ready_for_review";
  title: string;
  batchId?: string;
  id?: string;
};

export type AssistantAppliedScheduleRecord = {
  date: string;
  endTime: string;
  id: string;
  proposalId: string;
  startTime: string;
  title: string;
};

export type AssistantPendingWorkExceptionProposal = {
  date: string;
  exceptionType: "modify_shift";
  originalEndTime: string;
  originalStartTime: string;
  overrideEndTime: string;
  overrideStartTime: string;
  relatedWorkShiftId: string;
  title: string;
};

export type AssistantSchedulingContext = {
  appliedRecords: AssistantAppliedScheduleRecord[];
  batchId: string | null;
  candidateWindows: AssistantOpenWindow[];
  confirmationStatus:
    | "awaiting_window_confirmation"
    | "awaiting_window_selection"
    | "awaiting_duration"
    | "awaiting_session_details"
    | "ready_for_review";
  extractedItems: ExtractedPlanningItem[];
  originalDateBoundary?: SchedulingQuery["timeBoundary"];
  intent:
    | "create_multiple_time_blocks"
    | "create_time_block"
    | "find_open_time"
    | "multi_action_request";
  lastUpdatedAt: string;
  maximumDurationMinutes: number | null;
  pendingQuestion: string | null;
  pendingProposal: AssistantPendingTimeBlockProposal | null;
  pendingProposals: AssistantPendingTimeBlockProposal[];
  pendingWorkException: AssistantPendingWorkExceptionProposal | null;
  purpose: string;
  requestedDurationMinutes: number | null;
  requestedSessionCount: number | null;
  semanticRequest?: SemanticPlanningRequest | null;
  seriesProposal?: RecurringSeriesProposal | null;
  selectedDate: string | null;
  selectedWindowId: string | null;
  selectedWindowEnd: string | null;
  selectedWindowStart: string | null;
  state: AssistantWorkflowState;
  workflowId: string;
};

export type AssistantSchedulingConversationTurn = {
  context: AssistantSchedulingContext;
  message: string;
  proposal: AssistantPendingTimeBlockProposal | null;
};

export function normalizeAssistantSchedulingContext(
  value: unknown,
): AssistantSchedulingContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<AssistantSchedulingContext>;
  const allowedStatuses: AssistantSchedulingContext["confirmationStatus"][] = [
    "awaiting_window_confirmation",
    "awaiting_window_selection",
    "awaiting_duration",
    "awaiting_session_details",
    "ready_for_review",
  ];
  const allowedStates: AssistantWorkflowState[] = [
    "idle",
    "calculating_availability",
    "awaiting_window_selection",
    "awaiting_duration",
    "awaiting_session_details",
    "awaiting_title",
    "proposal_ready",
    "awaiting_apply",
    "applied",
    "needs_clarification",
    "failed",
  ];

  if (
    typeof candidate.purpose !== "string" ||
    !candidate.purpose.trim() ||
    !candidate.confirmationStatus ||
    !allowedStatuses.includes(candidate.confirmationStatus) ||
    !Array.isArray(candidate.candidateWindows)
  ) {
    return null;
  }

  const candidateWindows = candidate.candidateWindows.filter(
    (window): window is AssistantOpenWindow =>
      typeof window === "object" &&
      window !== null &&
      typeof window.date === "string" &&
      weekDays.includes(window.day) &&
      Number.isFinite(window.startMinutes) &&
      Number.isFinite(window.endMinutes) &&
      window.endMinutes > window.startMinutes,
  ).map((window) =>
    createAssistantOpenWindow({
      date: window.date,
      day: window.day,
      endMinutes: window.endMinutes,
      startMinutes: window.startMinutes,
    }),
  );

  if (
    candidateWindows.length === 0 &&
    candidate.state !== "failed" &&
    candidate.state !== "awaiting_session_details" &&
    candidate.state !== "needs_clarification" &&
    candidate.state !== "applied"
  ) {
    return null;
  }

  const state =
    candidate.state && allowedStates.includes(candidate.state)
      ? candidate.state
      : candidate.confirmationStatus === "awaiting_duration"
        ? "awaiting_duration"
        : candidate.confirmationStatus === "awaiting_session_details"
          ? "awaiting_session_details"
        : candidate.confirmationStatus === "ready_for_review"
          ? "awaiting_apply"
          : "awaiting_window_selection";

  return {
    appliedRecords: Array.isArray(candidate.appliedRecords)
      ? candidate.appliedRecords.filter(
          (record): record is AssistantAppliedScheduleRecord =>
            typeof record === "object" &&
            record !== null &&
            typeof record.id === "string" &&
            typeof record.proposalId === "string" &&
            typeof record.title === "string" &&
            typeof record.date === "string" &&
            typeof record.startTime === "string" &&
            typeof record.endTime === "string",
        )
      : [],
    batchId: typeof candidate.batchId === "string" ? candidate.batchId : null,
    candidateWindows: candidateWindows.slice(0, 120),
    confirmationStatus: candidate.confirmationStatus,
    intent:
      candidate.intent === "find_open_time"
        ? "find_open_time"
        : candidate.intent === "create_multiple_time_blocks"
          ? "create_multiple_time_blocks"
          : candidate.intent === "multi_action_request"
            ? "multi_action_request"
          : "create_time_block",
    extractedItems: Array.isArray(candidate.extractedItems)
      ? (candidate.extractedItems as ExtractedPlanningItem[]).slice(0, 12)
      : [],
    lastUpdatedAt:
      typeof candidate.lastUpdatedAt === "string"
        ? candidate.lastUpdatedAt
        : new Date().toISOString(),
    maximumDurationMinutes:
      typeof candidate.maximumDurationMinutes === "number" &&
      candidate.maximumDurationMinutes > 0
        ? candidate.maximumDurationMinutes
        : null,
    originalDateBoundary: candidate.originalDateBoundary,
    pendingQuestion:
      typeof candidate.pendingQuestion === "string"
        ? candidate.pendingQuestion
        : null,
    pendingProposal:
      typeof candidate.pendingProposal === "object" &&
      candidate.pendingProposal !== null
        ? candidate.pendingProposal
        : null,
    pendingProposals: Array.isArray(candidate.pendingProposals)
      ? candidate.pendingProposals.filter(
          (proposal): proposal is AssistantPendingTimeBlockProposal =>
            typeof proposal === "object" && proposal !== null,
        )
      : candidate.pendingProposal
        ? [candidate.pendingProposal]
        : [],
    pendingWorkException:
      typeof candidate.pendingWorkException === "object" &&
      candidate.pendingWorkException !== null
        ? candidate.pendingWorkException
        : null,
    purpose: candidate.purpose.trim().slice(0, 180),
    requestedDurationMinutes:
      typeof candidate.requestedDurationMinutes === "number" &&
      candidate.requestedDurationMinutes > 0
        ? candidate.requestedDurationMinutes
        : null,
    requestedSessionCount:
      typeof candidate.requestedSessionCount === "number" &&
      Number.isInteger(candidate.requestedSessionCount) &&
      candidate.requestedSessionCount > 0
        ? candidate.requestedSessionCount
        : null,
    semanticRequest: normalizeSemanticPlanningRequest(candidate.semanticRequest),
    seriesProposal: normalizeRecurringSeriesProposal(candidate.seriesProposal),
    selectedDate:
      typeof candidate.selectedDate === "string" ? candidate.selectedDate : null,
    selectedWindowId:
      typeof candidate.selectedWindowId === "string"
        ? candidate.selectedWindowId
        : null,
    selectedWindowEnd:
      typeof candidate.selectedWindowEnd === "string"
        ? candidate.selectedWindowEnd
        : null,
    selectedWindowStart:
      typeof candidate.selectedWindowStart === "string"
        ? candidate.selectedWindowStart
        : null,
    state,
    workflowId:
      typeof candidate.workflowId === "string" && candidate.workflowId
        ? candidate.workflowId
        : `workflow-${Date.now()}`,
  };
}

export type AssistantScheduleAnalysisInput = {
  currentDate?: string;
  importedCalendarEvents: ImportedCalendarEvent[];
  projects?: Project[];
  scheduleExceptions?: ScheduleException[];
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
    const match = weekStartDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(Number.NaN);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
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

function getMondayForDate(date: Date) {
  const monday = new Date(date);
  monday.setDate(date.getDate() + (date.getDay() === 0 ? -6 : 1 - date.getDay()));
  return monday;
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
  if (/\b(?:half an hour|half hour)\b/i.test(prompt)) {
    return 30;
  }

  const minuteMatch = prompt.match(/\b(\d+)\s*(?:minutes?|mins?)\b/i);

  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);

    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
  }

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

function minutesToTimeInput(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

function cleanPlanningPurpose(value: string) {
  return value
    .split(/[.!?]/)[0]
    .replace(/[?.!]+$/g, "")
    .replace(/^\s*(?:to\s+)?(?:plan|planning|prepare|work)\s+(?:for|on\s+)?/i, "")
    .replace(/[’']s\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferPlanningPurpose(
  prompt: string,
  recentMessages: readonly AssistantScheduleMessage[] = [],
) {
  const candidates = [
    prompt,
    ...[...recentMessages]
      .reverse()
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  ];

  for (const candidate of candidates) {
    const timeForMatch = candidate.match(
      /\b(?:make|find|reserve|block|need)\s+(?:me\s+)?(?:some\s+)?time\s+(?:for|to)\s+(.+?)(?:[.!?]|$)/i,
    );
    const directMatch = candidate.match(
      /\b(?:find|show)\s+(?:me\s+)?(?:an?\s+)?(?:open|free|available)\s+(?:time|window|slot)\s+(?:to|for)\s+(.+)$/i,
    );
    const planningMatch = candidate.match(
      /\b(?:plan|schedule|create|add)\s+(?:time\s+)?(?:for|to)\s+(.+)$/i,
    );
    const purpose = cleanPlanningPurpose(
      timeForMatch?.[1] ?? directMatch?.[1] ?? planningMatch?.[1] ?? "",
    );

    if (purpose) {
      return purpose;
    }
  }

  return "this work";
}

function createProposalTitle(purpose: string) {
  const normalized = cleanPlanningPurpose(purpose);

  if (!normalized || normalized === "this work") {
    return "Focused work block";
  }

  return normalized.slice(0, 120);
}

const weekdayAliases: Record<WeekDay, readonly string[]> = {
  Monday: ["monday", "mon"],
  Tuesday: ["tuesday", "tues", "tue"],
  Wednesday: ["wednesday", "weds", "wed"],
  Thursday: ["thursday", "thurs", "thur", "thu"],
  Friday: ["friday", "fri"],
  Saturday: ["saturday", "sat"],
  Sunday: ["sunday", "sun"],
};

function getMentionedWeekday(prompt: string) {
  return weekDays.find((day) =>
    weekdayAliases[day].some((alias) =>
      new RegExp(`\\b${alias}\\b`, "i").test(prompt),
    ),
  );
}

function findSelectedWindows(
  prompt: string,
  windows: readonly AssistantOpenWindow[],
) {
  const selectedById = windows.find((window) => prompt.includes(window.id));

  if (selectedById) {
    return [selectedById];
  }

  const selectedDay = getMentionedWeekday(prompt);

  if (selectedDay) {
    const dayWindows = windows.filter((window) => window.day === selectedDay);
    const timeMatch = prompt.match(
      /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
    );
    const selectedMinutes = timeMatch ? parseTimeMatch(timeMatch) : null;

    if (selectedMinutes !== null) {
      const exactWindow = dayWindows.find(
        (window) => window.startMinutes === selectedMinutes,
      );

      return exactWindow ? [exactWindow] : [];
    }

    return dayWindows;
  }

  const ordinalMatch = prompt.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\b/i);
  const ordinalIndexes: Record<string, number> = {
    "1st": 0,
    "2nd": 1,
    "3rd": 2,
    "4th": 3,
    first: 0,
    fourth: 3,
    second: 1,
    third: 2,
  };

  if (ordinalMatch) {
    const selectedWindow = windows[ordinalIndexes[ordinalMatch[1].toLowerCase()]];
    return selectedWindow ? [selectedWindow] : [];
  }

  return [];
}

function isPositiveSchedulingConfirmation(prompt: string) {
  return /^(?:(?:yes|yeah|yep|sure|please|yes please|sounds good|ok|okay|alright|all right)(?:[\s,!.]+(?:let(?:'|’)s do that|do that|go ahead))?|let(?:'|’)s do that|go ahead|draft it|add it|do it|put it on (?:my|the) schedule)[\s,!.]*$/i.test(
    prompt.trim(),
  );
}

function isNegativeSchedulingReply(prompt: string) {
  return /^(?:no|nope|not that one|choose another|another one)[\s,!.]*$/i.test(
    prompt.trim(),
  );
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
  const isoDateMatch = prompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDateMatch) {
    const date = parseIsoDate(isoDateMatch[1]);
    if (date) return [{ date: isoDateMatch[1], day: getDayFromDate(date) }];
  }
  const explicitDateMatch = prompt.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i,
  );
  if (explicitDateMatch) {
    const month = monthIndexByName[explicitDateMatch[1].toLowerCase()];
    const dayOfMonth = Number(explicitDateMatch[2]);
    const year = Number(explicitDateMatch[3]) || weekStart.getFullYear();
    const date = new Date(year, month, dayOfMonth);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === dayOfMonth
    ) {
      return [{ date: toIsoDate(date), day: getDayFromDate(date) }];
    }
  }
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
  scheduleExceptions = [],
}: AssistantScheduleAnalysisInput) {
  const weekStart = getWeekStart(weekStartDate, timezone);
  const commitments: NormalizedScheduleCommitment[] = [];

  weekDays.forEach((day) => {
    const date = getDateScopeForDay(day, weekStart).date;
    const effectiveShifts = getEffectiveWorkShiftsForDate(
      workShifts,
      scheduleExceptions,
      date,
      day,
    );

    effectiveShifts.forEach((shift) => {
    const startMinutes = parseStartTimeToMinutes(shift.startTime);
    const rawEndMinutes = parseStartTimeToMinutes(shift.endTime);

    if (startMinutes === null || rawEndMinutes === null) {
      return;
    }

    const endMinutes =
      rawEndMinutes <= startMinutes ? rawEndMinutes + 1440 : rawEndMinutes;
    commitments.push(
      ...addCommitmentSegments({
        baseDate: date,
        baseId: `work-shift:${shift.id}`,
        commitmentType: "work_shift",
        endMinutes,
        source: "work_shift",
        sourceLabel: shift.isException ? "Work shift · updated for this date" : "Work shift",
        startMinutes,
        timed: true,
        title: shift.location ? `Work shift at ${shift.location}` : "Work shift",
      }),
    );
    });
  });

  weeklyPlanBlocks.forEach((block) => {
    const startMinutes = parseStartTimeToMinutes(block.startTime);

    if (startMinutes === null) {
      return;
    }

    const date =
      block.scheduledDate ?? getDateScopeForDay(block.day, weekStart).date;

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
        windows.push(
          createAssistantOpenWindow({
            date: scope.date,
            day: scope.day,
            endMinutes: rangeStart,
            startMinutes: cursor,
          }),
        );
      }

      cursor = Math.max(cursor, rangeEnd);
    });

    if (scopedDayEnd - cursor >= minimumMinutes) {
      windows.push(
        createAssistantOpenWindow({
          date: scope.date,
          day: scope.day,
          endMinutes: scopedDayEnd,
          startMinutes: cursor,
        }),
      );
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

function hasSchedulingPlacementIntent(prompt: string) {
  return (
    /\b(?:plug|fit|put|add|schedule|reserve|block)\b.*\b(?:available|open|free|spot|slot|time)\b/i.test(
      prompt,
    ) ||
    /\b(?:make|find|reserve|block|need)\s+(?:me\s+)?(?:some\s+)?time\s+for\b/i.test(
      prompt,
    ) ||
    /\b(?:make|find|reserve|block|need)\s+(?:me\s+)?(?:some\s+)?time\s+to\b/i.test(
      prompt,
    ) ||
    /\b(?:put|add|schedule|plug)\s+(?:it|this|that|them|those)\s+(?:on|into|in)\s+(?:my|the)?\s*(?:schedule|week|calendar)\b/i.test(
      prompt,
    )
  );
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
  const requestsEveryOpening =
    /\b(?:show|list|see)\s+(?:me\s+)?(?:all|every)(?:\s+\w+){0,3}\s+(?:openings?|options?|slots?|windows?)\b|\bwhen am i free\b/i.test(
      prompt,
    );

  if (!requestsEveryOpening) {
    const recommended = windows.slice(0, 3);
    const labels = recommended.map(
      (window) =>
        `${window.day} ${formatWindowLabel(window)}`,
    );
    const recommendation =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
    return `The strongest ${recommended.length === 1 ? "opening is" : "options are"} ${recommendation}.${durationNote}${missingContextNote}`;
  }

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

  if (request.isPointCheck && request.scopes.length === 1) {
    const scope = request.scopes[0];
    const date = parseIsoDate(scope.date);
    const dateLabel = date
      ? new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "long",
          weekday: "long",
        }).format(date)
      : scope.date;
    if (blockers.length === 0) {
      return `You do not have anything scheduled at ${formatMinutes(
        request.startMinutes,
      )} on ${dateLabel}.${missingContextNote}`;
    }
    if (blockers.length === 1) {
      const { commitment } = blockers[0];
      return `You have “${commitment.title}” scheduled from ${formatMinutes(
        commitment.startMinutes ?? request.startMinutes,
      )}–${formatMinutes(
        commitment.endMinutes ?? request.endMinutes,
      )}.`;
    }
    return `You have ${blockers.length} items at ${formatMinutes(
      request.startMinutes,
    )} on ${dateLabel}: ${blockers
      .map(({ commitment }) => `“${commitment.title}”`)
      .join(", ")}.`;
  }

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

function parseClockTimesFromPrompt(prompt: string) {
  return [...prompt.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi)]
    .map((match) => parseTimeMatch(match))
    .filter((minutes): minutes is number => minutes !== null);
}

function hasEarlyDepartureSchedulingIntent(prompt: string) {
  return (
    /\b(?:leav(?:e|ing)|head(?:ing)?)\s+work\s+early\b/i.test(prompt) &&
    /\btoday\b/i.test(prompt) &&
    /\b(?:add|schedule|put|block|plug)\b/i.test(prompt)
  );
}

function getMsaPlanningDetails(projects: Project[] = []) {
  const matches = projects.filter((project) => {
    const searchable = `${project.name} ${project.nextAction}`.toLowerCase();
    return !project.completed && /\bmsa\b/i.test(searchable);
  });

  if (matches.length === 1) {
    return {
      details: matches[0].nextAction || "Work on the current MSA priority.",
      title: matches[0].name,
    };
  }

  return {
    details: "Work on the current MSA priority.",
    title: "MSA work",
  };
}

function createEarlyDepartureSchedulingTurn({
  input,
  prompt,
}: {
  input: AssistantScheduleAnalysisInput;
  prompt: string;
}): AssistantSchedulingConversationTurn | null {
  if (!hasEarlyDepartureSchedulingIntent(prompt)) {
    return null;
  }

  const timezone = input.timezone ?? getDefaultTimeZone();
  const workflowId = `workflow-${Date.now()}-early-departure`;
  const today = getIsoDateInTimeZone(new Date(), timezone);
  const todayDate = parseIsoDate(today);
  const todayDay = todayDate ? getDayFromDate(todayDate) : null;
  const times = parseClockTimesFromPrompt(prompt);
  const earlyEndMinutes = times[0] ?? null;
  const requestedStartMinutes = times[1] ?? null;

  if (!todayDay || earlyEndMinutes === null || requestedStartMinutes === null) {
    return null;
  }

  const relatedShift = input.workShifts.find((shift) => {
    const shiftStart = parseStartTimeToMinutes(shift.startTime);
    const shiftEnd = parseStartTimeToMinutes(shift.endTime);
    return (
      shift.day === todayDay &&
      shiftStart !== null &&
      shiftEnd !== null &&
      shiftStart < earlyEndMinutes &&
      shiftEnd > earlyEndMinutes
    );
  });

  if (!relatedShift) {
    return {
      context: {
        appliedRecords: [],
        batchId: null,
        candidateWindows: [],
        confirmationStatus: "awaiting_window_selection",
        intent: "create_time_block",
        extractedItems: extractPlanningItems(prompt, input.projects),
        lastUpdatedAt: new Date().toISOString(),
        maximumDurationMinutes: null,
        pendingProposal: null,
        pendingProposals: [],
        pendingQuestion: null,
        pendingWorkException: null,
        purpose: "MSA work",
        requestedDurationMinutes: null,
        requestedSessionCount: null,
        selectedDate: today,
        selectedWindowEnd: null,
        selectedWindowId: null,
        selectedWindowStart: null,
        state: "failed",
        workflowId,
      },
      message:
        "I couldn’t find a recurring work shift for today to shorten. Check Work Schedule, then try this request again.",
      proposal: null,
    };
  }

  const temporaryException: ScheduleException = {
    id: "pending-early-departure",
    date: today,
    exceptionType: "modify_shift",
    relatedWorkShiftId: relatedShift.id,
    originalStartTime: relatedShift.startTime,
    originalEndTime: relatedShift.endTime,
    overrideStartTime: relatedShift.startTime,
    overrideEndTime: minutesToTimeInput(earlyEndMinutes),
    title: "Leave work early",
    notes: "Drafted by the Assistant for review.",
    createdBy: "assistant_approved",
  };
  const commitments = buildNormalizedScheduleTimeline({
    ...input,
    scheduleExceptions: [
      ...(input.scheduleExceptions ?? []),
      temporaryException,
    ],
  });
  const directBlocker = findBlockersForRange({
    commitments,
    date: today,
    endMinutes: requestedStartMinutes + 1,
    isPointCheck: true,
    startMinutes: requestedStartMinutes,
  }).find((commitment) => commitment.source !== "work_shift");

  if (directBlocker) {
    return {
      context: {
        appliedRecords: [],
        batchId: null,
        candidateWindows: [],
        confirmationStatus: "awaiting_window_selection",
        intent: "create_time_block",
        extractedItems: extractPlanningItems(prompt, input.projects),
        lastUpdatedAt: new Date().toISOString(),
        maximumDurationMinutes: null,
        pendingProposal: null,
        pendingProposals: [],
        pendingQuestion: null,
        pendingWorkException: {
          date: temporaryException.date,
          exceptionType: "modify_shift",
          originalEndTime: temporaryException.originalEndTime ?? relatedShift.endTime,
          originalStartTime:
            temporaryException.originalStartTime ?? relatedShift.startTime,
          overrideEndTime: temporaryException.overrideEndTime ?? relatedShift.endTime,
          overrideStartTime:
            temporaryException.overrideStartTime ?? relatedShift.startTime,
          relatedWorkShiftId: relatedShift.id,
          title: temporaryException.title,
        },
        purpose: "MSA work",
        requestedDurationMinutes: null,
        requestedSessionCount: null,
        selectedDate: today,
        selectedWindowEnd: null,
        selectedWindowId: null,
        selectedWindowStart: minutesToTimeInput(requestedStartMinutes),
        state: "failed",
        workflowId,
      },
      message: `Leaving work early would free the afternoon, but ${formatCommitment(
        directBlocker,
      )} already covers ${formatMinutes(requestedStartMinutes)}. Choose another time and I’ll keep the one-day work change in the draft.`,
      proposal: null,
    };
  }

  const nextCommitmentStart = commitments
    .filter(
      (commitment) =>
        commitment.date === today &&
        commitment.startMinutes !== null &&
        commitment.startMinutes > requestedStartMinutes,
    )
    .map((commitment) => commitment.startMinutes as number)
    .sort((first, second) => first - second)[0];
  const endMinutes = Math.min(nextCommitmentStart ?? dayEndDefault, dayEndDefault);
  const candidateWindow = createAssistantOpenWindow({
    date: today,
    day: todayDay,
    endMinutes,
    startMinutes: requestedStartMinutes,
  });
  const planningDetails = getMsaPlanningDetails(input.projects);
  const requestedDurationMinutes = parseDurationMinutes(prompt);
  const durationFits =
    requestedDurationMinutes !== null &&
    requestedDurationMinutes <= candidateWindow.durationMinutes;
  const proposal: AssistantPendingTimeBlockProposal = {
    actionType: "create_time_block",
    date: today,
    details: planningDetails.details,
    durationMinutes: durationFits ? requestedDurationMinutes : null,
    selectedWindowEnd: minutesToTimeInput(endMinutes),
    sourceConversationId: null,
    startTime: minutesToTimeInput(requestedStartMinutes),
    status: durationFits ? "ready_for_review" : "needs_duration",
    title: planningDetails.title,
  };
  const pendingWorkException: AssistantPendingWorkExceptionProposal = {
    date: today,
    exceptionType: "modify_shift",
    originalEndTime: relatedShift.endTime,
    originalStartTime: relatedShift.startTime,
    overrideEndTime: minutesToTimeInput(earlyEndMinutes),
    overrideStartTime: relatedShift.startTime,
    relatedWorkShiftId: relatedShift.id,
    title: "Leave work early",
  };
  const context: AssistantSchedulingContext = {
    appliedRecords: [],
    batchId: null,
    candidateWindows: [candidateWindow],
    confirmationStatus: durationFits ? "ready_for_review" : "awaiting_duration",
    intent: "create_time_block",
    extractedItems: extractPlanningItems(prompt, input.projects),
    lastUpdatedAt: new Date().toISOString(),
    maximumDurationMinutes: candidateWindow.durationMinutes,
    pendingProposal: proposal,
    pendingProposals: [proposal],
    pendingQuestion: durationFits ? null : "How much time should I reserve?",
    pendingWorkException,
    purpose: planningDetails.title,
    requestedDurationMinutes: durationFits ? requestedDurationMinutes : null,
    requestedSessionCount: null,
    selectedDate: today,
    selectedWindowEnd: proposal.selectedWindowEnd,
    selectedWindowId: candidateWindow.id,
    selectedWindowStart: proposal.startTime,
    state: durationFits ? "awaiting_apply" : "awaiting_duration",
    workflowId,
  };

  return {
    context,
    message: durationFits
      ? `I drafted two linked changes for today: shorten your work shift to ${formatMinutes(
          earlyEndMinutes,
        )}, then place ${planningDetails.title} at ${formatMinutes(
          requestedStartMinutes,
        )}. Review both before applying.`
      : `Since you’re leaving work at ${formatMinutes(
          earlyEndMinutes,
        )} today, I can draft a one-day work exception and place ${planningDetails.title} at ${formatMinutes(
          requestedStartMinutes,
        )}. How much time should I reserve?`,
    proposal: durationFits ? proposal : null,
  };
}

function selectDistributedWindows(
  windows: AssistantOpenWindow[],
  count: number,
  durationMinutes: number,
) {
  const eligible = windows.filter((window) => window.durationMinutes >= durationMinutes);
  const firstByDate = [...new Map(eligible.map((window) => [window.date, window])).values()];

  if (firstByDate.length >= count) {
    if (count === 1) return [firstByDate[0]];
    if (count === 3 && firstByDate.length >= 6) {
      return [firstByDate[1], firstByDate[3], firstByDate[5]];
    }
    const selected: AssistantOpenWindow[] = [];
    for (let index = 0; index < count; index += 1) {
      const position = Math.round((index * (firstByDate.length - 1)) / (count - 1));
      const window = firstByDate[position];
      if (window && !selected.some((candidate) => candidate.id === window.id)) {
        selected.push(window);
      }
    }
    for (const window of firstByDate) {
      if (selected.length >= count) break;
      if (!selected.some((candidate) => candidate.id === window.id)) selected.push(window);
    }
    return selected.slice(0, count);
  }

  return eligible.slice(0, count);
}

function parseAllDurations(prompt: string) {
  const matches = [
    ...prompt.matchAll(
      /\b(?:half an hour|half hour|\d+\s*(?:minutes?|mins?)|(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*(?:hours?|hrs?))\b/gi,
    ),
  ];
  return matches
    .map((match) => parseExplicitDurationMinutes(match[0]))
    .filter((duration): duration is number => Boolean(duration));
}

function createMultiItemSchedulingTurn({
  activeContext,
  input,
  prompt,
}: {
  activeContext?: AssistantSchedulingContext | null;
  input: AssistantScheduleAnalysisInput;
  prompt: string;
}): AssistantSchedulingConversationTurn | null {
  const isContinuation =
    activeContext?.state === "awaiting_session_details" &&
    activeContext.intent === "multi_action_request";
  const initialItems = isContinuation
    ? activeContext.extractedItems
    : extractPlanningItems(prompt, input.projects);

  if (!isContinuation && initialItems.length < 2) return null;
  if (!isContinuation && !isExplicitMutationRequest(prompt)) return null;

  const missingDurationItems = initialItems.filter((item) =>
    item.missingFields.includes("duration"),
  );
  const suppliedDurations = parseAllDurations(prompt);
  const canAssignDurations =
    isContinuation &&
    suppliedDurations.length > 0 &&
    (suppliedDurations.length === missingDurationItems.length ||
      missingDurationItems.length === 1);
  let durationIndex = 0;
  const items = initialItems.map((item): ExtractedPlanningItem => {
    if (!item.missingFields.includes("duration") || !canAssignDurations) return item;
    const durationMinutes =
      suppliedDurations.length === 1
        ? suppliedDurations[0]
        : suppliedDurations[durationIndex++];
    return {
      ...item,
      durationMinutes,
      durationSource: "user_explicit",
      missingFields: item.missingFields.filter((field) => field !== "duration"),
    };
  });
  const missingFields = [...new Set(items.flatMap((item) => item.missingFields))];
  const workflowId = activeContext?.workflowId ?? `workflow-${Date.now()}-multi`;
  const batchId = activeContext?.batchId ?? `batch-${Date.now()}`;

  if (missingFields.length > 0) {
    const question =
      createConsolidatedClarification(items) ??
      "Tell me the missing durations in the same order as the items, and I’ll build the plan.";
    return {
      context: {
        appliedRecords: activeContext?.appliedRecords ?? [],
        batchId,
        candidateWindows: [],
        confirmationStatus: "awaiting_session_details",
        extractedItems: items,
        intent: "multi_action_request",
        lastUpdatedAt: new Date().toISOString(),
        maximumDurationMinutes: null,
        pendingProposal: null,
        pendingProposals: [],
        pendingQuestion: question,
        pendingWorkException: null,
        purpose: "Multi-item weekly plan",
        requestedDurationMinutes: null,
        requestedSessionCount: null,
        selectedDate: null,
        selectedWindowEnd: null,
        selectedWindowId: null,
        selectedWindowStart: null,
        state: "awaiting_session_details",
        workflowId,
      },
      message: question,
      proposal: null,
    };
  }

  const expandedItems = items.flatMap((item) =>
    Array.from({ length: item.frequency?.count ?? 1 }, (_, index) => ({
      item,
      sessionIndex: index,
    })),
  );
  const request = createScheduleRequest(
    "Find open time this week for 30 minutes",
    input.weekStartDate,
    [],
    input.timezone,
  );
  const commitments = buildNormalizedScheduleTimeline(input);
  const windows = validateOpenWindows(
    calculateOpenWindows({
      commitments,
      minimumMinutes: 30,
      scopes: request.scopes,
      startMinutes: request.startMinutes,
    }),
    request,
    commitments,
  );
  const cursorByWindow = new Map(windows.map((window) => [window.id, window.startMinutes]));
  const usedDates = new Set<string>();
  const proposals: AssistantPendingTimeBlockProposal[] = [];

  for (const { item, sessionIndex } of expandedItems) {
    const durationMinutes = item.durationMinutes ?? 0;
    const deadlineDay = item.deadline
      ? weekDays.findIndex((day) =>
          item.deadline?.toLowerCase().includes(day.toLowerCase()),
        )
      : -1;
    const eligible = windows.filter((window) => {
      const cursor = cursorByWindow.get(window.id) ?? window.startMinutes;
      return (
        cursor + durationMinutes <= window.endMinutes &&
        (deadlineDay < 0 || weekDays.indexOf(window.day) <= deadlineDay)
      );
    });
    const selected =
      eligible.find((window) => !usedDates.has(window.date)) ?? eligible[0] ?? null;

    if (!selected) {
      return {
        context: {
          appliedRecords: [],
          batchId,
          candidateWindows: windows,
          confirmationStatus: "awaiting_session_details",
          extractedItems: items,
          intent: "multi_action_request",
          lastUpdatedAt: new Date().toISOString(),
          maximumDurationMinutes: null,
          pendingProposal: null,
          pendingProposals: [],
          pendingQuestion: "Shorten one item, reduce its frequency, or choose a different week.",
          pendingWorkException: null,
          purpose: "Multi-item weekly plan",
          requestedDurationMinutes: null,
          requestedSessionCount: null,
          selectedDate: null,
          selectedWindowEnd: null,
          selectedWindowId: null,
          selectedWindowStart: null,
          state: "needs_clarification",
          workflowId,
        },
        message:
          "I could not fit every item into a validated opening before its deadline. Shorten one item, reduce its frequency, or choose a different week. Nothing has been added.",
        proposal: null,
      };
    }

    const startMinutes = cursorByWindow.get(selected.id) ?? selected.startMinutes;
    cursorByWindow.set(selected.id, startMinutes + durationMinutes);
    usedDates.add(selected.date);
    proposals.push({
      actionType: "create_time_block",
      batchId,
      date: selected.date,
      details: item.purpose ?? item.details ?? `Work on ${item.title}.`,
      durationMinutes,
      id: `${workflowId}-proposal-${proposals.length + 1}`,
      selectedWindowEnd: minutesToTimeInput(selected.endMinutes),
      sourceConversationId: null,
      startTime: minutesToTimeInput(startMinutes),
      status: "ready_for_review",
      title:
        (item.frequency?.count ?? 1) > 1
          ? `${item.title} ${sessionIndex + 1}`
          : item.title,
    });
  }

  return {
    context: {
      appliedRecords: [],
      batchId,
      candidateWindows: windows,
      confirmationStatus: "ready_for_review",
      extractedItems: items,
      intent: "multi_action_request",
      lastUpdatedAt: new Date().toISOString(),
      maximumDurationMinutes: null,
      pendingProposal: proposals[0] ?? null,
      pendingProposals: proposals,
      pendingQuestion: null,
      pendingWorkException: null,
      purpose: "Multi-item weekly plan",
      requestedDurationMinutes: null,
      requestedSessionCount: proposals.length,
      selectedDate: proposals[0]?.date ?? null,
      selectedWindowEnd: proposals[0]?.selectedWindowEnd ?? null,
      selectedWindowId: null,
      selectedWindowStart: proposals[0]?.startTime ?? null,
      state: "awaiting_apply",
      workflowId,
    },
    message: `I drafted ${proposals.length} validated time blocks across the week for review. I placed deadline-driven work first and spread repeated sessions across days where possible. Nothing has been added yet.`,
    proposal: proposals[0] ?? null,
  };
}

function createRecurringSchedulingTurn({
  activeContext,
  input,
  prompt,
}: {
  activeContext?: AssistantSchedulingContext | null;
  input: AssistantScheduleAnalysisInput;
  prompt: string;
}): AssistantSchedulingConversationTurn | null {
  const isContinuation =
    activeContext?.intent === "create_multiple_time_blocks" &&
    (activeContext.state === "awaiting_session_details" ||
      activeContext.state === "needs_clarification");
  const extractedItems = isContinuation
    ? activeContext.extractedItems
    : extractPlanningItems(prompt, input.projects);
  let semanticRequest = isContinuation && activeContext.semanticRequest
    ? activeContext.semanticRequest
    : extractSemanticPlanningRequest({
        previous: activeContext?.semanticRequest,
        projects: input.projects,
        prompt,
        workflowId: activeContext?.workflowId,
      });
  const isRecurring =
    isContinuation ||
    isRecurringPlanningRequest(prompt) ||
    extractedItems.some((item) => item.frequency?.recurring) ||
    Boolean(
      semanticRequest.scheduleInstructions.planningHorizon ||
        semanticRequest.scheduleInstructions.desiredFrequency?.intervalDays ||
        semanticRequest.scheduleInstructions.maximumWeeklyMinutes ||
        semanticRequest.scheduleInstructions.weeklyMinutes ||
        semanticRequest.weeklyGoal,
    );

  if (!isRecurring) return null;
  if (!isContinuation && extractedItems.length !== 1) return null;
  if (
    !isContinuation &&
    !isExplicitMutationRequest(prompt) &&
    !isExplicitSchedulingRequest(prompt) &&
    !semanticRequest.weeklyGoal
  ) {
    return null;
  }

  const item = extractedItems[0];
  if (!item) return null;
  const workflowId = activeContext?.workflowId ?? semanticRequest.workflowId;
  const batchId = activeContext?.batchId ?? `batch-${Date.now()}`;
  semanticRequest = {
    ...semanticRequest,
    activity: {
      ...semanticRequest.activity,
      purpose: semanticRequest.activity.purpose ?? item.purpose,
      title:
        semanticRequest.activity.title === "Planning item"
          ? item.title
          : semanticRequest.activity.title,
    },
    workflowId,
  };

  const recommendedWeeklyPattern =
    semanticRequest.weeklyGoal?.recommendedPattern;
  if (recommendedWeeklyPattern?.status === "pending") {
    if (isContinuation && isPositiveSchedulingConfirmation(prompt)) {
      semanticRequest = acceptRecommendedWeeklyPattern(semanticRequest);
    } else if (isContinuation && isNegativeSchedulingReply(prompt)) {
      semanticRequest = rejectRecommendedWeeklyPattern(semanticRequest);
      const question =
        "Would you rather use one three-hour session or two ninety-minute sessions?";
      return {
        context: {
          appliedRecords: activeContext?.appliedRecords ?? [],
          batchId,
          candidateWindows: [],
          confirmationStatus: "awaiting_session_details",
          extractedItems: [
            {
              ...item,
              missingFields: ["session_pattern"],
              purpose: semanticRequest.activity.purpose ?? item.purpose,
              title: semanticRequest.activity.title,
            },
          ],
          intent: "create_multiple_time_blocks",
          lastUpdatedAt: new Date().toISOString(),
          maximumDurationMinutes: null,
          pendingProposal: null,
          pendingProposals: [],
          pendingQuestion: question,
          pendingWorkException: null,
          purpose: semanticRequest.activity.title,
          requestedDurationMinutes: null,
          requestedSessionCount: null,
          selectedDate: null,
          selectedWindowEnd: null,
          selectedWindowId: null,
          selectedWindowStart: null,
          semanticRequest,
          seriesProposal: null,
          state: "awaiting_session_details",
          workflowId,
        },
        message: question,
        proposal: null,
      };
    } else {
      const weeklyMinutes = semanticRequest.weeklyGoal?.weeklyMinutes ?? 0;
      const count = recommendedWeeklyPattern.sessionsPerWeek;
      const duration = recommendedWeeklyPattern.durationMinutes;
      const formatDuration = (minutes: number) =>
        minutes === 60
          ? "one-hour"
          : minutes === 90
            ? "ninety-minute"
            : `${minutes}-minute`;
      const formatTotal = (minutes: number) =>
        minutes % 60 === 0
          ? `${formatSmallNumber(minutes / 60)}-hour`
          : `${minutes}-minute`;
      const question =
        count === 3 && duration === 60
          ? "I recommend three one-hour reading sessions each week instead of one three-hour block. That should make the preparation easier to maintain. Should I use that pattern?"
          : `I recommend ${formatSmallNumber(count)} ${formatDuration(duration)} sessions each week instead of one ${formatTotal(weeklyMinutes)} block. That should make the commitment easier to maintain. Should I use that pattern?`;
      return {
        context: {
          appliedRecords: activeContext?.appliedRecords ?? [],
          batchId,
          candidateWindows: [],
          confirmationStatus: "awaiting_session_details",
          extractedItems: [
            {
              ...item,
              missingFields: ["pattern_confirmation"],
              purpose: semanticRequest.activity.purpose ?? item.purpose,
              title: semanticRequest.activity.title,
            },
          ],
          intent: "create_multiple_time_blocks",
          lastUpdatedAt: new Date().toISOString(),
          maximumDurationMinutes: null,
          pendingProposal: null,
          pendingProposals: [],
          pendingQuestion: question,
          pendingWorkException: null,
          purpose: semanticRequest.activity.title,
          requestedDurationMinutes: duration,
          requestedSessionCount: count,
          selectedDate: null,
          selectedWindowEnd: null,
          selectedWindowId: null,
          selectedWindowStart: null,
          semanticRequest,
          seriesProposal: null,
          state: "needs_clarification",
          workflowId,
        },
        message: question,
        proposal: null,
      };
    }
  }

  if (hasUnresolvedConstraintConflict(semanticRequest)) {
    if (isContinuation && isPositiveSchedulingConfirmation(prompt)) {
      semanticRequest = acceptRecommendedConstraintResolution(semanticRequest);
    } else {
      const conflict = semanticRequest.contradictions.find(
        (candidate) => !candidate.resolved,
      );
      const recommendation = conflict?.resolutionOptions[0];
      const horizon = semanticRequest.scheduleInstructions.planningHorizon;
      const horizonCount = horizon
        ? ({ 2: "two", 3: "three", 4: "four", 5: "five" } as Record<
            number,
            string
          >)[horizon.count] ?? String(horizon.count)
        : null;
      const horizonLabel = horizon
        ? `${horizonCount}-${horizon.unit}`
        : "recurring";
      const activityReference = /sealed nectar/i.test(
        semanticRequest.activity.title,
      )
        ? "reading rhythm for halaqah preparation"
        : `rhythm for ${semanticRequest.activity.title}`;
      const question = `Got it—you want a steady ${horizonLabel} ${activityReference}. ${
        conflict?.message ?? "The requested rhythm conflicts with the weekly limit."
      } I recommend ${recommendation?.label ?? "a lower weekly frequency"} instead. Should I use that rhythm?`;

      return {
        context: {
          appliedRecords: activeContext?.appliedRecords ?? [],
          batchId,
          candidateWindows: [],
          confirmationStatus: "awaiting_session_details",
          extractedItems: [
            {
              ...item,
              durationMinutes:
                semanticRequest.scheduleInstructions.sessionDurationMinutes ??
                item.durationMinutes,
              durationSource: semanticRequest.scheduleInstructions.sessionDurationMinutes
                ? "user_explicit"
                : item.durationSource,
              missingFields: ["constraint_resolution"],
              purpose:
                semanticRequest.activity.purpose ?? item.purpose,
              title: semanticRequest.activity.title,
            },
          ],
          intent: "create_multiple_time_blocks",
          lastUpdatedAt: new Date().toISOString(),
          maximumDurationMinutes: null,
          pendingProposal: null,
          pendingProposals: [],
          pendingQuestion: question,
          pendingWorkException: null,
          purpose: semanticRequest.activity.title,
          requestedDurationMinutes:
            semanticRequest.scheduleInstructions.sessionDurationMinutes ?? null,
          requestedSessionCount: null,
          selectedDate: null,
          selectedWindowEnd: null,
          selectedWindowId: null,
          selectedWindowStart: null,
          semanticRequest,
          seriesProposal: null,
          state: "needs_clarification",
          workflowId,
        },
        message: question,
        proposal: null,
      };
    }
  }

  const intervalDays =
    semanticRequest.scheduleInstructions.desiredFrequency?.intervalDays;
  const count =
    parseRequestedSessionCount(prompt) ??
    semanticRequest.scheduleInstructions.desiredFrequency?.count ??
    (intervalDays ? Math.ceil(7 / intervalDays) : null) ??
    activeContext?.requestedSessionCount ??
    item.frequency?.count ??
    null;
  const durationMinutes =
    parseExplicitDurationMinutes(prompt) ??
    semanticRequest.scheduleInstructions.sessionDurationMinutes ??
    activeContext?.requestedDurationMinutes ??
    item.durationMinutes ??
    null;
  const purpose = semanticRequest.activity.title;
  const missingFields = [
    ...(!count ? ["frequency"] : []),
    ...(!durationMinutes ? ["duration"] : []),
  ];

  if (missingFields.length > 0) {
    const pendingItem: ExtractedPlanningItem = {
      ...item,
      missingFields,
      purpose: semanticRequest.activity.purpose ?? item.purpose,
      title: semanticRequest.activity.title,
      frequency: { count: count ?? undefined, period: "week", recurring: true },
      ...(durationMinutes
        ? { durationMinutes, durationSource: "user_explicit" as const }
        : { durationSource: "unknown" as const }),
    };
    const question =
      createConsolidatedClarification([pendingItem]) ??
      "How many sessions would you like this week, and how long should each one be?";

    return {
      context: {
        appliedRecords: activeContext?.appliedRecords ?? [],
        batchId,
        candidateWindows: activeContext?.candidateWindows ?? [],
        confirmationStatus: "awaiting_session_details",
        extractedItems: [pendingItem],
        intent: "create_multiple_time_blocks",
        lastUpdatedAt: new Date().toISOString(),
        maximumDurationMinutes: null,
        pendingProposal: null,
        pendingProposals: [],
        pendingQuestion: question,
        pendingWorkException: null,
        purpose,
        requestedDurationMinutes: durationMinutes,
        requestedSessionCount: count,
        selectedDate: null,
        selectedWindowEnd: null,
        selectedWindowId: null,
        selectedWindowStart: null,
        semanticRequest,
        seriesProposal: null,
        state: "awaiting_session_details",
        workflowId,
      },
      message: question,
      proposal: null,
    };
  }

  if (!count || !durationMinutes) {
    return null;
  }

  const horizon = semanticRequest.scheduleInstructions.planningHorizon;
  const horizonWeeks = horizon
    ? horizon.unit === "month"
      ? horizon.count * 4
      : horizon.unit === "day"
        ? Math.max(1, Math.ceil(horizon.count / 7))
        : horizon.count
    : 1;
  const baseWeekStart = getWeekStart(input.weekStartDate, input.timezone);
  const configuredStartDate = toIsoDate(baseWeekStart);
  const today = input.currentDate ?? getIsoDateInTimeZone(
    new Date(),
    input.timezone ?? getDefaultTimeZone(),
  );
  const horizonStartDate = today > configuredStartDate ? today : configuredStartDate;
  const horizonStart = parseIsoDate(horizonStartDate) ?? baseWeekStart;
  const allWindows: AssistantOpenWindow[] = [];
  const selected: AssistantOpenWindow[] = [];

  for (let periodIndex = 0; periodIndex < horizonWeeks; periodIndex += 1) {
    const periodStart = addDays(horizonStart, periodIndex * 7);
    const periodEnd = addDays(periodStart, 6);
    const periodStartIso = toIsoDate(periodStart);
    const periodEndIso = toIsoDate(periodEnd);
    const calendarWeekStarts = [
      toIsoDate(getMondayForDate(periodStart)),
      toIsoDate(getMondayForDate(periodEnd)),
    ].filter((value, index, values) => values.indexOf(value) === index);
    const periodWindows = calendarWeekStarts.flatMap((weekStartDate) => {
      const weekInput: AssistantScheduleAnalysisInput = {
        ...input,
        weekStartDate,
      };
      const request = createScheduleRequest(
        `Find open time this week for ${durationMinutes} minutes`,
        weekStartDate,
        [],
        input.timezone,
      );
      const commitments = buildNormalizedScheduleTimeline(weekInput);
      return validateOpenWindows(
        calculateOpenWindows({
          commitments,
          minimumMinutes: durationMinutes,
          scopes: request.scopes,
          startMinutes: request.startMinutes,
        }),
        request,
        commitments,
      );
    });
    const windows = [
      ...new Map(periodWindows.map((window) => [window.id, window])).values(),
    ]
      .filter(
        (window) =>
          window.date >= periodStartIso && window.date <= periodEndIso,
      )
      .sort(
        (first, second) =>
          first.date.localeCompare(second.date) ||
          first.startMinutes - second.startMinutes,
      );
    const firstByDate = [
      ...new Map(windows.map((window) => [window.date, window])).values(),
    ].filter((window) => window.durationMinutes >= durationMinutes);
    const periodSelection =
      count === 3 && firstByDate.length >= 6
        ? [firstByDate[0], firstByDate[3], firstByDate[5]]
        : selectDistributedWindows(windows, count, durationMinutes);
    allWindows.push(...windows);
    selected.push(...periodSelection);

    if (periodSelection.length < count) {
      return {
        context: {
          appliedRecords: activeContext?.appliedRecords ?? [],
          batchId,
          candidateWindows: allWindows,
          confirmationStatus: "awaiting_session_details",
          extractedItems: [{ ...item, missingFields: [] }],
          intent: "create_multiple_time_blocks",
          lastUpdatedAt: new Date().toISOString(),
          maximumDurationMinutes: null,
          pendingProposal: null,
          pendingProposals: [],
          pendingQuestion:
            "Choose fewer sessions, a shorter duration, or a different horizon.",
          pendingWorkException: null,
          purpose,
          requestedDurationMinutes: durationMinutes,
          requestedSessionCount: count,
          selectedDate: null,
          selectedWindowEnd: null,
          selectedWindowId: null,
          selectedWindowStart: null,
          semanticRequest,
          seriesProposal: null,
          state: "needs_clarification",
          workflowId,
        },
        message: `I couldn’t fit the full ${horizonWeeks}-week rhythm into reliable openings. Choose fewer sessions, a shorter duration, or a different horizon. Nothing has been added.`,
        proposal: null,
      };
    }
  }

  const proposals = selected.map((window, index): AssistantPendingTimeBlockProposal => ({
    actionType: "create_time_block",
    batchId,
    date: window.date,
    details:
      semanticRequest.activity.purpose ??
      item.purpose ??
      item.details ??
      `Work on ${semanticRequest.activity.title}.`,
    durationMinutes,
    id: `${workflowId}-proposal-${index + 1}`,
    selectedWindowEnd: minutesToTimeInput(window.endMinutes),
    sourceConversationId: null,
    startTime: minutesToTimeInput(window.startMinutes),
    status: "ready_for_review",
    title: semanticRequest.activity.title,
  }));
  const startDate = horizonStartDate;
  const endDate = toIsoDate(addDays(horizonStart, horizonWeeks * 7 - 1));
  const firstWeek = selected.slice(0, count);
  const seriesProposal: RecurringSeriesProposal = {
    assumptions: semanticRequest.contradictions
      .filter((conflict) => conflict.resolved)
      .map(
        () =>
          `Used ${count} sessions per week to respect the weekly maximum.`,
      ),
    conflicts: semanticRequest.contradictions,
    id: `series-${workflowId}`,
    occurrenceProposalIds: proposals.flatMap((proposal) =>
      proposal.id ? [proposal.id] : [],
    ),
    pattern: {
      durationMinutes,
      preferredWeekdays: [...new Set(firstWeek.map((window) => window.day))].sort(
        (first, second) => weekDays.indexOf(first) - weekDays.indexOf(second),
      ),
      sessionsPerWeek: count,
      typicalTimes: firstWeek.map((window) =>
        minutesToTimeInput(window.startMinutes),
      ),
    },
    planningHorizon: {
      endDate,
      startDate,
      weeks: horizonWeeks,
    },
    purpose: semanticRequest.activity.purpose,
    status: "pending",
    title: /sealed nectar/i.test(semanticRequest.activity.title)
      ? "Sealed Nectar Reading Plan"
      : `${semanticRequest.activity.title} Plan`,
    totalOccurrences: proposals.length,
    weeklyTotalMinutes: calculateWeeklyProposalMinutes(proposals, startDate),
    workflowId,
  };
  if (semanticRequest.weeklyGoal) {
    semanticRequest = {
      ...semanticRequest,
      weeklyGoal: {
        ...semanticRequest.weeklyGoal,
        occurrenceProposalIds: proposals.flatMap((proposal) =>
          proposal.id ? [proposal.id] : [],
        ),
        recurrence: {
          ...semanticRequest.weeklyGoal.recurrence,
          endDate,
          numberOfWeeks: horizonWeeks,
          startDate,
        },
      },
    };
  }
  const message =
    horizonWeeks > 1
      ? `I found a balanced rhythm across the week and drafted all ${proposals.length} sessions for review.`
      : semanticRequest.weeklyGoal
        ? `I drafted ${formatSmallNumber(proposals.length)} weekly ${
            /sealed nectar/i.test(semanticRequest.activity.title)
              ? "Sealed Nectar reading"
              : semanticRequest.activity.title
          } session${proposals.length === 1 ? "" : "s"} around your schedule.`
        : `I drafted ${proposals.length} ${semanticRequest.activity.title} session${proposals.length === 1 ? "" : "s"} for review. Nothing has been added yet.`;

  return {
    context: {
      appliedRecords: activeContext?.appliedRecords ?? [],
      batchId,
      candidateWindows: allWindows,
      confirmationStatus: "ready_for_review",
      extractedItems: [
        {
          ...item,
          durationMinutes,
          durationSource: "user_explicit",
          frequency: { count, period: "week", recurring: true },
          missingFields: [],
          purpose: semanticRequest.activity.purpose ?? item.purpose,
          title: semanticRequest.activity.title,
        },
      ],
      intent: "create_multiple_time_blocks",
      lastUpdatedAt: new Date().toISOString(),
      maximumDurationMinutes: durationMinutes,
      pendingProposal: proposals[0] ?? null,
      pendingProposals: proposals,
      pendingQuestion: null,
      pendingWorkException: null,
      purpose,
      requestedDurationMinutes: durationMinutes,
      requestedSessionCount: count,
      selectedDate: proposals[0]?.date ?? null,
      selectedWindowEnd: proposals[0]?.selectedWindowEnd ?? null,
      selectedWindowId: selected[0]?.id ?? null,
      selectedWindowStart: proposals[0]?.startTime ?? null,
      semanticRequest,
      seriesProposal,
      state: "awaiting_apply",
      workflowId,
    },
    message,
    proposal: proposals[0] ?? null,
  };
}

function createSchedulingStatusTurn(
  context: AssistantSchedulingContext,
): AssistantSchedulingConversationTurn {
  const total = context.pendingProposals.length || (context.pendingProposal ? 1 : 0);
  const applied = context.appliedRecords.length;
  let message: string;

  if (applied > 0 && (total === 0 || applied >= total)) {
    const records = context.appliedRecords
      .map((record) => `- ${record.date}, ${formatMinutes(parseStartTimeToMinutes(record.startTime) ?? 0)}-${formatMinutes(parseStartTimeToMinutes(record.endTime) ?? 0)} · ${record.title}`)
      .join("\n");
    message = `Yes. ${applied} session${applied === 1 ? " was" : "s were"} added to your Weekly Plan:\n\n${records}`;
  } else if (applied > 0) {
    message = `Partly. ${applied} of ${total} proposed sessions were added; the remaining ${total - applied} still need approval.`;
  } else if (context.state === "awaiting_apply" && total > 0) {
    message = `Not yet. I drafted ${total} session${total === 1 ? "" : "s"}, but ${total === 1 ? "it is" : "they are"} still waiting for your approval.`;
  } else {
    message = `No. ${context.purpose} has not been added yet.${context.pendingQuestion ? ` ${context.pendingQuestion}` : ""}`;
  }

  return { context, message, proposal: context.pendingProposal };
}

export function advanceAssistantSchedulingConversation({
  activeContext,
  input,
  loadWarning,
  prompt,
  recentMessages = [],
}: {
  activeContext?: AssistantSchedulingContext | null;
  input: AssistantScheduleAnalysisInput;
  loadWarning?: string | null;
  prompt: string;
  recentMessages?: readonly AssistantScheduleMessage[];
}): AssistantSchedulingConversationTurn | null {
  const now = new Date().toISOString();
  const workflowId = activeContext?.workflowId ?? `workflow-${Date.now()}`;

  if (activeContext && isAssistantStatusQuestion(prompt)) {
    return createSchedulingStatusTurn(activeContext);
  }

  if (
    activeContext?.state === "awaiting_apply" &&
    /\b(?:recalculate|different times?|other times?|try again)\b/i.test(prompt)
  ) {
    const priorProposalBlocks: WeeklyPlanBlock[] = activeContext.pendingProposals.flatMap(
      (proposal, index) => {
        const day = weekDays.find((candidate) =>
          activeContext.candidateWindows.some(
            (window) => window.date === proposal.date && window.day === candidate,
          ),
        );
        return day && proposal.durationMinutes
          ? [
              {
                day,
                estimatedHours: proposal.durationMinutes / 60,
                id: `recalculation-exclusion-${index}`,
                plannedTask: proposal.details,
                projectName: proposal.title,
                scheduledDate: proposal.date,
                startTime: proposal.startTime,
              },
            ]
          : [];
      },
    );
    const recalculationInput = {
      ...input,
      weeklyPlanBlocks: [...input.weeklyPlanBlocks, ...priorProposalBlocks],
    };
    const resetContext: AssistantSchedulingContext = {
      ...activeContext,
      candidateWindows: [],
      confirmationStatus: "awaiting_session_details",
      pendingProposal: null,
      pendingProposals: [],
      state: "awaiting_session_details",
    };
    const recalculated =
      activeContext.intent === "multi_action_request"
        ? createMultiItemSchedulingTurn({
            activeContext: resetContext,
            input: recalculationInput,
            prompt,
          })
        : createRecurringSchedulingTurn({
            activeContext: resetContext,
            input: recalculationInput,
            prompt,
          });

    if (recalculated) {
      return {
        ...recalculated,
        message: `I recalculated the plan using different validated openings. ${recalculated.message}`,
      };
    }
  }

  const multiItemTurn = createMultiItemSchedulingTurn({
    activeContext,
    input,
    prompt,
  });

  if (multiItemTurn) {
    return multiItemTurn;
  }

  const recurringTurn = createRecurringSchedulingTurn({
    activeContext,
    input,
    prompt,
  });

  if (recurringTurn) {
    return recurringTurn;
  }

  if (!activeContext) {
    const earlyDepartureTurn = createEarlyDepartureSchedulingTurn({
      input,
      prompt,
    });

    if (earlyDepartureTurn) {
      return earlyDepartureTurn;
    }

    const isOpenTimeRequest = hasOpenTimeQuestionIntent(prompt);
    const isPlacementRequest = hasSchedulingPlacementIntent(prompt);

    if (!isOpenTimeRequest && !isPlacementRequest) {
      return null;
    }

    const request = createScheduleRequest(
      prompt,
      input.weekStartDate,
      recentMessages,
      input.timezone,
    );
    const commitments = buildNormalizedScheduleTimeline(input);
    const windows = validateOpenWindows(
      calculateOpenWindows({
        commitments,
        minimumMinutes: request.minimumWindowMinutes,
        scopes: request.scopes,
        startMinutes: request.startMinutes,
      }),
      request,
      commitments,
    );
    const message = createOpenTimeAnswer({
      input,
      loadWarning,
      prompt,
      recentMessages,
    });

    const semanticRequest = extractSemanticPlanningRequest({
      projects: input.projects,
      prompt,
      workflowId,
    });
    const inferredPurpose = inferPlanningPurpose(prompt, recentMessages);
    const purpose =
      semanticRequest.activity.title !== "Planning item"
        ? semanticRequest.activity.title
        : inferredPurpose;

    if (windows.length === 0) {
      const failedContext: AssistantSchedulingContext = {
        appliedRecords: [],
        batchId: null,
        candidateWindows: [],
        confirmationStatus: "awaiting_window_selection",
        intent: isPlacementRequest ? "create_time_block" : "find_open_time",
        extractedItems: extractPlanningItems(prompt, input.projects),
        lastUpdatedAt: now,
        maximumDurationMinutes: null,
        originalDateBoundary: request.query.timeBoundary,
        pendingProposal: null,
        pendingProposals: [],
        pendingWorkException: null,
        pendingQuestion: null,
        purpose,
        requestedDurationMinutes: request.durationMinutes,
        requestedSessionCount: null,
        selectedDate: null,
        selectedWindowEnd: null,
        selectedWindowId: null,
        selectedWindowStart: null,
        semanticRequest,
        seriesProposal: null,
        state: "failed",
        workflowId,
      };

      return {
        context: failedContext,
        message:
          "I couldn’t find an opening that fits the loaded schedule. Try a different day, a shorter duration, or ask me to list what is blocking the week.",
        proposal: null,
      };
    }

    const pendingQuestion =
      "Which opening should I use? Choose a day or one of the openings below.";

    return {
      context: {
        appliedRecords: [],
        batchId: null,
        candidateWindows: windows,
        confirmationStatus: "awaiting_window_selection",
        intent: isPlacementRequest ? "create_time_block" : "find_open_time",
        extractedItems: extractPlanningItems(prompt, input.projects),
        lastUpdatedAt: now,
        maximumDurationMinutes: null,
        originalDateBoundary: request.query.timeBoundary,
        pendingProposal: null,
        pendingProposals: [],
        pendingWorkException: null,
        pendingQuestion,
        purpose,
        requestedDurationMinutes: request.durationMinutes,
        requestedSessionCount: null,
        selectedDate: null,
        selectedWindowId: null,
        selectedWindowEnd: null,
        selectedWindowStart: null,
        semanticRequest,
        seriesProposal: null,
        state: "awaiting_window_selection",
        workflowId,
      },
      message: `${message}\n\n${pendingQuestion}`,
      proposal: null,
    };
  }

  if (activeContext.state === "failed") {
    return null;
  }

  let selectedWindows = findSelectedWindows(
    prompt,
    activeContext.candidateWindows,
  );

  if (/\bthe other one\b/i.test(prompt)) {
    selectedWindows = activeContext.candidateWindows.filter(
      (window) => window.id !== activeContext.selectedWindowId,
    );
  }

  if (isNegativeSchedulingReply(prompt)) {
    const pendingQuestion =
      "No problem. Which opening should I use instead? Choose a day or one of the openings below.";

    return {
      context: {
        ...activeContext,
        confirmationStatus: "awaiting_window_selection",
        lastUpdatedAt: now,
        maximumDurationMinutes: null,
        pendingProposal: null,
        pendingProposals: [],
        pendingWorkException: null,
        pendingQuestion,
        requestedDurationMinutes: null,
        selectedDate: null,
        selectedWindowEnd: null,
        selectedWindowId: null,
        selectedWindowStart: null,
        state: "awaiting_window_selection",
      },
      message: pendingQuestion,
      proposal: null,
    };
  }

  if (
    (activeContext.state === "awaiting_window_selection" ||
      activeContext.state === "needs_clarification") &&
    isPositiveSchedulingConfirmation(prompt)
  ) {
    const pendingQuestion =
      "Which opening should I use? Choose a day or one of the openings below.";

    return {
      context: {
        ...activeContext,
        confirmationStatus: "awaiting_window_selection",
        lastUpdatedAt: now,
        pendingQuestion,
        state: "awaiting_window_selection",
      },
      message: pendingQuestion,
      proposal: null,
    };
  }

  if (selectedWindows.length > 1) {
    const choices = selectedWindows
      .slice(0, 4)
      .map((window) => window.label)
      .join(" or ");
    const pendingQuestion = `I found more than one opening there. Did you mean ${choices}?`;

    return {
      context: {
        ...activeContext,
        confirmationStatus: "awaiting_window_selection",
        lastUpdatedAt: now,
        pendingQuestion,
        state: "needs_clarification",
      },
      message: pendingQuestion,
      proposal: null,
    };
  }

  const selectedWindow = selectedWindows[0] ?? null;
  const mentionedDay = getMentionedWeekday(prompt);

  if (mentionedDay && !selectedWindow) {
    const pendingQuestion = `I don’t see a usable opening on ${mentionedDay}. Choose another opening below, or ask me what is blocking that day.`;

    return {
      context: {
        ...activeContext,
        confirmationStatus: "awaiting_window_selection",
        lastUpdatedAt: now,
        pendingQuestion,
        state: "needs_clarification",
      },
      message: pendingQuestion,
      proposal: null,
    };
  }

  if (selectedWindow) {
    const maximumDurationMinutes = selectedWindow.durationMinutes;
    const requestedDuration = activeContext.requestedDurationMinutes;
    const proposal: AssistantPendingTimeBlockProposal = {
      actionType: "create_time_block",
      date: selectedWindow.date,
      details: `Prepare and organize ${activeContext.purpose}.`,
      durationMinutes:
        requestedDuration && requestedDuration <= maximumDurationMinutes
          ? requestedDuration
          : null,
      selectedWindowEnd: minutesToTimeInput(selectedWindow.endMinutes),
      sourceConversationId: null,
      startTime: minutesToTimeInput(selectedWindow.startMinutes),
      status:
        requestedDuration && requestedDuration <= maximumDurationMinutes
        ? "ready_for_review"
        : "needs_duration",
      title:
        activeContext.semanticRequest?.activity.title &&
        activeContext.semanticRequest.activity.title !== "Planning item"
          ? activeContext.semanticRequest.activity.title
          : createProposalTitle(activeContext.purpose),
    };
    const nextContext: AssistantSchedulingContext = {
      ...activeContext,
      confirmationStatus:
        requestedDuration && requestedDuration <= maximumDurationMinutes
        ? "ready_for_review"
        : "awaiting_duration",
      lastUpdatedAt: now,
      maximumDurationMinutes,
      pendingProposal: proposal,
      pendingProposals: [proposal],
      pendingQuestion:
        requestedDuration && requestedDuration <= maximumDurationMinutes
          ? null
          : "How much time should I reserve?",
      selectedDate: selectedWindow.date,
      selectedWindowEnd: proposal.selectedWindowEnd,
      selectedWindowId: selectedWindow.id,
      selectedWindowStart: proposal.startTime,
      state:
        requestedDuration && requestedDuration <= maximumDurationMinutes
          ? "awaiting_apply"
          : "awaiting_duration",
    };

    if (requestedDuration && requestedDuration <= maximumDurationMinutes) {
      return {
        context: nextContext,
        message: `I kept ${selectedWindow.day} at ${selectedWindow.startLabel}. Review the exact block below before applying it.`,
        proposal,
      };
    }

    const durationNote =
      requestedDuration && requestedDuration > maximumDurationMinutes
        ? ` That opening only fits ${formatEstimatedHours(
            maximumDurationMinutes / 60,
          )}, so choose a shorter duration.`
        : "";

    return {
      context: nextContext,
      message: `${selectedWindow.day}'s opening starts at ${selectedWindow.startLabel}.${durationNote} How much time should I reserve? You can choose 30 minutes, 1 hour, 2 hours, or the full opening.`,
      proposal: null,
    };
  }

  if (
    activeContext.state === "awaiting_duration" &&
    activeContext.pendingProposal
  ) {
    const startMinutes = parseStartTimeToMinutes(
      activeContext.pendingProposal.startTime,
    );
    const endMinutes = parseStartTimeToMinutes(
      activeContext.pendingProposal.selectedWindowEnd,
    );
    const maximumDurationMinutes =
      startMinutes !== null && endMinutes !== null
        ? endMinutes >= startMinutes
          ? endMinutes - startMinutes
          : endMinutes + 1440 - startMinutes
        : null;
    const requestedDuration = /\b(?:use\s+)?(?:the\s+)?full\s+(?:opening|window)\b/i.test(
      prompt,
    )
      ? maximumDurationMinutes
      : parseDurationMinutes(prompt);

    if (!requestedDuration) {
      const pendingQuestion =
        "How much time should I reserve? Choose 30 minutes, 1 hour, 2 hours, or the full opening.";

      return {
        context: {
          ...activeContext,
          lastUpdatedAt: now,
          pendingQuestion,
        },
        message: pendingQuestion,
        proposal: null,
      };
    }

    if (maximumDurationMinutes !== null && requestedDuration > maximumDurationMinutes) {
      return {
        context: {
          ...activeContext,
          lastUpdatedAt: now,
          pendingQuestion: "Choose a shorter duration that fits this opening.",
        },
        message: `That opening can fit up to ${formatEstimatedHours(
          maximumDurationMinutes / 60,
        )}. How much of it should I reserve?`,
        proposal: null,
      };
    }

    const proposal: AssistantPendingTimeBlockProposal = {
      ...activeContext.pendingProposal,
      durationMinutes: requestedDuration,
      status: "ready_for_review",
    };
    const selectedWindowForProposal = activeContext.candidateWindows.find(
      (window) =>
        window.date === proposal.date &&
        minutesToTimeInput(window.startMinutes) === proposal.startTime,
    );
    const day = selectedWindowForProposal?.day ?? getDayFromDate(parseIsoDate(proposal.date) ?? new Date());

    return {
      context: {
        ...activeContext,
        confirmationStatus: "ready_for_review",
        lastUpdatedAt: now,
        maximumDurationMinutes,
        pendingProposal: proposal,
        pendingProposals: [proposal],
        pendingQuestion: null,
        requestedDurationMinutes: requestedDuration,
        state: "awaiting_apply",
      },
      message: `I kept ${day} at ${formatMinutes(
        startMinutes ?? 0,
      )} and reserved ${formatEstimatedHours(
        requestedDuration / 60,
      )}. Review the exact block below before applying it.`,
      proposal,
    };
  }

  if (
    activeContext.state === "awaiting_apply" &&
    isPositiveSchedulingConfirmation(prompt)
  ) {
    return {
      context: {
        ...activeContext,
        lastUpdatedAt: now,
        pendingQuestion: null,
      },
      message:
        "The block is ready for review. Use Apply on the suggestion card to save it; nothing is added until you do.",
      proposal: activeContext.pendingProposal,
    };
  }

  return null;
}
