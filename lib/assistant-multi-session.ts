import type { WeekDay } from "@/lib/weekly-plan";

export type SchedulingRequestKind =
  | "read_only_question"
  | "open_time_search"
  | "single_item_schedule"
  | "recurring_uniform_series"
  | "bounded_multi_session_plan"
  | "multi_item_week_plan"
  | "linked_schedule_changes"
  | "replan_existing_items";

export type RequestedPlanningSession = {
  activityTitle: string;
  activityType:
    | "study"
    | "review"
    | "reading"
    | "workout"
    | "project_work"
    | "errand"
    | "preparation"
    | "other";
  count: number;
  durationMinutes: number;
  flexibility: "fixed" | "preferred" | "flexible";
  hardTimeRanges?: Array<{ end: string; start: string }>;
  id: string;
  mustUseDifferentDayFrom?: string[];
  preferredTimeRanges?: Array<{ end: string; start: string }>;
  purpose?: string;
  sequenceRole?: string;
};

export type ResolvedRelativeDate = {
  originalText: string;
  resolvedAt: string;
  resolvedDate: string;
  timezone: string;
};

export type TemporaryAvailabilityOverride = {
  date: string;
  effectiveEnd: string;
  expiresAt: string;
  id: string;
  relatedWorkShiftId?: string;
  replaces: {
    originalEnd: string;
    originalStart?: string;
    sourceType: "work_shift";
  };
  resolvedRelativeDate: ResolvedRelativeDate;
  scope: "current_workflow" | "persisted_exception";
  source: "current_message" | "stored_schedule_exception";
};

export type MultiSessionPlanningRequest = {
  globalConstraints: {
    excludedDateRanges?: Array<{ endsAt: string; startsAt: string }>;
    excludedWeekdays?: number[];
    minimumGapMinutes?: number;
    requireDifferentDays?: boolean;
  };
  missingFields: string[];
  planningHorizon: {
    endDate: string;
    startDate: string;
    timezone: string;
  };
  preferences: {
    afterWorkBufferMinutes?: number;
    preferredTimeRanges?: Array<{ end: string; start: string }>;
  };
  purpose?: string;
  requestKind: "bounded_multi_session_plan";
  sessions: RequestedPlanningSession[];
  temporaryAvailabilityOverrides: TemporaryAvailabilityOverride[];
  title: string;
  workflowId: string;
};

export type SessionCandidate = {
  date: string;
  endsAt: string;
  preferenceScores: {
    afterWorkBuffer: number;
    dayDistribution: number;
    preferredTime: number;
    workloadBalance: number;
  };
  satisfiesHardConstraints: boolean;
  sessionId: string;
  sourceVersion: string;
  startsAt: string;
};

export type CandidateSessionPlan = {
  assignments: Array<{
    candidate: SessionCandidate;
    sessionId: string;
  }>;
  hardConstraintsSatisfied: boolean;
  id: string;
  relaxedPreferences: string[];
  scoreBreakdown: {
    eveningFit: number;
    exceptionUse: number;
    preferenceMatch: number;
    spacing: number;
    workloadBalance: number;
  };
  totalScore: number;
};

export type CandidatePlanResult = {
  candidateCountBySession: Record<string, number>;
  completePlans: CandidateSessionPlan[];
  selectedPlan: CandidateSessionPlan | null;
};

const numberWords: Record<string, number> = {
  a: 1,
  an: 1,
  eight: 8,
  five: 5,
  four: 4,
  one: 1,
  seven: 7,
  six: 6,
  three: 3,
  twice: 2,
  two: 2,
};

const weekdayIndex: Record<string, number> = {
  friday: 5,
  monday: 1,
  saturday: 6,
  sunday: 0,
  thursday: 4,
  tuesday: 2,
  wednesday: 3,
};

const DEFAULT_AFTER_WORK_BUFFER_MINUTES = 30;
export const DEFAULT_EVENING_START = "17:00";
export const DEFAULT_EVENING_END = "22:00";

function parseCount(value: string | undefined) {
  if (!value) return null;
  const count = Number(value) || numberWords[value.toLowerCase()];
  return Number.isInteger(count) && count > 0 && count <= 12 ? count : null;
}

function parseDuration(value: string, unit: string) {
  const amount = Number(value) || numberWords[value.toLowerCase()];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(/hour|hr/i.test(unit) ? amount * 60 : amount);
}

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) =>
      /^[A-Z]{2,}$/.test(word)
        ? word
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseIsoDay(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDay();
}

export function getIsoDateInTimezone(
  instant: Date,
  timezone: string,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(instant);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function resolveRelativeDate({
  currentDate,
  originalText,
  resolvedAt,
  timezone,
}: {
  currentDate: string;
  originalText: string;
  resolvedAt: string;
  timezone: string;
}): ResolvedRelativeDate | null {
  const normalized = originalText.trim().toLowerCase();
  let resolvedDate: string | null = null;
  if (normalized === "today") resolvedDate = currentDate;
  if (normalized === "tomorrow") resolvedDate = addDays(currentDate, 1);

  const weekdayMatch = normalized.match(
    /^(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/,
  );
  if (weekdayMatch) {
    const currentDay = parseIsoDay(currentDate);
    const target = weekdayIndex[weekdayMatch[2]];
    let offset = (target - currentDay + 7) % 7;
    if (weekdayMatch[1] === "next") offset = offset === 0 ? 7 : offset + 7;
    resolvedDate = addDays(currentDate, offset);
  }

  return resolvedDate
    ? { originalText, resolvedAt, resolvedDate, timezone }
    : null;
}

function parseClock(
  hourValue: string,
  minuteValue: string | undefined,
  period: string | undefined,
  fallbackPeriod?: string,
) {
  let hours = Number(hourValue);
  const minutes = Number(minuteValue ?? 0);
  const normalizedPeriod = (period ?? fallbackPeriod ?? "")
    .replace(/\./g, "")
    .toLowerCase();
  if (normalizedPeriod === "am") hours = hours === 12 ? 0 : hours;
  if (normalizedPeriod === "pm") hours = hours === 12 ? 12 : hours + 12;
  if (!normalizedPeriod && hours >= 1 && hours <= 7) hours += 12;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parsePreferredTimeRanges(prompt: string) {
  const match = prompt.match(
    /\bbetween\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s+(?:and|-)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  if (!match) return [];
  const start = parseClock(match[1], match[2], match[3], match[6]);
  const end = parseClock(match[4], match[5], match[6]);
  return start && end && start < end ? [{ end, start }] : [];
}

function inferActivityType(value: string): RequestedPlanningSession["activityType"] {
  if (/\breview\b/i.test(value)) return "review";
  if (/\bstud(?:y|ying)\b/i.test(value)) return "study";
  if (/\bread(?:ing)?\b|\bbook\b/i.test(value)) return "reading";
  if (/\bworkout|exercise|run\b/i.test(value)) return "workout";
  if (/\berrand|grocer|pickup\b/i.test(value)) return "errand";
  if (/\bprep|prepare|preparation\b/i.test(value)) return "preparation";
  if (/\bproject|work\b/i.test(value)) return "project_work";
  return "other";
}

function cleanActivityPhrase(value: string) {
  return value
    .replace(/^(?:an?|the|my)\s+/i, "")
    .replace(/\b(?:on|across)\s+(?:three|different|separate|\d+).*$/i, "")
    .replace(/[,.]+$/g, "")
    .trim();
}

function inferSharedActivityContext(activity: string) {
  return cleanActivityPhrase(activity)
    .replace(/\b(?:study|review|reading|workout|preparation|prep)\b.*$/i, "")
    .trim();
}

function createSessionTitle(activity: string, sharedContext: string) {
  const type = inferActivityType(activity);
  const typeLabel =
    type === "project_work"
      ? "Project Work"
      : type === "other"
        ? cleanActivityPhrase(activity)
        : titleCase(type.replace(/_/g, " "));
  const context = sharedContext || inferSharedActivityContext(activity);
  return titleCase(`${context} ${typeLabel}`.trim());
}

function parseSessionGroups(prompt: string) {
  const normalized = prompt.replace(/[–—]/g, "-");
  const pattern =
    /\b(\d+|one|two|three|four|five|six|seven|eight|a|an)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*[- ]?\s*(minutes?|mins?|hours?|hrs?)\s+(.{1,80}?)\s+(?:sessions?|blocks?)\b/gi;
  return [...normalized.matchAll(pattern)].flatMap((match) => {
    const count = parseCount(match[1]);
    const durationMinutes = parseDuration(match[2], match[3]);
    const activity = cleanActivityPhrase(match[4]);
    return count && durationMinutes && activity
      ? [{ activity, count, durationMinutes }]
      : [];
  });
}

export function classifySchedulingRequestKind(
  prompt: string,
): SchedulingRequestKind {
  const groups = parseSessionGroups(prompt);
  const durations = new Set(groups.map((group) => group.durationMinutes));
  const totalCount = groups.reduce((total, group) => total + group.count, 0);
  if (
    groups.length > 1 ||
    durations.size > 1 ||
    totalCount > 1 && /\b(?:different|separate)\s+days?\b/i.test(prompt)
  ) {
    return "bounded_multi_session_plan";
  }
  if (/\b(?:find|show|give)\b.*\b(?:openings?|slots?|time)\b/i.test(prompt)) {
    return "open_time_search";
  }
  if (/\b(?:schedule|add|put|book|reserve)\b/i.test(prompt)) {
    return totalCount > 1 ? "recurring_uniform_series" : "single_item_schedule";
  }
  return "read_only_question";
}

function parseTemporaryOverride({
  currentDate,
  prompt,
  resolvedAt,
  timezone,
  workflowId,
}: {
  currentDate: string;
  prompt: string;
  resolvedAt: string;
  timezone: string;
  workflowId: string;
}): TemporaryAvailabilityOverride | null {
  const match = prompt.match(
    /\b(today|tomorrow|(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b[^.!?]{0,80}?\bleav(?:e|ing)\s+work\s+at\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\s+instead\s+of\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  if (!match) return null;
  const resolvedRelativeDate = resolveRelativeDate({
    currentDate,
    originalText: match[1],
    resolvedAt,
    timezone,
  });
  const effectiveEnd = parseClock(match[2], match[3], match[4]);
  const originalEnd = parseClock(match[5], match[6], match[7]);
  if (!resolvedRelativeDate || !effectiveEnd || !originalEnd) return null;
  return {
    date: resolvedRelativeDate.resolvedDate,
    effectiveEnd,
    expiresAt: `${addDays(resolvedRelativeDate.resolvedDate, 1)}T00:00:00.000Z`,
    id: `${workflowId}-override-${resolvedRelativeDate.resolvedDate}`,
    replaces: { originalEnd, sourceType: "work_shift" },
    resolvedRelativeDate,
    scope: "current_workflow",
    source: "current_message",
  };
}

function getFridayDate(startDate: string) {
  const startDay = parseIsoDay(startDate);
  return addDays(startDate, (5 - startDay + 7) % 7);
}

export function extractMultiSessionPlanningRequest({
  currentDate,
  prompt,
  resolvedAt,
  timezone,
  weekStartDate,
  workflowId,
}: {
  currentDate: string;
  prompt: string;
  resolvedAt: string;
  timezone: string;
  weekStartDate: string;
  workflowId: string;
}): MultiSessionPlanningRequest | null {
  if (classifySchedulingRequestKind(prompt) !== "bounded_multi_session_plan") {
    return null;
  }
  const groups = parseSessionGroups(prompt);
  if (groups.length < 2) return null;
  const preferredTimeRanges = parsePreferredTimeRanges(prompt);
  const sharedContext = inferSharedActivityContext(groups[0].activity);
  const sessions: RequestedPlanningSession[] = groups.flatMap((group, groupIndex) =>
    Array.from({ length: group.count }, (_, occurrenceIndex): RequestedPlanningSession => {
      const activityTitle = createSessionTitle(group.activity, sharedContext);
      return {
        activityTitle,
        activityType: inferActivityType(group.activity),
        count: 1,
        durationMinutes: group.durationMinutes,
        flexibility: preferredTimeRanges.length > 0 ? "preferred" : "flexible",
        id: `${workflowId}-session-${groupIndex + 1}-${occurrenceIndex + 1}`,
        preferredTimeRanges,
        sequenceRole:
          group.count > 1 ? `${group.activity} ${occurrenceIndex + 1}` : group.activity,
      };
    }),
  );
  const sessionIds = sessions.map((session) => session.id);
  const requireDifferentDays = /\b(?:different|separate)\s+days?\b/i.test(prompt);
  sessions.forEach((session) => {
    if (requireDifferentDays) {
      session.mustUseDifferentDayFrom = sessionIds.filter((id) => id !== session.id);
    }
  });
  const planningEndDate = addDays(weekStartDate, 6);
  const horizonStartDate = currentDate > weekStartDate ? currentDate : weekStartDate;
  const fridayDate = getFridayDate(weekStartDate);
  const keepFridayEveningFree = /\b(?:keep|leave)\s+friday\s+evening\s+free\b/i.test(prompt);
  const temporaryOverride = parseTemporaryOverride({
    currentDate,
    prompt,
    resolvedAt,
    timezone,
    workflowId,
  });
  const contextTitle = titleCase(sharedContext || groups[0].activity);
  const isStudyPlan = groups.every((group) =>
    ["study", "review"].includes(inferActivityType(group.activity)),
  );
  const missingFields = validateSessionDurations(sessions).problems;

  return {
    globalConstraints: {
      ...(keepFridayEveningFree
        ? {
            excludedDateRanges: [
              {
                endsAt: `${fridayDate}T${DEFAULT_EVENING_END}:00`,
                startsAt: `${fridayDate}T${DEFAULT_EVENING_START}:00`,
              },
            ],
          }
        : {}),
      ...(requireDifferentDays ? { requireDifferentDays: true } : {}),
    },
    missingFields,
    planningHorizon: {
      endDate: planningEndDate,
      startDate: horizonStartDate,
      timezone,
    },
    preferences: {
      ...(/\b(?:not|do not|don['’]t)\s+(?:place|schedule|put)?\s*(?:anything|sessions?)?\s*immediately after work\b/i.test(
        prompt,
      )
        ? { afterWorkBufferMinutes: DEFAULT_AFTER_WORK_BUFFER_MINUTES }
        : {}),
      ...(preferredTimeRanges.length > 0 ? { preferredTimeRanges } : {}),
    },
    requestKind: "bounded_multi_session_plan",
    sessions,
    temporaryAvailabilityOverrides: temporaryOverride ? [temporaryOverride] : [],
    title: `${contextTitle} ${isStudyPlan ? "Study Plan" : "Plan"}`.replace(
      /\s+(?:Study\s+)?Plan\s+(?:Study\s+)?Plan$/i,
      " Plan",
    ),
    workflowId,
  };
}

export function validateSessionDurations(
  sessions: RequestedPlanningSession[],
) {
  const problems = sessions.flatMap((session) => {
    if (!Number.isFinite(session.durationMinutes) || session.durationMinutes <= 0) {
      return [`duration:${session.id}`];
    }
    return [];
  });
  return { problems, valid: problems.length === 0 };
}

function dateDistance(first: string, second: string) {
  return Math.abs(
    (new Date(`${first}T12:00:00Z`).getTime() -
      new Date(`${second}T12:00:00Z`).getTime()) /
      86_400_000,
  );
}

export function buildCompleteCandidatePlans({
  candidatesBySession,
  request,
}: {
  candidatesBySession: Map<string, SessionCandidate[]>;
  request: MultiSessionPlanningRequest;
}): CandidatePlanResult {
  const orderedSessions = [...request.sessions].sort(
    (first, second) => second.durationMinutes - first.durationMinutes,
  );
  const completePlans: CandidateSessionPlan[] = [];
  const assignments: CandidateSessionPlan["assignments"] = [];
  const usedDates = new Set<string>();

  const visit = (index: number) => {
    if (completePlans.length >= 25_000) return;
    if (index >= orderedSessions.length) {
      const dates = assignments.map((assignment) => assignment.candidate.date).sort();
      const preferenceMatch = assignments.reduce(
        (score, assignment) =>
          score + assignment.candidate.preferenceScores.preferredTime,
        0,
      );
      const eveningFit = assignments.filter(
        (assignment) => assignment.candidate.preferenceScores.preferredTime > 0,
      ).length * 10;
      const workloadBalance = new Set(dates).size * 8;
      const spacing = dates.reduce(
        (score, date, dateIndex) =>
          dateIndex === 0 ? score : score + Math.min(3, dateDistance(date, dates[dateIndex - 1])),
        0,
      );
      const exceptionDates = new Set(
        request.temporaryAvailabilityOverrides.map((override) => override.date),
      );
      const exceptionUse = assignments.some((assignment) =>
        exceptionDates.has(assignment.candidate.date),
      )
        ? 1
        : 0;
      const totalScore =
        preferenceMatch + eveningFit + workloadBalance + spacing + exceptionUse;
      const relaxedPreferences =
        request.preferences.preferredTimeRanges?.length &&
        assignments.some(
          (assignment) =>
            assignment.candidate.preferenceScores.preferredTime === 0,
        )
          ? ["preferred_time_range"]
          : [];
      const signature = assignments
        .map((assignment) => `${assignment.sessionId}-${assignment.candidate.startsAt}`)
        .join("|");
      completePlans.push({
        assignments: assignments.map((assignment) => ({ ...assignment })),
        hardConstraintsSatisfied: true,
        id: `${request.workflowId}-plan-${signature}`,
        relaxedPreferences,
        scoreBreakdown: {
          eveningFit,
          exceptionUse,
          preferenceMatch,
          spacing,
          workloadBalance,
        },
        totalScore,
      });
      return;
    }

    const session = orderedSessions[index];
    const candidates = (candidatesBySession.get(session.id) ?? []).slice(0, 30);
    for (const candidate of candidates) {
      if (!candidate.satisfiesHardConstraints) continue;
      if (request.globalConstraints.requireDifferentDays && usedDates.has(candidate.date)) {
        continue;
      }
      assignments.push({ candidate, sessionId: session.id });
      usedDates.add(candidate.date);
      visit(index + 1);
      assignments.pop();
      if (!assignments.some((assignment) => assignment.candidate.date === candidate.date)) {
        usedDates.delete(candidate.date);
      }
    }
  };

  visit(0);
  completePlans.sort((first, second) => {
    if (second.totalScore !== first.totalScore) return second.totalScore - first.totalScore;
    const firstSignature = first.assignments
      .map((assignment) => assignment.candidate.startsAt)
      .sort()
      .join("|");
    const secondSignature = second.assignments
      .map((assignment) => assignment.candidate.startsAt)
      .sort()
      .join("|");
    return firstSignature.localeCompare(secondSignature);
  });
  return {
    candidateCountBySession: Object.fromEntries(
      request.sessions.map((session) => [
        session.id,
        candidatesBySession.get(session.id)?.length ?? 0,
      ]),
    ),
    completePlans,
    selectedPlan: completePlans[0] ?? null,
  };
}

export function getWeekDayForIsoDate(date: string): WeekDay {
  return (
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as WeekDay[]
  )[parseIsoDay(date)];
}
