import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarAuthorizationUrl,
  getAuthenticatedGoogleCalendarUser,
  getGoogleCalendarErrorMessage,
  googleCalendarReadonlyScope,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { serviceClient, userId } =
      await getAuthenticatedGoogleCalendarUser(request);
    const state = crypto.randomUUID();
    const stateExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { error } = await serviceClient
      .from("google_calendar_connections")
      .upsert(
        {
          error_message: null,
          oauth_state: state,
          oauth_state_expires_at: stateExpiresAt,
          scope: googleCalendarReadonlyScope,
          status: "pending",
          user_id: userId,
        },
        { onConflict: "user_id" },
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      authorizationUrl: createGoogleCalendarAuthorizationUrl(state),
      scope: googleCalendarReadonlyScope,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getGoogleCalendarErrorMessage(error) },
      { status: 500 },
    );
  }
}
