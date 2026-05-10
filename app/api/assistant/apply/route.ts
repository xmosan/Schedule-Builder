import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  createAssistantContextSummary,
  normalizeAssistantSuggestions,
  type AssistantApplyResponse,
  type AssistantApplyResult,
  type AssistantSuggestion,
} from "@/lib/assistant";
import type { Project } from "@/lib/projects";
import {
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
  fetchWorkShiftsForUser,
  fetchWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";
import type { WeekDay, WeeklyPlanBlock } from "@/lib/weekly-plan";
import { formatWorkShiftRange, type WorkShift } from "@/lib/work-schedule";

export const dynamic = "force-dynamic";

const maxApprovedSuggestions = 8;

type WeeklyPlanBlockRow = {
  user_id: string;
  block_id: string;
  sort_index: number;
  day: WeekDay;
  project_name: string;
  planned_task: string;
  estimated_hours: number;
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

  return "The approved suggestion could not be applied.";
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
      { error: "Sign in before applying AI Plan Review suggestions." },
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

function createResult(
  suggestion: AssistantSuggestion,
  status: AssistantApplyResult["status"],
  message: string,
): AssistantApplyResult {
  return {
    suggestionId: suggestion.id,
    suggestionTitle: suggestion.title,
    type: suggestion.type,
    status,
    message,
  };
}

function normalizeProjectKey(projectName: string) {
  return projectName.trim().toLowerCase();
}

function findProjectByName(projects: Project[], projectName: string) {
  const targetName = normalizeProjectKey(projectName);
  return projects.find((project) => normalizeProjectKey(project.name) === targetName);
}

function createBlockId(suggestionId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${suggestionId}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateActionableSuggestion(suggestion: AssistantSuggestion) {
  if (
    suggestion.type !== "suggested_weekly_block" &&
    suggestion.type !== "suggested_next_action"
  ) {
    return "This suggestion is informational and cannot be applied automatically.";
  }

  return null;
}

async function applyWeeklyBlockSuggestion({
  appliedBlockCount,
  currentBlocks,
  currentProjects,
  suggestion,
  supabase,
  userId,
  workShifts,
}: {
  appliedBlockCount: number;
  currentBlocks: WeeklyPlanBlock[];
  currentProjects: Project[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
  workShifts: WorkShift[];
}) {
  const projectName = suggestion.projectName?.trim();
  const plannedTask = suggestion.plannedTask?.trim();

  if (!projectName) {
    return createResult(suggestion, "error", "Weekly block project name cannot be empty.");
  }

  if (!findProjectByName(currentProjects, projectName)) {
    return createResult(
      suggestion,
      "error",
      "This weekly block refers to an unknown project. Create that project first, then apply the block.",
    );
  }

  if (!plannedTask) {
    return createResult(suggestion, "error", "Weekly block task cannot be empty.");
  }

  if (!suggestion.day) {
    return createResult(
      suggestion,
      "error",
      "Weekly block day must be Monday through Sunday.",
    );
  }

  if (!suggestion.estimatedHours || suggestion.estimatedHours <= 0) {
    return createResult(
      suggestion,
      "error",
      "Weekly block estimated time must be greater than 0.",
    );
  }

  const row: WeeklyPlanBlockRow = {
    user_id: userId,
    block_id: createBlockId(suggestion.id),
    sort_index: currentBlocks.length + appliedBlockCount,
    day: suggestion.day,
    project_name: projectName,
    planned_task: plannedTask,
    estimated_hours: suggestion.estimatedHours,
  };
  const { error } = await supabase.from("weekly_plan_blocks").insert(row);

  if (error) {
    return createResult(suggestion, "error", error.message);
  }

  currentBlocks.push({
    id: row.block_id,
    day: row.day,
    projectName: row.project_name,
    plannedTask: row.planned_task,
    estimatedHours: row.estimated_hours,
  });

  const workRanges = workShifts
    .filter((shift) => shift.day === row.day)
    .map(formatWorkShiftRange);

  return createResult(
    suggestion,
    "applied",
    workRanges.length > 0
      ? `Created a weekly plan block. This day has work shifts (${workRanges.join(", ")}), so place the block outside those hours.`
      : "Created a weekly plan block.",
  );
}

async function applyNextActionSuggestion({
  currentProjects,
  suggestion,
  supabase,
  userId,
}: {
  currentProjects: Project[];
  suggestion: AssistantSuggestion;
  supabase: SupabaseClient;
  userId: string;
}) {
  const projectName = suggestion.projectName?.trim();
  const proposedNextAction = suggestion.proposedNextAction?.trim();

  if (!projectName) {
    return createResult(suggestion, "error", "Project name cannot be empty.");
  }

  if (!proposedNextAction) {
    return createResult(
      suggestion,
      "error",
      "Proposed next action cannot be empty.",
    );
  }

  const project = findProjectByName(currentProjects, projectName);

  if (!project) {
    return createResult(suggestion, "error", "Could not find that project.");
  }

  const { error } = await supabase
    .from("projects")
    .update({ next_action: proposedNextAction })
    .eq("user_id", userId)
    .eq("project_id", project.id);

  if (error) {
    return createResult(suggestion, "error", error.message);
  }

  project.nextAction = proposedNextAction;
  return createResult(suggestion, "applied", "Updated the project next action.");
}

async function loadContextSummary(supabase: SupabaseClient, userId: string) {
  const [profileResult, projectsResult, weeklyPlanResult, workShiftsResult] = await Promise.all([
    fetchPlannerProfileForUser(supabase, userId),
    fetchProjectsForUser(supabase, userId),
    fetchWeeklyPlanBlocksForUser(supabase, userId),
    fetchWorkShiftsForUser(supabase, userId),
  ]);

  return createAssistantContextSummary(
    projectsResult.error == null ? projectsResult.data : [],
    weeklyPlanResult.error == null ? weeklyPlanResult.data : [],
    profileResult.error == null && profileResult.data
      ? profileResult.data.plannerType
      : "Unknown",
    workShiftsResult.error == null ? workShiftsResult.data : [],
  );
}

export async function POST(request: NextRequest) {
  const authResult = await getAuthenticatedUser(request);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = (await request.json().catch(() => ({}))) as {
    approvedSuggestions?: unknown;
  };

  if (!Array.isArray(body.approvedSuggestions)) {
    return NextResponse.json(
      { error: "Send approvedSuggestions as an array." },
      { status: 400 },
    );
  }

  if (body.approvedSuggestions.length === 0) {
    return NextResponse.json(
      { error: "Approve at least one suggestion before applying." },
      { status: 400 },
    );
  }

  if (body.approvedSuggestions.length > maxApprovedSuggestions) {
    return NextResponse.json(
      { error: `Apply at most ${maxApprovedSuggestions} suggestions at a time.` },
      { status: 400 },
    );
  }

  const suggestions = body.approvedSuggestions.map((rawSuggestion, index) => {
    return {
      normalized: normalizeAssistantSuggestions([rawSuggestion])[0] ?? null,
      fallbackId: `approved-${index + 1}`,
    };
  });

  const [projectsResult, weeklyPlanResult, workShiftsResult] = await Promise.all([
    fetchProjectsForUser(authResult.supabase, authResult.userId),
    fetchWeeklyPlanBlocksForUser(authResult.supabase, authResult.userId),
    fetchWorkShiftsForUser(authResult.supabase, authResult.userId),
  ]);

  if (projectsResult.error || weeklyPlanResult.error) {
    return NextResponse.json(
      {
        error: `Could not load scheduler data before applying suggestions. ${[
          projectsResult.error,
          weeklyPlanResult.error,
        ]
          .filter(Boolean)
          .map(getErrorMessage)
          .join(" ")}`,
      },
      { status: 500 },
    );
  }

  const currentProjects = [...projectsResult.data];
  const currentBlocks = [...weeklyPlanResult.data];
  const workShifts = workShiftsResult.error ? [] : [...workShiftsResult.data];
  const results: AssistantApplyResult[] = [];
  let appliedBlockCount = 0;

  for (const item of suggestions) {
    if (!item.normalized) {
      results.push({
        suggestionId: item.fallbackId,
        suggestionTitle: "Invalid suggestion",
        type: "workload_warning",
        status: "error",
        message: "Suggestion payload did not match the safe assistant schema.",
      });
      continue;
    }

    const unsupportedMessage = validateActionableSuggestion(item.normalized);

    if (unsupportedMessage) {
      results.push(createResult(item.normalized, "skipped", unsupportedMessage));
      continue;
    }

    if (item.normalized.type === "suggested_weekly_block") {
      const result = await applyWeeklyBlockSuggestion({
        appliedBlockCount,
        currentBlocks,
        currentProjects,
        suggestion: item.normalized,
        supabase: authResult.supabase,
        userId: authResult.userId,
        workShifts,
      });

      results.push(result);

      if (result.status === "applied") {
        appliedBlockCount += 1;
      }

      continue;
    }

    results.push(
      await applyNextActionSuggestion({
        currentProjects,
        suggestion: item.normalized,
        supabase: authResult.supabase,
        userId: authResult.userId,
      }),
    );
  }

  const appliedCount = results.filter((result) => result.status === "applied").length;
  const context = await loadContextSummary(authResult.supabase, authResult.userId);
  const response: AssistantApplyResponse = {
    context,
    message:
      appliedCount > 0
        ? `Applied ${appliedCount} approved ${appliedCount === 1 ? "suggestion" : "suggestions"}.`
        : "No approved suggestions were applied.",
    results,
  };

  return NextResponse.json(response);
}
