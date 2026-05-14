import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  googleCalendarAppCreatedScope,
  googleCalendarReadonlyScope,
  type GoogleCalendarConnectionStatus,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

type GoogleCalendarStatusRow = {
  error_message: string | null;
  expires_at: string | null;
  google_account_email: string | null;
  last_synced_at: string | null;
  scope: string | null;
  status: GoogleCalendarConnectionStatus;
  sync_calendar_id?: string | null;
  sync_calendar_name?: string | null;
  sync_enabled?: boolean | null;
  write_granted_at?: string | null;
  write_scope?: string | null;
};

function isMissingGoogleCalendarSyncColumns(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";

  return (
    (candidate.code === "PGRST204" ||
      candidate.code === "42703" ||
      message.includes("schema cache")) &&
    (message.includes("sync_enabled") ||
      message.includes("sync_calendar_id") ||
      message.includes("sync_calendar_name") ||
      message.includes("write_scope") ||
      message.includes("write_granted_at"))
  );
}

function createStatusPayload(data: GoogleCalendarStatusRow | null) {
  if (!data) {
    return {
      connected: false,
      scope: googleCalendarReadonlyScope,
      status: "not_connected" satisfies GoogleCalendarConnectionStatus,
      syncCalendarId: null,
      syncCalendarName: null,
      syncEnabled: false,
      writeGrantedAt: null,
      writeScope: "",
    };
  }

  return {
    connected: data.status === "connected",
    errorMessage: data.error_message,
    expiresAt: data.expires_at,
    googleAccountEmail: data.google_account_email,
    lastSyncedAt: data.last_synced_at,
    scope: data.scope ?? googleCalendarReadonlyScope,
    status: data.status,
    syncCalendarId: data.sync_calendar_id ?? null,
    syncCalendarName: data.sync_calendar_name ?? null,
    syncEnabled: Boolean(data.sync_enabled),
    writeGrantedAt: data.write_granted_at ?? null,
    writeScope: data.write_scope ?? googleCalendarAppCreatedScope,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const extendedResult = await serviceClient
      .from("google_calendar_connections")
      .select(
        "status, google_account_email, last_synced_at, error_message, expires_at, scope, sync_enabled, sync_calendar_id, sync_calendar_name, write_scope, write_granted_at",
      )
      .eq("user_id", userId)
      .maybeSingle();
    let data = extendedResult.data as GoogleCalendarStatusRow | null;
    let error = extendedResult.error;

    if (error && isMissingGoogleCalendarSyncColumns(error)) {
      const legacyResult = await serviceClient
        .from("google_calendar_connections")
        .select(
          "status, google_account_email, last_synced_at, error_message, expires_at, scope",
        )
        .eq("user_id", userId)
        .maybeSingle();

      data = legacyResult.data as GoogleCalendarStatusRow | null;
      error = legacyResult.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(createStatusPayload(data as GoogleCalendarStatusRow | null));
  } catch (error) {
    return NextResponse.json(
      { error: getGoogleCalendarErrorMessage(error) },
      { status: 500 },
    );
  }
}
