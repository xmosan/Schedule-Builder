import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  assistantPlanningSuggestionTypes,
  createCalendarConflictSuggestions,
  createAssistantPlanningContext,
  createContextOnlyAssistantResponse,
  createFallbackAssistantResponse,
  filterAssistantSuggestions,
  hasPlanningIntent,
  isGreetingPrompt,
  isVaguePrompt,
  normalizeAssistantSuggestions,
  type AssistantPlanReviewResponse,
  type AssistantPlanningContext,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import type { PlannerProfile, PlannerType } from "@/lib/onboarding";
import {
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
  fetchWorkShiftsForUser,
  fetchWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";

export const dynamic = "force-dynamic";

const maxPromptLength = 2000;
const maxRecentMessages = 8;
const maxRecentMessageLength = 1200;
const defaultOpenAiModel = "gpt-4o-mini";
let openAiClient: OpenAI | null = null;

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
          plannedTask: { type: "string" },
          proposedNextAction: { type: "string" },
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
          "day",
          "estimatedHours",
          "plannedTask",
          "proposedNextAction",
          "weeklyHours",
        ],
      },
    },
  },
  required: ["message", "suggestions"],
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

async function loadPlanningContext(supabase: SupabaseClient, userId: string) {
  const [profileResult, projectsResult, weeklyPlanResult, workShiftsResult] = await Promise.all([
    fetchPlannerProfileForUser(supabase, userId),
    fetchProjectsForUser(supabase, userId),
    fetchWeeklyPlanBlocksForUser(supabase, userId),
    fetchWorkShiftsForUser(supabase, userId),
  ]);
  const loadErrors = [
    profileResult.error,
    projectsResult.error,
    weeklyPlanResult.error,
    workShiftsResult.error,
  ].filter(Boolean);

  const profile = profileResult.error == null ? profileResult.data : null;
  const plannerType: PlannerType | "Unknown" = profile
    ? profile.plannerType
    : "Unknown";

  return {
    context: createAssistantPlanningContext(
      projectsResult.error == null ? projectsResult.data : [],
      weeklyPlanResult.error == null ? weeklyPlanResult.data : [],
      plannerType,
      workShiftsResult.error == null ? workShiftsResult.data : [],
    ),
    profile,
    warning:
      loadErrors.length > 0
        ? `Some scheduler data could not load from Supabase, so suggestions may be limited. ${loadErrors
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
  return [
    "You are Schedule Builder's friendly planning assistant.",
    "Return JSON only matching the provided schema.",
    "Return a short, natural plain-language message first, then only the strongest reviewable planning suggestions.",
    "Sound like a helpful planning coach, not a system report.",
    "Do not repeat the same opening phrase every time.",
    "If the user is only greeting you, reply conversationally and return zero suggestions.",
    "If the user request is vague, ask one useful follow-up question and return zero or one suggestion.",
    "If the user asks a general question, answer briefly first before proposing schedule changes.",
    "Only generate suggestion cards when the user is asking for planning help.",
    "Limit suggestions to 2-4 high-quality items by default.",
    "Return at most 2 warning-style suggestions.",
    "Avoid duplicate or near-duplicate cards.",
    "Separate insights in the message from actions in the suggestions.",
    "Do not claim anything was saved.",
    "The app can create new projects, update project next actions, and create weekly blocks only after the user applies a reviewed action card.",
    "The app can also update existing project fields after review: name, category, priority, deadline, next action, and weekly hours.",
    "If the user asks you to create, add, draft, or save a project, return a new_project suggestion card. Do not say you cannot create or save it; say you drafted it for review and the user can apply it.",
    "If the user asks to change, edit, move, confirm, or update a project deadline, due date, priority, category, weekly hours, next action, or name, return an update_project suggestion card. Do not return an informational deadline warning for a requested project edit.",
    "For update_project cards, projectName must be the existing project to update. Include only the new values in deadline, category, priority, proposedNextAction, weeklyHours, or newProjectName. Leave unused fields empty or 0.",
    "If the user says to confirm a drafted change, remind them they still need to click the apply/update button unless the action card has already been applied. Never say the change is confirmed or completed before apply.",
    "Do not create calendar events.",
    "Do not mark projects done.",
    "Do not delete anything.",
    "Do not suggest destructive overwrites.",
    "Prefer additive weekly plan suggestions for active projects.",
    "Use the work schedule as unavailable time. Avoid suggesting weekly project blocks during work shifts.",
    "Some weekly plan blocks have start times. If a timed weekly block overlaps a saved work shift, return a workload_warning that says it may overlap a saved work shift.",
    "When suggesting new weekly blocks, prefer evenings, Friday, Saturday, Sunday, or flexible blocks when weekday work shifts make daytime unavailable.",
    "If the user asks to plan the week, find open time, or balance work and school, mention the saved work schedule naturally when it exists.",
    "Exact-dated deadlines can be placed on the calendar. Vague deadlines need exact dates and should not be placed on a month grid.",
    "Allowed suggestion types only: new_project, update_project, suggested_weekly_block, suggested_next_action, workload_warning, missing_deadline_warning, unclear_project_warning.",
    "Every suggestion must include id, type, title, description, confidence, rationale, and severity.",
    "For optional fields that do not apply, return an empty string or 0.",
    "For new_project cards, include projectName, category, priority, deadline, proposedNextAction, and weeklyHours.",
    "For update_project cards, include projectName and the proposed changed fields.",
    "For suggested_weekly_block cards, include projectName, day, estimatedHours, and plannedTask.",
    "For suggested_next_action cards, include projectName and proposedNextAction.",
    "",
    "Recent conversation:",
    JSON.stringify(recentMessages),
    "",
    `User request: ${prompt}`,
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
    `Weekly plan blocks: ${context.weeklyBlocksCount}`,
    `Weekly block hours: ${context.totalWeeklyBlockHours}`,
    `Work shifts: ${context.workShiftsCount}`,
    `Work schedule hours: ${context.workScheduleHours}`,
    `Work schedule summary: ${context.workScheduleSummary ?? "None saved"}`,
    `Calendar conflicts: ${context.calendarConflictCount}`,
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
    "Weekly plan blocks:",
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
  return [
    "You are Schedule Builder's conversational planning assistant.",
    "Write only the assistant message text. Do not return JSON.",
    "Be natural, specific, and concise. Aim for 2-5 short sentences.",
    "Pay attention to the latest user message and the recent conversation.",
    "If the user greets you, reply warmly and ask what they want to plan. Do not give a full report.",
    "If the user is vague, ask one helpful follow-up question instead of inventing a full schedule.",
    "If the user asks a normal question, answer it first.",
    "If the user asks for planning help, give a practical summary before separate action cards are shown by the app.",
    "If work shifts exist, treat them as unavailable and reference them naturally for planning requests.",
    "If timed weekly blocks overlap work shifts, mention the conflict clearly without moving anything.",
    "Avoid repeating the same opening wording from prior assistant messages.",
    "Never claim anything was saved or changed.",
    "The app can create projects, update next actions, and add weekly blocks only after the user applies a reviewed action card.",
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
      activeProjectsCount: context.activeProjectsCount,
      plannedWeeklyHours: context.plannedWeeklyHours,
      weeklyBlocksCount: context.weeklyBlocksCount,
      weeklyBlockHours: context.totalWeeklyBlockHours,
      workShiftsCount: context.workShiftsCount,
      workScheduleHours: context.workScheduleHours,
      workScheduleSummary: context.workScheduleSummary,
      calendarConflictCount: context.calendarConflictCount,
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
      workShifts: context.workShifts.map((shift) => ({
        day: shift.day,
        startTime: shift.startTime,
        endTime: shift.endTime,
        recurring: shift.recurring,
      })),
      calendarConflicts: context.calendarConflicts.map((conflict) => ({
        day: conflict.day,
        projectName: conflict.block.projectName,
        plannedTask: conflict.block.plannedTask,
        blockStart: conflict.blockStartLabel,
        blockEnd: conflict.blockEndLabel,
        workShift: conflict.shiftRangeLabel,
      })),
    }),
  ].join("\n");
}

function preserveFallbackProjectEdits(
  aiSuggestions: AssistantPlanReviewResponse["suggestions"],
  fallbackSuggestions: AssistantPlanReviewResponse["suggestions"],
) {
  const fallbackProjectEdits = fallbackSuggestions.filter(
    (suggestion) => suggestion.type === "update_project",
  );

  if (fallbackProjectEdits.length === 0) {
    return aiSuggestions;
  }

  const hasProjectEdit = aiSuggestions.some(
    (suggestion) => suggestion.type === "update_project",
  );

  if (hasProjectEdit) {
    return aiSuggestions;
  }

  return filterAssistantSuggestions([
    ...fallbackProjectEdits,
    ...aiSuggestions,
  ]);
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
    model: process.env.AI_MODEL || defaultOpenAiModel,
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
  };
  const suggestions = normalizeAssistantSuggestions(
    parsed.suggestions,
    assistantPlanningSuggestionTypes as readonly AssistantSuggestionType[],
  );
  const filteredSuggestions = filterAssistantSuggestions([
    ...createCalendarConflictSuggestions(context),
    ...suggestions,
  ]);

  return {
    message:
      typeof parsed.message === "string" && parsed.message.trim()
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
    model: process.env.AI_MODEL || defaultOpenAiModel,
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
    prompt?: unknown;
    recentMessages?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const recentMessages = normalizeRecentMessages(body.recentMessages);

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

  return createNdjsonStream(async (send) => {
    if (
      isGreetingPrompt(prompt) ||
      isVaguePrompt(prompt) ||
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

    const shouldGenerateSuggestions = hasPlanningIntent(prompt);
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
        suggestions = preserveFallbackProjectEdits(
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
