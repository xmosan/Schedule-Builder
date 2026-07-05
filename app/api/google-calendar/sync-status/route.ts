import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
} from "@/lib/google-calendar";
import { normalizeStartTime, weekDays, type WeekDay } from "@/lib/weekly-plan";

export const dynamic = "force-dynamic";

type WeeklyPlanBlockRow = {
  block_id: string;
  day: WeekDay;
  estimated_hours: number;
  planned_task: string;
  project_name: string;
  scheduled_date: string | null;
  start_time: string | null;
};

type GoogleCalendarSyncedEventRow = {
  google_event_id: string;
  google_event_html_link: string | null;
  id: string;
  last_synced_at: string;
  sync_status: "synced" | "needs_attention";
  synced_ends_at: string;
  synced_starts_at: string;
  synced_title: string;
  weekly_plan_block_id: string | null;
  block_snapshot: unknown;
};

function parseWeekStartDate(value: string | null) {
  if (!value?.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getDay() !== 1
  ) {
    return null;
  }

  return value;
}

function isMissingWeeklyPlanStartTimeColumn(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };

  return (
    typeof candidate.message === "string" &&
    candidate.message.includes("start_time") &&
    candidate.message.includes("weekly_plan_blocks")
  );
}

function getMissingStartTimeColumnMessage() {
  return "Google Calendar sync needs the Weekly Plan start time column in Supabase. Run the weekly-plan-start-times migration, then try again.";
}

function createBlockSnapshot(block: WeeklyPlanBlockRow) {
  return {
    day: block.day,
    estimatedHours: Number(block.estimated_hours),
    id: block.block_id,
    plannedTask: block.planned_task,
    projectName: block.project_name,
    scheduledDate: block.scheduled_date ?? "",
    startTime: normalizeStartTime(block.start_time ?? "") ?? "",
  };
}

function snapshotsMatch(
  snapshot: unknown,
  block: WeeklyPlanBlockRow | undefined,
) {
  if (!block || typeof snapshot !== "object" || snapshot === null) {
    return false;
  }

  const expected = createBlockSnapshot(block);
  const candidate = snapshot as Partial<typeof expected>;

  return (
    candidate.day === expected.day &&
    Number(candidate.estimatedHours) === expected.estimatedHours &&
    candidate.id === expected.id &&
    candidate.plannedTask === expected.plannedTask &&
    candidate.projectName === expected.projectName &&
    (candidate.startTime ?? "") === expected.startTime
  );
}

export async function GET(request: NextRequest) {
  try {
    const weekStartDate = parseWeekStartDate(
      new URL(request.url).searchParams.get("week_start_date"),
    );

    if (!weekStartDate) {
      return NextResponse.json(
        { error: "Choose a valid Monday week start date." },
        { status: 400 },
      );
    }

    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const [connectionResult, syncRowsResult] = await Promise.all([
      serviceClient
        .from("google_calendar_connections")
        .select("sync_enabled, sync_calendar_id, sync_calendar_name")
        .eq("user_id", userId)
        .maybeSingle(),
      serviceClient
        .from("google_calendar_synced_events")
        .select(
          "id, weekly_plan_block_id, sync_status, google_event_id, google_event_html_link, synced_title, synced_starts_at, synced_ends_at, last_synced_at, block_snapshot",
        )
        .eq("user_id", userId)
        .eq("week_start_date", weekStartDate),
    ]);

    if (connectionResult.error) {
      throw new Error(connectionResult.error.message);
    }

    if (syncRowsResult.error) {
      throw new Error(syncRowsResult.error.message);
    }

    const syncRows =
      (syncRowsResult.data as GoogleCalendarSyncedEventRow[] | null) ?? [];
    const syncedBlockIds = syncRows
      .map((row) => row.weekly_plan_block_id)
      .filter((blockId): blockId is string => Boolean(blockId));
    const blocksById = new Map<string, WeeklyPlanBlockRow>();

    if (syncedBlockIds.length > 0) {
      const { data: blockRows, error: blockRowsError } = await serviceClient
        .from("weekly_plan_blocks")
        .select(
          "block_id, day, project_name, planned_task, estimated_hours, start_time, scheduled_date",
        )
        .eq("user_id", userId)
        .in("block_id", syncedBlockIds);

      if (blockRowsError) {
        if (isMissingWeeklyPlanStartTimeColumn(blockRowsError)) {
          return NextResponse.json(
            { error: getMissingStartTimeColumnMessage() },
            { status: 409 },
          );
        }

        throw new Error(blockRowsError.message);
      }

      (blockRows as WeeklyPlanBlockRow[] | null)?.forEach((block) => {
        if (weekDays.includes(block.day)) {
          blocksById.set(block.block_id, block);
        }
      });
    }

    const needsAttentionIds = syncRows
      .filter(
        (row) => {
          const currentBlock = row.weekly_plan_block_id
            ? blocksById.get(row.weekly_plan_block_id)
            : undefined;

          return (
            row.weekly_plan_block_id &&
            currentBlock &&
            row.sync_status === "synced" &&
            !snapshotsMatch(row.block_snapshot, currentBlock)
          );
        },
      )
      .map((row) => row.id);

    if (needsAttentionIds.length > 0) {
      await serviceClient
        .from("google_calendar_synced_events")
        .update({ sync_status: "needs_attention" })
        .eq("user_id", userId)
        .in("id", needsAttentionIds);
    }

    return NextResponse.json({
      syncCalendarName:
        connectionResult.data?.sync_calendar_name ?? "Schedule Builder",
      syncEnabled: Boolean(connectionResult.data?.sync_enabled),
      removedSyncedEvents: syncRows
        .filter(
          (row) =>
            !row.weekly_plan_block_id ||
            !blocksById.has(row.weekly_plan_block_id),
        )
        .map((row) => ({
          googleEventHtmlLink: row.google_event_html_link,
          id: row.id,
          lastSyncedAt: row.last_synced_at,
          syncedEndsAt: row.synced_ends_at,
          syncedStartsAt: row.synced_starts_at,
          syncedTitle: row.synced_title,
        })),
      statuses: syncRows
        .filter(
          (row) =>
            row.weekly_plan_block_id &&
            blocksById.has(row.weekly_plan_block_id),
        )
        .map((row) => ({
          googleEventId: row.google_event_id,
          googleEventHtmlLink: row.google_event_html_link,
          lastSyncedAt: row.last_synced_at,
          syncStatus: needsAttentionIds.includes(row.id)
            ? "needs_attention"
            : row.sync_status,
          syncedTitle: row.synced_title,
          weeklyPlanBlockId: row.weekly_plan_block_id,
        })),
      weekStartDate,
    });
  } catch (error) {
    const message = getGoogleCalendarErrorMessage(error);

    return NextResponse.json(
      { error: message },
      { status: message.includes("Sign in") ? 401 : 500 },
    );
  }
}
