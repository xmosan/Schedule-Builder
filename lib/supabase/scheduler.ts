import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectCategory, ProjectPriority } from "@/lib/projects";
import type { WeekDay, WeeklyPlanBlock } from "@/lib/weekly-plan";

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
  const result = await supabase
    .from("projects")
    .select(
      "user_id, project_id, sort_index, name, category, priority, deadline, next_action, weekly_hours, completed",
    )
    .eq("user_id", userId)
    .order("sort_index", { ascending: true });

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
  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    return { error: deleteError };
  }

  if (projects.length === 0) {
    return { error: null as PostgrestError | null };
  }

  const { error } = await supabase
    .from("projects")
    .insert(projects.map((project, index) => mapProjectToRow(userId, project, index)));

  return { error };
}

export async function fetchWeeklyPlanBlocksForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const result = await supabase
    .from("weekly_plan_blocks")
    .select(
      "user_id, block_id, sort_index, day, project_name, planned_task, estimated_hours",
    )
    .eq("user_id", userId)
    .order("sort_index", { ascending: true });

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
  const { error: deleteError } = await supabase
    .from("weekly_plan_blocks")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    return { error: deleteError };
  }

  if (planBlocks.length === 0) {
    return { error: null as PostgrestError | null };
  }

  const { error } = await supabase.from("weekly_plan_blocks").insert(
    planBlocks.map((block, index) =>
      mapWeeklyPlanBlockToRow(userId, block, index),
    ),
  );

  return { error };
}
