"use client";

import { IcsImportPanel } from "@/components/calendar/ics-import-panel";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "@/components/projects/icons";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { integrations } from "@/lib/integrations";
import {
  type DesiredIntegration,
  type PlannerType,
} from "@/lib/onboarding";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchPlannerProfileForUser } from "@/lib/supabase/scheduler";

type GoogleCalendarConnectionStatus =
  | "connected"
  | "needs_reconnect"
  | "not_connected"
  | "pending";

type GoogleCalendarStatusResponse = {
  connected?: boolean;
  error?: string;
  errorMessage?: string | null;
  googleAccountEmail?: string | null;
  lastSyncedAt?: string | null;
  scope?: string;
  status?: GoogleCalendarConnectionStatus;
};

type GoogleCalendarSyncResponse = {
  error?: string;
  importedCount?: number;
  skippedDuplicates?: number;
};

const defaultRecommendationsByPlannerType: Record<
  PlannerType,
  DesiredIntegration[]
> = {
  Student: ["D2L / Brightspace", "Google Calendar", "ICS import/export"],
  Professional: ["Google Calendar", "Outlook Calendar", "ICS import/export"],
  "Organization leader": [
    "Google Calendar",
    "Outlook Calendar",
    "Apple Calendar",
  ],
  "Creator / entrepreneur": [
    "Google Calendar",
    "Apple Calendar",
    "ICS import/export",
  ],
  "General planning": ["Google Calendar", "Apple Calendar", "ICS import/export"],
};

const recommendationReasons: Record<
  PlannerType,
  Record<DesiredIntegration, string>
> = {
  Student: {
    "Google Calendar":
      "Useful for keeping classes, study blocks, and project work visible across devices.",
    "Apple Calendar":
      "Helpful if your personal schedule already lives across Apple devices.",
    "Outlook Calendar":
      "A good fit when school, work, or internship commitments live in Microsoft tools.",
    "D2L / Brightspace":
      "Most relevant for pulling course deadlines, quizzes, and assignment dates into planning.",
    "ICS import/export":
      "A flexible fallback for importing course calendars or exported academic schedules.",
    "Work schedule imports":
      "Helpful if you balance classes around part-time jobs or shift work.",
  },
  Professional: {
    "Google Calendar":
      "Strong for coordinating focus blocks, project deadlines, and shared calendars.",
    "Apple Calendar":
      "Useful when personal commitments and work blocks need to sit beside each other.",
    "Outlook Calendar":
      "A natural fit for meetings, follow-ups, deadlines, and Microsoft-based workdays.",
    "D2L / Brightspace":
      "Less central for most professional workflows unless you also manage coursework.",
    "ICS import/export":
      "Helpful for moving calendar data between tools without a direct connection.",
    "Work schedule imports":
      "Useful if your work relies on shift schedules or variable hours.",
  },
  "Organization leader": {
    "Google Calendar":
      "Helpful for shared events, team reminders, and coordinating schedules with others.",
    "Apple Calendar":
      "Useful for keeping organization work visible beside personal commitments.",
    "Outlook Calendar":
      "A good fit for formal meetings, admin work, and organization communications.",
    "D2L / Brightspace":
      "Useful only if your organization planning overlaps with course-based schedules.",
    "ICS import/export":
      "Helpful for sharing events or importing calendars from tools that export files.",
    "Work schedule imports":
      "Helpful for aligning organization commitments with personal work schedules.",
  },
  "Creator / entrepreneur": {
    "Google Calendar":
      "Useful for content blocks, client commitments, launches, and cross-device planning.",
    "Apple Calendar":
      "Helpful when creative work needs to stay visible beside personal scheduling.",
    "Outlook Calendar":
      "A good fit if clients, admin work, or meetings already run through Microsoft tools.",
    "D2L / Brightspace":
      "Less central unless your creator or business work also overlaps with coursework.",
    "ICS import/export":
      "Useful for exporting launches, content plans, or important work blocks into other tools.",
    "Work schedule imports":
      "A great fit if you balance creative work around a separate day job or shift schedule.",
  },
  "General planning": {
    "Google Calendar":
      "A balanced option for keeping weekly plans visible across devices and shared calendars.",
    "Apple Calendar":
      "A practical fit if your everyday schedule lives on Apple devices.",
    "Outlook Calendar":
      "Useful when meetings, work commitments, or admin tasks live in Microsoft tools.",
    "D2L / Brightspace":
      "Best when classes, assignments, or course calendars are part of your planning.",
    "ICS import/export":
      "A flexible option for moving calendar data in or out without a direct integration.",
    "Work schedule imports":
      "Useful if you need to plan your week around variable work shifts.",
  },
};


export function IntegrationsPage() {
  const [plannerType, setPlannerType] =
    useState<PlannerType>("General planning");
  const [desiredIntegrations, setDesiredIntegrations] = useState<
    DesiredIntegration[]
  >([]);
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<GoogleCalendarConnectionStatus>("not_connected");
  const [googleCalendarLastSyncedAt, setGoogleCalendarLastSyncedAt] = useState<
    string | null
  >(null);
  const [googleCalendarMessage, setGoogleCalendarMessage] = useState<
    string | null
  >(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(
    null,
  );
  const [isGoogleCalendarBusy, setIsGoogleCalendarBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let isActive = true;

    async function loadPlannerProfile() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (!isActive) {
          return;
        }

        if (sessionError) {
          return;
        }

        const userId = sessionData.session?.user.id;

        if (!userId) {
          return;
        }

        const profileResult = await fetchPlannerProfileForUser(supabase, userId);

        if (!isActive) {
          return;
        }

        if (profileResult.error) {
          return;
        }

        if (profileResult.data) {
          setPlannerType(profileResult.data.plannerType);
          setDesiredIntegrations(profileResult.data.desiredIntegrations);
        } else {
          setPlannerType("General planning");
          setDesiredIntegrations([]);
        }
      } catch (error) {
        if (!isActive) {
          return;
        }
      }
    }

    void loadPlannerProfile();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("google_calendar");
    const calendarError = params.get("google_calendar_error");

    if (connected === "connected") {
      setGoogleCalendarMessage(
        "Google Calendar connected. Upcoming events were synced for planning.",
      );
    }

    if (calendarError) {
      setGoogleCalendarError(calendarError);
    }

    if (connected || calendarError) {
      params.delete("google_calendar");
      params.delete("google_calendar_error");
      const nextUrl = `${window.location.pathname}${
        params.toString() ? `?${params.toString()}` : ""
      }${window.location.hash}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let isActive = true;

    async function loadGoogleCalendarStatus() {
      try {
        const accessToken = await getSupabaseAccessToken();

        if (!accessToken || !isActive) {
          return;
        }

        const response = await fetch("/api/google-calendar/status", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const payload = (await response.json()) as GoogleCalendarStatusResponse;

        if (!isActive) {
          return;
        }

        if (!response.ok || payload.error) {
          setGoogleCalendarError(
            payload.error ?? "Google Calendar status could not be loaded.",
          );
          return;
        }

        setGoogleCalendarStatus(payload.status ?? "not_connected");
        setGoogleCalendarLastSyncedAt(payload.lastSyncedAt ?? null);

        if (payload.errorMessage) {
          setGoogleCalendarError(payload.errorMessage);
        }
      } catch (error) {
        if (!isActive) {
          return;
        }

        setGoogleCalendarError(getGoogleCalendarUiError(error));
      }
    }

    void loadGoogleCalendarStatus();

    return () => {
      isActive = false;
    };
  }, []);

  async function getSupabaseAccessToken() {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured yet.");
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message);
    }

    const accessToken = data.session?.access_token;

    if (!accessToken) {
      throw new Error("Sign in before connecting Google Calendar.");
    }

    return accessToken;
  }

  function getGoogleCalendarUiError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return "Google Calendar is unavailable right now.";
  }

  async function connectGoogleCalendar() {
    setIsGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    setGoogleCalendarMessage(null);

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/google-calendar/connect", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
      });
      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };

      if (!response.ok || payload.error || !payload.authorizationUrl) {
        throw new Error(
          payload.error ?? "Google Calendar connection could not start.",
        );
      }

      window.location.href = payload.authorizationUrl;
    } catch (error) {
      setGoogleCalendarError(getGoogleCalendarUiError(error));
      setIsGoogleCalendarBusy(false);
    }
  }

  async function syncGoogleCalendar() {
    setIsGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    setGoogleCalendarMessage(null);

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/google-calendar/sync", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
      });
      const payload = (await response.json()) as GoogleCalendarSyncResponse;

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Google Calendar sync failed.");
      }

      setGoogleCalendarStatus("connected");
      setGoogleCalendarLastSyncedAt(new Date().toISOString());
      setGoogleCalendarMessage(
        `Synced ${payload.importedCount ?? 0} Google Calendar event${
          payload.importedCount === 1 ? "" : "s"
        } for planning.`,
      );
    } catch (error) {
      setGoogleCalendarError(getGoogleCalendarUiError(error));
    } finally {
      setIsGoogleCalendarBusy(false);
    }
  }

  async function disconnectGoogleCalendar() {
    if (
      !window.confirm(
        "Disconnect Google Calendar from Schedule Builder? This only removes the cached Google events from this app.",
      )
    ) {
      return;
    }

    setIsGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    setGoogleCalendarMessage(null);

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/google-calendar/disconnect", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Google Calendar disconnect failed.");
      }

      setGoogleCalendarStatus("not_connected");
      setGoogleCalendarLastSyncedAt(null);
      setGoogleCalendarMessage("Google Calendar disconnected.");
    } catch (error) {
      setGoogleCalendarError(getGoogleCalendarUiError(error));
    } finally {
      setIsGoogleCalendarBusy(false);
    }
  }

  const selectedIntegrations = useMemo(() => {
    return new Set<DesiredIntegration>(desiredIntegrations);
  }, [desiredIntegrations]);

  const workflowRecommendedIntegrations = useMemo(() => {
    return new Set<DesiredIntegration>(
      defaultRecommendationsByPlannerType[plannerType],
    );
  }, [plannerType]);

  const visibleIntegrations = useMemo(() => {
    return [...integrations].sort((first, second) => {
      const firstSelected = selectedIntegrations.has(first.onboardingName);
      const secondSelected = selectedIntegrations.has(second.onboardingName);
      const firstWorkflowRecommended = workflowRecommendedIntegrations.has(
        first.onboardingName,
      );
      const secondWorkflowRecommended = workflowRecommendedIntegrations.has(
        second.onboardingName,
      );
      const firstScore = (firstSelected ? 2 : 0) + (firstWorkflowRecommended ? 1 : 0);
      const secondScore =
        (secondSelected ? 2 : 0) + (secondWorkflowRecommended ? 1 : 0);

      return secondScore - firstScore;
    });
  }, [selectedIntegrations, workflowRecommendedIntegrations]);

  const recommendationSource =
    desiredIntegrations.length > 0
      ? "Recommended for you"
      : `Recommended for ${plannerType.toLowerCase()}`;

  const availableIntegrations = visibleIntegrations.filter(i => i.status === "available");
  const comingSoonIntegrations = visibleIntegrations.filter(i => i.status === "coming_soon");
  const googleCalendarStatusLabel =
    googleCalendarStatus === "connected"
      ? "Connected"
      : googleCalendarStatus === "needs_reconnect"
        ? "Needs reconnect"
        : googleCalendarStatus === "pending"
          ? "Connection pending"
          : "Not connected";
  const googleCalendarLastSyncLabel = googleCalendarLastSyncedAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(googleCalendarLastSyncedAt))
    : null;

  function renderGoogleCalendarActions() {
    return (
      <div className="w-full space-y-3">
        <div className="rounded-[18px] border border-brand-ink/8 bg-white/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={
                googleCalendarStatus === "connected"
                  ? "bg-brand-teal/10 text-brand-teal"
                  : googleCalendarStatus === "needs_reconnect"
                    ? "bg-brand-coral/10 text-brand-coral"
                    : "bg-brand-ink/[0.05] text-brand-ink/55"
              }
              variant="subtle"
            >
              {googleCalendarStatusLabel}
            </Badge>
            <Badge className="bg-brand-ink/[0.04] text-brand-ink/54" variant="subtle">
              Read-only
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-brand-ink/62">
            Schedule Builder can read upcoming Google Calendar events for
            planning context. It cannot create, edit, or delete Google Calendar
            events.
          </p>
          {googleCalendarLastSyncLabel ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/38">
              Last sync: {googleCalendarLastSyncLabel}
            </p>
          ) : null}
        </div>

        {googleCalendarMessage ? (
          <p className="rounded-2xl border border-brand-teal/15 bg-brand-teal/[0.07] px-3 py-2 text-sm font-medium leading-6 text-brand-teal">
            {googleCalendarMessage}
          </p>
        ) : null}

        {googleCalendarError ? (
          <p className="rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-sm font-medium leading-6 text-brand-coral">
            {googleCalendarError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {googleCalendarStatus === "connected" ? (
            <>
              <button
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-ink px-6 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                disabled={isGoogleCalendarBusy}
                type="button"
                onClick={syncGoogleCalendar}
              >
                {isGoogleCalendarBusy ? "Syncing..." : "Sync calendar"}
              </button>
              <button
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand-ink/10 bg-white/75 px-6 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                disabled={isGoogleCalendarBusy}
                type="button"
                onClick={disconnectGoogleCalendar}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-ink px-6 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
              disabled={isGoogleCalendarBusy}
              type="button"
              onClick={connectGoogleCalendar}
            >
              {isGoogleCalendarBusy
                ? "Opening Google..."
                : googleCalendarStatus === "needs_reconnect"
                  ? "Reconnect Google Calendar"
                  : "Connect Google Calendar"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-28 pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_320px] lg:items-end lg:gap-6">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Settings / Integrations
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                Connect your schedule tools
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                Bring calendar events, deadlines, and planning workflows into
                Schedule Builder.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>{visibleIntegrations.length} integrations</Badge>
                <Badge variant="subtle">{recommendationSource}</Badge>
              </div>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
              <CardContent className="p-4 sm:p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-teal">
                  Planned Roadmap
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-[22px] border border-brand-ink/8 bg-white/75 p-4">
                    <p className="text-sm leading-6 text-brand-ink/70">
                      <span className="font-semibold text-brand-ink">Start with read-only calendar context today.</span> Google Calendar and ICS import/export can bring commitments into Schedule Builder without writing back to your calendars.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="mt-4">
          <h2 className="mb-5 text-lg font-semibold tracking-tight text-brand-ink sm:text-xl">
            Available now
          </h2>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
            {availableIntegrations.map((integration) => {
              const wasSelectedDuringSetup = selectedIntegrations.has(
                integration.onboardingName,
              );
              const isRecommended = wasSelectedDuringSetup;
              const recommendationLabel = "Selected during setup";

              return (
                <IntegrationCard
                  actionSlot={
                    integration.id === "google-calendar"
                      ? renderGoogleCalendarActions()
                      : undefined
                  }
                  key={integration.id}
                  integration={integration}
                  isRecommended={isRecommended}
                  recommendationLabel={recommendationLabel}
                  recommendationReason={
                    isRecommended
                      ? recommendationReasons[plannerType][integration.onboardingName]
                      : undefined
                  }
                />
              );
            })}
          </section>
        </div>

        <section id="import-ics" className="scroll-mt-6">
          <IcsImportPanel />
        </section>

        <div className="mt-8 lg:mt-12">
          <h2 className="mb-5 text-lg font-semibold tracking-tight text-brand-ink sm:text-xl">
            Coming soon
          </h2>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
            {comingSoonIntegrations.map((integration) => {
              const wasSelectedDuringSetup = selectedIntegrations.has(
                integration.onboardingName,
              );
              const isRecommended = wasSelectedDuringSetup;
              const recommendationLabel = "Selected during setup";

              return (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  isRecommended={isRecommended}
                  recommendationLabel={recommendationLabel}
                  recommendationReason={
                    isRecommended
                      ? recommendationReasons[plannerType][integration.onboardingName]
                      : undefined
                  }
                />
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
