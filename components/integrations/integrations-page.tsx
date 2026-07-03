"use client";

import { IcsImportPanel } from "@/components/calendar/ics-import-panel";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "@/components/projects/icons";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { SchedulerAppShell } from "@/components/scheduler/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  formatImportedEventSource,
  getImportedCalendarSourceRemovalCopy,
  isManageableImportedCalendarSource,
  type ImportedCalendarEvent,
  type ManageableImportedCalendarSource,
} from "@/lib/imported-calendar";
import { integrations } from "@/lib/integrations";
import {
  type DesiredIntegration,
  type PlannerType,
} from "@/lib/onboarding";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchImportedCalendarEventsForUser,
  fetchPlannerProfileForUser,
} from "@/lib/supabase/scheduler";
import { getUserFacingError } from "@/lib/user-facing-error";

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

type RemoveImportedCalendarSourceResponse = {
  deletedCount?: number;
  error?: string;
  message?: string;
  source?: string;
};

type ImportedCalendarSummary = {
  count: number;
  dateRangeLabel: string;
  latestImportedAt: string | null;
  latestImportedLabel: string;
  source: ManageableImportedCalendarSource;
  sourceLabel: string;
};

type SchoolImportSetupId = "canvas" | "d2l";

type SchoolImportSetup = {
  accentClassName: string;
  buttonLabel: string;
  description: string;
  emptyHelpText: string;
  id: SchoolImportSetupId;
  label: string;
  panelTitle: string;
  source: string;
  sourceLabel: string;
  steps: string[];
  title: string;
};

const schoolImportSetups: Record<SchoolImportSetupId, SchoolImportSetup> = {
  d2l: {
    accentClassName: "border-[#a44824]/14 bg-[#fff2ea] text-[#a44824]",
    buttonLabel: "Choose Brightspace ICS file",
    description:
      "Download your Brightspace calendar file, then upload it here to review assignments, quizzes, and course events before saving.",
    emptyHelpText:
      "No events found in this file. Download your Brightspace calendar file first, then upload it here.",
    id: "d2l",
    label: "D2L / Brightspace",
    panelTitle: "Upload Brightspace calendar file",
    source: "d2l_ics",
    sourceLabel: "D2L / Brightspace",
    steps: [
      "Open D2L / Brightspace and go to Calendar.",
      "Look for Export, Subscribe, iCal, or ICS options.",
      "Download the .ics calendar file if your school offers one.",
      "Upload it here and choose which events to import.",
    ],
    title: "Import your Brightspace calendar",
  },
  canvas: {
    accentClassName: "border-[#b33b24]/14 bg-[#fff5f2] text-[#b33b24]",
    buttonLabel: "Choose Canvas ICS file",
    description:
      "Use your Canvas calendar export or feed file to review assignments, quizzes, course events, and due dates before saving.",
    emptyHelpText:
      "No events found in this file. Download your Canvas calendar file first, then upload it here.",
    id: "canvas",
    label: "Canvas",
    panelTitle: "Upload Canvas calendar file",
    source: "canvas_ics",
    sourceLabel: "Canvas",
    steps: [
      "Open Canvas and go to Calendar.",
      "Find Calendar Feed, iCal, Export, or Subscribe.",
      "Download or save the calendar file if your school offers one.",
      "Upload it here and choose which events to import.",
    ],
    title: "Import your Canvas calendar",
  },
};

function getSchoolSetupIdForIntegration(
  integrationId: string,
): SchoolImportSetupId | null {
  if (integrationId === "d2l-brightspace-calendar") {
    return "d2l";
  }

  if (integrationId === "canvas-calendar") {
    return "canvas";
  }

  return null;
}

const schoolCalendarIntegrationIds = new Set([
  "d2l-brightspace-calendar",
  "canvas-calendar",
]);

function formatImportedCalendarManagementSource(source: string) {
  if (source === "ics") {
    return "Imported calendar";
  }

  return formatImportedEventSource(source);
}

function formatImportedCalendarDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getImportedCalendarSourceSummaries(
  events: ImportedCalendarEvent[],
): ImportedCalendarSummary[] {
  const groups = events.reduce(
    (current, event) => {
      if (!isManageableImportedCalendarSource(event.source)) {
        return current;
      }

      const group = current.get(event.source) ?? [];
      group.push(event);
      current.set(event.source, group);
      return current;
    },
    new Map<ManageableImportedCalendarSource, ImportedCalendarEvent[]>(),
  );

  return [...groups.entries()]
    .map(([source, sourceEvents]) => {
      const importedTimes = sourceEvents
        .map((event) => new Date(event.importedAt).getTime())
        .filter((time) => !Number.isNaN(time));
      const eventTimes = sourceEvents
        .map((event) => new Date(event.startsAt).getTime())
        .filter((time) => !Number.isNaN(time));
      const latestImportedAt =
        importedTimes.length > 0
          ? new Date(Math.max(...importedTimes)).toISOString()
          : null;
      const firstEventDate =
        eventTimes.length > 0
          ? new Date(Math.min(...eventTimes)).toISOString()
          : null;
      const lastEventDate =
        eventTimes.length > 0
          ? new Date(Math.max(...eventTimes)).toISOString()
          : null;
      const firstEventLabel = formatImportedCalendarDate(firstEventDate);
      const lastEventLabel = formatImportedCalendarDate(lastEventDate);

      return {
        count: sourceEvents.length,
        dateRangeLabel:
          firstEventLabel === lastEventLabel
            ? firstEventLabel
            : `${firstEventLabel} - ${lastEventLabel}`,
        latestImportedAt,
        latestImportedLabel: latestImportedAt
          ? formatImportedCalendarDate(latestImportedAt)
          : "Unknown",
        source,
        sourceLabel: formatImportedCalendarManagementSource(source),
      };
    })
    .sort((first, second) =>
      first.sourceLabel.localeCompare(second.sourceLabel),
    );
}

const defaultRecommendationsByPlannerType: Record<
  PlannerType,
  DesiredIntegration[]
> = {
  Student: [
    "D2L / Brightspace",
    "Canvas",
    "Google Calendar",
    "ICS import/export",
  ],
  Professional: ["Google Calendar", "ICS import/export"],
  "Organization leader": ["Google Calendar", "ICS import/export"],
  "Creator / entrepreneur": ["Google Calendar", "ICS import/export"],
  "General planning": ["Google Calendar", "ICS import/export"],
};

const recommendationReasons: Record<
  PlannerType,
  Partial<Record<DesiredIntegration, string>>
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
    Canvas:
      "Useful when Canvas holds your assignments, quizzes, course events, and due dates.",
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
  const [openSchoolSetup, setOpenSchoolSetup] =
    useState<SchoolImportSetupId | null>(null);
  const [isIcsImportOpen, setIsIcsImportOpen] = useState(false);
  const [importedEvents, setImportedEvents] = useState<
    ImportedCalendarEvent[]
  >([]);
  const [importedCalendarMessage, setImportedCalendarMessage] = useState<
    string | null
  >(null);
  const [importedCalendarError, setImportedCalendarError] = useState<
    string | null
  >(null);
  const [sourcePendingRemoval, setSourcePendingRemoval] =
    useState<ManageableImportedCalendarSource | null>(null);
  const [sourceBeingRemoved, setSourceBeingRemoved] =
    useState<ManageableImportedCalendarSource | null>(null);

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
    if (!isSupabaseConfigured()) {
      return;
    }

    let isActive = true;

    async function loadImportedCalendarEvents() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (!isActive) {
          return;
        }

        if (sessionError) {
          setImportedCalendarError(sessionError.message);
          return;
        }

        const userId = sessionData.session?.user.id;

        if (!userId) {
          setImportedEvents([]);
          return;
        }

        const result = await fetchImportedCalendarEventsForUser(
          supabase,
          userId,
        );

        if (!isActive) {
          return;
        }

        if (result.error) {
          setImportedCalendarError(
            "Imported calendars could not be loaded. Refresh and try again.",
          );
          return;
        }

        setImportedEvents(result.data);
      } catch {
        if (!isActive) {
          return;
        }

        setImportedCalendarError(
          "Imported calendars could not be loaded. Refresh and try again.",
        );
      }
    }

    void loadImportedCalendarEvents();

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
        "Calendar sync enabled. Schedule Builder created or reused a dedicated Google Calendar. Time blocks sync only when you select them on the Weekly Plan page.",
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
    return getUserFacingError(
      error,
      "Google Calendar is unavailable right now.",
    );
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

  async function removeImportedCalendarSource(
    source: ManageableImportedCalendarSource,
  ) {
    const copy = getImportedCalendarSourceRemovalCopy(source);

    setSourceBeingRemoved(source);
    setImportedCalendarError(null);
    setImportedCalendarMessage(null);

    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/imported-calendar/remove-source", {
        body: JSON.stringify({ source }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload =
        (await response.json()) as RemoveImportedCalendarSourceResponse;

      if (!response.ok || payload.error) {
        throw new Error(
          payload.error ?? "Imported events could not be removed.",
        );
      }

      setImportedEvents((currentEvents) =>
        currentEvents.filter((event) => event.source !== source),
      );
      setImportedCalendarMessage(payload.message ?? copy.successMessage);
      setSourcePendingRemoval(null);
    } catch (error) {
      setImportedCalendarError(
        getUserFacingError(
          error,
          "Imported events could not be removed. Refresh and try again.",
        ),
      );
    } finally {
      setSourceBeingRemoved(null);
    }
  }

  function handleImportedCalendarEvents(events: ImportedCalendarEvent[]) {
    if (events.length === 0) {
      return;
    }

    setImportedEvents((currentEvents) => [...currentEvents, ...events]);
    setImportedCalendarError(null);
    setImportedCalendarMessage(null);
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

  const availableIntegrations = visibleIntegrations.filter(
    (integration) => integration.status === "available",
  );
  const schoolCalendarIntegrations = availableIntegrations.filter((integration) =>
    schoolCalendarIntegrationIds.has(integration.id),
  );
  const generalAvailableIntegrations = availableIntegrations.filter(
    (integration) => !schoolCalendarIntegrationIds.has(integration.id),
  );
  const comingSoonIntegrations = visibleIntegrations.filter(
    (integration) => integration.status === "coming_soon",
  );
  const importedCalendarSummaries = useMemo(
    () => getImportedCalendarSourceSummaries(importedEvents),
    [importedEvents],
  );
  const pendingRemovalCopy = sourcePendingRemoval
    ? getImportedCalendarSourceRemovalCopy(sourcePendingRemoval)
    : null;
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

  function toggleSchoolSetup(setupId: SchoolImportSetupId) {
    setOpenSchoolSetup((current) => {
      const next = current === setupId ? null : setupId;

      if (next) {
        setIsIcsImportOpen(false);
        window.setTimeout(() => {
          document
            .getElementById("school-calendar-import")
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
        setOpenSchoolSetup(null);
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
            sync only sends time blocks you manually choose from Weekly Plan.
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

  function renderSchoolCalendarActions(setupId: SchoolImportSetupId) {
    const setup = schoolImportSetups[setupId];
    const isOpen = openSchoolSetup === setupId;

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
          onClick={() => toggleSchoolSetup(setupId)}
          aria-expanded={isOpen}
          aria-controls="school-calendar-import"
        >
          {isOpen ? "Close guided setup" : `Open ${setup.label} setup`}
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
          aria-expanded={isIcsImportOpen}
          aria-controls="import-ics"
        >
          {isIcsImportOpen ? "Close ICS import" : "Import ICS File"}
        </button>
      </>
    );
  }

  function renderImportedCalendarsManagement() {
    return (
      <section className="panel overflow-hidden">
        <div className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Imported calendars
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-brand-ink sm:text-3xl">
                Manage imported school and calendar events
              </h2>
              <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                Remove imported event sets from Schedule Builder without
                changing Canvas, Brightspace, Google Calendar, projects, time
                blocks, or work shifts.
              </p>
            </div>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-xl border border-brand-ink/10 bg-white/80 px-5 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white"
              href="/calendar"
            >
              View Calendar
            </Link>
          </div>

          {importedCalendarMessage ? (
            <p className="mt-4 rounded-2xl border border-brand-teal/15 bg-brand-teal/[0.07] px-4 py-3 text-sm font-medium leading-6 text-brand-teal">
              {importedCalendarMessage}
            </p>
          ) : null}

          {importedCalendarError ? (
            <p className="mt-4 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
              {importedCalendarError}
            </p>
          ) : null}

          {importedCalendarSummaries.length > 0 ? (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {importedCalendarSummaries.map((summary) => {
                const copy = getImportedCalendarSourceRemovalCopy(
                  summary.source,
                );
                const isRemoving = sourceBeingRemoved === summary.source;

                return (
                  <article
                    className="rounded-[26px] border border-brand-ink/8 bg-white/76 p-4 shadow-[0_16px_36px_rgba(18,32,47,0.045)]"
                    key={summary.source}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Badge className="bg-brand-teal/10 text-brand-teal" variant="subtle">
                          Imported
                        </Badge>
                        <h3 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-brand-ink">
                          {summary.sourceLabel}
                        </h3>
                      </div>
                      <span className="rounded-full bg-brand-ink/[0.045] px-3 py-1 text-sm font-semibold text-brand-ink/58">
                        {summary.count} event{summary.count === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-ink/6 bg-white/70 px-3 py-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/42">
                          Latest import
                        </span>
                        <span className="text-sm font-semibold text-brand-ink/66">
                          {summary.latestImportedLabel}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-ink/6 bg-white/70 px-3 py-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/42">
                          Date range
                        </span>
                        <span className="text-sm font-semibold text-brand-ink/66">
                          {summary.dateRangeLabel}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-brand-ink/10 bg-white/80 px-4 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white sm:flex-none"
                        href="/calendar"
                      >
                        Manage
                      </Link>
                      <button
                        className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-brand-coral/18 bg-brand-coral/[0.07] px-4 text-sm font-semibold text-brand-coral transition-all hover:-translate-y-0.5 hover:bg-brand-coral/10 disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none"
                        disabled={Boolean(sourceBeingRemoved)}
                        type="button"
                        onClick={() => setSourcePendingRemoval(summary.source)}
                      >
                        {isRemoving ? "Removing..." : copy.removeLabel}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-[24px] border border-dashed border-brand-ink/12 bg-white/62 p-5">
              <h3 className="text-lg font-semibold text-brand-ink">
                No imported calendars yet
              </h3>
              <p className="mt-2 text-sm leading-6 text-brand-ink/58">
                Import Canvas, D2L / Brightspace, or a calendar file first.
                Imported event management will appear here after events are
                saved.
              </p>
            </div>
          )}

          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/36">
            Current imports are managed by source. Removing one import type
            removes all saved events from that source.
          </p>
        </div>
      </section>
    );
  }

  return (
    <SchedulerAppShell contentClassName="flex flex-col gap-5 sm:gap-6">

        <section className="page-header !block overflow-hidden bg-dashboard-radial">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_320px] lg:items-end lg:gap-6">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Outside schedule sources
              </div>

              <h1 className="page-title mt-3">
                Integrations
              </h1>

              <p className="page-contract max-w-2xl">
                Connect the tools that provide your schedule context.
              </p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-brand-ink/55">
                Import school events, read external calendars, and manually
                send approved plans when you choose.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>{availableIntegrations.length} available now</Badge>
                <Badge variant="subtle">School calendar pack</Badge>
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
                      only writes approved time blocks to your dedicated
                      Schedule Builder calendar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="mt-4">
          <div className="mb-5">
            <h2 className="text-lg font-semibold tracking-tight text-brand-ink sm:text-xl">
              School calendars
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-ink/60">
              Import course events through calendar files without sharing school
              credentials. Using Blackboard, Moodle, or another school platform?
              If it provides an iCal or ICS export, use Calendar import/export
              below.
            </p>
          </div>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
            {schoolCalendarIntegrations.map((integration) => {
              const wasSelectedDuringSetup = selectedIntegrations.has(
                integration.onboardingName,
              );
              const isRecommended = wasSelectedDuringSetup;
              const recommendationLabel = "Selected during setup";
              const schoolSetupId = getSchoolSetupIdForIntegration(integration.id);

              return (
                <IntegrationCard
                  actionSlot={
                    schoolSetupId
                      ? renderSchoolCalendarActions(schoolSetupId)
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

        <div
          className={`grid transition-all duration-300 ease-in-out ${
            openSchoolSetup
              ? "mt-0 grid-rows-[1fr] opacity-100"
              : "-mt-5 grid-rows-[0fr] opacity-0 sm:-mt-6"
          }`}
          aria-hidden={!openSchoolSetup}
          {...(!openSchoolSetup ? { inert: true } : {})}
        >
          <div className="overflow-hidden">
            <section
              id="school-calendar-import"
              className={`grid scroll-mt-6 gap-4 pb-2 pt-1 lg:grid-cols-[0.9fr_1.1fr] transition-transform duration-300 ease-in-out ${
                openSchoolSetup ? "translate-y-0" : "-translate-y-2"
              }`}
            >
              {openSchoolSetup ? (
                <>
                  <Card className="rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)]">
                    <CardContent className="p-4 sm:p-6">
                      <div
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${schoolImportSetups[openSchoolSetup].accentClassName}`}
                      >
                        {schoolImportSetups[openSchoolSetup].label}
                      </div>
                      <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                        {schoolImportSetups[openSchoolSetup].title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                        {schoolImportSetups[openSchoolSetup].description}
                      </p>

                      <ol className="mt-5 grid gap-3">
                        {schoolImportSetups[openSchoolSetup].steps.map(
                          (step, index) => (
                            <li
                              className="flex gap-3 rounded-[20px] border border-brand-ink/8 bg-white/72 p-3 text-sm leading-6 text-brand-ink/68"
                              key={step}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-xs font-bold text-brand-teal">
                                {index + 1}
                              </span>
                              <span>{step}</span>
                            </li>
                          ),
                        )}
                      </ol>

                      <p className="mt-4 rounded-[20px] border border-brand-teal/14 bg-brand-teal/[0.06] px-4 py-3 text-sm font-medium leading-6 text-brand-teal">
                        No school login or password is needed. Imported events
                        are always reviewed before saving.
                      </p>
                    </CardContent>
                  </Card>

                  <IcsImportPanel
                    buttonLabel={schoolImportSetups[openSchoolSetup].buttonLabel}
                    compact
                    description={`Upload the .ics file from ${schoolImportSetups[openSchoolSetup].sourceLabel}. You will choose which school events to import before anything is saved.`}
                    emptyHelpText={schoolImportSetups[openSchoolSetup].emptyHelpText}
                    onImported={handleImportedCalendarEvents}
                    source={schoolImportSetups[openSchoolSetup].source}
                    sourceLabel={schoolImportSetups[openSchoolSetup].sourceLabel}
                    title={schoolImportSetups[openSchoolSetup].panelTitle}
                  />
                </>
              ) : null}
            </section>
          </div>
        </div>

        <div className="mt-6 lg:mt-8">
          <h2 className="mb-5 text-lg font-semibold tracking-tight text-brand-ink sm:text-xl">
            Calendar connections
          </h2>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
            {generalAvailableIntegrations.map((integration) => {
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

        <div
          className={`grid transition-all duration-300 ease-in-out ${
            isIcsImportOpen
              ? "mt-0 grid-rows-[1fr] opacity-100"
              : "-mt-5 grid-rows-[0fr] opacity-0 sm:-mt-6"
          }`}
          aria-hidden={!isIcsImportOpen}
          {...(!isIcsImportOpen ? { inert: true } : {})}
        >
          <div className="overflow-hidden">
            <section
              id="import-ics"
              className={`scroll-mt-6 pb-2 pt-1 transition-transform duration-300 ease-in-out ${
                isIcsImportOpen ? "translate-y-0" : "-translate-y-2"
              }`}
            >
              <IcsImportPanel
                description="Upload a calendar file from school, work, Apple Calendar, Google Calendar, Outlook, or another app. You will review events before anything is saved."
                onImported={handleImportedCalendarEvents}
                title="Import a calendar file"
              />
            </section>
          </div>
        </div>

        <div className="mt-6 lg:mt-8">
          {renderImportedCalendarsManagement()}
        </div>

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

        <ConfirmDialog
          confirmLabel={pendingRemovalCopy?.confirmLabel ?? "Remove events"}
          description={pendingRemovalCopy?.description ?? ""}
          destructive
          loading={Boolean(sourceBeingRemoved)}
          open={Boolean(sourcePendingRemoval)}
          title={pendingRemovalCopy?.title ?? "Remove imported events?"}
          onCancel={() => {
            if (!sourceBeingRemoved) {
              setSourcePendingRemoval(null);
            }
          }}
          onConfirm={() => {
            if (sourcePendingRemoval) {
              void removeImportedCalendarSource(sourcePendingRemoval);
            }
          }}
        />
    </SchedulerAppShell>
  );
}
