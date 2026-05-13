export type ImportedCalendarEvent = {
  id: string;
  source: "ics" | string;
  externalUid: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  importedAt: string;
};

export type ImportedCalendarEventDraft = Omit<
  ImportedCalendarEvent,
  "id" | "importedAt"
>;

function getEventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getImportedEventDurationHours(
  event: Pick<ImportedCalendarEvent, "allDay" | "endsAt" | "startsAt">,
) {
  if (event.allDay || !event.endsAt) {
    return 0;
  }

  const startDate = getEventDate(event.startsAt);
  const endDate = getEventDate(event.endsAt);

  if (!startDate || !endDate || endDate <= startDate) {
    return 0;
  }

  return (endDate.getTime() - startDate.getTime()) / 36e5;
}

export function formatImportedEventDate(event: Pick<ImportedCalendarEvent, "startsAt">) {
  const date = getEventDate(event.startsAt);

  if (!date) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatImportedEventTimeRange(
  event: Pick<ImportedCalendarEvent, "allDay" | "endsAt" | "startsAt">,
) {
  if (event.allDay) {
    return "All day";
  }

  const startDate = getEventDate(event.startsAt);
  const endDate = event.endsAt ? getEventDate(event.endsAt) : null;

  if (!startDate) {
    return "Time unavailable";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const startLabel = formatter.format(startDate);

  if (!endDate) {
    return startLabel;
  }

  return `${startLabel} - ${formatter.format(endDate)}`;
}

export function sortImportedCalendarEvents(events: ImportedCalendarEvent[]) {
  return [...events].sort((first, second) => {
    const startDifference =
      new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime();

    if (startDifference !== 0) {
      return startDifference;
    }

    return first.title.localeCompare(second.title);
  });
}
