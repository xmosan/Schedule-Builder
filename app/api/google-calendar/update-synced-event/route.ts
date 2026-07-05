import { NextRequest, NextResponse } from "next/server";
import {
  ensureGoogleCalendarAccessToken,
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  getScheduleBuilderGoogleCalendarTimeZone,
  googleCalendarAppCreatedScope,
  hasGoogleCalendarScope,
  updateScheduleBuilderGoogleCalendarEvent,
  type GoogleCalendarConnectionRow,
} from "@/lib/google-calendar";
import { fetchProjectsForUser } from "@/lib/supabase/scheduler";
import {
  formatEstimatedHours,
  formatStartTime,
  normalizeStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import type { Project } from "@/lib/projects";

export const dynamic = "force-dynamic";

type UpdateSyncedEventRequestBody = {
  blockId?: unknown;
  weekStartDate?: unknown;
};

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
  google_calendar_id: string;
  google_event_html_link: string | null;
  google_event_id: string;
  id: string;
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

  const candidate = error as { message?: unknown };

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
  if (row.scheduled_date) {
    block.scheduledDate = row.scheduled_date;
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
    scheduledDate: block.scheduledDate ?? "",
    startTime: block.startTime ?? "",
  };
}

function normalizeProjectLookupName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isProjectWorkBlock(block: WeeklyPlanBlock, projects: Project[]) {
  const blockTitle = normalizeProjectLookupName(block.projectName);

  return projects.some(
    (project) => normalizeProjectLookupName(project.name) === blockTitle,
  );
}

function getGoogleCalendarEventTitle(
  block: WeeklyPlanBlock,
  projects: Project[],
) {
  const projectName = block.projectName.trim();

  if (!isProjectWorkBlock(block, projects)) {
    return projectName || "Schedule Builder time block";
  }

  if (!projectName || projectName.toLowerCase() === "schedule builder") {
    return "Schedule Builder time block";
  }

  return `Schedule Builder: ${projectName}`;
}

function getBlockEventDate(weekStartDate: string, day: WeekDay) {
  return addDaysToIsoDate(weekStartDate, weekDays.indexOf(day));
}

function getConnectionSelect() {
  return "user_id, status, google_calendar_id, google_account_email, access_token, refresh_token, token_type, scope, expires_at, oauth_state, oauth_state_expires_at, last_synced_at, error_message, inserted_at, updated_at, sync_enabled, sync_calendar_id, sync_calendar_name, write_scope, write_granted_at";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateSyncedEventRequestBody;
    const blockId = typeof body.blockId === "string" ? body.blockId.trim() : "";
    const weekStartDate = parseWeekStartDate(body.weekStartDate);

    if (!blockId) {
      return NextResponse.json(
        { error: "Choose the time block to update." },
        { status: 400 },
      );
    }

    if (!weekStartDate) {
      return NextResponse.json(
        { error: "Choose a valid Monday week start date." },
        { status: 400 },
      );
    }

    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const [connectionResult, blockResult, syncRowResult, projectsResult] =
      await Promise.all([
        serviceClient
          .from("google_calendar_connections")
          .select(getConnectionSelect())
          .eq("user_id", userId)
          .maybeSingle(),
        serviceClient
          .from("weekly_plan_blocks")
          .select(
            "block_id, day, project_name, planned_task, estimated_hours, start_time, scheduled_date",
          )
          .eq("user_id", userId)
          .eq("block_id", blockId)
          .maybeSingle(),
        serviceClient
          .from("google_calendar_synced_events")
          .select(
            "id, weekly_plan_block_id, google_calendar_id, google_event_id, google_event_html_link",
          )
          .eq("user_id", userId)
          .eq("week_start_date", weekStartDate)
          .eq("weekly_plan_block_id", blockId)
          .maybeSingle(),
        fetchProjectsForUser(serviceClient, userId),
      ]);

    if (connectionResult.error) {
      throw new Error(connectionResult.error.message);
    }

    if (blockResult.error) {
      if (isMissingWeeklyPlanStartTimeColumn(blockResult.error)) {
        return NextResponse.json(
          { error: getMissingStartTimeColumnMessage() },
          { status: 409 },
        );
      }

      throw new Error(blockResult.error.message);
    }

    if (syncRowResult.error) {
      throw new Error(syncRowResult.error.message);
    }

    if (projectsResult.error) {
      throw new Error(projectsResult.error.message);
    }

    if (!connectionResult.data) {
      return NextResponse.json(
        { error: "Connect Google Calendar before updating synced events." },
        { status: 409 },
      );
    }

    if (!blockResult.data) {
      return NextResponse.json(
        { error: "This time block was not found." },
        { status: 404 },
      );
    }

    if (!syncRowResult.data) {
      return NextResponse.json(
        { error: "This block has not been synced to Google Calendar yet." },
        { status: 404 },
      );
    }

    const connection =
      connectionResult.data as unknown as GoogleCalendarConnectionRow;
    const syncRow = syncRowResult.data as unknown as GoogleCalendarSyncedEventRow;

    if (!connection.sync_enabled || !connection.sync_calendar_id) {
      return NextResponse.json(
        { error: "Enable Google sync before updating synced events." },
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

    if (syncRow.google_calendar_id !== connection.sync_calendar_id) {
      return NextResponse.json(
        {
          error:
            "This event is not on your Schedule Builder Google Calendar, so Schedule Builder will not update it.",
        },
        { status: 403 },
      );
    }

    const block = mapWeeklyPlanRowToBlock(
      blockResult.data as unknown as WeeklyPlanBlockRow,
    );
    const startMinutes = parseStartTimeToMinutes(block.startTime);
    const startTime = block.startTime;
    const durationMinutes = Math.round(block.estimatedHours * 60);

    if (startMinutes === null || !startTime) {
      return NextResponse.json(
        { error: "Add a start time before updating this Google Calendar event." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json(
        { error: "Add a positive estimated time before updating this event." },
        { status: 400 },
      );
    }

    const accessToken = await ensureGoogleCalendarAccessToken(
      serviceClient,
      connection,
    );
    const timeZone = getScheduleBuilderGoogleCalendarTimeZone();
    const eventDate =
      block.scheduledDate ?? getBlockEventDate(weekStartDate, block.day);
    const startsAt = `${eventDate}T${startTime}:00`;
    const endsAt = addMinutesToLocalDateTime(
      eventDate,
      startTime,
      durationMinutes,
    );
    const title = getGoogleCalendarEventTitle(block, projectsResult.data);
    const description = [
      `Planned task: ${block.plannedTask}`,
      `Duration: ${formatEstimatedHours(block.estimatedHours)}`,
      `Scheduled time: ${formatStartTime(block.startTime)}`,
      "",
      "Source: Schedule Builder",
      "Note: Synced from Weekly Plan.",
    ].join("\n");
    const googleEvent = await updateScheduleBuilderGoogleCalendarEvent(
      accessToken,
      connection.sync_calendar_id,
      syncRow.google_event_id,
      {
        description,
        endsAt,
        startsAt,
        timeZone,
        title,
      },
    );
    const { data: updatedRow, error: updateError } = await serviceClient
      .from("google_calendar_synced_events")
      .update({
        block_snapshot: createBlockSnapshot(block),
        google_event_etag: googleEvent.etag,
        google_event_html_link:
          googleEvent.htmlLink ?? syncRow.google_event_html_link,
        last_synced_at: new Date().toISOString(),
        sync_status: "synced",
        synced_ends_at: endsAt,
        synced_starts_at: startsAt,
        synced_title: title,
      })
      .eq("user_id", userId)
      .eq("id", syncRow.id)
      .select(
        "weekly_plan_block_id, sync_status, google_event_html_link, last_synced_at, synced_title",
      )
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    const row = updatedRow as {
      google_event_html_link: string | null;
      last_synced_at: string;
      synced_title: string;
      weekly_plan_block_id: string | null;
    };

    return NextResponse.json({
      blockId,
      googleEventId: googleEvent.id,
      googleEventHtmlLink: row.google_event_html_link,
      lastSyncedAt: row.last_synced_at,
      message: "Google Calendar event updated.",
      syncStatus: "synced",
      syncedTitle: row.synced_title,
      weeklyPlanBlockId: row.weekly_plan_block_id,
    });
  } catch (error) {
    const message = getGoogleCalendarErrorMessage(error);

    return NextResponse.json(
      { error: message },
      { status: message.includes("Sign in") ? 401 : 500 },
    );
  }
}
