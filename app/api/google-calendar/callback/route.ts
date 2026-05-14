import { NextRequest, NextResponse } from "next/server";
import {
  createScheduleBuilderGoogleCalendar,
  exchangeGoogleCalendarCode,
  getGoogleCalendarErrorMessage,
  getSupabaseServiceClient,
  googleCalendarAppCreatedScope,
  googleCalendarReadonlyScope,
  hasGoogleCalendarScope,
  isGoogleCalendarSyncState,
  mergeGoogleCalendarScopes,
  scheduleBuilderGoogleCalendarName,
  syncGoogleCalendarForUser,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

function getRedirectUrl(request: NextRequest, params: Record<string, string>) {
  const fallbackOrigin = new URL(request.url).origin;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ??
    fallbackOrigin;
  const redirectUrl = new URL("/integrations", siteUrl);

  Object.entries(params).forEach(([key, value]) => {
    redirectUrl.searchParams.set(key, value);
  });

  return redirectUrl;
}

async function failConnection(state: string | null, message: string) {
  if (!state) {
    return;
  }

  const serviceClient = getSupabaseServiceClient();
  const isSyncFlow = isGoogleCalendarSyncState(state);
  await serviceClient
    .from("google_calendar_connections")
    .update({
      error_message: message,
      oauth_state: null,
      oauth_state_expires_at: null,
      ...(isSyncFlow ? {} : { status: "needs_reconnect" }),
    })
    .eq("oauth_state", state);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const isSyncFlow = isGoogleCalendarSyncState(state);

  if (oauthError) {
    await failConnection(state, oauthError);

    return NextResponse.redirect(
      getRedirectUrl(request, {
        [isSyncFlow ? "google_calendar_sync_error" : "google_calendar_error"]:
          oauthError,
      }),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      getRedirectUrl(request, {
        google_calendar_error: "Google Calendar did not return a valid authorization response.",
      }),
    );
  }

  try {
    const serviceClient = getSupabaseServiceClient();
    const { data, error } = await serviceClient
      .from("google_calendar_connections")
      .select(
        "user_id, status, refresh_token, scope, oauth_state_expires_at, sync_calendar_id, sync_calendar_name",
      )
      .eq("oauth_state", state)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Google Calendar connection state could not be verified.");
    }

    const expiresAt = data.oauth_state_expires_at
      ? new Date(data.oauth_state_expires_at).getTime()
      : 0;

    if (expiresAt < Date.now()) {
      throw new Error("Google Calendar connection expired. Please try again.");
    }

    const token = await exchangeGoogleCalendarCode(code);
    const tokenExpiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

    if (isSyncFlow) {
      if (data.status !== "connected") {
        throw new Error(
          "Connect Google Calendar read-only access before enabling calendar sync.",
        );
      }

      if (!token.scope) {
        throw new Error(
          "Google did not return the granted calendar sync scope. Please try again.",
        );
      }

      if (
        !hasGoogleCalendarScope(token.scope, googleCalendarAppCreatedScope)
      ) {
        throw new Error(
          "Google did not grant Schedule Builder calendar sync permission.",
        );
      }

      if (
        hasGoogleCalendarScope(data.scope, googleCalendarReadonlyScope) &&
        !hasGoogleCalendarScope(token.scope, googleCalendarReadonlyScope)
      ) {
        throw new Error(
          "Google did not return combined read and sync permissions. Please try enabling sync again.",
        );
      }

      const dedicatedCalendar = data.sync_calendar_id
        ? {
            id: data.sync_calendar_id,
            summary:
              data.sync_calendar_name ?? scheduleBuilderGoogleCalendarName,
          }
        : await createScheduleBuilderGoogleCalendar(token.access_token);

      const { error: updateError } = await serviceClient
        .from("google_calendar_connections")
        .update({
          access_token: token.access_token,
          error_message: null,
          expires_at: tokenExpiresAt,
          oauth_state: null,
          oauth_state_expires_at: null,
          refresh_token: token.refresh_token ?? data.refresh_token,
          scope: mergeGoogleCalendarScopes(data.scope, token.scope),
          status: "connected",
          sync_calendar_id: dedicatedCalendar.id,
          sync_calendar_name: dedicatedCalendar.summary,
          sync_enabled: true,
          token_type: token.token_type ?? "Bearer",
          write_granted_at: new Date().toISOString(),
          write_scope: googleCalendarAppCreatedScope,
        })
        .eq("user_id", data.user_id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      return NextResponse.redirect(
        getRedirectUrl(request, {
          google_calendar_sync: "enabled",
        }),
      );
    }

    const { error: updateError } = await serviceClient
      .from("google_calendar_connections")
      .update({
        access_token: token.access_token,
        error_message: null,
        expires_at: tokenExpiresAt,
        oauth_state: null,
        oauth_state_expires_at: null,
        refresh_token: token.refresh_token ?? data.refresh_token,
        scope: mergeGoogleCalendarScopes(
          googleCalendarReadonlyScope,
          token.scope,
        ),
        status: "connected",
        token_type: token.token_type ?? "Bearer",
      })
      .eq("user_id", data.user_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await syncGoogleCalendarForUser(serviceClient, data.user_id);

    return NextResponse.redirect(
      getRedirectUrl(request, {
        google_calendar: "connected",
      }),
    );
  } catch (error) {
    const message = getGoogleCalendarErrorMessage(error);
    await failConnection(state, message);

    return NextResponse.redirect(
      getRedirectUrl(request, {
        [isSyncFlow ? "google_calendar_sync_error" : "google_calendar_error"]:
          message,
      }),
    );
  }
}
