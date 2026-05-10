import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  createAssistantPlanningContext,
  createContextOnlyAssistantResponse,
  createFallbackAssistantResponse,
  normalizeAssistantSuggestions,
  type AssistantPlanReviewResponse,
  type AssistantPlanningContext,
} from "@/lib/assistant";
import type { PlannerType } from "@/lib/onboarding";
import {
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
  fetchWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";

export const dynamic = "force-dynamic";

const maxPromptLength = 2000;
const defaultOpenAiModel = "gpt-4o-mini";

const assistantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: {
      type: "string",
      description:
        "A concise note explaining that suggestions are review-only and nothing was saved.",
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
            enum: [
              "suggested_weekly_block",
              "suggested_next_action",
              "workload_warning",
              "missing_deadline_warning",
              "unclear_project_warning",
            ],
          },
          title: { type: "string" },
          summary: { type: "string" },
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
          "summary",
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

  const plannerType: PlannerType | "Unknown" =
    profileResult.error == null && profileResult.data
      ? profileResult.data.plannerType
      : "Unknown";

  return {
    context: createAssistantPlanningContext(
      projectsResult.error == null ? projectsResult.data : [],
      weeklyPlanResult.error == null ? weeklyPlanResult.data : [],
      plannerType,
    ),
    warning:
      loadErrors.length > 0
        ? `Some scheduler data could not load from Supabase, so suggestions may be limited. ${loadErrors
            .map(getErrorMessage)
            .join(" ")}`
        : null,
  };
}

function extractOpenAiOutputText(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const response = value as {
    output?: Array<{
      content?: Array<{ text?: unknown; type?: unknown }>;
    }>;
    output_text?: unknown;
  };

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const textParts =
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => typeof text === "string") ?? [];

  return textParts.length > 0 ? textParts.join("") : null;
}

function createAiPrompt(prompt: string, context: AssistantPlanningContext) {
  return [
    "You are Schedule Builder's AI Plan Review assistant.",
    "Return only reviewable suggestions. Do not claim anything was saved.",
    "Do not suggest direct calendar edits, OAuth actions, or destructive overwrites.",
    "Prefer practical suggestions that use existing projects and weekly plan blocks.",
    "Suggestion types allowed: suggested_weekly_block, suggested_next_action, workload_warning, missing_deadline_warning, unclear_project_warning.",
    "For optional fields that do not apply, return an empty string or 0.",
    "",
    `User request: ${prompt}`,
    "",
    `Planner type: ${context.plannerType}`,
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
): Promise<Pick<AssistantPlanReviewResponse, "message" | "suggestions">> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || defaultOpenAiModel,
      input: [
        {
          role: "system",
          content:
            "You generate safe, structured planning suggestions for a project scheduling app. Output JSON matching the provided schema.",
        },
        {
          role: "user",
          content: createAiPrompt(prompt, context),
        },
      ],
      max_output_tokens: 1400,
      text: {
        format: {
          type: "json_schema",
          name: "schedule_builder_plan_review",
          schema: assistantResponseJsonSchema,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`AI provider request failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const outputText = extractOpenAiOutputText(payload);

  if (!outputText) {
    throw new Error("AI provider returned an empty response.");
  }

  const parsed = JSON.parse(outputText) as {
    message?: unknown;
    suggestions?: unknown;
  };
  const suggestions = normalizeAssistantSuggestions(parsed.suggestions);

  if (suggestions.length === 0) {
    throw new Error("AI provider returned no valid suggestions.");
  }

  return {
    message:
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : "Generated safe review suggestions. Nothing has been saved or changed.",
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

  const { context, warning } = await loadPlanningContext(
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
    const aiResponse = await createOpenAiSuggestions(prompt, context);

    return NextResponse.json({
      context: fallbackResponse.context,
      message: warning ? `${aiResponse.message} ${warning}` : aiResponse.message,
      source: "ai",
      suggestions: aiResponse.suggestions,
    } satisfies AssistantPlanReviewResponse);
  } catch (error) {
    return NextResponse.json({
      ...fallbackWithWarning,
      message: `${fallbackWithWarning.message} AI provider was unavailable, so rule-based fallback suggestions were used. ${getErrorMessage(error)}`,
    });
  }
}
