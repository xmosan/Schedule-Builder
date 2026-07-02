import { normalizeStartTime, type WeekDay } from "@/lib/weekly-plan";
import type { WorkShift } from "@/lib/work-schedule";

export const scheduleExceptionTypes = [
  "modify_shift",
  "cancel_shift",
  "extra_shift",
  "blocked_time",
  "available_override",
] as const;

export type ScheduleExceptionType = (typeof scheduleExceptionTypes)[number];

export type ScheduleException = {
  id: string;
  date: string;
  exceptionType: ScheduleExceptionType;
  relatedWorkShiftId: string | null;
  originalStartTime: string | null;
  originalEndTime: string | null;
  overrideStartTime: string | null;
  overrideEndTime: string | null;
  title: string;
  notes: string;
  createdBy: "user" | "assistant_approved";
  insertedAt?: string;
  updatedAt?: string;
};

export type ScheduleExceptionDraft = Omit<
  ScheduleException,
  "id" | "insertedAt" | "updatedAt"
>;

export function isScheduleExceptionType(
  value: unknown,
): value is ScheduleExceptionType {
  return (
    typeof value === "string" &&
    scheduleExceptionTypes.includes(value as ScheduleExceptionType)
  );
}

export function validateScheduleExceptionDraft(
  draft: ScheduleExceptionDraft,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    return "Choose a valid exception date.";
  }

  if (
    (draft.exceptionType === "modify_shift" ||
      draft.exceptionType === "cancel_shift") &&
    !draft.relatedWorkShiftId
  ) {
    return "Choose the recurring shift this exception changes.";
  }

  if (
    draft.exceptionType === "modify_shift" ||
    draft.exceptionType === "extra_shift" ||
    draft.exceptionType === "blocked_time"
  ) {
    const start = normalizeStartTime(draft.overrideStartTime);
    const end = normalizeStartTime(draft.overrideEndTime);

    if (!start || !end || end <= start) {
      return "Exception start and end times must form a valid range.";
    }
  }

  return null;
}

export function getEffectiveWorkShiftsForDate(
  workShifts: WorkShift[],
  scheduleExceptions: ScheduleException[],
  date: string,
  day: WeekDay,
) {
  const dateExceptions = scheduleExceptions.filter(
    (exception) => exception.date === date,
  );
  const cancelledShiftIds = new Set(
    dateExceptions
      .filter((exception) => exception.exceptionType === "cancel_shift")
      .map((exception) => exception.relatedWorkShiftId)
      .filter((id): id is string => Boolean(id)),
  );
  const modifiedByShiftId = new Map(
    dateExceptions
      .filter(
        (exception) =>
          exception.exceptionType === "modify_shift" &&
          Boolean(exception.relatedWorkShiftId),
      )
      .map((exception) => [exception.relatedWorkShiftId as string, exception]),
  );
  const recurring = workShifts
    .filter(
      (shift) => shift.day === day && !cancelledShiftIds.has(shift.id),
    )
    .map((shift) => {
      const exception = modifiedByShiftId.get(shift.id);

      if (!exception) {
        return shift;
      }

      return {
        ...shift,
        startTime: exception.overrideStartTime ?? shift.startTime,
        endTime: exception.overrideEndTime ?? shift.endTime,
        exceptionDate: exception.date,
        exceptionId: exception.id,
        exceptionType: "modify_shift",
        isException: true,
        notes: exception.notes || shift.notes,
      } satisfies WorkShift;
    });
  const added = dateExceptions
    .filter(
      (exception) =>
        exception.exceptionType === "extra_shift" ||
        exception.exceptionType === "blocked_time",
    )
    .filter(
      (exception) => exception.overrideStartTime && exception.overrideEndTime,
    )
    .map(
      (exception) =>
        ({
          id: `exception:${exception.id}`,
          day,
          startTime: exception.overrideStartTime as string,
          endTime: exception.overrideEndTime as string,
          location: "",
          notes: exception.notes,
          recurring: false,
          exceptionDate: exception.date,
          exceptionId: exception.id,
          exceptionType: exception.exceptionType as
            | "extra_shift"
            | "blocked_time",
          isException: true,
        }) satisfies WorkShift,
    );

  return [...recurring, ...added].sort((first, second) =>
    first.startTime.localeCompare(second.startTime),
  );
}
