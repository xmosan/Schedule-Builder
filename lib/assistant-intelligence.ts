import type { AssistantContextStatus } from "@/lib/assistant";
import type { Project } from "@/lib/projects";

export const assistantTurnOutcomes = [
  "direct_answer",
  "analysis",
  "clarification_required",
  "candidate_selection_required",
  "proposal_ready",
  "proposal_pending_review",
  "apply_succeeded",
  "apply_failed",
  "cannot_confirm",
  "sync_guidance",
] as const;

export type AssistantTurnOutcome = (typeof assistantTurnOutcomes)[number];

export const assistantIntents = [
  "general_conversation",
  "find_open_time",
  "check_availability",
  "check_conflicts",
  "create_time_block",
  "create_multiple_time_blocks",
  "create_task",
  "create_project",
  "update_work_exception",
  "multi_action_request",
  "plan_week",
  "sync_question",
  "status_question",
] as const;

export type AssistantIntent = (typeof assistantIntents)[number];
export type AssistantCompletionStatus =
  | "nothing_created"
  | "proposal_created"
  | "records_applied";

export type ExtractedPlanningItemType =
  | "project"
  | "task"
  | "assignment"
  | "reading"
  | "study"
  | "meeting"
  | "appointment"
  | "work_activity"
  | "workout"
  | "errand"
  | "religious_preparation"
  | "recurring_activity"
  | "schedule_exception"
  | "unknown";

export type ExtractedPlanningItem = {
  confidence: number;
  deadline?: string;
  details?: string;
  durationMinutes?: number;
  durationSource:
    | "user_explicit"
    | "stored_preference"
    | "model_estimate_for_review"
    | "unknown";
  flexibility?: "fixed" | "flexible" | "deadline_driven";
  frequency?: {
    count?: number;
    period?: "day" | "week" | "month";
    recurring?: boolean;
  };
  id: string;
  missingFields: string[];
  originalText?: string;
  preferredDate?: string;
  preferredTime?: string;
  priority?: "low" | "medium" | "high";
  purpose?: string;
  relatedProjectId?: string;
  relatedProjectName?: string;
  title: string;
  type: ExtractedPlanningItemType;
};

export type AssistantSourceCompleteness = {
  googleCalendarLoaded: boolean;
  importedCalendarsLoaded: boolean;
  projectsLoaded: boolean;
  scheduleExceptionsLoaded: boolean;
  weeklyPlanLoaded: boolean;
  workScheduleLoaded: boolean;
};

export type AssistantTurnResult = {
  completionStatus: AssistantCompletionStatus;
  extractedItems: ExtractedPlanningItem[];
  intent: AssistantIntent;
  missingFields: string[];
  outcome: AssistantTurnOutcome;
  proposalIds: string[];
  responseText: string;
  selectedCandidateId?: string;
  sourceCompleteness: AssistantSourceCompleteness;
  uncertaintyNotes: string[];
  workflowState: string;
};

export type ProjectMatch = {
  confidence: number;
  project: Project;
  reason: "exact_title" | "title" | "next_action" | "category";
};

const explicitMutationPattern =
  /\b(?:add|apply|block|book|create|draft|fit|move|plan|plug|put|reserve|save|schedule|shift)\b/i;
const statusQuestionPattern =
  /\b(?:is it on (?:my|the) schedule|did you add (?:it|that|them|those)|was (?:it|that) saved|is the plan applied|did (?:that|those|the) blocks? get created|has (?:it|that) been (?:added|scheduled|saved))\b/i;
const recurringPattern =
  /\b(?:throughout the week|across the week|split (?:it|this) across|several days|a little each|every weekday|every other day|times? this week|sessions? this week|twice|three times|four times|gradually|recurring)\b/i;
const completionClaimPattern =
  /\b(?:you(?:'re| are) all set|it(?:'s| is) scheduled|i (?:added|scheduled|saved|applied|put) (?:it|that|them|those)|it(?:'s| is) on (?:your|the) schedule|your plan has been updated|(?:done|applied|completed)[.!]?\s*$)\b/i;
const appliedClaimPattern =
  /\b(?:(?:i|we) (?:added|applied|saved|scheduled|put)|(?:it|that|the (?:plan|block|session)|your plan) (?:has been|was|is) (?:added|applied|saved|scheduled|updated)|(?:added|applied|saved|scheduled) successfully|on your schedule|all set|done)\b/i;

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

function stableItemId(title: string, index: number) {
  return `item-${index + 1}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "planning"}`;
}

export function isExplicitMutationRequest(prompt: string) {
  return explicitMutationPattern.test(prompt.trim());
}

export function isAssistantStatusQuestion(prompt: string) {
  return statusQuestionPattern.test(prompt.trim());
}

export function isRecurringPlanningRequest(prompt: string) {
  return recurringPattern.test(prompt.trim());
}

export function parseRequestedSessionCount(prompt: string) {
  if (/\bevery weekday\b/i.test(prompt)) {
    return 5;
  }

  if (/\bevery other day\b/i.test(prompt)) {
    return 3;
  }

  const match = prompt.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|twice)\s+(?:(?:reading|study|workout)\s+)?(?:sessions?|times?|workouts?)\b/i,
  );

  if (!match) {
    return null;
  }

  const count = Number(match[1]) || numberWords[match[1].toLowerCase()];
  return Number.isInteger(count) && count > 0 && count <= 8 ? count : null;
}

export function parseExplicitDurationMinutes(prompt: string) {
  if (/\b(?:half an hour|half hour)\b/i.test(prompt)) {
    return 30;
  }

  const minuteMatch = prompt.match(/\b(\d+)\s*(?:minutes?|mins?)\b/i);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
  }

  const hourMatch = prompt.match(
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*(?:hours?|hrs?)\b/i,
  );
  if (!hourMatch) {
    return null;
  }

  const hours = Number(hourMatch[1]) || numberWords[hourMatch[1].toLowerCase()];
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
}

function inferItemType(text: string): ExtractedPlanningItemType {
  if (/\bsealed nectar|halaqah|masjid|khutba|religious|quran|qur'an\b/i.test(text)) {
    return "religious_preparation";
  }
  if (/\bassignment|homework|paper|essay\b/i.test(text)) return "assignment";
  if (/\bread|reading|book\b/i.test(text)) return "reading";
  if (/\bstudy|exam|quiz|class\b/i.test(text)) return "study";
  if (/\bworkout|gym|run|exercise\b/i.test(text)) return "workout";
  if (/\bgrocer|errand|pickup|shopping\b/i.test(text)) return "errand";
  if (/\bappointment|doctor|dentist\b/i.test(text)) return "appointment";
  if (/\bmeeting|meet with\b/i.test(text)) return "meeting";
  if (/\breport|work task|internship\b/i.test(text)) return "work_activity";
  if (/\bmsa\b/i.test(text)) return "work_activity";
  if (/\bproject\b/i.test(text)) return "project";
  if (/\btask|todo|to-do\b/i.test(text)) return "task";
  return "unknown";
}

function inferTitle(text: string, type: ExtractedPlanningItemType) {
  const sealedNectar = text.match(/\b(?:read(?:ing)?\s+)?(?:the\s+)?sealed nectar\b/i);
  if (sealedNectar) return "Read The Sealed Nectar";
  if (/\bmsa\b/i.test(text)) return "MSA preparation";
  if (/\bgrocer/i.test(text)) return "Groceries";
  if (/\bworkout/i.test(text)) return "Workout";
  if (/\bassignment\b/i.test(text)) {
    const subject = text.match(/\b([A-Za-z0-9][A-Za-z0-9 &'-]{1,40}) assignment\b/i)?.[1];
    return subject && !/^(?:a|an|the|my)$/i.test(subject.trim())
      ? `${subject.trim()} assignment`
      : "Assignment";
  }
  if (/\bwork report\b/i.test(text)) return "Work report";

  const cleaned = text
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/\b(?:due|before|by|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday).*$/i, "")
    .replace(/\b(?:for|lasting)\s+\d+(?:\.\d+)?\s*(?:minutes?|hours?).*$/i, "")
    .trim();
  if (cleaned.length >= 3 && cleaned.length <= 90) return cleaned;
  return type === "unknown" ? "Planning item" : `${type.replace(/_/g, " ")}`;
}

function inferDeadline(text: string) {
  return text.match(
    /\b(?:due|before|by)\s+((?:this\s+|next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2})\b/i,
  )?.[1];
}

function inferPurpose(text: string, title: string) {
  if (/\bsealed nectar|halaqah|south side masjid\b/i.test(text)) {
    return "Prepare for weekly South Side masjid halaqahs";
  }
  const purpose = text.match(/\b(?:in order to|so (?:that )?i can|to)\s+(.+)$/i)?.[1];
  return purpose && !title.toLowerCase().includes(purpose.toLowerCase())
    ? purpose.replace(/[.!?]+$/, "").trim()
    : undefined;
}

function splitPlanningSegments(prompt: string) {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;

  const listLead = prompt.match(/\b(?:i have|plan|schedule)\s+(.+)$/i)?.[1] ?? prompt;
  const normalized = listLead.replace(/,?\s+and\s+(?=(?:an?|two|three|four|my)\b)/gi, ", ");
  const segments = normalized.split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean);
  return segments.length > 1 ? segments : [prompt.trim()];
}

export function matchProjectsForText(projects: Project[], text: string) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return [];

  return projects
    .filter((project) => !project.completed)
    .map((project): ProjectMatch | null => {
      const name = project.name.toLowerCase();
      const nextAction = project.nextAction.toLowerCase();
      if (normalized === name) return { confidence: 1, project, reason: "exact_title" };
      if (normalized.includes(name) || name.includes(normalized)) {
        return { confidence: 0.9, project, reason: "title" };
      }

      const meaningfulTokens = normalized.split(" ").filter((token) => token.length > 2);
      const titleHits = meaningfulTokens.filter((token) => name.includes(token)).length;
      const nextActionHits = meaningfulTokens.filter((token) => nextAction.includes(token)).length;
      if (titleHits > 0) {
        return { confidence: Math.min(0.88, 0.64 + titleHits * 0.08), project, reason: "title" };
      }
      if (nextActionHits > 0) {
        return { confidence: Math.min(0.82, 0.58 + nextActionHits * 0.08), project, reason: "next_action" };
      }
      if (normalized.includes(project.category.toLowerCase())) {
        return { confidence: 0.5, project, reason: "category" };
      }
      return null;
    })
    .filter((match): match is ProjectMatch => Boolean(match))
    .sort((first, second) => second.confidence - first.confidence);
}

export function extractPlanningItems(prompt: string, projects: Project[] = []) {
  const recurring = isRecurringPlanningRequest(prompt);
  const sharedCount = parseRequestedSessionCount(prompt);
  const sharedDuration = parseExplicitDurationMinutes(prompt);
  const segments = splitPlanningSegments(prompt).filter(
    (segment) =>
      !/:$/.test(segment) &&
      !/^tasks?\s+from\b/i.test(segment) &&
      /\b(?:assignment|appointment|book|errands?|groceries|grocery|halaqah|meeting|msa|project|read|report|study|tasks?|workouts?)\b/i.test(
        segment,
      ),
  );
  const candidates = segments.length > 0 ? segments : [prompt.trim()];

  return candidates.slice(0, 12).map((segment, index): ExtractedPlanningItem => {
    const type = inferItemType(segment);
    const title = inferTitle(segment, type);
    const deadline = inferDeadline(segment);
    const matches = matchProjectsForText(projects, `${title} ${segment}`);
    const clearMatch = matches[0]?.confidence >= 0.82 ? matches[0] : null;
    const count = parseRequestedSessionCount(segment) ?? (candidates.length === 1 ? sharedCount : null);
    const duration = parseExplicitDurationMinutes(segment) ?? (candidates.length === 1 ? sharedDuration : null);
    const needsFrequency = recurring && !count;
    const needsDuration =
      (recurring || isExplicitMutationRequest(prompt)) &&
      type !== "project" &&
      !duration;

    return {
      confidence: type === "unknown" ? 0.58 : 0.9,
      ...(deadline ? { deadline } : {}),
      details: segment,
      ...(duration ? { durationMinutes: duration } : {}),
      durationSource: duration ? "user_explicit" : "unknown",
      flexibility: deadline ? "deadline_driven" : "flexible",
      ...(recurring || count
        ? { frequency: { ...(count ? { count } : {}), period: "week", recurring: true } }
        : {}),
      id: stableItemId(title, index),
      missingFields: [
        ...(needsFrequency ? ["frequency"] : []),
        ...(needsDuration ? ["duration"] : []),
      ],
      ...(prompt.includes("\n") ? { originalText: prompt } : {}),
      ...(clearMatch
        ? {
            relatedProjectId: String(clearMatch.project.id),
            relatedProjectName: clearMatch.project.name,
          }
        : {}),
      purpose: inferPurpose(prompt, title),
      title,
      type: recurring && type === "unknown" ? "recurring_activity" : type,
    };
  });
}

export function classifyAssistantIntent(prompt: string, items: ExtractedPlanningItem[] = []) {
  if (isAssistantStatusQuestion(prompt)) return "status_question" as const;
  if (/\b(?:sync|google calendar)\b/i.test(prompt)) return "sync_question" as const;
  if (/\b(?:leav(?:e|ing) work early|work exception)\b/i.test(prompt)) {
    return "update_work_exception" as const;
  }
  if (items.length > 1) return "multi_action_request" as const;
  if (isExplicitMutationRequest(prompt) && isRecurringPlanningRequest(prompt)) {
    return "create_multiple_time_blocks" as const;
  }
  if (isExplicitMutationRequest(prompt)) {
    if (/\bproject\b/i.test(prompt)) return "create_project" as const;
    if (/\btask|reminder|appointment|errand\b/i.test(prompt)) return "create_task" as const;
    return "create_time_block" as const;
  }
  if (/\bconflicts?|overlap\b/i.test(prompt)) return "check_conflicts" as const;
  if (/\bfree|available|availability\b/i.test(prompt)) return "check_availability" as const;
  if (/\bfind\b.*\btime\b/i.test(prompt)) return "find_open_time" as const;
  if (/\bplan\b.*\bweek\b/i.test(prompt)) return "plan_week" as const;
  return "general_conversation" as const;
}

export function sourceCompletenessFromStatus(
  status?: AssistantContextStatus,
): AssistantSourceCompleteness {
  const loaded = (state?: string) => state === "available" || state === "empty";
  return {
    googleCalendarLoaded: loaded(status?.googleCalendar.state),
    importedCalendarsLoaded: loaded(status?.importedCalendars.state),
    projectsLoaded: loaded(status?.projects.state),
    scheduleExceptionsLoaded: loaded(status?.scheduleExceptions.state),
    weeklyPlanLoaded: loaded(status?.weeklyPlan.state),
    workScheduleLoaded: loaded(status?.workSchedule.state),
  };
}

export function createAssistantTurnResult({
  completionStatus,
  contextStatus,
  extractedItems,
  intent,
  missingFields,
  outcome,
  proposalIds,
  responseText,
  selectedCandidateId,
  uncertaintyNotes = [],
  workflowState,
}: {
  completionStatus: AssistantCompletionStatus;
  contextStatus?: AssistantContextStatus;
  extractedItems: ExtractedPlanningItem[];
  intent: AssistantIntent;
  missingFields?: string[];
  outcome: AssistantTurnOutcome;
  proposalIds?: string[];
  responseText: string;
  selectedCandidateId?: string | null;
  uncertaintyNotes?: string[];
  workflowState: string;
}): AssistantTurnResult {
  return {
    completionStatus,
    extractedItems,
    intent,
    missingFields:
      missingFields ?? [...new Set(extractedItems.flatMap((item) => item.missingFields))],
    outcome,
    proposalIds: proposalIds ?? [],
    responseText,
    ...(selectedCandidateId ? { selectedCandidateId } : {}),
    sourceCompleteness: sourceCompletenessFromStatus(contextStatus),
    uncertaintyNotes,
    workflowState,
  };
}

export function validateAssistantCompletionLanguage(
  responseText: string,
  completionStatus: AssistantCompletionStatus,
) {
  const text = responseText.trim();
  const explicitlyNegative =
    /\b(?:nothing (?:has been|was) (?:added|applied|saved|scheduled)|not (?:been )?(?:added|applied|saved|scheduled)|has not been|hasn't been|is not scheduled|isn't scheduled)\b/i.test(
      text,
    );
  const mismatch =
    completionStatus === "nothing_created"
      ? !explicitlyNegative &&
        (completionClaimPattern.test(text) || appliedClaimPattern.test(text))
      : completionStatus === "proposal_created"
        ? !explicitlyNegative &&
          (completionClaimPattern.test(text) ||
            /\b(?:i|we) (?:added|applied|saved|scheduled|put)\b/i.test(text))
        : false;

  if (!mismatch) {
    return { mismatch: false, responseText: text };
  }

  console.warn("Assistant completion-language guard replaced an inconsistent response", {
    completionStatus,
  });

  return {
    mismatch: true,
    responseText:
      completionStatus === "proposal_created"
        ? "I drafted the requested change for your review. Nothing has been added yet; review and approve the proposal first."
        : "It has not been scheduled yet. I still need the missing planning details before I can prepare a proposal.",
  };
}

export function createConsolidatedClarification(items: ExtractedPlanningItem[]) {
  const missingFrequency = items.filter((item) => item.missingFields.includes("frequency"));
  const missingDuration = items.filter((item) => item.missingFields.includes("duration"));

  if (items.length === 1 && missingFrequency.length > 0 && missingDuration.length > 0) {
    const activity = items[0].type === "reading" || /read/i.test(items[0].title)
      ? "reading sessions"
      : "sessions";
    return `How many ${activity} would you like this week, and roughly how long should each one be?`;
  }

  const questions: string[] = [];
  missingDuration.forEach((item) => questions.push(`How long should “${item.title}” take?`));
  missingFrequency.forEach((item) => questions.push(`How many “${item.title}” sessions do you want this week?`));

  if (questions.length === 0) return null;
  if (questions.length === 1) return questions[0];
  return `I need ${questions.length} details:\n\n${questions.map((question) => `- ${question}`).join("\n")}`;
}
