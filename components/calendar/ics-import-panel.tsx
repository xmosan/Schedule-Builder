"use client";

import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { CalendarIcon } from "@/components/projects/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatImportedEventDate,
  formatImportedEventTimeRange,
  type ImportedCalendarEvent,
  type ImportedCalendarEventDraft,
} from "@/lib/imported-calendar";
import { parseIcsCalendar, type ParsedIcsEvent } from "@/lib/ics-import";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { createImportedCalendarEventsForUser } from "@/lib/supabase/scheduler";

type IcsImportPanelProps = {
  buttonLabel?: string;
  compact?: boolean;
  description?: string;
  emptyHelpText?: string;
  onImported?: (events: ImportedCalendarEvent[]) => void;
  source?: string;
  sourceLabel?: string;
  title?: string;
};

type ImportStatus = "idle" | "parsing" | "ready" | "importing" | "done";

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

  return "ICS import is unavailable right now.";
}

function eventToDraft(
  event: ParsedIcsEvent,
  source: string,
): ImportedCalendarEventDraft {
  return {
    source,
    externalUid: event.externalUid,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
  };
}

export function IcsImportPanel({
  buttonLabel = "Choose ICS file",
  compact = false,
  description = "Upload a calendar file from school, work, Apple Calendar, Google Calendar, Outlook, or another app. You will review events before anything is saved.",
  emptyHelpText,
  onImported,
  source = "ics",
  sourceLabel = "ICS",
  title = "Import ICS file",
}: IcsImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [events, setEvents] = useState<ParsedIcsEvent[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEvents = useMemo(
    () => events.filter((event) => selectedIds.has(event.previewId)),
    [events, selectedIds],
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus("parsing");
    setMessage(null);
    setError(null);
    setWarnings([]);

    try {
      const content = await file.text();
      const result = parseIcsCalendar(content);

      setEvents(result.events);
      setSelectedIds(new Set(result.events.map((item) => item.previewId)));
      setWarnings(result.warnings);
      setStatus(result.events.length > 0 ? "ready" : "idle");
      setMessage(
        result.events.length > 0
          ? `Found ${result.events.length} ${sourceLabel} event${
              result.events.length === 1 ? "" : "s"
            }. Choose what to import.`
          : emptyHelpText ?? "No events found in this file.",
      );
    } catch (parseError) {
      setEvents([]);
      setSelectedIds(new Set());
      setStatus("idle");
      setError(getErrorMessage(parseError));
    } finally {
      event.target.value = "";
    }
  }

  async function importSelectedEvents() {
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured yet.");
      return;
    }

    if (selectedEvents.length === 0) {
      setError("Choose at least one event to import.");
      return;
    }

    setStatus("importing");
    setError(null);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const userId = data.session?.user.id;

      if (!userId) {
        setStatus("ready");
        setError("Sign in before importing calendar events.");
        return;
      }

      const result = await createImportedCalendarEventsForUser(
        supabase,
        userId,
        selectedEvents.map((event) => eventToDraft(event, source)),
      );

      if (result.error) {
        throw result.error;
      }

      setStatus("done");
      setMessage(
        `Imported ${result.data.length} event${
          result.data.length === 1 ? "" : "s"
        }${
          result.skippedDuplicates > 0
            ? `. Skipped ${result.skippedDuplicates} duplicate${
                result.skippedDuplicates === 1 ? "" : "s"
              }.`
            : "."
        }`,
      );
      setEvents([]);
      setSelectedIds(new Set());
      onImported?.(result.data);
    } catch (importError) {
      setStatus("ready");
      setError(getErrorMessage(importError));
    }
  }

  function toggleEvent(previewId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(previewId)) {
        next.delete(previewId);
      } else {
        next.add(previewId);
      }

      return next;
    });
  }

  function cancelPreview() {
    setEvents([]);
    setSelectedIds(new Set());
    setWarnings([]);
    setStatus("idle");
    setMessage(null);
    setError(null);
  }

  return (
    <Card
      className={`rounded-[30px] border-white/70 bg-white/88 ${
        compact ? "" : "shadow-[0_18px_45px_rgba(18,32,47,0.065)]"
      }`}
    >
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-teal/14 bg-brand-teal/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
              <CalendarIcon className="h-4 w-4" />
              {sourceLabel} import
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-brand-ink">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-ink/62">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              accept=".ics,text/calendar"
              className="hidden"
              type="file"
              onChange={handleFileChange}
            />
            <Button
              disabled={status === "parsing" || status === "importing"}
              onClick={() => fileInputRef.current?.click()}
            >
              {status === "parsing" ? "Reading file..." : buttonLabel}
            </Button>
          </div>
        </div>

        {message ? (
          <p className="mt-4 rounded-2xl border border-brand-teal/14 bg-brand-teal/8 px-4 py-3 text-sm font-medium leading-6 text-brand-teal">
            {message}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
            {error}
          </p>
        ) : null}

        {warnings.length > 0 ? (
          <div className="mt-4 space-y-2">
            {warnings.map((warning) => (
              <p
                key={warning}
                className="rounded-2xl border border-brand-ink/8 bg-brand-ink/[0.025] px-4 py-3 text-sm leading-6 text-brand-ink/60"
              >
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        {events.length > 0 ? (
          <div className="mt-5">
            <div className="flex flex-col gap-3 border-b border-brand-ink/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-brand-ink/62">
                {selectedEvents.length} of {events.length} selected
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedIds(new Set(events.map((item) => item.previewId)))
                  }
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="mt-4 grid max-h-[480px] gap-3 overflow-y-auto pr-1">
              {events.map((calendarEvent) => (
                <label
                  key={calendarEvent.previewId}
                  className="flex cursor-pointer gap-3 rounded-[24px] border border-brand-ink/8 bg-white/76 p-4 transition hover:border-brand-teal/20 hover:bg-brand-teal/[0.035]"
                >
                  <input
                    checked={selectedIds.has(calendarEvent.previewId)}
                    className="mt-1 h-5 w-5 accent-brand-teal"
                    type="checkbox"
                    onChange={() => toggleEvent(calendarEvent.previewId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-brand-ink">
                      {calendarEvent.title}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-brand-ink/58">
                      {formatImportedEventDate(calendarEvent)} •{" "}
                      {formatImportedEventTimeRange(calendarEvent)}
                    </span>
                    {calendarEvent.location ? (
                      <span className="mt-1 block text-sm leading-6 text-brand-ink/52">
                        {calendarEvent.location}
                      </span>
                    ) : null}
                    <span className="mt-2 inline-flex rounded-full border border-brand-ink/8 bg-brand-ink/[0.025] px-2.5 py-1 text-xs font-semibold text-brand-ink/46">
                      Source: {sourceLabel}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                disabled={status === "importing" || selectedEvents.length === 0}
                onClick={importSelectedEvents}
              >
                {status === "importing" ? "Importing..." : "Import selected"}
              </Button>
              <Button variant="outline" onClick={cancelPreview}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
