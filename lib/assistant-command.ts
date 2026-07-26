import type { PlanningDecisionRecord } from "@/lib/assistant-automation";
import type { SchedulingWorkflowContext } from "@/lib/assistant-workflow";

export type AssistantCommandIntent =
  | "undo_latest_reversible_action"
  | "status_latest_action"
  | "status_last_scheduled"
  | "status_last_undone"
  | "social_reply"
  | "new_planning_request"
  | "ambiguous";

export type AssistantActionSnapshotRecord = {
  blockId?: string;
  date: string;
  durationMinutes: number;
  startTime: string;
  title: string;
};

type NormalizeAssistantCommandInput = {
  activeWorkflow?: SchedulingWorkflowContext | null;
  latestAssistantAction?: PlanningDecisionRecord | null;
  latestReversibleAction?: PlanningDecisionRecord | null;
  message: string;
};

const socialReplyPattern =
  /^(?:thank(?:s| you)(?: so much)?|appreciate it|great|perfect)[.!\s]*$/i;
const directUndoVerbPattern = /\b(?:undo|revert|reverse)\b/i;
const removalVerbPattern =
  /\b(?:remove|delete|cancel|get rid of|take\s+(?:it|that|this|those|them|the blocks?|the sessions?|the plan|the schedule)\s+off|never mind|scratch that)\b/i;
const recentActionReferencePattern =
  /\b(?:it|that|this|those|them|what you (?:added|scheduled|created)|the (?:blocks?|sessions?|schedule|plan|things you scheduled)|those personal blocks)\b/i;
const arbitraryOwnedRecordPattern =
  /\b(?:(?:all|every)\s+(?:my\s+)?|my\s+)(?:work shifts?|calendar events?|imported events?|google events?|canvas events?|d2l events?|ics events?)\b/i;
const lastUndoneStatusPattern =
  /\b(?:what (?:exactly )?did you (?:undo|remove|take off|delete)|what did you just (?:undo|remove|delete)|did you undo (?:it|that|them|those)|what did you take off)\b/i;
const lastScheduledStatusPattern =
  /\b(?:what (?:exactly )?did you (?:add|schedule|create)|where did you put|which (?:times?|sessions?|blocks?) did you (?:add|schedule)|what did you schedule before undoing it)\b/i;
const latestActionStatusPattern =
  /\b(?:what (?:exactly )?(?:changed|happened)|what did you just change|is it still on (?:my|the) schedule|is that still on (?:my|the) schedule)\b/i;

function normalizeMessage(message: string) {
  return message
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeAssistantCommandOrHistoryQuestion(message: string) {
  const normalized = normalizeMessage(message);
  return (
    socialReplyPattern.test(normalized) ||
    directUndoVerbPattern.test(normalized) ||
    removalVerbPattern.test(normalized) ||
    lastUndoneStatusPattern.test(normalized) ||
    lastScheduledStatusPattern.test(normalized) ||
    latestActionStatusPattern.test(normalized)
  );
}

export function normalizeAssistantCommand({
  activeWorkflow,
  latestAssistantAction,
  latestReversibleAction,
  message,
}: NormalizeAssistantCommandInput): AssistantCommandIntent {
  const normalized = normalizeMessage(message);
  if (socialReplyPattern.test(normalized)) return "social_reply";
  if (lastUndoneStatusPattern.test(normalized)) return "status_last_undone";
  if (lastScheduledStatusPattern.test(normalized)) return "status_last_scheduled";
  if (latestActionStatusPattern.test(normalized)) return "status_latest_action";

  const hasDirectUndoVerb = directUndoVerbPattern.test(normalized);
  const hasRemovalVerb = removalVerbPattern.test(normalized);
  const referencesRecentAction = recentActionReferencePattern.test(normalized);
  const targetsArbitraryOwnedRecords = arbitraryOwnedRecordPattern.test(normalized);
  const workflowHasAssistantAction = Boolean(
    activeWorkflow &&
      ["applied", "applied_with_warning", "partially_applied", "undone", "canceled"].includes(
        activeWorkflow.state,
      ),
  );

  if (
    !targetsArbitraryOwnedRecords &&
    ((hasDirectUndoVerb && referencesRecentAction) ||
      (hasDirectUndoVerb && latestReversibleAction) ||
      (hasRemovalVerb && referencesRecentAction && latestReversibleAction))
  ) {
    return "undo_latest_reversible_action";
  }
  if (
    !targetsArbitraryOwnedRecords &&
    hasRemovalVerb &&
    referencesRecentAction &&
    latestAssistantAction?.status === "undone"
  ) {
    return "status_last_undone";
  }

  if (
    hasDirectUndoVerb ||
    hasRemovalVerb ||
    (referencesRecentAction && workflowHasAssistantAction) ||
    latestAssistantAction?.status === "undone"
  ) {
    return "ambiguous";
  }

  return "new_planning_request";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDurationMinutes(value: unknown) {
  const hours =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  const minutes = Math.round(hours * 60);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function getAssistantActionSnapshotRecords(
  action?: PlanningDecisionRecord | null,
): AssistantActionSnapshotRecord[] {
  if (!action?.afterState || typeof action.afterState !== "object") return [];
  const records = (action.afterState as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const row = record as Record<string, unknown>;
    const date = readString(row.scheduled_date);
    const startTime = readString(row.start_time)?.slice(0, 5) ?? null;
    const title = readString(row.project_name);
    const durationMinutes = readDurationMinutes(row.estimated_hours);
    if (!date || !startTime || !title || !durationMinutes) return [];
    return [
      {
        ...(readString(row.block_id) ? { blockId: readString(row.block_id) ?? undefined } : {}),
        date,
        durationMinutes,
        startTime,
        title,
      },
    ];
  });
}

function formatClock(totalMinutes: number) {
  const minutesInDay = 24 * 60;
  const normalized = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function parseClock(time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatAssistantActionRecord(record: AssistantActionSnapshotRecord) {
  const date = new Date(`${record.date}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime())
    ? record.date
    : new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        weekday: "short",
      }).format(date);
  const startMinutes = parseClock(record.startTime);
  const timeLabel =
    startMinutes === null
      ? record.startTime
      : `${formatClock(startMinutes)}–${formatClock(
          startMinutes + record.durationMinutes,
        )}`;
  return `- ${dateLabel} · ${record.title} · ${timeLabel}`;
}

export function createAssistantActionHistoryMessage(input: {
  intent:
    | "status_latest_action"
    | "status_last_scheduled"
    | "status_last_undone";
  latestAction: PlanningDecisionRecord;
}) {
  const records = getAssistantActionSnapshotRecords(input.latestAction);
  if (records.length === 0) {
    return input.latestAction.status === "undone"
      ? "The latest automated plan was undone, but I couldn’t reload its exact block details."
      : "I found the latest automated plan, but I couldn’t reload its exact block details.";
  }
  const lines = records.map(formatAssistantActionRecord).join("\n");
  const wasUndone = input.latestAction.status === "undone";
  if (input.intent === "status_last_undone") {
    return wasUndone
      ? `I undid these ${records.length} block${records.length === 1 ? "" : "s"}:\n\n${lines}`
      : "I haven’t undone the latest automated plan.";
  }
  if (input.intent === "status_last_scheduled") {
    return wasUndone
      ? `I had scheduled these ${records.length} block${records.length === 1 ? "" : "s"}, but they were later undone:\n\n${lines}`
      : `Here’s what I scheduled:\n\n${lines}`;
  }
  return wasUndone
    ? `No. ${records.length === 1 ? "This block was" : `These ${records.length} blocks were`} removed by Undo:\n\n${lines}`
    : `Yes. ${records.length === 1 ? "This block is" : `These ${records.length} blocks are`} still scheduled:\n\n${lines}`;
}
