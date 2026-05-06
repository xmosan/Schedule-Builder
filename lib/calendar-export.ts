import {
  formatEstimatedHours,
  weekDays,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

const defaultDayStartMinutes = 9 * 60;

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function formatIcsDateTime(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function formatIcsUtcDateTime(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line: string) {
  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = remaining.slice(75);
  }

  chunks.push(remaining);
  return chunks.join("\r\n ");
}

function serializeIcsLines(lines: string[]) {
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

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

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function setMinutesFromStartOfDay(date: Date, minutes: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
  );
}

function createUid(block: WeeklyPlanBlock, index: number) {
  const safeId = block.id.replace(/[^a-zA-Z0-9-]/g, "") || String(index);
  return `${safeId}-${index}@schedule-builder`;
}

export function getCurrentWeekMondayInputValue() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = addDays(today, -daysSinceMonday);
  const year = String(monday.getFullYear()).padStart(4, "0");
  const month = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function generateWeeklyPlanIcs(
  blocks: WeeklyPlanBlock[],
  weekStartDateValue: string,
) {
  const weekStartDate = parseDateInput(weekStartDateValue);

  if (!weekStartDate) {
    return {
      content: "",
      exportedCount: 0,
      skippedCount: 0,
      warnings: ["Choose a valid week start date before exporting."],
    };
  }

  if (weekStartDate.getDay() !== 1) {
    return {
      content: "",
      exportedCount: 0,
      skippedCount: 0,
      warnings: ["Choose the Monday for the week you want to export."],
    };
  }

  const warnings: string[] = [];
  const nextStartByDay = new Map<string, number>();
  const nowStamp = formatIcsUtcDateTime(new Date());
  const eventLines: string[] = [];
  let exportedCount = 0;

  blocks.forEach((block, index) => {
    const dayOffset = weekDays.indexOf(block.day);
    const durationMinutes = Math.round(block.estimatedHours * 60);

    if (
      dayOffset < 0 ||
      !Number.isFinite(durationMinutes) ||
      durationMinutes <= 0
    ) {
      warnings.push(
        `Skipped "${block.projectName || "Untitled block"}" because it is missing estimated time.`,
      );
      return;
    }

    if (!block.projectName.trim() || !block.plannedTask.trim()) {
      warnings.push(`Skipped an incomplete block on ${block.day}.`);
      return;
    }

    const eventDate = addDays(weekStartDate, dayOffset);
    const startMinutes = nextStartByDay.get(block.day) ?? defaultDayStartMinutes;
    const endMinutes = startMinutes + durationMinutes;
    nextStartByDay.set(block.day, endMinutes);

    const startDate = setMinutesFromStartOfDay(eventDate, startMinutes);
    const endDate = setMinutesFromStartOfDay(eventDate, endMinutes);
    const summary = `Schedule Builder: ${block.projectName}`;
    const description = [
      `Planned task: ${block.plannedTask}`,
      `Estimated duration: ${formatEstimatedHours(block.estimatedHours)}`,
      "Exported from Schedule Builder.",
    ].join("\n");

    eventLines.push(
      "BEGIN:VEVENT",
      `UID:${createUid(block, index)}`,
      `DTSTAMP:${nowStamp}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `DTSTART:${formatIcsDateTime(startDate)}`,
      `DTEND:${formatIcsDateTime(endDate)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
    exportedCount += 1;
  });

  if (blocks.length > 0 && exportedCount === 0) {
    warnings.push("No valid weekly plan blocks were available to export.");
  }

  const content = serializeIcsLines([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Schedule Builder//Weekly Plan Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Schedule Builder Weekly Plan",
    ...eventLines,
    "END:VCALENDAR",
  ]);

  return {
    content,
    exportedCount,
    skippedCount: blocks.length - exportedCount,
    warnings,
  };
}
