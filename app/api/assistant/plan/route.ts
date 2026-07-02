import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  addScheduledItemConflictWarningsToSuggestions,
  assistantPlanningSuggestionTypes,
  createCalendarConflictSuggestions,
  createAssistantPlanningContext,
  createContextOnlyAssistantResponse,
  createFallbackAssistantResponse,
  filterAssistantSuggestions,
  getAssistantCurrentWeekStartInput,
  getRelevantImportedCalendarEvents,
  isGreetingPrompt,
  isVaguePrompt,
  normalizeAssistantSuggestions,
  shouldGenerateAssistantActionCards,
  type AssistantGoogleSyncRow,
  type AssistantPlanReviewResponse,
  type AssistantPlanningContext,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import type { PlannerProfile, PlannerType } from "@/lib/onboarding";
import {
  advanceAssistantSchedulingConversation,
  createAssistantScheduleAnalysisSnapshot,
  hasDeterministicScheduleQuestionIntent,
  normalizeAssistantSchedulingContext,
} from "@/lib/assistant-schedule-analysis";
import {
  fetchPlannerProfileForUser,
  fetchImportedCalendarEventsForUser,
  fetchProjectsForUser,
  fetchScheduledItemsForUser,
  fetchScheduleExceptionsForUser,
  fetchWorkShiftsForUser,
  fetchWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";

export const dynamic = "force-dynamic";

const maxPromptLength = 12000;
const maxRecentMessages = 8;
const maxRecentMessageLength = 1200;
const defaultOpenAiModel = "gpt-4o-mini";
let openAiClient: OpenAI | null = null;

function getAssistantModel() {
  return (
    process.env.OPENAI_ASSISTANT_MODEL?.trim() ||
    process.env.AI_MODEL?.trim() ||
    defaultOpenAiModel
  );
}

type AssistantChatHistoryItem = {
  role: "assistant" | "user";
  content: string;
};

type AssistantStreamEvent =
  | { type: "message_delta"; delta: string }
  | { type: "final"; response: AssistantPlanReviewResponse }
  | { type: "error"; error: string };

const assistantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: {
      type: "string",
      description:
        "A friendly plain-language assistant reply. It should explain the planning ideas conversationally and remind the user that they choose what to apply.",
    },
    suggestions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: assistantPlanningSuggestionTypes,
          },
          title: { type: "string" },
          description: { type: "string" },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          rationale: { type: "string" },
          severity: {
            type: "string",
            enum: ["info", "warning", "important"],
          },
          projectName: { type: "string" },
          newProjectName: { type: "string" },
          category: {
            type: "string",
            enum: ["Must-do", "Growth", "Maintenance", ""],
          },
          priority: {
            type: "string",
            enum: ["High", "Medium", "Low", ""],
          },
          deadline: { type: "string" },
          itemType: {
            type: "string",
            enum: ["task", "appointment", ""],
          },
          itemDate: { type: "string" },
          startTime: { type: "string" },
          location: { type: "string" },
          conflictWarnings: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
          },
          day: {
            type: "string",
            enum: [
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
              "",
            ],
          },
          estimatedHours: { type: "number" },
          exceptionDate: { type: "string" },
          exceptionType: {
            type: "string",
            enum: [
              "modify_shift",
              "cancel_shift",
              "extra_shift",
              "blocked_time",
              "available_override",
              "",
            ],
          },
          originalEndTime: { type: "string" },
          originalStartTime: { type: "string" },
          overrideEndTime: { type: "string" },
          overrideStartTime: { type: "string" },
          plannedTask: { type: "string" },
          proposedNextAction: { type: "string" },
          relatedWorkShiftId: { type: "string" },
          weeklyHours: { type: "number" },
        },
        required: [
          "id",
          "type",
          "title",
          "description",
          "confidence",
          "rationale",
          "severity",
          "projectName",
          "newProjectName",
          "category",
          "priority",
          "deadline",
          "itemType",
          "itemDate",
          "startTime",
          "location",
          "conflictWarnings",
          "day",
          "estimatedHours",
          "exceptionDate",
          "exceptionType",
          "originalEndTime",
          "originalStartTime",
          "overrideEndTime",
          "overrideStartTime",
          "plannedTask",
          "proposedNextAction",
          "relatedWorkShiftId",
          "weeklyHours",
        ],
      },
    },
    turn: {
      type: "object",
      additionalProperties: false,
      properties: {
        responseText: { type: "string" },
        intent: {
          type: "string",
          enum: [
            "question",
            "analysis",
            "planning_change",
            "sync",
            "open_time",
            "greeting",
            "vague",
          ],
        },
        workflowTransition: {
          type: "string",
          enum: ["none", "ask_clarification", "propose_actions"],
        },
        extracted: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            date: { type: "string" },
            day: { type: "string" },
            startTime: { type: "string" },
            durationMinutes: { type: "number" },
          },
          required: ["title", "date", "day", "startTime", "durationMinutes"],
        },
        missingFields: {
          type: "array",
          items: {
            type: "string",
            enum: ["title", "date", "day", "startTime", "duration"],
          },
        },
        actionCardReady: { type: "boolean" },
      },
      required: [
        "responseText",
        "intent",
        "workflowTransition",
        "extracted",
        "missingFields",
        "actionCardReady",
      ],
    },
  },
  required: ["message", "suggestions", "turn"],
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Assistant planning is unavailable right now.";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function getOpenAiClient(apiKey: string) {
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey });
  }

  return openAiClient;
}

function normalizeRecentMessages(value: unknown): AssistantChatHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const candidate = item as Partial<AssistantChatHistoryItem>;

      if (
        (candidate.role !== "assistant" && candidate.role !== "user") ||
        typeof candidate.content !== "string" ||
        !candidate.content.trim()
      ) {
        return null;
      }

      return {
        role: candidate.role,
        content: candidate.content.trim().slice(0, maxRecentMessageLength),
      };
    })
    .filter((item): item is AssistantChatHistoryItem => item !== null)
    .slice(-maxRecentMessages);
}

function normalizeTimezone(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const timezone = value.trim();

  if (!timezone || timezone.length > 80 || /[^A-Za-z0-9_+\-/.]/.test(timezone)) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return undefined;
  }
}

function createNdjsonStream(
  executor: (send: (event: AssistantStreamEvent) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: AssistantStreamEvent) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          await executor(send);
        } catch (error) {
          send({
            type: "error",
            error: getErrorMessage(error),
          });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

function splitTextForFallbackStream(message: string) {
  return message.match(/.{1,28}(?:\s|$)/g) ?? [message];
}

async function streamFallbackMessage(
  message: string,
  send: (event: AssistantStreamEvent) => void,
) {
  for (const chunk of splitTextForFallbackStream(message)) {
    send({ type: "message_delta", delta: chunk });
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

async function getAuthenticatedUser(
  request: NextRequest,
): Promise<{ supabase: SupabaseClient; userId: string } | NextResponse> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in before using Planning Assistant." },
      { status: 401 },
    );
  }

  try {
    const supabase = createAuthenticatedSupabaseClient(accessToken);
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? "Session could not be verified." },
        { status: 401 },
      );
    }

    return {
      supabase,
      userId: data.user.id,
    };
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

async function loadPlanningContext(
  supabase: SupabaseClient,
  userId: string,
  timezone?: string,
) {
  const syncWeekStartDate = getAssistantCurrentWeekStartInput();
  const [
    profileResult,
    projectsResult,
    weeklyPlanResult,
    workShiftsResult,
    importedEventsResult,
    scheduledItemsResult,
    scheduleExceptionsResult,
    googleSyncConnectionResult,
    googleSyncRowsResult,
  ] = await Promise.all([
    fetchPlannerProfileForUser(supabase, userId),
    fetchProjectsForUser(supabase, userId),
    fetchWeeklyPlanBlocksForUser(supabase, userId),
    fetchWorkShiftsForUser(supabase, userId),
    fetchImportedCalendarEventsForUser(supabase, userId),
    fetchScheduledItemsForUser(supabase, userId),
    fetchScheduleExceptionsForUser(supabase, userId),
    supabase
      .from("google_calendar_connections")
      .select("sync_enabled, sync_calendar_name")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("google_calendar_synced_events")
      .select(
        "weekly_plan_block_id, sync_status, google_event_html_link, synced_title, block_snapshot",
      )
      .eq("user_id", userId)
      .eq("week_start_date", syncWeekStartDate),
  ]);
  const loadErrors = [
    profileResult.error,
    projectsResult.error,
    weeklyPlanResult.error,
    workShiftsResult.error,
    importedEventsResult.error,
    scheduledItemsResult.error,
    scheduleExceptionsResult.error,
    googleSyncConnectionResult.error,
    googleSyncRowsResult.error,
  ].filter(Boolean);

  const profile = profileResult.error == null ? profileResult.data : null;
  const plannerType: PlannerType | "Unknown" = profile
    ? profile.plannerType
    : "Unknown";
  const googleSyncRows: AssistantGoogleSyncRow[] =
    googleSyncRowsResult.error == null
      ? ((googleSyncRowsResult.data ?? []).map((row) => ({
          blockSnapshot: row.block_snapshot,
          googleEventHtmlLink: row.google_event_html_link,
          syncStatus:
            row.sync_status === "needs_attention"
              ? ("needs_attention" as const)
              : ("synced" as const),
          syncedTitle: row.synced_title,
          weeklyPlanBlockId: row.weekly_plan_block_id,
        })) satisfies AssistantGoogleSyncRow[])
      : [];

  return {
    context: createAssistantPlanningContext(
      projectsResult.error == null ? projectsResult.data : [],
      weeklyPlanResult.error == null ? weeklyPlanResult.data : [],
      plannerType,
      workShiftsResult.error == null ? workShiftsResult.data : [],
      importedEventsResult.error == null
        ? getRelevantImportedCalendarEvents(importedEventsResult.data)
        : [],
      googleSyncRows,
      {
        syncCalendarName:
          googleSyncConnectionResult.error == null
            ? googleSyncConnectionResult.data?.sync_calendar_name
            : null,
        syncEnabled:
          googleSyncConnectionResult.error == null
            ? Boolean(googleSyncConnectionResult.data?.sync_enabled)
            : false,
        scheduledItems:
          scheduledItemsResult.error == null ? scheduledItemsResult.data : [],
        scheduleExceptions:
          scheduleExceptionsResult.error == null
            ? scheduleExceptionsResult.data
            : [],
        timezone,
        weekStartDate: syncWeekStartDate,
      },
    ),
    profile,
    warning:
      loadErrors.length > 0
        ? `Some calendar or schedule data did not load, so this answer may be incomplete. ${loadErrors
            .map(getErrorMessage)
            .join(" ")}`
        : null,
  };
}

function createAiPrompt(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
  recentMessages: AssistantChatHistoryItem[] = [],
) {
  const scheduleAnalysis = createAssistantScheduleAnalysisSnapshot({
    importedCalendarEvents: context.importedCalendarEvents,
    scheduleExceptions: context.scheduleExceptions,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  });

  return [
    "You are Schedule Builder's friendly planning assistant.",
    "Return JSON only matching the provided schema.",
    "Classify the latest turn in turn.intent and report extracted scheduling fields, missingFields, and actionCardReady.",
    "Set actionCardReady true only for a clear planning_change request with every required field needed by the proposed action.",
    "Do not calculate availability, conflicts, or open windows. Use only the deterministic schedule data provided below.",
    "If a required field is missing, use workflowTransition ask_clarification, list the missing field, set actionCardReady false, and return zero suggestions.",
    "Return a short, natural plain-language message first, then only the strongest reviewable planning suggestions.",
    "Sound like a helpful planning coach, not a system report.",
    "Do not repeat the same opening phrase every time.",
    "If the user is only greeting you, reply conversationally and return zero suggestions.",
    "If the user request is vague, ask one useful follow-up question and return zero or one suggestion.",
    "If the user asks a general question, answer briefly first before proposing schedule changes.",
    "Do not create suggestion cards for every response.",
    "Return zero suggestions for direct questions, analysis/review requests, Google sync status questions, and open-time searches unless the user clearly asks to change the plan.",
    "Only generate suggestion cards when the user clearly asks to create, add, move, update, schedule, plan, or generate blocks/projects.",
    "For 'find open time' requests, list open windows in the message and ask whether the user wants to turn one into a time block. Return zero suggestions unless they asked to create blocks.",
    "Limit suggestions to 2-4 high-quality items by default.",
    "Return at most 2 warning-style suggestions.",
    "Avoid duplicate or near-duplicate cards.",
    "Separate insights in the message from actions in the suggestions.",
    "Do not claim anything was saved.",
    "The app can create new projects, update project next actions, and create weekly blocks only after the user applies a reviewed action card.",
    "The app can also create exact-date standalone tasks and appointments only after the user applies a reviewed action card.",
    "The app can create date-specific work-schedule exceptions only after the user applies a reviewed action card. Never edit the recurring shift for a one-day change.",
    "The app can also update existing project fields after review: name, category, priority, deadline, next action, and weekly hours.",
    "If the user asks you to create, add, draft, or save a project, return a new_project suggestion card. Do not say you cannot create or save it; say you drafted it for review and the user can apply it.",
    "Do not create a new_project card unless the user explicitly asks for a project, goal, initiative, class, course, or work project.",
    "If the user asks to add a normal task, appointment, errand, reminder, or personal calendar item tied to an exact date, return a suggested_scheduled_item card. Do not create a project.",
    "Use suggested_weekly_block only for week-oriented time blocks tied to Monday through Sunday planning.",
    "For suggested_scheduled_item cards, title is the task or appointment title. plannedTask is the description/details. itemDate must be YYYY-MM-DD. itemType must be task or appointment. startTime must be HH:MM or empty.",
    "Appointments require itemDate, startTime, and estimatedHours. If a requested appointment is missing any of those, ask a clarifying question and return zero suggestions.",
    "Tasks require itemDate, title, and estimatedHours. Tasks may be flexible with empty startTime.",
    "Use the current server date for relative dates. If a date is ambiguous, ask a clarifying question and return zero suggestions.",
    "If the user asks to change, edit, move, confirm, or update a project deadline, due date, priority, category, weekly hours, next action, or name, return an update_project suggestion card. Do not return an informational deadline warning for a requested project edit.",
    "For update_project cards, projectName must be the existing project to update. Include only the new values in deadline, category, priority, proposedNextAction, weeklyHours, or newProjectName. Leave unused fields empty or 0.",
    "If the user says to confirm a drafted change, remind them they still need to click the apply/update button unless the action card has already been applied. Never say the change is confirmed or completed before apply.",
    "Do not create Google Calendar events.",
    "Do not mark projects done.",
    "Do not delete anything.",
    "Do not suggest destructive overwrites.",
    "Prefer additive weekly plan suggestions for active projects.",
    "Use the work schedule as blocked time. Avoid suggesting weekly project time blocks during work shifts.",
    "Use imported calendar events as commitments and blocked time. Avoid suggesting weekly project time blocks during imported event times.",
    "Use onboarding profile as soft context: students may need study blocks and D2L import, workers may need work-shift-aware planning, organization leaders may need event prep time, and general planners may need broad prioritization.",
    "Do not force onboarding assumptions. Mention them only when they make the answer more useful.",
    "Google Calendar sync is manual and one-way. Never claim you synced blocks, sent events to Google Calendar, or updated Google Calendar.",
    "If the user asks to sync to Google Calendar, explain what is ready and tell them to review the Weekly Plan page and click Sync selected themselves.",
    "Use Google sync context to answer questions about ready blocks, synced blocks, blocks needing start times, blocks needing attention, overnight blocks, and conflicts.",
    "Some weekly time blocks have start times. If a timed weekly block overlaps a saved work shift, return a workload_warning that says it may overlap a saved work shift.",
    "If a timed weekly block overlaps an imported calendar event, return a workload_warning that says it may overlap an imported calendar event.",
    "When suggesting new weekly blocks, prefer evenings, Friday, Saturday, Sunday, or flexible blocks when weekday work shifts make daytime unavailable.",
    "If the user asks to plan the week, find open time, or balance work and school, mention saved work shifts and imported calendar commitments naturally when they exist.",
    "Exact-dated deadlines can be placed on the calendar. Vague deadlines need exact dates and should not be placed on a month grid.",
    "Allowed suggestion types only: new_project, update_project, suggested_scheduled_item, suggested_weekly_block, suggested_next_action, schedule_exception, workload_warning, missing_deadline_warning, unclear_project_warning.",
    "Every suggestion must include id, type, title, description, confidence, rationale, and severity.",
    "For optional fields that do not apply, return an empty string, 0, or an empty array for conflictWarnings.",
    "For new_project cards, include projectName, category, priority, deadline, proposedNextAction, and weeklyHours.",
    "For update_project cards, include projectName and the proposed changed fields.",
    "For suggested_scheduled_item cards, include itemType, title, plannedTask, itemDate, startTime, estimatedHours, location, and conflictWarnings.",
    "For suggested_weekly_block cards, include projectName, day, estimatedHours, and plannedTask. projectName may be an existing project name or a standalone task/appointment title.",
    "For suggested_next_action cards, include projectName and proposedNextAction.",
    "For schedule_exception cards, include exceptionType, exceptionDate, relatedWorkShiftId, originalStartTime, originalEndTime, overrideStartTime, and overrideEndTime.",
    "",
    "Recent conversation:",
    JSON.stringify(recentMessages),
    "",
    `User request: ${prompt}`,
    `Current server date: ${new Date().toISOString().slice(0, 10)}`,
    `User timezone: ${context.timezone}`,
    "",
    "Onboarding profile:",
    JSON.stringify(
      profile
        ? {
            plannerType: profile.plannerType,
            planningGoals: profile.planningGoals,
            desiredIntegrations: profile.desiredIntegrations,
            scheduleIntensity: profile.scheduleIntensity,
            onboardingCompleted: profile.onboardingCompleted,
          }
        : {
            plannerType: context.plannerType,
            planningGoals: [],
            desiredIntegrations: [],
            scheduleIntensity: "Unknown",
            onboardingCompleted: false,
          },
    ),
    "",
    `Active projects: ${context.activeProjectsCount}`,
    `Planned weekly project hours: ${context.plannedWeeklyHours}`,
    `Weekly time blocks: ${context.weeklyBlocksCount}`,
    `Weekly block hours: ${context.totalWeeklyBlockHours}`,
    `Work shifts: ${context.workShiftsCount}`,
    `Work schedule hours: ${context.workScheduleHours}`,
    `Work schedule summary: ${context.workScheduleSummary ?? "None saved"}`,
    `Imported calendar events: ${context.importedEventsCount}`,
    `Imported event conflicts: ${context.importedEventConflictCount}`,
    `Calendar conflicts: ${context.calendarConflictCount}`,
    `Manual sync destination created: ${context.googleSync.syncEnabled}`,
    `Google sync calendar: ${context.googleSync.syncCalendarName ?? "Schedule Builder"}`,
    `Google sync ready blocks: ${context.googleSyncReadyCount}`,
    `Google sync already synced blocks: ${context.googleSyncSyncedCount}`,
    `Google sync needs start time blocks: ${context.googleSyncNeedsTimeCount}`,
    `Google sync needs attention blocks: ${context.googleSyncNeedsAttentionCount}`,
    `Google sync overnight blocks: ${context.googleSyncOvernightCount}`,
    `Exact-dated deadlines: ${context.deadlinesWithDatesCount}`,
    `Deadlines needing dates: ${context.deadlinesNeedingDatesCount}`,
    "",
    "Projects:",
    JSON.stringify(
      context.projects.map((project) => ({
        name: project.name,
        category: project.category,
        priority: project.priority,
        deadline: project.deadline,
        nextAction: project.nextAction,
        weeklyHours: project.weeklyHours,
        completed: project.completed,
      })),
    ),
    "",
    "Weekly time blocks:",
    JSON.stringify(
      context.weeklyPlanBlocks.map((block) => ({
        day: block.day,
        projectName: block.projectName,
        plannedTask: block.plannedTask,
        estimatedHours: block.estimatedHours,
        startTime: block.startTime ?? null,
      })),
    ),
    "",
    "Scheduled tasks and appointments:",
    JSON.stringify(
      context.scheduledItems.map((item) => ({
        itemType: item.itemType,
        title: item.title,
        description: item.description,
        itemDate: item.itemDate,
        startTime: item.startTime ?? null,
        estimatedHours: item.estimatedHours,
        location: item.location,
      })),
    ),
    "",
    "Work shifts:",
    JSON.stringify(
      context.workShifts.map((shift) => ({
        day: shift.day,
        startTime: shift.startTime,
        endTime: shift.endTime,
        location: shift.location,
        notes: shift.notes,
        recurring: shift.recurring,
      })),
    ),
    "",
    "Visible calendar conflicts:",
    JSON.stringify(
      context.calendarConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        workShift: conflict.shiftRangeLabel,
      })),
    ),
    "",
    "Imported calendar events:",
    JSON.stringify(
      context.importedCalendarEvents.map((event) => ({
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        source: event.source,
      })),
    ),
    "",
    "Imported event conflicts:",
    JSON.stringify(
      context.importedEventConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        importedEventTitle: conflict.event.title,
        importedEventTime: conflict.eventRangeLabel,
      })),
    ),
    "",
    "Google Calendar sync context:",
    JSON.stringify({
      syncEnabled: context.googleSync.syncEnabled,
      syncCalendarName: context.googleSync.syncCalendarName,
      currentWeekStart: context.googleSync.currentWeekStart,
      readyBlocks: context.googleSync.readyBlocks,
      syncedBlocks: context.googleSync.syncedBlocks,
      needsTimeBlocks: context.googleSync.needsTimeBlocks,
      needsAttentionBlocks: context.googleSync.needsAttentionBlocks,
      overnightBlocks: context.googleSync.overnightBlocks,
      conflictBlocks: context.googleSync.conflictBlocks,
      removedSyncedEvents: context.googleSync.removedSyncedEvents,
    }),
    "",
    "Normalized schedule timeline for availability checks:",
    JSON.stringify(scheduleAnalysis.normalizedCommitments),
    "",
    "Deterministic open windows this week:",
    JSON.stringify(scheduleAnalysis.openWindows),
    "",
    "All-day schedule notes:",
    JSON.stringify(scheduleAnalysis.allDayItems),
    "",
    "Exact project deadlines:",
    JSON.stringify(context.deadlinesWithDates),
    "",
    "Deadlines needing exact dates:",
    JSON.stringify(context.deadlinesNeedingDates),
  ].join("\n");
}

function createAssistantMessagePrompt(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
  recentMessages: AssistantChatHistoryItem[],
) {
  const scheduleAnalysis = createAssistantScheduleAnalysisSnapshot({
    importedCalendarEvents: context.importedCalendarEvents,
    scheduleExceptions: context.scheduleExceptions,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  });

  return [
    "You are Schedule Builder's conversational planning assistant.",
    "Write only the assistant message text. Do not return JSON.",
    "Be natural, specific, and concise. Aim for 2-5 short sentences.",
    "Pay attention to the latest user message and the recent conversation.",
    "If the user greets you, reply warmly and ask what they want to plan. Do not give a full report.",
    "If the user is vague, ask one helpful follow-up question instead of inventing a full schedule.",
    "If the user asks a normal question, answer it first.",
    "If the user asks for analysis, sync status, or open time, answer directly and do not promise action cards.",
    "Only mention review cards when the user clearly asks to create, add, move, update, schedule, plan, or generate blocks/projects.",
    "For 'find open time' requests, list open windows or likely openings and ask whether the user wants to turn one into a time block.",
    "For questions about tasks or appointments, answer from scheduledItems context and do not create cards unless the user asks to add or schedule something.",
    "If the user asks to add an exact-date task, appointment, reminder, or errand, say you can draft it for review. Never say it was saved.",
    "If work shifts exist, treat them as blocked time and reference them naturally for planning requests.",
    "If imported calendar events exist, treat them as blocked commitments and reference them naturally for planning/open-time requests.",
    "Use onboarding profile as soft context without being pushy. Student means study/class language can help; Professional means work-shift-aware planning can help; Organization leader means prep time and conflicts can help; General planning should stay broad.",
    "If timed weekly blocks overlap work shifts, mention the conflict clearly without moving anything.",
    "If timed weekly blocks overlap imported calendar events, mention the conflict clearly without moving anything.",
    "Google Calendar sync is manual and one-way. Never say you synced, sent, updated, or deleted Google Calendar events.",
    "If the user asks about Google Calendar sync, explain the sync readiness from context and direct them back to the Weekly Plan page to select blocks and click Sync selected.",
    "Mention blocks that need start times, blocks needing attention, overnight blocks, and conflicts when they matter.",
    "Avoid repeating the same opening wording from prior assistant messages.",
    "Never claim anything was saved or changed.",
    "The app can create projects, update next actions, and add weekly blocks only after the user applies a reviewed action card.",
    "The app can create exact-date tasks and appointments only after the user applies a reviewed action card.",
    "The app can update project deadlines, priority, category, weekly hours, next action, and name only after the user applies a reviewed action card.",
    "If the user asks to create or save a project, say you drafted it for review. Do not say you cannot create or save it from here.",
    "If the user asks to confirm a project edit, say the edit is ready to apply in the review card. Do not say it is confirmed, saved, completed, or changed unless the user clicked apply.",
    "Never say you created calendar events.",
    "",
    "Recent conversation:",
    JSON.stringify(recentMessages),
    "",
    `Latest user message: ${prompt}`,
    "",
    "Schedule context:",
    JSON.stringify({
      plannerType: profile?.plannerType ?? context.plannerType,
      timezone: context.timezone,
      activeProjectsCount: context.activeProjectsCount,
      plannedWeeklyHours: context.plannedWeeklyHours,
      weeklyBlocksCount: context.weeklyBlocksCount,
      weeklyBlockHours: context.totalWeeklyBlockHours,
      workShiftsCount: context.workShiftsCount,
      workScheduleHours: context.workScheduleHours,
      workScheduleSummary: context.workScheduleSummary,
      importedEventsCount: context.importedEventsCount,
      importedEventConflictCount: context.importedEventConflictCount,
      calendarConflictCount: context.calendarConflictCount,
      googleSync: context.googleSync,
      googleSyncReadyCount: context.googleSyncReadyCount,
      googleSyncSyncedCount: context.googleSyncSyncedCount,
      googleSyncNeedsTimeCount: context.googleSyncNeedsTimeCount,
      googleSyncNeedsAttentionCount: context.googleSyncNeedsAttentionCount,
      googleSyncOvernightCount: context.googleSyncOvernightCount,
      deadlinesWithDates: context.deadlinesWithDates,
      deadlinesNeedingDates: context.deadlinesNeedingDates,
      projects: context.projects.map((project) => ({
        name: project.name,
        category: project.category,
        priority: project.priority,
        deadline: project.deadline,
        nextAction: project.nextAction,
        weeklyHours: project.weeklyHours,
        completed: project.completed,
      })),
      weeklyPlanBlocks: context.weeklyPlanBlocks.map((block) => ({
        day: block.day,
        projectName: block.projectName,
        plannedTask: block.plannedTask,
        estimatedHours: block.estimatedHours,
        startTime: block.startTime ?? null,
      })),
      scheduledItems: context.scheduledItems.map((item) => ({
        itemType: item.itemType,
        title: item.title,
        description: item.description,
        itemDate: item.itemDate,
        startTime: item.startTime ?? null,
        estimatedHours: item.estimatedHours,
        location: item.location,
      })),
      workShifts: context.workShifts.map((shift) => ({
        day: shift.day,
        startTime: shift.startTime,
        endTime: shift.endTime,
        recurring: shift.recurring,
      })),
      importedCalendarEvents: context.importedCalendarEvents.map((event) => ({
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        source: event.source,
      })),
      calendarConflicts: context.calendarConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        workShift: conflict.shiftRangeLabel,
      })),
      importedEventConflicts: context.importedEventConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        importedEventTitle: conflict.event.title,
        importedEventTime: conflict.eventRangeLabel,
      })),
      normalizedScheduleTimeline: scheduleAnalysis.normalizedCommitments,
      deterministicOpenWindows: scheduleAnalysis.openWindows,
      allDayScheduleNotes: scheduleAnalysis.allDayItems,
    }),
  ].join("\n");
}

function preserveFallbackCriticalSuggestions(
  aiSuggestions: AssistantPlanReviewResponse["suggestions"],
  fallbackSuggestions: AssistantPlanReviewResponse["suggestions"],
) {
  const fallbackCriticalSuggestions = fallbackSuggestions.filter(
    (suggestion) =>
      suggestion.type === "update_project" ||
      suggestion.type === "suggested_scheduled_item",
  );

  if (fallbackCriticalSuggestions.length === 0) {
    return aiSuggestions;
  }

  const missingFallbackSuggestions = fallbackCriticalSuggestions.filter(
    (fallbackSuggestion) =>
      !aiSuggestions.some((suggestion) => suggestion.type === fallbackSuggestion.type),
  );

  return missingFallbackSuggestions.length > 0
    ? filterAssistantSuggestions([...missingFallbackSuggestions, ...aiSuggestions])
    : aiSuggestions;
}

async function createOpenAiSuggestions(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
  recentMessages: AssistantChatHistoryItem[] = [],
): Promise<Pick<AssistantPlanReviewResponse, "message" | "suggestions">> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const client = getOpenAiClient(apiKey);
  const response = await client.responses.create({
    model: getAssistantModel(),
    instructions:
      "You generate safe, structured planning suggestions for a project scheduling app. Output JSON only and never suggest destructive actions.",
    input: createAiPrompt(prompt, context, profile, recentMessages),
    max_output_tokens: 1400,
    text: {
      format: {
        type: "json_schema",
        name: "schedule_builder_plan_review",
        schema: assistantResponseJsonSchema,
        strict: true,
      },
    },
  });
  const outputText = response.output_text;

  if (!outputText) {
    throw new Error("OpenAI returned an empty response.");
  }

  const parsed = JSON.parse(outputText) as {
    message?: unknown;
    suggestions?: unknown;
    turn?: {
      actionCardReady?: unknown;
      responseText?: unknown;
    };
  };
  const actionCardReady = parsed.turn?.actionCardReady === true;
  const suggestions = addScheduledItemConflictWarningsToSuggestions(
    normalizeAssistantSuggestions(
      actionCardReady ? parsed.suggestions : [],
      assistantPlanningSuggestionTypes as readonly AssistantSuggestionType[],
    ),
    context,
  );
  const filteredSuggestions = filterAssistantSuggestions([
    ...createCalendarConflictSuggestions(context),
    ...suggestions,
  ]);

  return {
    message:
      typeof parsed.turn?.responseText === "string" &&
      parsed.turn.responseText.trim()
        ? parsed.turn.responseText.trim()
        : typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : filteredSuggestions.length > 0
          ? "Here’s the focused version I’d start with. Review the suggestions and only apply the ones that fit."
          : "I can help with that. Tell me what feels most urgent or what kind of plan you want to build, and I’ll keep the next step simple.",
    suggestions: filteredSuggestions,
  };
}

async function streamOpenAiAssistantMessage({
  context,
  profile,
  prompt,
  recentMessages,
  send,
}: {
  context: AssistantPlanningContext;
  profile: PlannerProfile | null;
  prompt: string;
  recentMessages: AssistantChatHistoryItem[];
  send: (event: AssistantStreamEvent) => void;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const client = getOpenAiClient(apiKey);
  const stream = await client.responses.create({
    model: getAssistantModel(),
    instructions:
      "You are a friendly planning coach inside Schedule Builder. Stream plain conversational text only.",
    input: createAssistantMessagePrompt(prompt, context, profile, recentMessages),
    max_output_tokens: 500,
    stream: true,
  });
  let message = "";

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      message += event.delta;
      send({ type: "message_delta", delta: event.delta });
    }

    if (event.type === "response.failed") {
      throw new Error(
        event.response.error?.message ?? "OpenAI could not finish the response.",
      );
    }

    if (event.type === "response.incomplete") {
      throw new Error("OpenAI response was incomplete.");
    }
  }

  return message.trim();
}

export async function GET(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { context, warning } = await loadPlanningContext(
    authResult.supabase,
    authResult.userId,
  );
  const response = createContextOnlyAssistantResponse(context);
  const nextMessage = warning
    ? `${response.message} ${warning}`
    : response.message;

  return NextResponse.json({
    ...response,
    assistantMessage: nextMessage,
    message: nextMessage,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = (await request.json().catch(() => ({}))) as {
    activeSchedulingContext?: unknown;
    prompt?: unknown;
    recentMessages?: unknown;
    threadId?: unknown;
    timezone?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const recentMessages = normalizeRecentMessages(body.recentMessages);
  const timezone = normalizeTimezone(body.timezone);
  const activeSchedulingContext = normalizeAssistantSchedulingContext(
    body.activeSchedulingContext,
  );
  const threadId =
    typeof body.threadId === "string" && body.threadId.length <= 80
      ? body.threadId
      : null;

  if (!prompt) {
    return NextResponse.json(
      { error: "Describe what you want help planning." },
      { status: 400 },
    );
  }

  if (prompt.length > maxPromptLength) {
    return NextResponse.json(
      { error: `Keep the prompt under ${maxPromptLength} characters.` },
      { status: 400 },
    );
  }

  const { context, profile, warning } = await loadPlanningContext(
    authResult.supabase,
    authResult.userId,
    timezone,
  );
  const fallbackResponse = createFallbackAssistantResponse(
    context,
    prompt,
    recentMessages,
  );
  const fallbackMessage = warning
    ? `${fallbackResponse.message} ${warning}`
    : fallbackResponse.message;
  const fallbackWithWarning: AssistantPlanReviewResponse = {
    ...fallbackResponse,
    assistantMessage: fallbackMessage,
    message: fallbackMessage,
  };

  const scheduleInput = {
    importedCalendarEvents: context.importedCalendarEvents,
    projects: context.projects,
    scheduleExceptions: context.scheduleExceptions,
    scheduledItems: context.scheduledItems,
    timezone: context.timezone,
    weekStartDate: context.googleSync.currentWeekStart,
    weeklyPlanBlocks: context.weeklyPlanBlocks,
    workShifts: context.workShifts,
  };
  const schedulingTurn = advanceAssistantSchedulingConversation({
    activeContext: activeSchedulingContext,
    input: scheduleInput,
    loadWarning: warning,
    prompt,
    recentMessages,
  });

  if (schedulingTurn) {
    const proposal = schedulingTurn.proposal
      ? { ...schedulingTurn.proposal, sourceConversationId: threadId }
      : null;
    const schedulingContext = proposal
      ? { ...schedulingTurn.context, pendingProposal: proposal }
      : schedulingTurn.context;
    const selectedWindow = proposal
      ? schedulingTurn.context.candidateWindows.find(
          (window) =>
            window.date === proposal.date &&
            `${String(Math.floor(window.startMinutes / 60)).padStart(2, "0")}:${String(
              window.startMinutes % 60,
            ).padStart(2, "0")}` === proposal.startTime,
        )
      : null;
    const timeBlockSuggestions =
      proposal?.status === "ready_for_review" &&
      proposal.durationMinutes &&
      selectedWindow
        ? [
            {
              id: `time-block-${proposal.date}-${proposal.startTime}`,
              type: "suggested_weekly_block" as const,
              title: proposal.title,
              description: `${new Intl.DateTimeFormat("en-US", {
                month: "long",
                day: "numeric",
                weekday: "long",
                year: "numeric",
              }).format(new Date(`${proposal.date}T00:00:00`))} from ${
                selectedWindow.startLabel
              } for ${proposal.durationMinutes / 60} hour${
                proposal.durationMinutes === 60 ? "" : "s"
              }.`,
              confidence: 0.98,
              summary: proposal.details,
              rationale:
                "This uses the exact opening and duration you confirmed in this conversation.",
              severity: "important" as const,
              projectName: proposal.title,
              plannedTask: proposal.details,
              day: selectedWindow.day,
              itemDate: proposal.date,
              startTime: proposal.startTime,
              estimatedHours: proposal.durationMinutes / 60,
              conflictWarnings: [] as string[],
            },
          ]
        : [];
    const workException = schedulingContext.pendingWorkException;
    const suggestions = [
      ...(workException && timeBlockSuggestions.length > 0
        ? [
            {
              id: `schedule-exception-${workException.date}-${workException.relatedWorkShiftId}`,
              type: "schedule_exception" as const,
              title: "Update today’s work shift",
              description: `End work at ${workException.overrideEndTime} on ${workException.date}. This applies to this date only.`,
              confidence: 1,
              summary: "Create a one-day exception without changing the recurring shift.",
              rationale:
                "The later time block depends on today’s work shift ending early.",
              severity: "important" as const,
              exceptionDate: workException.date,
              exceptionType: workException.exceptionType,
              originalEndTime: workException.originalEndTime,
              originalStartTime: workException.originalStartTime,
              overrideEndTime: workException.overrideEndTime,
              overrideStartTime: workException.overrideStartTime,
              relatedWorkShiftId: workException.relatedWorkShiftId,
              conflictWarnings: [] as string[],
            },
          ]
        : []),
      ...timeBlockSuggestions,
    ];
    const response: AssistantPlanReviewResponse = {
      actions: suggestions,
      assistantMessage: schedulingTurn.message,
      context: fallbackWithWarning.context,
      message: schedulingTurn.message,
      schedulingContext,
      source: "fallback",
      suggestions,
    };

    return createNdjsonStream(async (send) => {
      await streamFallbackMessage(response.message, send);
      send({ type: "final", response });
    });
  }

  return createNdjsonStream(async (send) => {
    if (
      isGreetingPrompt(prompt) ||
      isVaguePrompt(prompt) ||
      (fallbackWithWarning.suggestions.length > 0 &&
        !shouldGenerateAssistantActionCards(prompt)) ||
      (hasDeterministicScheduleQuestionIntent(prompt) &&
        !shouldGenerateAssistantActionCards(prompt)) ||
      !process.env.OPENAI_API_KEY
    ) {
      await streamFallbackMessage(fallbackWithWarning.message, send);
      send({ type: "final", response: fallbackWithWarning });
      return;
    }

    let streamedMessage = "";

    try {
      streamedMessage = await streamOpenAiAssistantMessage({
        context,
        profile,
        prompt,
        recentMessages,
        send,
      });
    } catch (error) {
      const fallbackMessage = `${fallbackWithWarning.message} I had trouble getting the full assistant response, so I used a simpler planning check for now. ${getErrorMessage(error)}`;
      const fallbackWithError: AssistantPlanReviewResponse = {
        ...fallbackWithWarning,
        assistantMessage: fallbackMessage,
        message: fallbackMessage,
      };

      await streamFallbackMessage(fallbackMessage, send);
      send({ type: "final", response: fallbackWithError });
      return;
    }

    const shouldGenerateSuggestions = shouldGenerateAssistantActionCards(prompt);
    let suggestions: AssistantPlanReviewResponse["suggestions"] = [];
    let finalMessage = streamedMessage;

    if (shouldGenerateSuggestions) {
      try {
        const aiResponse = await createOpenAiSuggestions(
          prompt,
          context,
          profile,
          recentMessages,
        );
        suggestions = preserveFallbackCriticalSuggestions(
          aiResponse.suggestions,
          fallbackResponse.suggestions,
        );
        finalMessage = streamedMessage || aiResponse.message;
      } catch (error) {
        const note =
          " I couldn’t prepare action cards this time, but you can still use the plan above manually.";
        finalMessage = `${streamedMessage}${note}`;
        send({ type: "message_delta", delta: note });
      }
    }

    const messageWithWarning = warning ? `${finalMessage} ${warning}` : finalMessage;

    if (warning) {
      send({ type: "message_delta", delta: ` ${warning}` });
    }

    send({
      type: "final",
      response: {
        actions: suggestions,
        assistantMessage: messageWithWarning,
        context: fallbackResponse.context,
        message: messageWithWarning,
        source: "ai",
        suggestions,
      },
    });
  });
}
