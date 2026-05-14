import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { ImportedCalendarEventDraft } from "@/lib/imported-calendar";
import {
  deleteImportedCalendarEventsForSource,
  replaceImportedCalendarEventsForSourceRange,
} from "@/lib/supabase/scheduler";

export const googleCalendarSource = "google_calendar";
export const googleCalendarReadonlyScope =
  "https://www.googleapis.com/auth/calendar.readonly";
export const googleCalendarAppCreatedScope =
  "https://www.googleapis.com/auth/calendar.app.created";
export const scheduleBuilderGoogleCalendarName = "Schedule Builder";

const googleCalendarSyncStatePrefix = "sync:";

export type GoogleCalendarConnectionStatus =
  | "connected"
  | "needs_reconnect"
  | "not_connected"
  | "pending";

export type GoogleCalendarConnectionRow = {
  access_token: string | null;
  error_message: string | null;
  expires_at: string | null;
  google_account_email: string | null;
  google_calendar_id: string;
  inserted_at: string;
  last_synced_at: string | null;
  oauth_state: string | null;
  oauth_state_expires_at: string | null;
  refresh_token: string | null;
  scope: string;
  status: GoogleCalendarConnectionStatus;
  sync_calendar_id: string | null;
  sync_calendar_name: string | null;
  sync_enabled: boolean;
  token_type: string | null;
  updated_at: string;
  user_id: string;
  write_granted_at: string | null;
  write_scope: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleSuccessfulTokenResponse = GoogleTokenResponse & {
  access_token: string;
};

type GoogleCalendarApiEventDate = {
  date?: string;
  dateTime?: string;
};

type GoogleCalendarApiEvent = {
  description?: string;
  end?: GoogleCalendarApiEventDate;
  htmlLink?: string;
  iCalUID?: string;
  id?: string;
  location?: string;
  start?: GoogleCalendarApiEventDate;
  status?: string;
  summary?: string;
};

type GoogleCalendarEventsResponse = {
  error?: {
    message?: string;
  };
  items?: GoogleCalendarApiEvent[];
  nextPageToken?: string;
};

type GoogleCalendarResourceResponse = {
  error?: {
    message?: string;
  };
  id?: string;
  summary?: string;
};

let serviceClient: SupabaseClient | null = null;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Google Calendar is unavailable right now.";
}

export function getGoogleCalendarErrorMessage(error: unknown) {
  return getErrorMessage(error);
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function getSiteUrl() {
  return requireEnv("NEXT_PUBLIC_SITE_URL").replace(/\/$/, "");
}

export function getGoogleCalendarRedirectUri() {
  return `${getSiteUrl()}/api/google-calendar/callback`;
}

function getGoogleClientConfig() {
  return {
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: getGoogleCalendarRedirectUri(),
  };
}

export function getSupabaseServiceClient() {
  if (serviceClient) {
    return serviceClient;
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceClient;
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function createAuthenticatedSupabaseClient(accessToken: string) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = requireEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function getAuthenticatedGoogleCalendarUser(request: NextRequest) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    throw new Error("Sign in before connecting Google Calendar.");
  }

  const userClient = createAuthenticatedSupabaseClient(accessToken);
  const { data, error } = await userClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error(error?.message ?? "Session could not be verified.");
  }

  return {
    serviceClient: getSupabaseServiceClient(),
    userClient,
    userId: data.user.id,
  };
}

export function createGoogleCalendarSyncState() {
  return `${googleCalendarSyncStatePrefix}${crypto.randomUUID()}`;
}

export function isGoogleCalendarSyncState(state: string | null) {
  return Boolean(state?.startsWith(googleCalendarSyncStatePrefix));
}

export function createGoogleCalendarAuthorizationUrl(
  state: string,
  scope = googleCalendarReadonlyScope,
) {
  const { clientId, redirectUri } = getGoogleClientConfig();
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function mergeGoogleCalendarScopes(...scopeValues: Array<string | null | undefined>) {
  return [
    ...new Set(
      scopeValues
        .flatMap((scope) => scope?.split(/\s+/) ?? [])
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ].join(" ");
}

export function hasGoogleCalendarScope(
  scopeValue: string | null | undefined,
  expectedScope: string,
) {
  return Boolean(scopeValue?.split(/\s+/).includes(expectedScope));
}

async function postGoogleTokenRequest(
  body: URLSearchParams,
): Promise<GoogleSuccessfulTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const tokenResponse = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || tokenResponse.error) {
    throw new Error(
      tokenResponse.error_description ??
        tokenResponse.error ??
        "Google did not return a usable token.",
    );
  }

  if (!tokenResponse.access_token) {
    throw new Error("Google did not return an access token.");
  }

  return tokenResponse as GoogleSuccessfulTokenResponse;
}

export async function exchangeGoogleCalendarCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleClientConfig();

  return postGoogleTokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  );
}

async function refreshGoogleCalendarToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleClientConfig();

  return postGoogleTokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

function getExpiresAt(expiresInSeconds?: number) {
  if (!expiresInSeconds) {
    return null;
  }

  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function tokenExpiresSoon(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() < Date.now() + 60_000;
}

export async function ensureGoogleCalendarAccessToken(
  serviceClient: SupabaseClient,
  connection: GoogleCalendarConnectionRow,
) {
  if (connection.access_token && !tokenExpiresSoon(connection.expires_at)) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    await markGoogleCalendarNeedsReconnect(
      serviceClient,
      connection.user_id,
      "Google Calendar needs to be reconnected.",
    );
    throw new Error("Google Calendar needs to be reconnected.");
  }

  const refreshedToken = await refreshGoogleCalendarToken(
    connection.refresh_token,
  );
  const expiresAt = getExpiresAt(refreshedToken.expires_in);
  const { error } = await serviceClient
    .from("google_calendar_connections")
    .update({
      access_token: refreshedToken.access_token,
      error_message: null,
      expires_at: expiresAt,
      scope: refreshedToken.scope ?? connection.scope,
      status: "connected",
      token_type: refreshedToken.token_type ?? connection.token_type,
    })
    .eq("user_id", connection.user_id);

  if (error) {
    throw new Error(error.message);
  }

  return refreshedToken.access_token;
}

export async function markGoogleCalendarNeedsReconnect(
  serviceClient: SupabaseClient,
  userId: string,
  message: string,
) {
  await serviceClient
    .from("google_calendar_connections")
    .update({
      error_message: message,
      status: "needs_reconnect",
    })
    .eq("user_id", userId);
}

export function getGoogleCalendarSyncRange(referenceDate = new Date()) {
  const localDate = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const day = localDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(localDate);
  start.setDate(start.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);

  return {
    end,
    endIso: end.toISOString(),
    start,
    startIso: start.toISOString(),
  };
}

function googleDateOnlyToIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toISOString();
}

function mapGoogleEventToDraft(
  event: GoogleCalendarApiEvent,
): ImportedCalendarEventDraft | null {
  if (event.status === "cancelled") {
    return null;
  }

  const startValue = event.start?.dateTime ?? event.start?.date;

  if (!startValue) {
    return null;
  }

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const startsAt = allDay ? googleDateOnlyToIso(startValue) : new Date(startValue).toISOString();
  const endValue = event.end?.dateTime ?? event.end?.date;
  const endsAt = endValue
    ? allDay
      ? googleDateOnlyToIso(endValue)
      : new Date(endValue).toISOString()
    : null;

  return {
    allDay,
    description: event.description ?? "",
    endsAt,
    externalUid: event.id ?? event.iCalUID ?? `${startsAt}-${event.summary ?? "event"}`,
    location: event.location ?? "",
    source: googleCalendarSource,
    startsAt,
    title: event.summary?.trim() || "Untitled Google Calendar event",
  };
}

export async function fetchGoogleCalendarEvents(
  accessToken: string,
  rangeStartIso: string,
  rangeEndIso: string,
) {
  const events: ImportedCalendarEventDraft[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: "2500",
      orderBy: "startTime",
      singleEvents: "true",
      timeMax: rangeEndIso,
      timeMin: rangeStartIso,
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const payload = (await response.json()) as GoogleCalendarEventsResponse;

    if (!response.ok || payload.error) {
      throw new Error(
        payload.error?.message ?? "Google Calendar events could not be loaded.",
      );
    }

    events.push(
      ...(payload.items ?? [])
        .map(mapGoogleEventToDraft)
        .filter((event): event is ImportedCalendarEventDraft => event !== null),
    );

    pageToken = payload.nextPageToken;
  } while (pageToken);

  return events;
}

export async function createScheduleBuilderGoogleCalendar(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    body: JSON.stringify({
      description:
        "Calendar created by Schedule Builder for user-approved weekly plan sync.",
      summary: scheduleBuilderGoogleCalendarName,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as GoogleCalendarResourceResponse;

  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message ??
        "Schedule Builder calendar could not be created.",
    );
  }

  if (!payload.id) {
    throw new Error("Google did not return the Schedule Builder calendar ID.");
  }

  return {
    id: payload.id,
    summary: payload.summary ?? scheduleBuilderGoogleCalendarName,
  };
}

export async function syncGoogleCalendarForUser(
  serviceClient: SupabaseClient,
  userId: string,
) {
  const { data, error } = await serviceClient
    .from("google_calendar_connections")
    .select(
      "user_id, status, google_calendar_id, google_account_email, access_token, refresh_token, token_type, scope, expires_at, oauth_state, oauth_state_expires_at, last_synced_at, error_message, inserted_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Google Calendar is not connected yet.");
  }

  const connection = data as GoogleCalendarConnectionRow;
  const accessToken = await ensureGoogleCalendarAccessToken(
    serviceClient,
    connection,
  );
  const range = getGoogleCalendarSyncRange();
  const drafts = await fetchGoogleCalendarEvents(
    accessToken,
    range.startIso,
    range.endIso,
  );
  const result = await replaceImportedCalendarEventsForSourceRange(
    serviceClient,
    userId,
    googleCalendarSource,
    drafts,
    range.startIso,
    range.endIso,
  );

  if (result.error) {
    throw new Error(result.error.message);
  }

  const { error: updateError } = await serviceClient
    .from("google_calendar_connections")
    .update({
      error_message: null,
      last_synced_at: new Date().toISOString(),
      status: "connected",
    })
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    events: result.data,
    range,
    skippedDuplicates: result.skippedDuplicates,
  };
}

export async function disconnectGoogleCalendarForUser(
  serviceClient: SupabaseClient,
  userId: string,
) {
  const [connectionResult, eventsResult] = await Promise.all([
    serviceClient
      .from("google_calendar_connections")
      .delete()
      .eq("user_id", userId),
    deleteImportedCalendarEventsForSource(
      serviceClient,
      userId,
      googleCalendarSource,
    ),
  ]);

  if (connectionResult.error) {
    throw new Error(connectionResult.error.message);
  }

  if (eventsResult.error) {
    throw new Error(eventsResult.error.message);
  }
}
