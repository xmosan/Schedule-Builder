import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  priorityLevels,
  projectCategories,
  type ProjectCategory,
  type ProjectDraft,
  type ProjectPriority,
} from "@/lib/projects";

export const dynamic = "force-dynamic";

const defaultOpenAiModel = "gpt-4o-mini";
const maxDescriptionLength = 1200;
let openAiClient: OpenAI | null = null;

const projectDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    nextAction: { type: "string" },
    deadline: { type: "string" },
    category: { type: "string", enum: projectCategories },
    priority: { type: "string", enum: priorityLevels },
    weeklyHours: { type: "number", minimum: 0 },
  },
  required: [
    "name",
    "nextAction",
    "deadline",
    "category",
    "priority",
    "weeklyHours",
  ],
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

  return "Project draft is unavailable right now.";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function getOpenAiClient(apiKey: string) {
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey });
  }

  return openAiClient;
}

async function verifySignedInUser(request: NextRequest) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in before creating an assistant draft." },
      { status: 401 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return NextResponse.json(
      { error: "Supabase environment variables are not configured." },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
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
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? "Session could not be verified." },
      { status: 401 },
    );
  }

  return null;
}

function isProjectCategory(value: unknown): value is ProjectCategory {
  return (
    typeof value === "string" &&
    projectCategories.includes(value as ProjectCategory)
  );
}

function isProjectPriority(value: unknown): value is ProjectPriority {
  return (
    typeof value === "string" &&
    priorityLevels.includes(value as ProjectPriority)
  );
}

function trimField(value: unknown, fallback = "", maxLength = 90) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : fallback;
}

function getFallbackCategory(description: string): ProjectCategory {
  if (/\b(content|business|client|launch|marketing|product|portfolio|startup)\b/i.test(description)) {
    return "Growth";
  }

  if (/\b(admin|maintenance|meeting|operations|follow-up|follow up|organize)\b/i.test(description)) {
    return "Maintenance";
  }

  return "Must-do";
}

function getFallbackPriority(description: string): ProjectPriority {
  if (/\b(urgent|exam|deadline|due|important|high priority|this week)\b/i.test(description)) {
    return "High";
  }

  if (/\b(low priority|someday|later|optional)\b/i.test(description)) {
    return "Low";
  }

  return "Medium";
}

function createTitleFromDescription(description: string) {
  const cleaned = description
    .replace(/^(i need to|i want to|help me|plan|create|work on)\s+/i, "")
    .split(/[.!?\n]/)[0]
    ?.trim();

  if (!cleaned) {
    return "New Project";
  }

  return cleaned
    .replace(/\s+/g, " ")
    .slice(0, 64)
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function createFallbackDraft(description: string): ProjectDraft {
  return {
    name: createTitleFromDescription(description),
    category: getFallbackCategory(description),
    priority: getFallbackPriority(description),
    deadline: /\b(this week|tomorrow|today|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i.exec(description)?.[0] ?? "",
    nextAction: "Define the next concrete deliverable and schedule the first work block",
    weeklyHours: "2",
  };
}

function normalizeProjectDraft(value: unknown, description: string): ProjectDraft {
  const fallback = createFallbackDraft(description);

  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const candidate = value as Record<string, unknown>;
  const weeklyHours =
    typeof candidate.weeklyHours === "number"
      ? candidate.weeklyHours
      : Number(candidate.weeklyHours);
  const normalizedHours =
    Number.isFinite(weeklyHours) && weeklyHours >= 0
      ? Math.min(Math.round(weeklyHours * 4) / 4, 80)
      : Number(fallback.weeklyHours);

  return {
    name: trimField(candidate.name, fallback.name) || fallback.name,
    category: isProjectCategory(candidate.category)
      ? candidate.category
      : fallback.category,
    priority: isProjectPriority(candidate.priority)
      ? candidate.priority
      : fallback.priority,
    deadline: trimField(candidate.deadline, fallback.deadline),
    nextAction:
      trimField(candidate.nextAction, fallback.nextAction, 140) ||
      fallback.nextAction,
    weeklyHours: String(normalizedHours),
  };
}

function createProjectDraftPrompt(description: string) {
  return [
    "You draft one project for Schedule Builder.",
    "Return JSON only matching the schema.",
    "Do not save anything. The user will review before saving.",
    "Keep the project practical, concise, and easy to schedule.",
    "The nextAction must be a concrete next step, not a vague goal.",
    "Category must be one of: Must-do, Growth, Maintenance.",
    "Priority must be one of: High, Medium, Low.",
    "weeklyHours must be a realistic non-negative number for this week.",
    "If no deadline is mentioned, return an empty deadline string.",
    "",
    `User description: ${description}`,
  ].join("\n");
}

async function createOpenAiProjectDraft(description: string) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const client = getOpenAiClient(apiKey);
  const response = await client.responses.create({
    model: process.env.AI_MODEL || defaultOpenAiModel,
    instructions:
      "You create safe, reviewable project draft fields for a scheduling app. Output JSON only.",
    input: createProjectDraftPrompt(description),
    max_output_tokens: 500,
    text: {
      format: {
        type: "json_schema",
        name: "schedule_builder_project_draft",
        schema: projectDraftJsonSchema,
        strict: true,
      },
    },
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned an empty draft.");
  }

  return JSON.parse(response.output_text);
}

export async function POST(request: NextRequest) {
  const authError = await verifySignedInUser(request);

  if (authError) {
    return authError;
  }

  const body = (await request.json().catch(() => ({}))) as {
    description?: unknown;
  };
  const description =
    typeof body.description === "string" ? body.description.trim() : "";

  if (!description) {
    return NextResponse.json(
      { error: "Describe what you are working on first." },
      { status: 400 },
    );
  }

  if (description.length > maxDescriptionLength) {
    return NextResponse.json(
      { error: `Keep the description under ${maxDescriptionLength} characters.` },
      { status: 400 },
    );
  }

  try {
    const aiDraft = await createOpenAiProjectDraft(description);
    const draft = normalizeProjectDraft(aiDraft, description);

    return NextResponse.json({
      draft,
      message: aiDraft
        ? "Project draft created. Review and edit before saving."
        : "OpenAI is not configured, so a simple local draft was created. Review and edit before saving.",
      source: aiDraft ? "ai" : "fallback",
    });
  } catch (error) {
    const draft = createFallbackDraft(description);

    return NextResponse.json({
      draft,
      message: `OpenAI could not create a draft, so a simple local draft was created. ${getErrorMessage(error)}`,
      source: "fallback",
    });
  }
}
