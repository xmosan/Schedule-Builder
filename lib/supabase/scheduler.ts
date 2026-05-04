import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectCategory, ProjectPriority } from "@/lib/projects";
import type { WeekDay, WeeklyPlanBlock } from "@/lib/weekly-plan";

type SchedulerSyncError = Error | PostgrestError;

const supabaseRequestTimeoutMs = 8000;

type ProjectRow = {
  user_id: string;
  project_id: number;
  sort_index: number;
  name: string;
  category: ProjectCategory;
  priority: ProjectPriority;
  deadline: string;
  next_action: string;
  weekly_hours: number;
  completed: boolean;
};

type WeeklyPlanBlockRow = {
  user_id: string;
  block_id: string;
  sort_index: number;
  day: WeekDay;
  project_name: string;
  planned_task: string;
  estimated_hours: number;
};

function createTimeoutError(operation: string) {
  return new Error(
    `${operation} timed out. Using the local scheduler cache for now.`,
  );
}

async function withSupabaseTimeout<Result extends { error: SchedulerSyncError | null }>(
  request: PromiseLike<Result>,
  operation: string,
) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<Result>((resolve) => {
        timeoutId = globalThis.setTimeout(() => {
          timeoutId = undefined;
          resolve({ error: createTimeoutError(operation) } as Result);
        }, supabaseRequestTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function mapProjectRowToProject(row: ProjectRow): Project {
  return {
    id: row.project_id,
    name: row.name,
    category: row.category,
    priority: row.priority,
    deadline: row.deadline,
    nextAction: row.next_action,
    weeklyHours: row.weekly_hours,
    completed: row.completed,
  };
}

function mapProjectToRow(userId: string, project: Project, index: number): ProjectRow {
  return {
    user_id: userId,
    project_id: project.id,
    sort_index: index,
    name: project.name,
    category: project.category,
    priority: project.priority,
    deadline: project.deadline,
    next_action: project.nextAction,
    weekly_hours: project.weeklyHours,
    completed: project.completed,
  };
}

function mapWeeklyPlanRowToBlock(row: WeeklyPlanBlockRow): WeeklyPlanBlock {
  return {
    id: row.block_id,
    day: row.day,
    projectName: row.project_name,
    plannedTask: row.planned_task,
    estimatedHours: row.estimated_hours,
  };
}

function mapWeeklyPlanBlockToRow(
  userId: string,
  block: WeeklyPlanBlock,
  index: number,
): WeeklyPlanBlockRow {
  return {
    user_id: userId,
    block_id: block.id,
    sort_index: index,
    day: block.day,
    project_name: block.projectName,
    planned_task: block.plannedTask,
    estimated_hours: block.estimatedHours,
  };
}

export async function fetchProjectsForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("projects")
      .select(
        "user_id, project_id, sort_index, name, category, priority, deadline, next_action, weekly_hours, completed",
      )
      .eq("user_id", userId)
      .order("sort_index", { ascending: true }),
    "Loading projects from Supabase",
  );

  return {
    data: result.data?.map((row) => mapProjectRowToProject(row as ProjectRow)) ?? [],
    error: result.error,
  };
}

export async function replaceProjectsForUser(
  supabase: SupabaseClient,
  userId: string,
  projects: Project[],
) {
  const existingResult = await withSupabaseTimeout(
    supabase.from("projects").select("project_id").eq("user_id", userId),
    "Checking existing projects in Supabase",
  );

  if (existingResult.error) {
    return { error: existingResult.error };
  }

  if (projects.length === 0) {
    const { error } = await withSupabaseTimeout(
      supabase.from("projects").delete().eq("user_id", userId),
      "Deleting projects from Supabase",
    );

    return { error };
  }

  const { error: upsertError } = await withSupabaseTimeout(
    supabase
      .from("projects")
      .upsert(projects.map((project, index) => mapProjectToRow(userId, project, index)), {
        onConflict: "user_id,project_id",
      }),
    "Saving projects to Supabase",
  );

  if (upsertError) {
    return { error: upsertError };
  }

  const currentProjectIds = new Set(projects.map((project) => project.id));
  const staleProjectIds =
    existingResult.data
      ?.map((row) => Number((row as Pick<ProjectRow, "project_id">).project_id))
      .filter((projectId) => !currentProjectIds.has(projectId)) ?? [];

  if (staleProjectIds.length === 0) {
    return { error: null as SchedulerSyncError | null };
  }

  const { error: deleteError } = await withSupabaseTimeout(
    supabase
      .from("projects")
      .delete()
      .eq("user_id", userId)
      .in("project_id", staleProjectIds),
    "Deleting removed projects from Supabase",
  );

  return { error: deleteError };
}

export async function fetchWeeklyPlanBlocksForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("weekly_plan_blocks")
      .select(
        "user_id, block_id, sort_index, day, project_name, planned_task, estimated_hours",
      )
      .eq("user_id", userId)
      .order("sort_index", { ascending: true }),
    "Loading weekly plan from Supabase",
  );

  return {
    data:
      result.data?.map((row) => mapWeeklyPlanRowToBlock(row as WeeklyPlanBlockRow)) ??
      [],
    error: result.error,
  };
}

export async function replaceWeeklyPlanBlocksForUser(
  supabase: SupabaseClient,
  userId: string,
  planBlocks: WeeklyPlanBlock[],
) {
  const existingResult = await withSupabaseTimeout(
    supabase
      .from("weekly_plan_blocks")
      .select("block_id")
      .eq("user_id", userId),
    "Checking existing weekly plan blocks in Supabase",
  );

  if (existingResult.error) {
    return { error: existingResult.error };
  }

  if (planBlocks.length === 0) {
    const { error } = await withSupabaseTimeout(
      supabase.from("weekly_plan_blocks").delete().eq("user_id", userId),
      "Deleting weekly plan blocks from Supabase",
    );

    return { error };
  }

  const { error: upsertError } = await withSupabaseTimeout(
    supabase.from("weekly_plan_blocks").upsert(
      planBlocks.map((block, index) =>
        mapWeeklyPlanBlockToRow(userId, block, index),
      ),
      { onConflict: "user_id,block_id" },
    ),
    "Saving weekly plan to Supabase",
  );

  if (upsertError) {
    return { error: upsertError };
  }

  const currentBlockIds = new Set(planBlocks.map((block) => block.id));
  const staleBlockIds =
    existingResult.data
      ?.map((row) => String((row as Pick<WeeklyPlanBlockRow, "block_id">).block_id))
      .filter((blockId) => !currentBlockIds.has(blockId)) ?? [];

  if (staleBlockIds.length === 0) {
    return { error: null as SchedulerSyncError | null };
  }

  const { error: deleteError } = await withSupabaseTimeout(
    supabase
      .from("weekly_plan_blocks")
      .delete()
      .eq("user_id", userId)
      .in("block_id", staleBlockIds),
    "Deleting removed weekly plan blocks from Supabase",
  );

  return { error: deleteError };
}
