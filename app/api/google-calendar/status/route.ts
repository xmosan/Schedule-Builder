import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  googleCalendarReadonlyScope,
  type GoogleCalendarConnectionStatus,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const { data, error } = await serviceClient
      .from("google_calendar_connections")
      .select(
        "status, google_account_email, last_synced_at, error_message, expires_at, scope",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({
        connected: false,
        scope: googleCalendarReadonlyScope,
        status: "not_connected" satisfies GoogleCalendarConnectionStatus,
      });
    }

    return NextResponse.json({
      connected: data.status === "connected",
      errorMessage: data.error_message,
      expiresAt: data.expires_at,
      googleAccountEmail: data.google_account_email,
      lastSyncedAt: data.last_synced_at,
      scope: data.scope ?? googleCalendarReadonlyScope,
      status: data.status as GoogleCalendarConnectionStatus,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getGoogleCalendarErrorMessage(error) },
      { status: 500 },
    );
  }
}
