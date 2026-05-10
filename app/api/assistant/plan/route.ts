import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  assistantPlanningSuggestionTypes,
  createAssistantPlanningContext,
  createContextOnlyAssistantResponse,
  createFallbackAssistantResponse,
  normalizeAssistantSuggestions,
  type AssistantPlanReviewResponse,
  type AssistantPlanningContext,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import type { PlannerProfile, PlannerType } from "@/lib/onboarding";
import {
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
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
        "A concise note explaining that suggestions are reviewable and nothing was saved automatically.",
    },
    suggestions: {
      type: "array",
      maxItems: 8,
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
      { error: "Sign in before using AI Plan Review." },
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
  const [profileResult, projectsResult, weeklyPlanResult] = await Promise.all([
    fetchPlannerProfileForUser(supabase, userId),
    fetchProjectsForUser(supabase, userId),
    fetchWeeklyPlanBlocksForUser(supabase, userId),
  ]);
  const loadErrors = [
    profileResult.error,
    projectsResult.error,
    weeklyPlanResult.error,
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
    "You are Schedule Builder's AI Plan Review assistant.",
    "Return JSON only matching the provided schema.",
    "Return only reviewable planning suggestions. Do not claim anything was saved.",
    "Do not create calendar events.",
    "Do not mark projects done.",
    "Do not delete anything.",
    "Do not suggest destructive overwrites.",
    "Prefer additive weekly plan suggestions for active projects.",
    "Allowed suggestion types only: suggested_weekly_block, suggested_next_action, workload_warning, missing_deadline_warning, unclear_project_warning.",
    "Every suggestion must include id, type, title, description, confidence, rationale, and severity.",
    "For optional fields that do not apply, return an empty string or 0.",
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

  if (suggestions.length === 0) {
    throw new Error("OpenAI returned no valid safe suggestions.");
  }

  return {
    message:
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : "Generated safe review suggestions. Nothing has been saved automatically.",
    suggestions,
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

  return NextResponse.json({
    ...response,
    message: warning ? `${response.message} ${warning}` : response.message,
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
  const fallbackWithWarning: AssistantPlanReviewResponse = {
    ...fallbackResponse,
    message: warning
      ? `${fallbackResponse.message} ${warning}`
      : fallbackResponse.message,
  };

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(fallbackWithWarning);
  }

  try {
    const aiResponse = await createOpenAiSuggestions(prompt, context, profile);

    return NextResponse.json({
      context: fallbackResponse.context,
      message: warning ? `${aiResponse.message} ${warning}` : aiResponse.message,
      source: "ai",
      suggestions: aiResponse.suggestions,
    } satisfies AssistantPlanReviewResponse);
  } catch (error) {
    return NextResponse.json({
      ...fallbackWithWarning,
      message: `${fallbackWithWarning.message} OpenAI was unavailable or returned invalid output, so rule-based fallback suggestions were used. ${getErrorMessage(error)}`,
    });
  }
}
