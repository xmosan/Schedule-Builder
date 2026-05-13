import type { ImportedCalendarEventDraft } from "@/lib/imported-calendar";

export type ParsedIcsEvent = ImportedCalendarEventDraft & {
  previewId: string;
};

export type IcsParseResult = {
  events: ParsedIcsEvent[];
  warnings: string[];
};

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

const maxPreviewEvents = 500;

function unfoldIcsLines(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce<string[]>((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
        return lines;
      }

      lines.push(line);
      return lines;
    }, []);
}

function parseProperty(line: string): IcsProperty | null {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  const rawNameAndParams = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [rawName, ...rawParams] = rawNameAndParams.split(";");
  const params = rawParams.reduce<Record<string, string>>((current, param) => {
    const [key, ...rest] = param.split("=");

    if (key && rest.length > 0) {
      current[key.toUpperCase()] = rest.join("=").replace(/^"|"$/g, "");
    }

    return current;
  }, {});

  return {
    name: rawName.toUpperCase(),
    params,
    value,
  };
}

function getProperty(properties: IcsProperty[], name: string) {
  return properties.find((property) => property.name === name);
}

function unescapeIcsText(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseDateTime(value: string) {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/,
  );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6] ?? "0");
  const date = match[7]
    ? new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds))
    : new Date(year, month - 1, day, hours, minutes, seconds);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function parseIcsDateValue(property?: IcsProperty | null) {
  if (!property) {
    return null;
  }

  const value = property.value.trim();
  const isDateOnly = property.params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const date = isDateOnly ? parseDateOnly(value) : parseDateTime(value);

  if (!date) {
    return null;
  }

  return {
    allDay: isDateOnly,
    iso: date.toISOString(),
  };
}

function parseVEvent(properties: IcsProperty[], index: number): ParsedIcsEvent | null {
  const start = parseIcsDateValue(getProperty(properties, "DTSTART"));

  if (!start) {
    return null;
  }

  const end = parseIcsDateValue(getProperty(properties, "DTEND"));
  const uid = unescapeIcsText(getProperty(properties, "UID")?.value ?? "");
  const title =
    unescapeIcsText(getProperty(properties, "SUMMARY")?.value ?? "") ||
    "Untitled event";
  const description = unescapeIcsText(
    getProperty(properties, "DESCRIPTION")?.value ?? "",
  );
  const location = unescapeIcsText(getProperty(properties, "LOCATION")?.value ?? "");

  return {
    previewId: uid || `${start.iso}-${index}-${title}`,
    source: "ics",
    externalUid: uid,
    title,
    description,
    location,
    startsAt: start.iso,
    endsAt: end?.iso ?? null,
    allDay: start.allDay,
  };
}

export function parseIcsCalendar(content: string): IcsParseResult {
  const lines = unfoldIcsLines(content);
  const events: ParsedIcsEvent[] = [];
  const warnings: string[] = [];
  let currentEvent: IcsProperty[] | null = null;
  let skippedEvents = 0;
  let recurringEvents = 0;

  lines.forEach((line) => {
    const normalizedLine = line.trim();

    if (normalizedLine === "BEGIN:VEVENT") {
      currentEvent = [];
      return;
    }

    if (normalizedLine === "END:VEVENT") {
      if (currentEvent) {
        if (getProperty(currentEvent, "RRULE")) {
          recurringEvents += 1;
        }

        const event = parseVEvent(currentEvent, events.length);

        if (event) {
          events.push(event);
        } else {
          skippedEvents += 1;
        }
      }

      currentEvent = null;
      return;
    }

    if (!currentEvent) {
      return;
    }

    const property = parseProperty(line);

    if (property) {
      currentEvent.push(property);
    }
  });

  if (skippedEvents > 0) {
    warnings.push(`${skippedEvents} event${skippedEvents === 1 ? "" : "s"} could not be parsed.`);
  }

  if (recurringEvents > 0) {
    warnings.push(
      "Recurring rules are not expanded yet. Imported recurring events use the event instances present in the file.",
    );
  }

  if (events.length > maxPreviewEvents) {
    warnings.push(
      `Showing the first ${maxPreviewEvents} events from this file. Split very large calendars into smaller exports for best results.`,
    );
  }

  return {
    events: events.slice(0, maxPreviewEvents),
    warnings,
  };
}
