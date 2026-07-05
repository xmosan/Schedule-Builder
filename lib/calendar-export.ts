import {
  formatEstimatedHours,
  formatStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";
import type { Project } from "@/lib/projects";

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

function normalizeProjectLookupName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isProjectWorkBlock(block: WeeklyPlanBlock, projects: Project[]) {
  const blockTitle = normalizeProjectLookupName(block.projectName);

  return projects.some(
    (project) => normalizeProjectLookupName(project.name) === blockTitle,
  );
}

function getWeeklyPlanEventTitle(block: WeeklyPlanBlock, projects: Project[]) {
  const title = block.projectName.trim();

  if (!isProjectWorkBlock(block, projects)) {
    return title || "Schedule Builder time block";
  }

  if (!title || title.toLowerCase() === "schedule builder") {
    return "Schedule Builder time block";
  }

  return `Schedule Builder: ${title}`;
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
  projects: Project[] = [],
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
  const orderedBlocks = blocks
    .map((block, index) => ({
      block,
      index,
      dateKey: block.scheduledDate ?? "",
      dayOffset: weekDays.indexOf(block.day),
      startMinutes: parseStartTimeToMinutes(block.startTime),
    }))
    .sort((first, second) => {
      if (first.dateKey !== second.dateKey) {
        return first.dateKey.localeCompare(second.dateKey);
      }
      if (first.dayOffset !== second.dayOffset) {
        return first.dayOffset - second.dayOffset;
      }

      if (first.startMinutes !== null && second.startMinutes !== null) {
        return first.startMinutes - second.startMinutes || first.index - second.index;
      }

      if (first.startMinutes !== null) {
        return -1;
      }

      if (second.startMinutes !== null) {
        return 1;
      }

      return first.index - second.index;
    });

  orderedBlocks.forEach(({ block }, index) => {
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

    const eventDate = block.scheduledDate
      ? parseDateInput(block.scheduledDate)
      : addDays(weekStartDate, dayOffset);
    if (!eventDate) {
      warnings.push(`Skipped "${block.projectName}" because its date is invalid.`);
      return;
    }
    const explicitStartMinutes = parseStartTimeToMinutes(block.startTime);
    const dayKey = block.scheduledDate ?? block.day;
    const startMinutes =
      explicitStartMinutes ?? nextStartByDay.get(dayKey) ?? defaultDayStartMinutes;
    const endMinutes = startMinutes + durationMinutes;

    if (explicitStartMinutes === null) {
      nextStartByDay.set(dayKey, endMinutes);
    }

    const startDate = setMinutesFromStartOfDay(eventDate, startMinutes);
    const endDate = setMinutesFromStartOfDay(eventDate, endMinutes);
    const summary = getWeeklyPlanEventTitle(block, projects);
    const description = [
      `Planned task: ${block.plannedTask}`,
      `Start time: ${formatStartTime(block.startTime)}`,
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
    warnings.push("No valid time blocks were available to export.");
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
