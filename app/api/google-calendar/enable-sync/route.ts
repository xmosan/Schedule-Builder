import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarAuthorizationUrl,
  createGoogleCalendarSyncState,
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  googleCalendarAppCreatedScope,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

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
      message.includes("write_scope"))
  );
}

export async function POST(request: NextRequest) {
  try {
    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const { data, error } = await serviceClient
      .from("google_calendar_connections")
      .select("status, sync_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isMissingGoogleCalendarSyncColumns(error)) {
        return NextResponse.json(
          {
            error:
              "Google Calendar sync is not ready in this Supabase project. Run the one-way sync migration, then try again.",
          },
          { status: 409 },
        );
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.status !== "connected") {
      return NextResponse.json(
        {
          error:
            "Connect Google Calendar read-only access before enabling calendar sync.",
        },
        { status: 409 },
      );
    }

    const state = createGoogleCalendarSyncState();
    const stateExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { error: updateError } = await serviceClient
      .from("google_calendar_connections")
      .update({
        error_message: null,
        oauth_state: state,
        oauth_state_expires_at: stateExpiresAt,
      })
      .eq("user_id", userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      authorizationUrl: createGoogleCalendarAuthorizationUrl(
        state,
        googleCalendarAppCreatedScope,
      ),
      scope: googleCalendarAppCreatedScope,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getGoogleCalendarErrorMessage(error) },
      { status: 500 },
    );
  }
}
