"use client";

import { IcsImportPanel } from "@/components/calendar/ics-import-panel";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "@/components/projects/icons";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  syncCalendarName?: string | null;
  syncEnabled?: boolean;
  writeGrantedAt?: string | null;
  writeScope?: string | null;
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
  const [googleCalendarSyncEnabled, setGoogleCalendarSyncEnabled] =
    useState(false);
  const [googleCalendarSyncCalendarName, setGoogleCalendarSyncCalendarName] =
    useState<string | null>(null);
  const [googleCalendarWriteGrantedAt, setGoogleCalendarWriteGrantedAt] =
    useState<string | null>(null);
  const [googleCalendarMessage, setGoogleCalendarMessage] = useState<
    string | null
  >(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(
    null,
  );
  const [
    googleCalendarAuthorizationUrl,
    setGoogleCalendarAuthorizationUrl,
  ] = useState<string | null>(null);
  const [isGoogleCalendarBusy, setIsGoogleCalendarBusy] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [isD2lSetupOpen, setIsD2lSetupOpen] = useState(false);
  const [isIcsImportOpen, setIsIcsImportOpen] = useState(false);

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
    const syncEnabled = params.get("google_calendar_sync");
    const calendarError = params.get("google_calendar_error");
    const calendarSyncError = params.get("google_calendar_sync_error");

    if (connected === "connected") {
      setGoogleCalendarAuthorizationUrl(null);
      setGoogleCalendarMessage(
        "Google Calendar connected. Upcoming events were synced for planning.",
      );
    }

    if (syncEnabled === "enabled") {
      setGoogleCalendarAuthorizationUrl(null);
      setGoogleCalendarMessage(
        "Calendar sync enabled. Schedule Builder created or reused a dedicated Google Calendar. Weekly Plan blocks sync only when you select them on the Weekly Plan page.",
      );
      setGoogleCalendarSyncEnabled(true);
    }

    if (calendarError || calendarSyncError) {
      setGoogleCalendarAuthorizationUrl(null);
      setGoogleCalendarError(calendarError ?? calendarSyncError);
    }

    if (connected || syncEnabled || calendarError || calendarSyncError) {
      params.delete("google_calendar");
      params.delete("google_calendar_sync");
      params.delete("google_calendar_error");
      params.delete("google_calendar_sync_error");
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
        setGoogleCalendarSyncEnabled(Boolean(payload.syncEnabled));
        setGoogleCalendarSyncCalendarName(payload.syncCalendarName ?? null);
        setGoogleCalendarWriteGrantedAt(payload.writeGrantedAt ?? null);

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

  async function startGoogleCalendarAuthorization(
    endpoint: "/api/google-calendar/connect" | "/api/google-calendar/enable-sync",
    fallbackErrorMessage: string,
  ) {
    setIsGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    setGoogleCalendarAuthorizationUrl(null);
    setGoogleCalendarMessage("Opening Google authorization...");

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch(endpoint, {
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
          payload.error ?? fallbackErrorMessage,
        );
      }

      setGoogleCalendarAuthorizationUrl(payload.authorizationUrl);
      setGoogleCalendarMessage(
        "Google authorization is ready. If it does not open automatically, use the button below.",
      );
      window.location.assign(payload.authorizationUrl);
      window.setTimeout(() => setIsGoogleCalendarBusy(false), 1500);
    } catch (error) {
      setGoogleCalendarError(getGoogleCalendarUiError(error));
      setGoogleCalendarMessage(null);
      setIsGoogleCalendarBusy(false);
    }
  }

  async function connectGoogleCalendar() {
    await startGoogleCalendarAuthorization(
      "/api/google-calendar/connect",
      "Google Calendar connection could not start.",
    );
  }

  async function enableGoogleCalendarSync() {
    await startGoogleCalendarAuthorization(
      "/api/google-calendar/enable-sync",
      "Google Calendar sync permission could not start.",
    );
  }

  async function syncGoogleCalendar() {
    setIsGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    setGoogleCalendarMessage(null);
    setGoogleCalendarAuthorizationUrl(null);

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
    setIsDisconnectDialogOpen(false);
    setIsGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    setGoogleCalendarMessage(null);
    setGoogleCalendarAuthorizationUrl(null);

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
      setGoogleCalendarSyncCalendarName(null);
      setGoogleCalendarSyncEnabled(false);
      setGoogleCalendarWriteGrantedAt(null);
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
  const googleCalendarWriteGrantedLabel = googleCalendarWriteGrantedAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(googleCalendarWriteGrantedAt))
    : null;
  const googleCalendarStatusRows = [
    {
      label: "Read-only",
      value: googleCalendarStatusLabel,
      tone:
        googleCalendarStatus === "connected"
          ? "success"
          : googleCalendarStatus === "needs_reconnect"
            ? "warning"
            : "muted",
    },
    {
      label: "Sync",
      value: googleCalendarSyncEnabled ? "Enabled" : "Not enabled",
      tone: googleCalendarSyncEnabled ? "success" : "muted",
    },
    {
      label: "Last read-only sync",
      value: googleCalendarLastSyncLabel ?? "Not refreshed yet",
      tone: googleCalendarLastSyncLabel ? "muted" : "soft",
    },
    {
      label: "Sync calendar",
      value: googleCalendarSyncEnabled
        ? googleCalendarSyncCalendarName ?? "Schedule Builder"
        : "Enable sync to create one",
      tone: googleCalendarSyncEnabled ? "muted" : "soft",
    },
  ];

  function toggleD2lSetup() {
    setIsD2lSetupOpen((current) => {
      const next = !current;

      if (next) {
        setIsIcsImportOpen(false);
        window.setTimeout(() => {
          document
            .getElementById("d2l-brightspace-import")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }

      return next;
    });
  }

  function toggleIcsImport() {
    setIsIcsImportOpen((current) => {
      const next = !current;

      if (next) {
        setIsD2lSetupOpen(false);
        window.setTimeout(() => {
          document
            .getElementById("import-ics")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }

      return next;
    });
  }

  function renderGoogleCalendarActions() {
    return (
      <div className="w-full space-y-3">
        <div className="rounded-[18px] border border-brand-ink/8 bg-white/70 p-4">
          <div className="grid gap-2">
            {googleCalendarStatusRows.map((row) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-ink/6 bg-white/70 px-3 py-2"
                key={row.label}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/42">
                  {row.label}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    row.tone === "success"
                      ? "bg-brand-teal/10 text-brand-teal"
                      : row.tone === "warning"
                        ? "bg-brand-coral/10 text-brand-coral"
                        : row.tone === "soft"
                          ? "bg-brand-ink/[0.035] text-brand-ink/45"
                          : "bg-brand-ink/[0.045] text-brand-ink/58"
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          {googleCalendarWriteGrantedLabel ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/38">
              Sync permission enabled {googleCalendarWriteGrantedLabel}
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-brand-ink/62">
            Read-only events help Schedule Builder avoid conflicts. Calendar
            sync only sends blocks you manually choose from Weekly Plan.
          </p>
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

        {googleCalendarAuthorizationUrl ? (
          <a
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand-teal/20 bg-brand-teal/10 px-6 text-sm font-semibold text-brand-teal transition-all hover:-translate-y-0.5 hover:bg-brand-teal/15 sm:w-auto"
            href={googleCalendarAuthorizationUrl}
          >
            Open Google authorization
          </a>
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
                {isGoogleCalendarBusy ? "Refreshing..." : "Refresh events"}
              </button>
              <button
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand-ink/10 bg-white/75 px-6 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                disabled={isGoogleCalendarBusy || googleCalendarSyncEnabled}
                type="button"
                onClick={enableGoogleCalendarSync}
              >
                {isGoogleCalendarBusy
                  ? "Opening Google..."
                  : googleCalendarSyncEnabled
                    ? "Calendar sync enabled"
                    : "Enable Calendar Sync"}
              </button>
              <button
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand-ink/10 bg-white/75 px-6 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
                disabled={isGoogleCalendarBusy}
                type="button"
                onClick={() => setIsDisconnectDialogOpen(true)}
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

  function renderD2lActions() {
    return (
      <div className="w-full space-y-3">
        <div className="rounded-[18px] border border-[#a44824]/12 bg-[#fff2ea]/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-[#a44824]/10 text-[#a44824]" variant="subtle">
              Guided setup
            </Badge>
            <Badge className="bg-brand-ink/[0.045] text-brand-ink/55" variant="subtle">
              Uses ICS import
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-brand-ink/62">
            Bring in course calendar files without sharing school credentials.
            You will review every event before saving it.
          </p>
        </div>
        <button
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-ink px-6 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-ink/90 sm:w-auto"
          type="button"
          onClick={toggleD2lSetup}
        >
          {isD2lSetupOpen ? "Close guided setup" : "Open guided setup"}
        </button>
      </div>
    );
  }

  function renderIcsActions() {
    return (
      <>
        <Link
          href="/plan"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-ink px-6 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-ink/90 sm:w-auto"
        >
          Export from Weekly Plan
        </Link>
        <button
          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand-ink/10 bg-white/75 px-6 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white sm:w-auto"
          type="button"
          onClick={toggleIcsImport}
        >
          {isIcsImportOpen ? "Close ICS import" : "Import ICS File"}
        </button>
      </>
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
                Connect calendars, import school events, and send approved
                plans to your dedicated Schedule Builder Google Calendar.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>{availableIntegrations.length} available now</Badge>
                <Badge variant="subtle">Guided setup</Badge>
                <Badge variant="subtle">
                  {comingSoonIntegrations.length} coming soon
                </Badge>
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
                      <span className="font-semibold text-brand-ink">
                        Review first, then send when ready.
                      </span>{" "}
                      Google Calendar can read commitments now, and manual sync
                      only writes approved Weekly Plan blocks to your dedicated
                      Schedule Builder calendar.
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
                      : integration.id === "d2l-brightspace-calendar"
                        ? renderD2lActions()
                        : integration.id === "ics-upload-import"
                          ? renderIcsActions()
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

        {isD2lSetupOpen ? (
          <section
            id="d2l-brightspace-import"
            className="grid scroll-mt-6 gap-4 lg:grid-cols-[0.9fr_1.1fr]"
          >
            <Card className="rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)]">
              <CardContent className="p-4 sm:p-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#a44824]/14 bg-[#fff2ea] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#a44824]">
                  D2L / Brightspace
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                  Import your course calendar
                </h2>
                <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                  Download your Brightspace calendar file, then upload it here
                  to review assignments, quizzes, and course events before
                  saving.
                </p>

                <ol className="mt-5 grid gap-3">
                  {[
                    "Open D2L / Brightspace and go to Calendar.",
                    "Look for Export, Subscribe, iCal, or ICS options.",
                    "Download the .ics calendar file if your school offers one.",
                    "Upload it here and choose which events to import.",
                  ].map((step, index) => (
                    <li
                      className="flex gap-3 rounded-[20px] border border-brand-ink/8 bg-white/72 p-3 text-sm leading-6 text-brand-ink/68"
                      key={step}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#a44824]/10 text-xs font-bold text-[#a44824]">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                <p className="mt-4 rounded-[20px] border border-brand-teal/14 bg-brand-teal/[0.06] px-4 py-3 text-sm font-medium leading-6 text-brand-teal">
                  No school login or password is needed. Imported events are
                  always reviewed before saving.
                </p>
              </CardContent>
            </Card>

            <IcsImportPanel
              buttonLabel="Choose Brightspace ICS file"
              compact
              description="Upload the .ics file from D2L / Brightspace. You will choose which course events to import before anything is saved."
              emptyHelpText="No events found in this file. Download your Brightspace calendar file first, then upload it here."
              source="d2l_ics"
              sourceLabel="D2L / Brightspace"
              title="Upload Brightspace calendar file"
            />
          </section>
        ) : null}

        {isIcsImportOpen ? (
          <section id="import-ics" className="scroll-mt-6">
            <IcsImportPanel
              description="Upload a calendar file from school, work, Apple Calendar, Google Calendar, Outlook, or another app. You will review events before anything is saved."
              title="Import a calendar file"
            />
          </section>
        ) : null}

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

        <ConfirmDialog
          confirmLabel="Disconnect"
          description="Schedule Builder will stop reading your Google Calendar events. Existing local plans will not be deleted."
          destructive
          loading={isGoogleCalendarBusy}
          open={isDisconnectDialogOpen}
          title="Disconnect Google Calendar?"
          onCancel={() => setIsDisconnectDialogOpen(false)}
          onConfirm={() => void disconnectGoogleCalendar()}
        />
      </div>
    </div>
  );
}
