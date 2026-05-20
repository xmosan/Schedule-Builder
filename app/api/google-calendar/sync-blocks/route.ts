import { NextRequest, NextResponse } from "next/server";
import {
  createScheduleBuilderGoogleCalendarEvent,
  ensureGoogleCalendarAccessToken,
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  getScheduleBuilderGoogleCalendarTimeZone,
  googleCalendarAppCreatedScope,
  hasGoogleCalendarScope,
  type GoogleCalendarConnectionRow,
} from "@/lib/google-calendar";
import {
  fetchImportedCalendarEventsForUser,
  fetchWorkShiftsForUser,
} from "@/lib/supabase/scheduler";
import {
  getWeeklyPlanImportedEventConflictForBlock,
  getWeeklyPlanWorkConflictForBlock,
} from "@/lib/schedule-conflicts";
import {
  formatEstimatedHours,
  formatStartTime,
  normalizeStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

export const dynamic = "force-dynamic";

type SyncBlocksRequestBody = {
  blockIds?: unknown;
  weekStartDate?: unknown;
};

type WeeklyPlanBlockRow = {
  block_id: string;
  day: WeekDay;
  estimated_hours: number;
  planned_task: string;
  project_name: string;
  start_time: string | null;
};

type ExistingSyncRow = {
  google_event_html_link: string | null;
  sync_status: "synced" | "needs_attention";
  weekly_plan_block_id: string | null;
};

function parseWeekStartDate(value: unknown) {
  if (typeof value !== "string" || !value.match(/^\d{4}-\d{2}-\d{2}$/)) {
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

function addDaysToIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);

  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addMinutesToLocalDateTime(isoDate: string, time: string, minutes: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hours, rawMinutes] = time.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, rawMinutes + minutes, 0);

  return `${String(date.getFullYear()).padStart(4, "0")}-${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
}

function mapWeeklyPlanRowToBlock(row: WeeklyPlanBlockRow): WeeklyPlanBlock {
  const block: WeeklyPlanBlock = {
    day: row.day,
    estimatedHours: Number(row.estimated_hours),
    id: row.block_id,
    plannedTask: row.planned_task,
    projectName: row.project_name,
  };
  const startTime = normalizeStartTime(row.start_time ?? "");

  if (startTime) {
    block.startTime = startTime;
  }

  return block;
}

function createBlockSnapshot(block: WeeklyPlanBlock) {
  return {
    day: block.day,
    estimatedHours: block.estimatedHours,
    id: block.id,
    plannedTask: block.plannedTask,
    projectName: block.projectName,
    startTime: block.startTime ?? "",
  };
}

function getGoogleCalendarEventTitle(block: WeeklyPlanBlock) {
  const projectName = block.projectName.trim();

  if (!projectName || projectName.toLowerCase() === "schedule builder") {
    return "Schedule Builder plan block";
  }

  return `Schedule Builder: ${projectName}`;
}

function getBlockEventDate(weekStartDate: string, day: WeekDay) {
  return addDaysToIsoDate(weekStartDate, weekDays.indexOf(day));
}

function getBlockWarnings(
  block: WeeklyPlanBlock,
  weekStartDate: string,
  workShifts: Awaited<ReturnType<typeof fetchWorkShiftsForUser>>["data"],
  importedEvents: Awaited<ReturnType<typeof fetchImportedCalendarEventsForUser>>["data"],
) {
  const weekStart = new Date(`${weekStartDate}T00:00:00`);
  const workConflict = getWeeklyPlanWorkConflictForBlock(block, workShifts);
  const importedConflict = getWeeklyPlanImportedEventConflictForBlock(
    block,
    importedEvents,
    weekStart,
  );

  return [
    workConflict?.message ?? null,
    importedConflict
      ? "This block may overlap with an imported calendar event."
      : null,
  ].filter((message): message is string => Boolean(message));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SyncBlocksRequestBody;
    const weekStartDate = parseWeekStartDate(body.weekStartDate);
    const blockIds = Array.isArray(body.blockIds)
      ? [
          ...new Set(
            body.blockIds
              .map((blockId) =>
                typeof blockId === "string" ? blockId.trim() : "",
              )
              .filter(Boolean),
          ),
        ]
      : [];

    if (!weekStartDate) {
      return NextResponse.json(
        { error: "Choose a valid Monday week start date." },
        { status: 400 },
      );
    }

    if (blockIds.length === 0) {
      return NextResponse.json(
        { error: "Choose at least one timed Weekly Plan block to sync." },
        { status: 400 },
      );
    }

    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const { data: connectionData, error: connectionError } = await serviceClient
      .from("google_calendar_connections")
      .select(
        "user_id, status, google_calendar_id, google_account_email, access_token, refresh_token, token_type, scope, expires_at, oauth_state, oauth_state_expires_at, last_synced_at, error_message, inserted_at, updated_at, sync_enabled, sync_calendar_id, sync_calendar_name, write_scope, write_granted_at",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (connectionError) {
      throw new Error(connectionError.message);
    }

    if (!connectionData) {
      return NextResponse.json(
        { error: "Connect Google Calendar before syncing Weekly Plan blocks." },
        { status: 409 },
      );
    }

    const connection = connectionData as GoogleCalendarConnectionRow;

    if (!connection.sync_enabled || !connection.sync_calendar_id) {
      return NextResponse.json(
        {
          error:
            "Enable Calendar Sync before syncing Weekly Plan blocks to Google Calendar.",
        },
        { status: 409 },
      );
    }

    if (
      !hasGoogleCalendarScope(connection.write_scope, googleCalendarAppCreatedScope)
    ) {
      return NextResponse.json(
        {
          error:
            "Google Calendar write permission is missing. Re-enable Calendar Sync, then try again.",
        },
        { status: 409 },
      );
    }

    const [blockRowsResult, existingRowsResult, workResult, importedResult] =
      await Promise.all([
        serviceClient
          .from("weekly_plan_blocks")
          .select(
            "block_id, day, project_name, planned_task, estimated_hours, start_time",
          )
          .eq("user_id", userId)
          .in("block_id", blockIds),
        serviceClient
          .from("google_calendar_synced_events")
          .select(
            "weekly_plan_block_id, sync_status, google_event_html_link",
          )
          .eq("user_id", userId)
          .eq("week_start_date", weekStartDate)
          .in("weekly_plan_block_id", blockIds),
        fetchWorkShiftsForUser(serviceClient, userId),
        fetchImportedCalendarEventsForUser(serviceClient, userId),
      ]);

    if (blockRowsResult.error) {
      if (isMissingWeeklyPlanStartTimeColumn(blockRowsResult.error)) {
        return NextResponse.json(
          { error: getMissingStartTimeColumnMessage() },
          { status: 409 },
        );
      }

      throw new Error(blockRowsResult.error.message);
    }

    if (existingRowsResult.error) {
      throw new Error(existingRowsResult.error.message);
    }

    if (workResult.error) {
      throw new Error(workResult.error.message);
    }

    if (importedResult.error) {
      throw new Error(importedResult.error.message);
    }

    const blocksById = new Map(
      ((blockRowsResult.data as WeeklyPlanBlockRow[] | null) ?? []).map((row) => [
        row.block_id,
        mapWeeklyPlanRowToBlock(row),
      ]),
    );
    const existingByBlockId = new Map(
      ((existingRowsResult.data as ExistingSyncRow[] | null) ?? [])
        .filter((row) => row.weekly_plan_block_id)
        .map((row) => [row.weekly_plan_block_id as string, row]),
    );
    const accessToken = await ensureGoogleCalendarAccessToken(
      serviceClient,
      connection,
    );
    const timeZone = getScheduleBuilderGoogleCalendarTimeZone();
    const results = [];

    for (const blockId of blockIds) {
      const block = blocksById.get(blockId);
      const existingSync = existingByBlockId.get(blockId);

      if (existingSync) {
        results.push({
          blockId,
          googleEventHtmlLink: existingSync.google_event_html_link,
          message: "Already synced for this week.",
          status: "already_synced",
          syncStatus: existingSync.sync_status,
          warnings: [] as string[],
        });
        continue;
      }

      if (!block) {
        results.push({
          blockId,
          message: "This Weekly Plan block was not found.",
          status: "failed",
          warnings: [] as string[],
        });
        continue;
      }

      const startMinutes = parseStartTimeToMinutes(block.startTime);
      const startTime = block.startTime;
      const durationMinutes = Math.round(block.estimatedHours * 60);

      if (startMinutes === null || !startTime) {
        results.push({
          blockId,
          message: "Add a start time before syncing this block.",
          status: "failed",
          warnings: [] as string[],
        });
        continue;
      }

      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        results.push({
          blockId,
          message: "Add a positive estimated time before syncing this block.",
          status: "failed",
          warnings: [] as string[],
        });
        continue;
      }

      if (!block.projectName.trim() || !block.plannedTask.trim()) {
        results.push({
          blockId,
          message: "Project name and task are required before syncing.",
          status: "failed",
          warnings: [] as string[],
        });
        continue;
      }

      try {
        const eventDate = getBlockEventDate(weekStartDate, block.day);
        const startsAt = `${eventDate}T${startTime}:00`;
        const endsAt = addMinutesToLocalDateTime(
          eventDate,
          startTime,
          durationMinutes,
        );
        const warnings = getBlockWarnings(
          block,
          weekStartDate,
          workResult.data,
          importedResult.data,
        );
        const title = getGoogleCalendarEventTitle(block);
        const description = [
          `Planned task: ${block.plannedTask}`,
          `Duration: ${formatEstimatedHours(block.estimatedHours)}`,
          `Scheduled time: ${formatStartTime(block.startTime)}`,
          "",
          "Source: Schedule Builder",
          "Note: Synced from Weekly Plan.",
        ].join("\n");
        const googleEvent = await createScheduleBuilderGoogleCalendarEvent(
          accessToken,
          connection.sync_calendar_id,
          {
            description,
            endsAt,
            startsAt,
            timeZone,
            title,
          },
        );
        const { data: insertedRow, error: insertError } = await serviceClient
          .from("google_calendar_synced_events")
          .insert({
            block_snapshot: createBlockSnapshot(block),
            google_calendar_id: connection.sync_calendar_id,
            google_event_etag: googleEvent.etag,
            google_event_html_link: googleEvent.htmlLink,
            google_event_id: googleEvent.id,
            last_synced_at: new Date().toISOString(),
            sync_status: "synced",
            synced_ends_at: endsAt,
            synced_starts_at: startsAt,
            synced_title: title,
            user_id: userId,
            week_start_date: weekStartDate,
            weekly_plan_block_id: block.id,
          })
          .select(
            "weekly_plan_block_id, sync_status, google_event_html_link, last_synced_at",
          )
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        results.push({
          blockId,
          googleEventId: googleEvent.id,
          googleEventHtmlLink:
            (insertedRow as ExistingSyncRow | null)?.google_event_html_link ??
            googleEvent.htmlLink,
          message: "Synced to Google Calendar.",
          status: "synced",
          syncStatus: "synced",
          warnings,
        });
      } catch (error) {
        results.push({
          blockId,
          message: getGoogleCalendarErrorMessage(error),
          status: "failed",
          warnings: [] as string[],
        });
      }
    }

    return NextResponse.json({
      results,
      syncCalendarName:
        connection.sync_calendar_name ?? "Schedule Builder",
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
