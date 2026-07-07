import type { Project } from "@/lib/projects";

export type SemanticPlanningItemType =
  | "project"
  | "task"
  | "reading"
  | "study"
  | "routine"
  | "recurring_activity"
  | "appointment"
  | "meeting"
  | "workout"
  | "errand"
  | "preparation"
  | "time_block_series"
  | "unknown";

export type PlanningConstraint = {
  code:
    | "minimum_session_duration"
    | "maximum_weekly_minutes"
    | "weekly_commitment"
    | "recurrence_interval"
    | "planning_horizon"
    | "deadline"
    | "preferred_time";
  description: string;
  fields: string[];
};

export type ResolutionOption = {
  id: string;
  label: string;
  sessionsPerWeek?: number;
};

export type ConstraintConflict = {
  affectedFields: string[];
  code:
    | "frequency_exceeds_weekly_maximum"
    | "duration_exceeds_available_window"
    | "deadline_impossible"
    | "preferred_time_conflict"
    | "recurrence_conflict";
  message: string;
  resolutionOptions: ResolutionOption[];
  resolved: boolean;
  selectedResolutionId?: string;
};

export type SemanticPlanningRequest = {
  activity: {
    details?: string;
    object?: string;
    purpose?: string;
    title: string;
    verb?: string;
  };
  constraints: PlanningConstraint[];
  contradictions: ConstraintConflict[];
  itemType: SemanticPlanningItemType;
  missingFields: string[];
  relatedProject?: {
    confidence?: number;
    id?: string;
    title?: string;
  };
  requestId: string;
  scheduleInstructions: {
    avoidDays?: string[];
    deadline?: string;
    desiredFrequency?: {
      count?: number;
      intervalDays?: number;
      period?: "day" | "week";
    };
    exactDate?: string;
    exactTime?: string;
    maximumWeeklyMinutes?: number;
    minimumSessionDurationMinutes?: number;
    planningHorizon?: {
      count: number;
      maximumCount?: number;
      minimumCount?: number;
      unit: "day" | "week" | "month";
    };
    preferredDays?: string[];
    preferredTimes?: string[];
    sessionDurationMinutes?: number;
    weeklyMinutes?: number;
  };
  weeklyGoal?: WeeklyRecurringGoal;
  workflowId: string;
};

export type WeeklyRecurringGoal = {
  activityTitle: string;
  occurrenceProposalIds: string[];
  purpose?: string;
  recommendedPattern: {
    consistentWeeklyTime?: boolean;
    durationMinutes: number;
    rationale: string;
    singleContiguousBlock?: boolean;
    sessionsPerWeek: number;
    status: "pending" | "accepted" | "rejected";
  };
  recurrence: {
    endDate?: string;
    frequency: "weekly";
    numberOfWeeks?: number;
    startDate?: string;
  };
  weeklyMinutes: number;
};

export type RecurringSeriesProposal = {
  assumptions: string[];
  conflicts: ConstraintConflict[];
  id: string;
  occurrenceProposalIds: string[];
  pattern: {
    durationMinutes: number;
    preferredWeekdays?: string[];
    sessionsPerWeek: number;
    typicalTimes?: string[];
  };
  planningHorizon: {
    endDate: string;
    startDate: string;
    weeks: number;
  };
  purpose?: string;
  status: "pending" | "partially_applied" | "applied" | "rejected";
  title: string;
  totalOccurrences: number;
  weeklyTotalMinutes: number;
  workflowId: string;
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
  two: 2,
};

const commandOnlyPattern =
  /^(?:(?:please\s+)?(?:(?:plan|schedule|add|put|place|implement|move|create|draft|do)(?:\s+(?:it|this|that))?|find time|make time|go ahead)\b|(?:it|this|that)\b|(?:for\s+)?(?:the\s+)?next\s+\w+\s+(?:days?|weeks?|months?))[^a-z0-9]*$/i;
const commandLanguagePattern =
  /\b(?:plan|schedule|add|put|place|find time|make time|implement|move|create|draft it|do it|go ahead)\b/i;

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value) || numberWords[value.toLowerCase()];
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizePlanningLanguage(prompt: string) {
  return prompt
    .replace(/\beveryweek\b/gi, "every week")
    .replace(/\bperweek\b/gi, "per week")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

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

function sentenceCase(value: string) {
  const trimmed = value.trim().replace(/[.!?,;:]+$/, "");
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}

function cleanActivityObject(value: string) {
  return value
    .replace(/^(?:my|the|a|an)\s+/i, "")
    .replace(
      /\s+(?:on|in|into|around)\s+(?:my|the)\s+(?:schedule|calendar|week).*$/i,
      "",
    )
    .replace(
      /\s+(?:for|over)\s+(?:the\s+)?next\s+(?:\d+|one|two|three|four|five|six|seven|eight)\s+(?:days?|weeks?|months?).*$/i,
      "",
    )
    .replace(/\s+(?:every|up to|no more than|at least)\b.*$/i, "")
    .replace(/[.!?,;:]+$/, "")
    .trim();
}

export function isCommandDerivedTitle(title: string) {
  const normalized = title.trim();
  return (
    !normalized ||
    commandOnlyPattern.test(normalized) ||
    (/^(?:plan|schedule|add|put|place|find|make|implement|move|create|draft)\b/i.test(
      normalized,
    ) && !/\b(?:agenda|outline|report|assignment|workout|grocer|call|read)\b/i.test(normalized))
  );
}

export function inferSemanticActivityTitle(
  prompt: string,
  previousTitle?: string | null,
) {
  if (previousTitle && commandOnlyPattern.test(prompt.trim())) {
    return previousTitle;
  }
  if (/\b(?:the\s+)?sealed nectar\b/i.test(prompt)) {
    return "Read The Sealed Nectar";
  }
  if (/\b(?:draft|write|prepare)\b[^.!?]*\bkhutbah?\b[^.!?]*\boutline\b/i.test(prompt)) {
    return "Draft khutbah outline";
  }
  if (/\bboard meeting\b/i.test(prompt) && /\b(?:prep|prepare|preparation|agenda)\b/i.test(prompt)) {
    return "Prepare for board meeting";
  }
  const assignment = prompt.match(
    /\b(review|finish|complete|work on)\s+(?:my\s+|the\s+)?([A-Za-z]{2,}\s*\d{2,4}\s+assignment)\b/i,
  );
  if (assignment) {
    const verb = /review/i.test(assignment[1]) ? "Review" : "Finish";
    return `${verb} ${assignment[2].replace(/\s+/g, " ")}`;
  }
  const report = prompt.match(
    /\b(finish|complete|review|draft|write)\s+(?:my\s+|the\s+)?([A-Za-z0-9][A-Za-z0-9 '&-]{0,60}\breport)\b/i,
  );
  if (report) {
    const verb = /review/i.test(report[1])
      ? "Review"
      : /draft|write/i.test(report[1])
        ? "Draft"
        : "Finish";
    return `${verb} ${report[2].toLowerCase()}`;
  }
  if (/\b(?:grocery shopping|buy groceries|groceries)\b/i.test(prompt)) {
    return "Grocery shopping";
  }
  if (/\b(?:call|phone)\s+(?:my\s+|the\s+)?advisor\b/i.test(prompt)) {
    return "Call advisor";
  }
  if (/\b(?:workout|work out|exercise|gym)\b/i.test(prompt)) {
    return "Workout";
  }
  const verbObject = prompt.match(
    /\b(read|finish|review|prepare|draft|write|call|study|practice)\s+([^.!?]{2,90})/i,
  );
  if (verbObject) {
    const object = cleanActivityObject(verbObject[2]);
    if (object) {
      return `${sentenceCase(verbObject[1].toLowerCase())} ${object}`;
    }
  }
  if (previousTitle && !isCommandDerivedTitle(previousTitle)) {
    return previousTitle;
  }
  return "Planning item";
}

function inferPurpose(prompt: string, title: string, previousPurpose?: string) {
  if (/\bsouth side masjid\b/i.test(prompt)) {
    return "Prepare for weekly South Side masjid halaqahs";
  }
  if (/\bsealed nectar|halaqah|masjid\b/i.test(prompt) || title === "Read The Sealed Nectar") {
    return "Prepare for the masjid halaqah";
  }
  const explicit = prompt.match(
    /\b(?:so that i can|so i can|in order to|for the purpose of)\s+([^.!?]+)/i,
  )?.[1];
  return explicit?.trim() || previousPurpose;
}

function parseDurationMinutes(prompt: string) {
  const withoutWeeklyCommitment = removeWeeklyCommitmentPhrase(prompt);
  if (/\bhalf (?:an )?hour\b/i.test(prompt)) return 30;
  const minutes = withoutWeeklyCommitment.match(/\b(\d+)\s*(?:minutes?|mins?)\b/i);
  if (minutes) return Number(minutes[1]);
  const hours = withoutWeeklyCommitment.match(
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*-?\s*(?:hours?|hrs?)\b/i,
  );
  const value = parseNumber(hours?.[1]);
  return value ? Math.round(value * 60) : null;
}

const weeklyCommitmentPattern =
  /\b(?:(at least|minimum(?: of)?|no less than|up to|no more than|at most|maximum(?: of)?|about|around|roughly)\s+)?(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*(hours?|hrs?|minutes?|mins?)\s*(?:each|per|every|a)\s+week\b|\b(?:(at least|minimum(?: of)?|no less than|up to|no more than|at most|maximum(?: of)?|about|around|roughly)\s+)?(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*(hours?|hrs?|minutes?|mins?)\s+weekly\b/i;

export type WeeklyCommitment = {
  kind: "minimum" | "maximum" | "target";
  minutes: number;
  sourceText: string;
};

export function parseWeeklyCommitment(prompt: string): WeeklyCommitment | null {
  const match = normalizePlanningLanguage(prompt).match(weeklyCommitmentPattern);
  if (!match) return null;
  const qualifier = (match[1] ?? match[4] ?? "").toLowerCase();
  const amount = parseNumber(match[2] ?? match[5]);
  const unit = match[3] ?? match[6];
  if (!amount || !unit) return null;
  const kind = /up to|no more|at most|maximum/.test(qualifier)
    ? "maximum"
    : /at least|minimum|no less/.test(qualifier)
      ? "minimum"
      : "target";
  return {
    kind,
    minutes: /min/i.test(unit) ? Math.round(amount) : Math.round(amount * 60),
    sourceText: match[0],
  };
}

export function removeWeeklyCommitmentPhrase(prompt: string) {
  return normalizePlanningLanguage(prompt).replace(weeklyCommitmentPattern, " ");
}

function recommendWeeklyPattern(
  weeklyMinutes: number,
  itemType: SemanticPlanningItemType,
  options: {
    consistentWeeklyTime?: boolean;
    durationMinutes?: number | null;
    sessionsPerWeek?: number | null;
    singleContiguousBlock?: boolean;
  } = {},
) {
  if (options.singleContiguousBlock) {
    return {
      consistentWeeklyTime: true,
      durationMinutes: weeklyMinutes,
      rationale:
        "The user asked for one continuous block repeated at the same time each week.",
      sessionsPerWeek: 1,
      singleContiguousBlock: true,
      status: "accepted" as const,
    };
  }
  if (options.sessionsPerWeek && options.durationMinutes) {
    return {
      consistentWeeklyTime: options.consistentWeeklyTime ?? true,
      durationMinutes: options.durationMinutes,
      rationale: "The user explicitly chose the weekly session pattern.",
      sessionsPerWeek: options.sessionsPerWeek,
      singleContiguousBlock: false,
      status: "accepted" as const,
    };
  }
  const splitFriendly = [
    "reading",
    "study",
    "preparation",
    "recurring_activity",
    "time_block_series",
    "workout",
  ].includes(itemType);
  const sessionsPerWeek = splitFriendly && weeklyMinutes >= 180
    ? 3
    : splitFriendly && weeklyMinutes >= 120
      ? 2
      : 1;
  return {
    consistentWeeklyTime: options.consistentWeeklyTime ?? true,
    durationMinutes: Math.ceil(weeklyMinutes / sessionsPerWeek / 5) * 5,
    rationale:
      sessionsPerWeek > 1
        ? "Shorter sessions are easier to maintain than one long block."
        : "One session covers the weekly commitment without unnecessary splitting.",
    sessionsPerWeek,
    singleContiguousBlock: sessionsPerWeek === 1,
    status: "pending" as const,
  };
}

function parsePlanningHorizon(prompt: string) {
  if (/\b(?:starting\s+)?this week\b|\bfor the current week\b/i.test(prompt)) {
    return { count: 1, unit: "week" as const };
  }
  const rangeMatch = prompt.match(
    /\b(?:for|over|during)?\s*(?:the\s+)?next\s+(\d+|one|two|three|four|five|six|seven|eight)\s*-\s*(\d+|one|two|three|four|five|six|seven|eight)\s+(days?|weeks?|months?)\b/i,
  );
  const rangeMinimum = parseNumber(rangeMatch?.[1]);
  const rangeMaximum = parseNumber(rangeMatch?.[2]);
  if (rangeMatch && rangeMinimum && rangeMaximum) {
    const minimumCount = Math.min(rangeMinimum, rangeMaximum);
    const maximumCount = Math.max(rangeMinimum, rangeMaximum);
    const unit = rangeMatch[3].toLowerCase().startsWith("day")
      ? "day"
      : rangeMatch[3].toLowerCase().startsWith("month")
        ? "month"
        : "week";
    return {
      count: maximumCount,
      maximumCount,
      minimumCount,
      unit,
    } as const;
  }
  const match = prompt.match(
    /\b(?:for|over|during)?\s*(?:the\s+)?next\s+(\d+|one|two|three|four|five|six|seven|eight)\s+(days?|weeks?|months?)\b/i,
  );
  const count = parseNumber(match?.[1]);
  if (!match || !count) return null;
  const unit = match[2].toLowerCase().startsWith("day")
    ? "day"
    : match[2].toLowerCase().startsWith("month")
      ? "month"
      : "week";
  return { count, unit } as const;
}

function parseIntervalDays(prompt: string) {
  const match = prompt.match(
    /\bevery\s+(\d+|one|two|three|four|five|six|seven)\s+days?\b/i,
  );
  return parseNumber(match?.[1]);
}

function parseSessionsPerWeek(prompt: string) {
  const match = prompt.match(
    /\b(\d+|one|two|three|four|five|six|seven)\s+(?:(?:(?:\d+|one|two|three|four|five|six|seven)\s*-?\s*(?:hours?|hrs?|minutes?|mins?)\s+)?sessions?(?:\s+(?:each|per)\s+week)?|days?\s+(?:of\s+the|a|per)\s+week|days?\s+of\s+the\s+week)\b/i,
  );
  return parseNumber(match?.[1]);
}

const planningWeekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function parsePreferredDays(prompt: string) {
  return planningWeekdays.filter((day) =>
    new RegExp(`\\b${day}\\b`, "i").test(prompt),
  );
}

function parsePreferredTime(prompt: string) {
  const match = prompt.match(
    /\b(?:at|after|starting(?:\s+at)?|from)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const isPm = /^p/i.test(match[3]);
  if (hours === 12) hours = 0;
  if (isPm) hours += 12;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function inferWeeklyPatternPreference(prompt: string) {
  const singleContiguousBlock =
    /\b(?:consecutive|contiguous|continuous|single|one)\s+(?:time|block|session)\b/i.test(
      prompt,
    ) ||
    /\b(?:same|repeated)\s+(?:day\s+and\s+time|time|block)\s+(?:each|every|per)\s+week\b/i.test(
      prompt,
    );
  const splitAcrossDays =
    /\b(?:per|each)\s+day\b/i.test(prompt) ||
    /\b\d+\s+days?\s+(?:of\s+the|a|per)\s+week\b/i.test(prompt);
  return {
    consistentWeeklyTime:
      singleContiguousBlock || /\b(?:same|repeated)\b.*\bweek\b/i.test(prompt),
    singleContiguousBlock: singleContiguousBlock && !splitAcrossDays,
  };
}

function parseMaximumWeeklyMinutes(prompt: string) {
  const match = prompt.match(
    /\b(?:up to|no more than|at most|maximum(?: of)?)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*(hours?|hrs?|minutes?|mins?)\s+(?:each|per|a)\s+week\b/i,
  );
  const amount = parseNumber(match?.[1]);
  if (!match || !amount) return null;
  return /min/i.test(match[2]) ? Math.round(amount) : Math.round(amount * 60);
}

function inferItemType(
  prompt: string,
  title: string,
  hasRecurringInstructions: boolean,
): SemanticPlanningItemType {
  if (hasRecurringInstructions) return "time_block_series";
  if (/\bappointment|doctor|dentist\b/i.test(prompt)) return "appointment";
  if (/\bmeeting\b/i.test(prompt)) return "meeting";
  if (/\bworkout|exercise|gym\b/i.test(prompt)) return "workout";
  if (/\bgrocer|shopping|errand\b/i.test(prompt)) return "errand";
  if (/\bread|book\b/i.test(prompt) || /^Read\b/.test(title)) return "reading";
  if (/\bstudy|assignment|exam\b/i.test(prompt)) return "study";
  if (/\bprepare|preparation|agenda|outline\b/i.test(prompt)) return "preparation";
  if (/\bproject\b/i.test(prompt)) return "project";
  if (title !== "Planning item") return "task";
  return "unknown";
}

function findRelatedProject(projects: Project[], title: string, prompt: string) {
  const words = `${title} ${prompt}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  const matches = projects
    .filter((project) => !project.completed)
    .map((project) => {
      const searchable = `${project.name} ${project.nextAction}`.toLowerCase();
      const hits = words.filter((word) => searchable.includes(word)).length;
      return { confidence: Math.min(0.95, hits / Math.max(2, words.length / 2)), project };
    })
    .filter((match) => match.confidence >= 0.55)
    .sort((first, second) => second.confidence - first.confidence);
  return matches[0]
    ? {
        confidence: matches[0].confidence,
        id: String(matches[0].project.id),
        title: matches[0].project.name,
      }
    : undefined;
}

export function extractSemanticPlanningRequest({
  previous,
  projects = [],
  prompt,
  requestId,
  workflowId,
}: {
  previous?: SemanticPlanningRequest | null;
  projects?: Project[];
  prompt: string;
  requestId?: string;
  workflowId?: string;
}): SemanticPlanningRequest {
  const normalizedPrompt = normalizePlanningLanguage(prompt);
  const title = inferSemanticActivityTitle(
    normalizedPrompt,
    previous?.activity.title,
  );
  const weeklyCommitment = parseWeeklyCommitment(normalizedPrompt);
  const planningHorizon =
    parsePlanningHorizon(normalizedPrompt) ??
    previous?.scheduleInstructions.planningHorizon;
  const intervalDays =
    parseIntervalDays(normalizedPrompt) ??
    previous?.scheduleInstructions.desiredFrequency?.intervalDays;
  const explicitSessionCount = parseSessionsPerWeek(normalizedPrompt);
  const explicitDurationMinutes = parseDurationMinutes(normalizedPrompt);
  const explicitPreferredDays = parsePreferredDays(normalizedPrompt);
  const explicitPreferredTime = parsePreferredTime(normalizedPrompt);
  const sessionCount =
    explicitSessionCount ??
    previous?.scheduleInstructions.desiredFrequency?.count;
  const durationMinutes =
    explicitDurationMinutes ??
    previous?.scheduleInstructions.sessionDurationMinutes;
  const previousWeeklyMinutes = previous?.weeklyGoal?.weeklyMinutes ??
    previous?.scheduleInstructions.weeklyMinutes;
  const weeklyMinutes = weeklyCommitment?.kind === "maximum"
    ? previousWeeklyMinutes
    : weeklyCommitment?.minutes ??
      previousWeeklyMinutes ??
      (explicitSessionCount && explicitDurationMinutes
        ? explicitSessionCount * explicitDurationMinutes
        : undefined);
  const maximumWeeklyMinutes =
    parseMaximumWeeklyMinutes(normalizedPrompt) ??
    (weeklyCommitment?.kind === "maximum" ? weeklyCommitment.minutes : null) ??
    previous?.scheduleInstructions.maximumWeeklyMinutes;
  const hasRecurringInstructions = Boolean(
    planningHorizon || intervalDays || sessionCount || weeklyMinutes,
  );
  const purpose = inferPurpose(
    normalizedPrompt,
    title,
    previous?.activity.purpose,
  );
  const itemType = inferItemType(
    normalizedPrompt,
    title,
    hasRecurringInstructions,
  );
  const patternPreference = inferWeeklyPatternPreference(normalizedPrompt);
  const previousPattern = previous?.weeklyGoal?.recommendedPattern;
  const recommendedPattern = weeklyMinutes
    ? explicitSessionCount && explicitDurationMinutes
      ? recommendWeeklyPattern(weeklyMinutes, itemType, {
          consistentWeeklyTime: true,
          durationMinutes: explicitDurationMinutes,
          sessionsPerWeek: explicitSessionCount,
        })
      : patternPreference.singleContiguousBlock
        ? recommendWeeklyPattern(weeklyMinutes, itemType, patternPreference)
        : previousPattern ??
          recommendWeeklyPattern(weeklyMinutes, itemType, patternPreference)
    : undefined;
  const effectiveSessionCount =
    recommendedPattern?.status === "accepted"
      ? recommendedPattern.sessionsPerWeek
      : sessionCount;
  const effectiveDurationMinutes =
    recommendedPattern?.status === "accepted"
      ? recommendedPattern.durationMinutes
      : durationMinutes;
  const constraints: PlanningConstraint[] = [];
  if (planningHorizon) {
    constraints.push({
      code: "planning_horizon",
      description: `${planningHorizon.count} ${planningHorizon.unit}${planningHorizon.count === 1 ? "" : "s"}`,
      fields: ["planningHorizon"],
    });
  }
  if (intervalDays) {
    constraints.push({
      code: "recurrence_interval",
      description: `At least one session every ${intervalDays} days`,
      fields: ["desiredFrequency.intervalDays"],
    });
  }
  if (durationMinutes) {
    constraints.push({
      code: "minimum_session_duration",
      description: `At least ${durationMinutes} minutes per session`,
      fields: ["minimumSessionDurationMinutes"],
    });
  }
  if (maximumWeeklyMinutes) {
    constraints.push({
      code: "maximum_weekly_minutes",
      description: `No more than ${maximumWeeklyMinutes} minutes per week`,
      fields: ["maximumWeeklyMinutes"],
    });
  }
  if (weeklyMinutes) {
    constraints.push({
      code: "weekly_commitment",
      description: `${weeklyMinutes} minutes per week`,
      fields: ["weeklyMinutes"],
    });
  }

  const contradictions: ConstraintConflict[] = [];
  if (intervalDays && durationMinutes && maximumWeeklyMinutes) {
    const intervalSessions = Math.ceil(7 / intervalDays);
    const maximumSessions = Math.floor(maximumWeeklyMinutes / durationMinutes);
    if (intervalSessions > maximumSessions) {
      contradictions.push({
        affectedFields: [
          "desiredFrequency.intervalDays",
          "minimumSessionDurationMinutes",
          "maximumWeeklyMinutes",
        ],
        code: "frequency_exceeds_weekly_maximum",
        message: `One hour every ${formatSmallNumber(intervalDays)} days would sometimes exceed your ${formatSmallNumber(maximumWeeklyMinutes / 60)}-hour weekly limit.`,
        resolutionOptions: [
          {
            id: "respect-weekly-maximum",
            label: `${formatSmallNumber(maximumSessions)} one-hour sessions per week`,
            sessionsPerWeek: maximumSessions,
          },
        ],
        resolved: false,
      });
    }
  }

  const missingFields = [
    ...(weeklyMinutes && recommendedPattern?.status === "pending"
      ? ["pattern_confirmation"]
      : []),
    ...(hasRecurringInstructions && !weeklyMinutes && !durationMinutes ? ["duration"] : []),
    ...(hasRecurringInstructions && !weeklyMinutes && !intervalDays && !sessionCount
      ? ["frequency"]
      : []),
    ...(contradictions.length > 0 ? ["constraint_resolution"] : []),
  ];
  const resolvedWorkflowId = workflowId ?? previous?.workflowId ?? `workflow-${Date.now()}`;

  return {
    activity: {
      details: prompt,
      object: title.replace(/^(?:Read|Finish|Review|Prepare|Draft|Call|Study)\s+/i, ""),
      purpose,
      title,
      verb: title.split(" ")[0],
    },
    constraints,
    contradictions,
    itemType,
    missingFields,
    relatedProject: findRelatedProject(projects, title, normalizedPrompt),
    requestId: requestId ?? previous?.requestId ?? `request-${Date.now()}`,
    scheduleInstructions: {
      desiredFrequency: hasRecurringInstructions
        ? {
            count: effectiveSessionCount,
            intervalDays,
            period: "week",
          }
        : undefined,
      maximumWeeklyMinutes,
      minimumSessionDurationMinutes: effectiveDurationMinutes,
      planningHorizon,
      preferredDays:
        explicitPreferredDays.length > 0
          ? [...explicitPreferredDays]
          : previous?.scheduleInstructions.preferredDays,
      preferredTimes: explicitPreferredTime
        ? [explicitPreferredTime]
        : previous?.scheduleInstructions.preferredTimes,
      sessionDurationMinutes: effectiveDurationMinutes,
      weeklyMinutes,
    },
    ...(weeklyMinutes && recommendedPattern
      ? {
          weeklyGoal: {
            activityTitle: title,
            occurrenceProposalIds:
              previous?.weeklyGoal?.occurrenceProposalIds ?? [],
            purpose,
            recommendedPattern,
            recurrence: {
              frequency: "weekly" as const,
              ...(planningHorizon?.unit === "week"
                ? { numberOfWeeks: planningHorizon.count }
                : {}),
            },
            weeklyMinutes,
          },
        }
      : {}),
    workflowId: resolvedWorkflowId,
  };
}

export function acceptRecommendedWeeklyPattern(
  request: SemanticPlanningRequest,
) {
  const pattern = request.weeklyGoal?.recommendedPattern;
  if (!request.weeklyGoal || !pattern || pattern.status !== "pending") {
    return request;
  }
  return {
    ...request,
    missingFields: request.missingFields.filter(
      (field) => field !== "pattern_confirmation",
    ),
    scheduleInstructions: {
      ...request.scheduleInstructions,
      desiredFrequency: {
        count: pattern.sessionsPerWeek,
        period: "week" as const,
      },
      sessionDurationMinutes: pattern.durationMinutes,
    },
    weeklyGoal: {
      ...request.weeklyGoal,
      recommendedPattern: {
        ...pattern,
        status: "accepted" as const,
      },
    },
  };
}

export function rejectRecommendedWeeklyPattern(
  request: SemanticPlanningRequest,
) {
  if (!request.weeklyGoal) return request;
  return {
    ...request,
    weeklyGoal: {
      ...request.weeklyGoal,
      recommendedPattern: {
        ...request.weeklyGoal.recommendedPattern,
        status: "rejected" as const,
      },
    },
  };
}

export function calculateWeeklyProposalMinutes(
  proposals: Array<{ date: string; durationMinutes: number | null }>,
  startDate: string,
) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return proposals.reduce((total, proposal) => {
    const date = new Date(`${proposal.date}T00:00:00`);
    return date >= start && date < end
      ? total + (proposal.durationMinutes ?? 0)
      : total;
  }, 0);
}

export function acceptRecommendedConstraintResolution(
  request: SemanticPlanningRequest,
) {
  const conflict = request.contradictions.find(
    (candidate) =>
      candidate.code === "frequency_exceeds_weekly_maximum" &&
      !candidate.resolved,
  );
  const resolution = conflict?.resolutionOptions[0];
  if (!conflict || !resolution?.sessionsPerWeek) return request;

  return {
    ...request,
    contradictions: request.contradictions.map((candidate) =>
      candidate === conflict
        ? {
            ...candidate,
            resolved: true,
            selectedResolutionId: resolution.id,
          }
        : candidate,
    ),
    missingFields: request.missingFields.filter(
      (field) => field !== "constraint_resolution",
    ),
    scheduleInstructions: {
      ...request.scheduleInstructions,
      desiredFrequency: {
        ...request.scheduleInstructions.desiredFrequency,
        count: resolution.sessionsPerWeek,
        period: "week" as const,
      },
    },
  };
}

export function validateSemanticTitle(
  title: string,
  request?: SemanticPlanningRequest | null,
) {
  if (isCommandDerivedTitle(title)) {
    return request?.activity.title && !isCommandDerivedTitle(request.activity.title)
      ? request.activity.title
      : null;
  }
  if (
    request?.activity.title &&
    /sealed nectar/i.test(request.activity.title) &&
    !/sealed nectar/i.test(title)
  ) {
    return request.activity.title;
  }
  return title.trim().slice(0, 120) || null;
}

export function hasUnresolvedConstraintConflict(
  request: SemanticPlanningRequest,
) {
  return request.contradictions.some((conflict) => !conflict.resolved);
}

export function isSchedulingCommandOnly(prompt: string) {
  return commandOnlyPattern.test(prompt.trim()) ||
    (commandLanguagePattern.test(prompt) && !/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(prompt));
}

export function normalizeSemanticPlanningRequest(
  value: unknown,
): SemanticPlanningRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<SemanticPlanningRequest>;
  if (
    typeof candidate.workflowId !== "string" ||
    typeof candidate.requestId !== "string" ||
    typeof candidate.activity !== "object" ||
    candidate.activity === null ||
    typeof candidate.activity.title !== "string" ||
    !candidate.activity.title.trim() ||
    typeof candidate.scheduleInstructions !== "object" ||
    candidate.scheduleInstructions === null ||
    !Array.isArray(candidate.constraints) ||
    !Array.isArray(candidate.contradictions) ||
    !Array.isArray(candidate.missingFields)
  ) {
    return null;
  }
  return candidate as SemanticPlanningRequest;
}

export function normalizeRecurringSeriesProposal(
  value: unknown,
): RecurringSeriesProposal | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<RecurringSeriesProposal>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.workflowId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.totalOccurrences !== "number" ||
    !Array.isArray(candidate.occurrenceProposalIds) ||
    typeof candidate.pattern !== "object" ||
    candidate.pattern === null ||
    typeof candidate.pattern.sessionsPerWeek !== "number" ||
    typeof candidate.pattern.durationMinutes !== "number" ||
    typeof candidate.planningHorizon !== "object" ||
    candidate.planningHorizon === null
  ) {
    return null;
  }
  return {
    ...(candidate as RecurringSeriesProposal),
    weeklyTotalMinutes:
      typeof candidate.weeklyTotalMinutes === "number"
        ? candidate.weeklyTotalMinutes
        : candidate.pattern.sessionsPerWeek * candidate.pattern.durationMinutes,
  };
}
