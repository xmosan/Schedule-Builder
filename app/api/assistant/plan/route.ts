import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  assistantPlanningSuggestionTypes,
  createAssistantPlanningContext,
  createContextOnlyAssistantResponse,
  createFallbackAssistantResponse,
  filterAssistantSuggestions,
  hasPlanningIntent,
  isGreetingPrompt,
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
const defaultOpenAiModel = "gpt-4o-mini";
let openAiClient: OpenAI | null = null;

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
          "day",
          "estimatedHours",
          "plannedTask",
          "proposedNextAction",
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
    "Do not create calendar events.",
    "Do not mark projects done.",
    "Do not delete anything.",
    "Do not suggest destructive overwrites.",
    "Prefer additive weekly plan suggestions for active projects.",
    "Use the work schedule as unavailable time. Avoid suggesting weekly project blocks during work shifts.",
    "Weekly plan blocks do not have exact start times yet. Prefer lighter non-work days when possible, and if a block lands on a work day, explain that it should happen outside work hours.",
    "Allowed suggestion types only: suggested_weekly_block, suggested_next_action, workload_warning, missing_deadline_warning, unclear_project_warning.",
    "Every suggestion must include id, type, title, description, confidence, rationale, and severity.",
    "For optional fields that do not apply, return an empty string or 0.",
    "For suggested_weekly_block cards, include projectName, day, estimatedHours, and plannedTask.",
    "For suggested_next_action cards, include projectName and proposedNextAction.",
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
  ].join("\n");
}

async function createOpenAiSuggestions(
  prompt: string,
  context: AssistantPlanningContext,
  profile: PlannerProfile | null,
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
    input: createAiPrompt(prompt, context, profile),
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
  const filteredSuggestions = filterAssistantSuggestions(suggestions);

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

  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

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
  const fallbackResponse = createFallbackAssistantResponse(context, prompt);
  const fallbackMessage = warning
    ? `${fallbackResponse.message} ${warning}`
    : fallbackResponse.message;
  const fallbackWithWarning: AssistantPlanReviewResponse = {
    ...fallbackResponse,
    assistantMessage: fallbackMessage,
    message: fallbackMessage,
  };

  if (isGreetingPrompt(prompt) || !hasPlanningIntent(prompt)) {
    return NextResponse.json(fallbackWithWarning);
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(fallbackWithWarning);
  }

  try {
    const aiResponse = await createOpenAiSuggestions(prompt, context, profile);

    const aiMessage = warning ? `${aiResponse.message} ${warning}` : aiResponse.message;

    return NextResponse.json({
      actions: aiResponse.suggestions,
      assistantMessage: aiMessage,
      context: fallbackResponse.context,
      message: aiMessage,
      source: "ai",
      suggestions: aiResponse.suggestions,
    } satisfies AssistantPlanReviewResponse);
  } catch (error) {
    const fallbackMessage = `${fallbackWithWarning.message} I had trouble getting the full assistant response, so I used a simpler planning check for now. ${getErrorMessage(error)}`;

    return NextResponse.json({
      ...fallbackWithWarning,
      assistantMessage: fallbackMessage,
      message: fallbackMessage,
    });
  }
}
