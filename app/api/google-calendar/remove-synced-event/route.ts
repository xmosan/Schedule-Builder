import { NextRequest, NextResponse } from "next/server";
import {
  deleteScheduleBuilderGoogleCalendarEvent,
  ensureGoogleCalendarAccessToken,
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  googleCalendarAppCreatedScope,
  hasGoogleCalendarScope,
  type GoogleCalendarConnectionRow,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

type RemoveSyncedEventRequestBody = {
  syncEventId?: unknown;
};

type GoogleCalendarSyncedEventRow = {
  google_calendar_id: string;
  google_event_id: string;
  id: string;
  synced_title: string;
};

function getConnectionSelect() {
  return "user_id, status, google_calendar_id, google_account_email, access_token, refresh_token, token_type, scope, expires_at, oauth_state, oauth_state_expires_at, last_synced_at, error_message, inserted_at, updated_at, sync_enabled, sync_calendar_id, sync_calendar_name, write_scope, write_granted_at";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RemoveSyncedEventRequestBody;
    const syncEventId =
      typeof body.syncEventId === "string" ? body.syncEventId.trim() : "";

    if (!syncEventId) {
      return NextResponse.json(
        { error: "Choose the Google Calendar event to remove." },
        { status: 400 },
      );
    }

    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const [connectionResult, syncRowResult] = await Promise.all([
      serviceClient
        .from("google_calendar_connections")
        .select(getConnectionSelect())
        .eq("user_id", userId)
        .maybeSingle(),
      serviceClient
        .from("google_calendar_synced_events")
        .select("id, google_calendar_id, google_event_id, synced_title")
        .eq("user_id", userId)
        .eq("id", syncEventId)
        .maybeSingle(),
    ]);

    if (connectionResult.error) {
      throw new Error(connectionResult.error.message);
    }

    if (syncRowResult.error) {
      throw new Error(syncRowResult.error.message);
    }

    if (!connectionResult.data) {
      return NextResponse.json(
        { error: "Connect Google Calendar before removing synced events." },
        { status: 409 },
      );
    }

    if (!syncRowResult.data) {
      return NextResponse.json(
        { error: "This synced Google Calendar event was not found." },
        { status: 404 },
      );
    }

    const connection =
      connectionResult.data as unknown as GoogleCalendarConnectionRow;
    const syncRow = syncRowResult.data as unknown as GoogleCalendarSyncedEventRow;

    if (!connection.sync_enabled || !connection.sync_calendar_id) {
      return NextResponse.json(
        { error: "Enable Google sync before removing synced events." },
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
            "This event is not on your Schedule Builder Google Calendar, so Schedule Builder will not remove it.",
        },
        { status: 403 },
      );
    }

    const accessToken = await ensureGoogleCalendarAccessToken(
      serviceClient,
      connection,
    );
    const deleteResult = await deleteScheduleBuilderGoogleCalendarEvent(
      accessToken,
      connection.sync_calendar_id,
      syncRow.google_event_id,
    );
    const { error: deleteRowError } = await serviceClient
      .from("google_calendar_synced_events")
      .delete()
      .eq("user_id", userId)
      .eq("id", syncRow.id);

    if (deleteRowError) {
      throw new Error(deleteRowError.message);
    }

    return NextResponse.json({
      message: deleteResult.notFound
        ? "Google Calendar event was already gone, so Schedule Builder cleaned up the sync record."
        : "Google Calendar event removed.",
      syncEventId,
    });
  } catch (error) {
    const message = getGoogleCalendarErrorMessage(error);

    return NextResponse.json(
      { error: message },
      { status: message.includes("Sign in") ? 401 : 500 },
    );
  }
}
