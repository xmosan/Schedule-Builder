import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeDesiredIntegrations,
  normalizePlannerType,
  normalizePlanningGoals,
  normalizeScheduleIntensity,
  type OnboardingAnswers,
  type PlannerProfile,
  type PlannerType,
  type ScheduleIntensity,
} from "@/lib/onboarding";
import type { Project, ProjectCategory, ProjectPriority } from "@/lib/projects";
import {
  sortImportedCalendarEvents,
  type ImportedCalendarEvent,
  type ImportedCalendarEventDraft,
} from "@/lib/imported-calendar";
import {
  normalizeStartTime,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import type { WorkShift, WorkShiftDraft } from "@/lib/work-schedule";

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
  start_time?: string | null;
};

type PlannerProfileRow = {
  user_id: string;
  planner_type: PlannerType;
  planning_goals: string[] | null;
  desired_integrations: string[] | null;
  schedule_intensity: ScheduleIntensity;
  onboarding_completed: boolean;
};

type WorkShiftRow = {
  id: string;
  user_id: string;
  day: WeekDay;
  start_time: string;
  end_time: string;
  location: string | null;
  notes: string | null;
  recurring: boolean;
};

type ImportedCalendarEventRow = {
  id: string;
  user_id: string;
  source: string;
  external_uid: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  imported_at: string;
};

function createTimeoutError(operation: string) {
  return new Error(
    `${operation} timed out. Using the local scheduler cache for now.`,
  );
}

function isMissingWeeklyPlanStartTimeColumn(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };

  return (
    typeof candidate.message === "string" &&
    candidate.message.includes("start_time") &&
    (candidate.message.includes("weekly_plan_blocks") ||
      candidate.code === "PGRST204")
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
  const block: WeeklyPlanBlock = {
    id: row.block_id,
    day: row.day,
    projectName: row.project_name,
    plannedTask: row.planned_task,
    estimatedHours: row.estimated_hours,
  };
  const startTime = normalizeStartTime(row.start_time ?? "");

  if (startTime) {
    block.startTime = startTime;
  }

  return block;
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
    start_time: block.startTime ?? null,
  };
}

function mapWeeklyPlanBlockToLegacyRow(
  userId: string,
  block: WeeklyPlanBlock,
  index: number,
): Omit<WeeklyPlanBlockRow, "start_time"> {
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

function mapPlannerProfileRowToProfile(row: PlannerProfileRow): PlannerProfile {
  return {
    userId: row.user_id,
    plannerType: normalizePlannerType(row.planner_type),
    planningGoals: normalizePlanningGoals(row.planning_goals),
    desiredIntegrations: normalizeDesiredIntegrations(row.desired_integrations),
    scheduleIntensity: normalizeScheduleIntensity(row.schedule_intensity),
    onboardingCompleted: row.onboarding_completed,
  };
}

function mapWorkShiftRowToWorkShift(row: WorkShiftRow): WorkShift {
  return {
    id: row.id,
    day: row.day,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    location: row.location ?? "",
    notes: row.notes ?? "",
    recurring: row.recurring,
  };
}

function mapWorkShiftDraftToRow(
  userId: string,
  draft: WorkShiftDraft,
): Omit<WorkShiftRow, "id"> {
  return {
    user_id: userId,
    day: draft.day,
    start_time: draft.startTime,
    end_time: draft.endTime,
    location: draft.location.trim(),
    notes: draft.notes.trim(),
    recurring: draft.recurring,
  };
}

function mapImportedCalendarEventRowToEvent(
  row: ImportedCalendarEventRow,
): ImportedCalendarEvent {
  return {
    id: row.id,
    source: row.source,
    externalUid: row.external_uid ?? "",
    title: row.title,
    description: row.description ?? "",
    location: row.location ?? "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    importedAt: row.imported_at,
  };
}

function mapImportedCalendarEventDraftToRow(
  userId: string,
  draft: ImportedCalendarEventDraft,
): Omit<ImportedCalendarEventRow, "id" | "imported_at"> {
  return {
    user_id: userId,
    source: draft.source || "ics",
    external_uid: draft.externalUid.trim() || null,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    location: draft.location.trim() || null,
    starts_at: draft.startsAt,
    ends_at: draft.endsAt,
    all_day: draft.allDay,
  };
}

function createImportedEventDuplicateKey(
  event: Pick<
    ImportedCalendarEvent,
    "endsAt" | "externalUid" | "source" | "startsAt" | "title"
  >,
) {
  const externalUid = event.externalUid.trim();

  if (externalUid) {
    return `${event.source}:uid:${externalUid}`;
  }

  return `${event.source}:event:${event.title.trim().toLowerCase()}:${
    event.startsAt
  }:${event.endsAt ?? ""}`;
}

function mapOnboardingAnswersToRow(
  userId: string,
  answers: OnboardingAnswers,
): PlannerProfileRow {
  return {
    user_id: userId,
    planner_type: answers.plannerType,
    planning_goals: answers.planningGoals,
    desired_integrations: answers.desiredIntegrations,
    schedule_intensity: answers.scheduleIntensity,
    onboarding_completed: true,
  };
}

export async function fetchPlannerProfileForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("planner_profiles")
      .select(
        "user_id, planner_type, planning_goals, desired_integrations, schedule_intensity, onboarding_completed",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    "Loading onboarding profile from Supabase",
  );

  return {
    data: result.data
      ? mapPlannerProfileRowToProfile(result.data as PlannerProfileRow)
      : null,
    error: result.error,
  };
}

export async function savePlannerProfileForUser(
  supabase: SupabaseClient,
  userId: string,
  answers: OnboardingAnswers,
) {
  const profileRow = mapOnboardingAnswersToRow(userId, answers);
  const result = await withSupabaseTimeout(
    supabase
      .from("planner_profiles")
      .upsert(profileRow, { onConflict: "user_id" })
      .select(
        "user_id, planner_type, planning_goals, desired_integrations, schedule_intensity, onboarding_completed",
      )
      .single(),
    "Saving onboarding profile to Supabase",
  );

  return {
    data: result.data
      ? mapPlannerProfileRowToProfile(result.data as PlannerProfileRow)
      : null,
    error: result.error,
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

export async function deleteProjectForUser(
  supabase: SupabaseClient,
  userId: string,
  projectId: number,
) {
  const { error } = await withSupabaseTimeout(
    supabase
      .from("projects")
      .delete()
      .eq("user_id", userId)
      .eq("project_id", projectId),
    "Deleting project from Supabase",
  );

  return { error };
}

export async function fetchWeeklyPlanBlocksForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  type WeeklyPlanFetchResult = {
    data: unknown[] | null;
    error: SchedulerSyncError | null;
  };
  let result: WeeklyPlanFetchResult = await withSupabaseTimeout(
    supabase
      .from("weekly_plan_blocks")
      .select(
        "user_id, block_id, sort_index, day, project_name, planned_task, estimated_hours, start_time",
      )
      .eq("user_id", userId)
      .order("sort_index", { ascending: true }),
    "Loading weekly plan from Supabase",
  );

  if (isMissingWeeklyPlanStartTimeColumn(result.error)) {
    result = await withSupabaseTimeout(
      supabase
        .from("weekly_plan_blocks")
        .select(
          "user_id, block_id, sort_index, day, project_name, planned_task, estimated_hours",
        )
        .eq("user_id", userId)
        .order("sort_index", { ascending: true }),
      "Loading weekly plan from Supabase",
    );
  }

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

  let { error: upsertError } = await withSupabaseTimeout(
    supabase.from("weekly_plan_blocks").upsert(
      planBlocks.map((block, index) =>
        mapWeeklyPlanBlockToRow(userId, block, index),
      ),
      { onConflict: "user_id,block_id" },
    ),
    "Saving weekly plan to Supabase",
  );

  if (isMissingWeeklyPlanStartTimeColumn(upsertError)) {
    const retryResult = await withSupabaseTimeout(
      supabase.from("weekly_plan_blocks").upsert(
        planBlocks.map((block, index) =>
          mapWeeklyPlanBlockToLegacyRow(userId, block, index),
        ),
        { onConflict: "user_id,block_id" },
      ),
      "Saving weekly plan to Supabase",
    );

    upsertError = retryResult.error;
  }

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

export async function deleteWeeklyPlanBlockForUser(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
) {
  const { error } = await withSupabaseTimeout(
    supabase
      .from("weekly_plan_blocks")
      .delete()
      .eq("user_id", userId)
      .eq("block_id", blockId),
    "Deleting weekly plan block from Supabase",
  );

  return { error };
}

export async function fetchWorkShiftsForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("work_shifts")
      .select(
        "id, user_id, day, start_time, end_time, location, notes, recurring",
      )
      .eq("user_id", userId)
      .order("day", { ascending: true })
      .order("start_time", { ascending: true }),
    "Loading work schedule from Supabase",
  );

  return {
    data: result.data?.map((row) => mapWorkShiftRowToWorkShift(row as WorkShiftRow)) ?? [],
    error: result.error,
  };
}

export async function createWorkShiftForUser(
  supabase: SupabaseClient,
  userId: string,
  draft: WorkShiftDraft,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("work_shifts")
      .insert(mapWorkShiftDraftToRow(userId, draft))
      .select("id, user_id, day, start_time, end_time, location, notes, recurring")
      .single(),
    "Saving work shift to Supabase",
  );

  return {
    data: result.data
      ? mapWorkShiftRowToWorkShift(result.data as WorkShiftRow)
      : null,
    error: result.error,
  };
}

export async function updateWorkShiftForUser(
  supabase: SupabaseClient,
  userId: string,
  shiftId: string,
  draft: WorkShiftDraft,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("work_shifts")
      .update(mapWorkShiftDraftToRow(userId, draft))
      .eq("user_id", userId)
      .eq("id", shiftId)
      .select("id, user_id, day, start_time, end_time, location, notes, recurring")
      .single(),
    "Updating work shift in Supabase",
  );

  return {
    data: result.data
      ? mapWorkShiftRowToWorkShift(result.data as WorkShiftRow)
      : null,
    error: result.error,
  };
}

export async function deleteWorkShiftForUser(
  supabase: SupabaseClient,
  userId: string,
  shiftId: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("work_shifts")
      .delete()
      .eq("user_id", userId)
      .eq("id", shiftId),
    "Removing work shift from Supabase",
  );

  return { error: result.error };
}

export async function fetchImportedCalendarEventsForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("imported_calendar_events")
      .select(
        "id, user_id, source, external_uid, title, description, location, starts_at, ends_at, all_day, imported_at",
      )
      .eq("user_id", userId)
      .order("starts_at", { ascending: true }),
    "Loading imported calendar events from Supabase",
  );

  return {
    data: sortImportedCalendarEvents(
      result.data?.map((row) =>
        mapImportedCalendarEventRowToEvent(row as ImportedCalendarEventRow),
      ) ?? [],
    ),
    error: result.error,
  };
}

export async function createImportedCalendarEventsForUser(
  supabase: SupabaseClient,
  userId: string,
  drafts: ImportedCalendarEventDraft[],
) {
  const existingResult = await withSupabaseTimeout(
    supabase
      .from("imported_calendar_events")
      .select("id, source, external_uid, title, starts_at, ends_at")
      .eq("user_id", userId),
    "Checking existing imported calendar events in Supabase",
  );

  if (existingResult.error) {
    return {
      data: [] as ImportedCalendarEvent[],
      error: existingResult.error,
      skippedDuplicates: 0,
    };
  }

  const existingKeys = new Set(
    (existingResult.data ?? []).map((row) => {
      const event = row as Pick<
        ImportedCalendarEventRow,
        "ends_at" | "external_uid" | "source" | "starts_at" | "title"
      >;

      return createImportedEventDuplicateKey({
        source: event.source,
        externalUid: event.external_uid ?? "",
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
      });
    }),
  );
  const rows = drafts
    .filter((draft) => {
      const key = createImportedEventDuplicateKey(draft);

      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    })
    .map((draft) => mapImportedCalendarEventDraftToRow(userId, draft));
  const skippedDuplicates = drafts.length - rows.length;

  if (rows.length === 0) {
    return {
      data: [] as ImportedCalendarEvent[],
      error: null as SchedulerSyncError | null,
      skippedDuplicates,
    };
  }

  const result = await withSupabaseTimeout(
    supabase
      .from("imported_calendar_events")
      .insert(rows)
      .select(
        "id, user_id, source, external_uid, title, description, location, starts_at, ends_at, all_day, imported_at",
      ),
    "Saving imported calendar events to Supabase",
  );

  return {
    data: sortImportedCalendarEvents(
      result.data?.map((row) =>
        mapImportedCalendarEventRowToEvent(row as ImportedCalendarEventRow),
      ) ?? [],
    ),
    error: result.error,
    skippedDuplicates,
  };
}

export async function replaceImportedCalendarEventsForSourceRange(
  supabase: SupabaseClient,
  userId: string,
  source: string,
  drafts: ImportedCalendarEventDraft[],
  rangeStartIso: string,
  rangeEndIso: string,
) {
  const deleteResult = await withSupabaseTimeout(
    supabase
      .from("imported_calendar_events")
      .delete()
      .eq("user_id", userId)
      .eq("source", source)
      .gte("starts_at", rangeStartIso)
      .lte("starts_at", rangeEndIso),
    `Clearing ${source} calendar events from Supabase`,
  );

  if (deleteResult.error) {
    return {
      data: [] as ImportedCalendarEvent[],
      error: deleteResult.error,
      skippedDuplicates: 0,
    };
  }

  return createImportedCalendarEventsForUser(supabase, userId, drafts);
}

export async function deleteImportedCalendarEventsForSource(
  supabase: SupabaseClient,
  userId: string,
  source: string,
) {
  const result = await withSupabaseTimeout(
    supabase
      .from("imported_calendar_events")
      .delete()
      .eq("user_id", userId)
      .eq("source", source),
    `Removing ${source} calendar events from Supabase`,
  );

  return { error: result.error };
}
