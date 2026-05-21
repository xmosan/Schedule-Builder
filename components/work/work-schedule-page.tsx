"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  createWorkShiftsForUser,
  deleteWorkShiftForUser,
  fetchWorkShiftsForUser,
  updateWorkShiftForUser,
} from "@/lib/supabase/scheduler";
import { weekDays, type WeekDay } from "@/lib/weekly-plan";
import {
  defaultWorkShiftDraft,
  formatWorkShiftRange,
  getWorkShiftDurationHours,
  sortWorkShifts,
  validateWorkShiftDraft,
  type WorkShift,
  type WorkShiftDraft,
} from "@/lib/work-schedule";

type WorkScheduleStatus = "loading" | "ready" | "signed_out" | "error";
type AddShiftTarget = "quick" | WeekDay;
type FormTarget = "quick" | WeekDay | `edit:${string}`;
type AddWorkShiftDraft = Omit<WorkShiftDraft, "day"> & {
  days: WeekDay[];
};

const shiftRemovalAnimationMs = 300;
const dayChipLabels: Record<WeekDay, string> = {
  Monday: "M",
  Tuesday: "T",
  Wednesday: "W",
  Thursday: "T",
  Friday: "F",
  Saturday: "S",
  Sunday: "S",
};

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

  return "Work schedule is unavailable right now.";
}

function getMissingTableMessage(error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("work_shifts")) {
    return "The work_shifts table is missing in Supabase. Run supabase/work-shifts.sql, then refresh this page.";
  }

  return message;
}

function formatShiftHours(hours: number) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr${
    hours === 1 ? "" : "s"
  }`;
}

function getAddDraftForDay(day: WeekDay): AddWorkShiftDraft {
  return {
    startTime: defaultWorkShiftDraft.startTime,
    endTime: defaultWorkShiftDraft.endTime,
    location: "",
    notes: "",
    recurring: true,
    days: [day],
  };
}

function normalizeShiftLocation(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getDuplicateShiftDays(
  existingShifts: WorkShift[],
  draft: AddWorkShiftDraft,
) {
  return draft.days.filter((day) =>
    existingShifts.some(
      (shift) =>
        shift.day === day &&
        shift.startTime === draft.startTime &&
        shift.endTime === draft.endTime &&
        normalizeShiftLocation(shift.location) ===
          normalizeShiftLocation(draft.location),
    ),
  );
}

function pluralizeShift(count: number) {
  return `${count} ${count === 1 ? "shift" : "shifts"}`;
}

function createWorkShiftDraftForDay(
  draft: AddWorkShiftDraft,
  day: WeekDay,
): WorkShiftDraft {
  return {
    day,
    startTime: draft.startTime,
    endTime: draft.endTime,
    location: draft.location,
    notes: draft.notes,
    recurring: true,
  };
}

function validateAddWorkShiftDraft(draft: AddWorkShiftDraft) {
  if (draft.days.length === 0) {
    return "Choose at least one day for this shift.";
  }

  return validateWorkShiftDraft(createWorkShiftDraftForDay(draft, draft.days[0]));
}

function getDraftFromShift(shift: WorkShift): WorkShiftDraft {
  return {
    day: shift.day,
    startTime: shift.startTime,
    endTime: shift.endTime,
    location: shift.location,
    notes: shift.notes,
    recurring: true,
  };
}

function WorkShiftCard({
  isExiting,
  onEdit,
  onRemove,
  removeError,
  shift,
}: {
  isExiting: boolean;
  onEdit: () => void;
  onRemove: () => void;
  removeError?: string;
  shift: WorkShift;
}) {
  const duration = getWorkShiftDurationHours(shift);

  return (
    <div
      className="weekly-block-shell"
      data-exiting={isExiting ? "true" : "false"}
    >
      <div className="weekly-block-inner animate-weekly-block rounded-[24px] border border-brand-ink/8 bg-gradient-to-br from-white via-white to-brand-mist/55 p-4 shadow-[0_12px_28px_rgba(18,32,47,0.045)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-[-0.02em] text-brand-ink">
              {formatWorkShiftRange(shift)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-teal/[0.085] px-3 py-1.5 text-xs font-semibold text-brand-teal">
                <ClockIcon className="h-4 w-4" />
                {formatShiftHours(duration)}
              </span>
              <span className="inline-flex items-center rounded-full bg-brand-ink/[0.045] px-3 py-1.5 text-xs font-semibold text-brand-ink/58">
                Repeats weekly
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              className="h-10 px-3 text-xs text-brand-ink/58 hover:bg-brand-teal/10 hover:text-brand-teal"
              size="sm"
              type="button"
              variant="secondary"
              onClick={onEdit}
            >
              Edit
            </Button>
            <Button
              aria-label={`Remove work shift ${formatWorkShiftRange(shift)}`}
              className="h-10 w-10 rounded-full border border-brand-ink/10 bg-white/85 p-0 text-brand-ink/54 shadow-[0_8px_18px_rgba(18,32,47,0.05)] hover:border-brand-coral/20 hover:bg-brand-coral/10 hover:text-brand-coral"
              disabled={isExiting}
              size="sm"
              title="Remove shift"
              type="button"
              variant="secondary"
              onClick={onRemove}
            >
              <TrashIcon aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">Remove shift</span>
            </Button>
          </div>
        </div>

        {shift.location ? (
          <p className="mt-3 text-sm font-medium leading-6 text-brand-ink/70">
            {shift.location}
          </p>
        ) : null}

        {shift.notes ? (
          <p className="mt-1 text-sm leading-6 text-brand-ink/58">
            {shift.notes}
          </p>
        ) : null}

        {removeError ? (
          <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-xs font-medium leading-5 text-brand-coral">
            {removeError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function WorkSchedulePage() {
  const [status, setStatus] = useState<WorkScheduleStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [draft, setDraft] = useState<AddWorkShiftDraft>(
    getAddDraftForDay("Monday"),
  );
  const [editDraft, setEditDraft] =
    useState<WorkShiftDraft>(defaultWorkShiftDraft);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [activeDayForm, setActiveDayForm] = useState<WeekDay | null>(null);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState<FormTarget | null>(null);
  const [errorTarget, setErrorTarget] = useState<FormTarget | null>(null);
  const [exitingShiftIds, setExitingShiftIds] = useState<
    Record<string, boolean>
  >({});
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [pendingRemoveShiftId, setPendingRemoveShiftId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const removeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus("signed_out");
      setError("Supabase is not configured yet.");
      return;
    }

    let isActive = true;

    async function loadWorkSchedule() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (!isActive) {
          return;
        }

        if (sessionError) {
          setStatus("error");
          setError(sessionError.message);
          return;
        }

        const nextUserId = data.session?.user.id ?? null;

        if (!nextUserId) {
          setStatus("signed_out");
          setUserId(null);
          setError(null);
          return;
        }

        const result = await fetchWorkShiftsForUser(supabase, nextUserId);

        if (!isActive) {
          return;
        }

        setUserId(nextUserId);

        if (result.error) {
          setStatus("error");
          setError(getMissingTableMessage(result.error));
          return;
        }

        setShifts(sortWorkShifts(result.data));
        setStatus("ready");
        setError(null);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setStatus("error");
        setError(getMissingTableMessage(loadError));
      }
    }

    void loadWorkSchedule();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(removeTimers.current).forEach((timerId) => {
        clearTimeout(timerId);
      });
    };
  }, []);

  const shiftsByDay = useMemo(() => {
    return new Map<WeekDay, WorkShift[]>(
      weekDays.map((day) => [
        day,
        sortWorkShifts(shifts.filter((shift) => shift.day === day)),
      ]),
    );
  }, [shifts]);

  const unavailableHours = useMemo(() => {
    return shifts.reduce(
      (sum, shift) => sum + getWorkShiftDurationHours(shift),
      0,
    );
  }, [shifts]);

  const daysBlocked = useMemo(() => {
    return weekDays.filter((day) =>
      shifts.some((shift) => shift.day === day),
    ).length;
  }, [shifts]);

  function showFormError(target: FormTarget, messageText: string) {
    setError(messageText);
    setErrorTarget(target);
  }

  function clearFeedback() {
    setError(null);
    setErrorTarget(null);
    setMessage(null);
  }

  function openQuickAddForm() {
    setIsQuickAddOpen((current) => {
      const shouldOpen = !current;

      if (shouldOpen) {
        setDraft(getAddDraftForDay("Monday"));
      }

      return shouldOpen;
    });
    setActiveDayForm(null);
    setEditingShiftId(null);
    clearFeedback();
  }

  function openDayForm(day: WeekDay) {
    const shouldClose = activeDayForm === day;

    setIsQuickAddOpen(false);
    setEditingShiftId(null);
    setActiveDayForm(shouldClose ? null : day);
    setDraft(getAddDraftForDay(day));
    clearFeedback();
  }

  function startEditingShift(shift: WorkShift) {
    setIsQuickAddOpen(false);
    setActiveDayForm(null);
    setEditingShiftId(shift.id);
    setEditDraft(getDraftFromShift(shift));
    clearFeedback();
  }

  async function saveNewShift(target: AddShiftTarget) {
    const nextDraft: AddWorkShiftDraft = {
      ...draft,
      recurring: true,
    };
    const validationError = validateAddWorkShiftDraft(nextDraft);

    if (validationError) {
      showFormError(target, validationError);
      return;
    }

    if (!userId) {
      showFormError(target, "Sign in before saving work shifts.");
      return;
    }

    setSavingTarget(target);
    clearFeedback();

    try {
      const duplicateDays = getDuplicateShiftDays(shifts, nextDraft);
      const duplicateDaySet = new Set(duplicateDays);
      const daysToCreate = nextDraft.days.filter(
        (day) => !duplicateDaySet.has(day),
      );

      if (daysToCreate.length === 0) {
        setMessage(
          `No new shifts added. Skipped ${pluralizeShift(
            duplicateDays.length,
          )} that already exist${duplicateDays.length === 1 ? "s" : ""}.`,
        );
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const draftsToCreate = daysToCreate.map((day) =>
        createWorkShiftDraftForDay(nextDraft, day),
      );
      const result = await createWorkShiftsForUser(
        supabase,
        userId,
        draftsToCreate,
      );

      if (result.error) {
        showFormError(target, getMissingTableMessage(result.error));
        return;
      }

      const savedShifts = result.data;
      setShifts((current) => sortWorkShifts([...current, ...savedShifts]));
      setDraft(getAddDraftForDay(target === "quick" ? "Monday" : target));
      setIsQuickAddOpen(false);
      setActiveDayForm(null);
      setMessage(
        [
          `Added ${pluralizeShift(savedShifts.length)}.`,
          duplicateDays.length > 0
            ? `Skipped ${pluralizeShift(duplicateDays.length)} that already exist${
                duplicateDays.length === 1 ? "s" : ""
              }.`
            : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" "),
      );
    } catch (saveError) {
      showFormError(target, getMissingTableMessage(saveError));
    } finally {
      setSavingTarget(null);
    }
  }

  async function saveEditedShift(shiftId: string) {
    const target: FormTarget = `edit:${shiftId}`;
    const nextDraft = {
      ...editDraft,
      recurring: true,
    };
    const validationError = validateWorkShiftDraft(nextDraft);

    if (validationError) {
      showFormError(target, validationError);
      return;
    }

    if (!userId) {
      showFormError(target, "Sign in before updating work shifts.");
      return;
    }

    setSavingTarget(target);
    clearFeedback();

    try {
      const supabase = getSupabaseBrowserClient();
      const result = await updateWorkShiftForUser(
        supabase,
        userId,
        shiftId,
        nextDraft,
      );

      if (result.error || !result.data) {
        showFormError(target, getMissingTableMessage(result.error));
        return;
      }

      const updatedShift = result.data;
      setShifts((current) =>
        sortWorkShifts(
          current.map((shift) => (shift.id === shiftId ? updatedShift : shift)),
        ),
      );
      setEditingShiftId(null);
      setMessage("Work shift updated.");
    } catch (updateError) {
      showFormError(target, getMissingTableMessage(updateError));
    } finally {
      setSavingTarget(null);
    }
  }

  function requestRemoveShift(shiftId: string) {
    if (!userId) {
      setError("Sign in before removing work shifts.");
      return;
    }

    if (exitingShiftIds[shiftId]) {
      return;
    }

    setPendingRemoveShiftId(shiftId);
  }

  function removeShiftWithAnimation(shiftId: string) {
    if (!userId || exitingShiftIds[shiftId]) {
      return;
    }

    setPendingRemoveShiftId(null);
    clearFeedback();
    setRemoveErrors((current) => {
      const next = { ...current };
      delete next[shiftId];
      return next;
    });
    setExitingShiftIds((current) => ({ ...current, [shiftId]: true }));

    removeTimers.current[shiftId] = setTimeout(() => {
      void Promise.resolve(
        deleteWorkShiftForUser(getSupabaseBrowserClient(), userId, shiftId),
      )
        .then((result) => {
          if (result.error) {
            throw result.error;
          }

          setShifts((current) => current.filter((shift) => shift.id !== shiftId));
          setMessage("Work shift removed.");
        })
        .catch((removeError: unknown) => {
          setRemoveErrors((current) => ({
            ...current,
            [shiftId]: `Shift could not be removed: ${getMissingTableMessage(
              removeError,
            )}`,
          }));
        })
        .finally(() => {
          setExitingShiftIds((current) => {
            const next = { ...current };
            delete next[shiftId];
            return next;
          });
          delete removeTimers.current[shiftId];
        });
    }, shiftRemovalAnimationMs);
  }

  function renderDayChips({
    formId,
    selectedDays,
    setDraftValue,
  }: {
    formId: string;
    selectedDays: WeekDay[];
    setDraftValue: Dispatch<SetStateAction<AddWorkShiftDraft>>;
  }) {
    return (
      <div>
        <p className="field-label" id={`${formId}-days-label`}>
          Days this shift repeats
        </p>
        <div
          aria-labelledby={`${formId}-days-label`}
          className="grid grid-cols-7 gap-2"
          role="group"
        >
          {weekDays.map((day) => {
            const isSelected = selectedDays.includes(day);

            return (
              <button
                key={day}
                aria-label={day}
                aria-pressed={isSelected}
                className={`min-h-11 rounded-full border text-sm font-bold transition active:scale-[0.97] ${
                  isSelected
                    ? "border-brand-teal/25 bg-brand-teal text-white shadow-[0_10px_22px_rgba(20,121,110,0.16)]"
                    : "border-brand-ink/10 bg-white/72 text-brand-ink/55 hover:border-brand-teal/18 hover:bg-brand-teal/[0.06] hover:text-brand-teal"
                }`}
                type="button"
                onClick={() => {
                  setDraftValue((current) => {
                    const nextDays = current.days.includes(day)
                      ? current.days.filter((selectedDay) => selectedDay !== day)
                      : [...current.days, day].sort(
                          (first, second) =>
                            weekDays.indexOf(first) - weekDays.indexOf(second),
                        );

                    return {
                      ...current,
                      days: nextDays,
                    };
                  });
                  clearFeedback();
                }}
              >
                {dayChipLabels[day]}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderAddShiftForm({
    draftValue,
    formId,
    onCancel,
    onSubmit,
    setDraftValue,
    target,
  }: {
    draftValue: AddWorkShiftDraft;
    formId: string;
    onCancel?: () => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    setDraftValue: Dispatch<SetStateAction<AddWorkShiftDraft>>;
    target: AddShiftTarget;
  }) {
    const shouldShowError = error && errorTarget === target;
    const submitLabel =
      draftValue.days.length === 1 ? "Add shift" : "Add shifts";

    return (
      <form
        className="mt-5 grid gap-4 lg:grid-cols-2"
        onSubmit={onSubmit}
      >
        <div>
          <label className="field-label" htmlFor={`${formId}-start`}>
            Start time
          </label>
          <Input
            id={`${formId}-start`}
            required
            type="time"
            value={draftValue.startTime}
            onChange={(event) => {
              setDraftValue((current) => ({
                ...current,
                startTime: event.target.value,
              }));
              clearFeedback();
            }}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${formId}-end`}>
            End time
          </label>
          <Input
            id={`${formId}-end`}
            required
            type="time"
            value={draftValue.endTime}
            onChange={(event) => {
              setDraftValue((current) => ({
                ...current,
                endTime: event.target.value,
              }));
              clearFeedback();
            }}
          />
        </div>

        <div className="lg:col-span-2">
          {renderDayChips({
            formId,
            selectedDays: draftValue.days,
            setDraftValue,
          })}
        </div>

        <div>
          <label className="field-label" htmlFor={`${formId}-location`}>
            Location optional
          </label>
          <Input
            id={`${formId}-location`}
            placeholder="Office, campus, remote..."
            value={draftValue.location}
            onChange={(event) => {
              setDraftValue((current) => ({
                ...current,
                location: event.target.value,
              }));
              clearFeedback();
            }}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${formId}-notes`}>
            Notes optional
          </label>
          <Input
            id={`${formId}-notes`}
            placeholder="Commute, break, manager..."
            value={draftValue.notes}
            onChange={(event) => {
              setDraftValue((current) => ({
                ...current,
                notes: event.target.value,
              }));
              clearFeedback();
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 lg:col-span-2">
          {onCancel ? (
            <Button
              className="w-full"
              size="sm"
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            className={onCancel ? "w-full" : "w-full col-span-2"}
            disabled={savingTarget === target || status === "loading"}
            size="sm"
            type="submit"
          >
            {savingTarget === target ? "Saving..." : submitLabel}
          </Button>
        </div>

        <p className="rounded-[18px] border border-brand-ink/8 bg-white/66 px-4 py-3 text-xs font-medium leading-5 text-brand-ink/52 lg:col-span-2">
          Shifts repeat weekly. Date-specific work shifts are not enabled yet.
        </p>

        {shouldShowError ? (
          <p className="rounded-[20px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral lg:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  function renderShiftForm({
    draftValue,
    formId,
    onCancel,
    onSubmit,
    setDraftValue,
    showDayField,
    submitLabel,
    target,
  }: {
    draftValue: WorkShiftDraft;
    formId: string;
    onCancel?: () => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    setDraftValue: Dispatch<SetStateAction<WorkShiftDraft>>;
    showDayField: boolean;
    submitLabel: string;
    target: FormTarget;
  }) {
    const shouldShowError = error && errorTarget === target;
    const isEditing = target.startsWith("edit:");

    return (
      <form
        className={
          showDayField
            ? "mt-5 grid gap-4 lg:grid-cols-[160px_1fr_1fr]"
            : "mt-4 space-y-3"
        }
        onSubmit={onSubmit}
      >
        {isEditing ? (
          <p className="rounded-[18px] border border-brand-teal/12 bg-white/66 px-4 py-3 text-xs font-semibold leading-5 text-brand-teal lg:col-span-3">
            Editing updates this shift only.
          </p>
        ) : null}

        {showDayField ? (
          <div>
            <label className="field-label" htmlFor={`${formId}-day`}>
              Day
            </label>
            <Select
              id={`${formId}-day`}
              value={draftValue.day}
              onChange={(event) => {
                setDraftValue((current) => ({
                  ...current,
                  day: event.target.value as WeekDay,
                }));
                clearFeedback();
              }}
            >
              {weekDays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor={`${formId}-start`}>
              Start
            </label>
            <Input
              id={`${formId}-start`}
              required
              type="time"
              value={draftValue.startTime}
              onChange={(event) => {
                setDraftValue((current) => ({
                  ...current,
                  startTime: event.target.value,
                }));
                clearFeedback();
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor={`${formId}-end`}>
              End
            </label>
            <Input
              id={`${formId}-end`}
              required
              type="time"
              value={draftValue.endTime}
              onChange={(event) => {
                setDraftValue((current) => ({
                  ...current,
                  endTime: event.target.value,
                }));
                clearFeedback();
              }}
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor={`${formId}-location`}>
            Location optional
          </label>
          <Input
            id={`${formId}-location`}
            placeholder="Office, campus, remote..."
            value={draftValue.location}
            onChange={(event) => {
              setDraftValue((current) => ({
                ...current,
                location: event.target.value,
              }));
              clearFeedback();
            }}
          />
        </div>

        <div className={showDayField ? "lg:col-span-2" : ""}>
          <label className="field-label" htmlFor={`${formId}-notes`}>
            Notes optional
          </label>
          <Input
            id={`${formId}-notes`}
            placeholder="Commute, break, manager..."
            value={draftValue.notes}
            onChange={(event) => {
              setDraftValue((current) => ({
                ...current,
                notes: event.target.value,
              }));
              clearFeedback();
            }}
          />
        </div>

        <div
          className={
            showDayField
              ? "flex flex-col gap-3 lg:col-span-3 lg:flex-row"
              : "grid grid-cols-2 gap-2"
          }
        >
          {onCancel ? (
            <Button
              className="w-full"
              size="sm"
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            className="w-full"
            disabled={savingTarget === target || status === "loading"}
            size="sm"
            type="submit"
          >
            {savingTarget === target ? "Saving..." : submitLabel}
          </Button>
        </div>

        <p className="rounded-[18px] border border-brand-ink/8 bg-white/66 px-4 py-3 text-xs font-medium leading-5 text-brand-ink/52 lg:col-span-3">
          Shifts repeat weekly. Date-specific work shifts are not enabled yet.
        </p>

        {shouldShowError ? (
          <p className="rounded-[20px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral lg:col-span-3">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  const pendingRemoveShift = pendingRemoveShiftId
    ? shifts.find((shift) => shift.id === pendingRemoveShiftId)
    : undefined;

  return (
    <div className="px-3 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_360px] lg:items-end">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-5xl">
                Work Schedule
              </h1>
              <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                Add work shifts and unavailable hours so Schedule Builder can
                plan around them.
              </p>
              <p className="mt-3 rounded-[22px] border border-brand-teal/15 bg-brand-teal/[0.07] px-4 py-3 text-sm font-medium leading-6 text-brand-teal">
                Start by adding your regular work shifts. Schedule Builder will use them to avoid planning project blocks during unavailable time.
              </p>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88">
              <CardContent className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Unavailable this week
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {formatShiftHours(unavailableHours)}
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Shifts
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {shifts.length}
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Recurring shifts
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {shifts.length}
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                    Days blocked
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-brand-ink">
                    {daysBlocked}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {status === "signed_out" ? (
          <Card className="rounded-[30px] border-white/70 bg-white/88">
            <CardContent className="p-5 sm:p-6">
              <p className="text-lg font-semibold text-brand-ink">
                Sign in to manage your work schedule.
              </p>
              <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                Work shifts sync through Supabase with the rest of your schedule.
              </p>
              <Link
                className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white"
                href="/"
              >
                Go to sign in
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {status !== "signed_out" ? (
          <>
            <Card className="rounded-[24px] border-white/70 bg-white/78 sm:rounded-[28px]">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                      <PlusIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                        Quick add shift
                      </h2>
                      <p className="text-sm leading-6 text-brand-ink/60">
                        Add a shift quickly, or use a day card below.
                      </p>
                    </div>
                  </div>
                  <Button
                    aria-expanded={isQuickAddOpen}
                    className="w-full sm:w-auto"
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={openQuickAddForm}
                  >
                    {!isQuickAddOpen ? <PlusIcon className="h-4 w-4" /> : null}
                    {isQuickAddOpen ? "Hide quick add" : "Open quick add"}
                  </Button>
                </div>

                {isQuickAddOpen
                  ? renderAddShiftForm({
                      draftValue: draft,
                      formId: "quick-work-shift",
                      onSubmit: (event) => {
                        event.preventDefault();
                        void saveNewShift("quick");
                      },
                      setDraftValue: setDraft,
                      target: "quick",
                    })
                  : null}
              </CardContent>
            </Card>

            {message ? (
              <div className="rounded-[22px] border border-brand-teal/18 bg-brand-teal/8 p-4 text-sm leading-6 text-brand-teal">
                {message}
              </div>
            ) : null}

            {error && !errorTarget ? (
              <div className="rounded-[22px] border border-brand-coral/18 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                {error}
              </div>
            ) : null}

            <section className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {weekDays.map((day) => {
                const dayShifts = shiftsByDay.get(day) ?? [];
                const dayHours = dayShifts.reduce(
                  (sum, shift) => sum + getWorkShiftDurationHours(shift),
                  0,
                );

                return (
                  <Card
                    key={day}
                    className="h-full overflow-hidden rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)] sm:rounded-[34px]"
                  >
                    <CardContent className="flex h-full flex-col p-4 sm:p-5 lg:p-6">
                      <div className="mb-4 flex flex-col gap-4 border-b border-brand-ink/8 pb-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                            {day}
                          </h2>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge variant="subtle">
                              {dayShifts.length}{" "}
                              {dayShifts.length === 1 ? "shift" : "shifts"}
                            </Badge>
                            <Badge
                              className="bg-brand-teal/8 text-brand-teal"
                              variant="subtle"
                            >
                              {formatShiftHours(dayHours)}
                            </Badge>
                          </div>
                        </div>
                        {activeDayForm === day ? (
                          <Button
                            className="h-10 px-4 text-sm sm:w-auto"
                            size="sm"
                            type="button"
                            variant="secondary"
                            onClick={() => setActiveDayForm(null)}
                          >
                            Close
                          </Button>
                        ) : (
                          <Button
                            className="w-full border-dashed sm:w-auto"
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => openDayForm(day)}
                          >
                            <PlusIcon className="h-4 w-4" />
                            Add to {day}
                          </Button>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col gap-4">
                        {activeDayForm === day ? (
                          <div className="rounded-[24px] border border-brand-teal/18 bg-brand-teal/[0.045] p-3 sm:p-4">
                            <div>
                              <p className="text-sm font-semibold text-brand-ink">
                                Add to {day}
                              </p>
                              <p className="text-xs leading-5 text-brand-ink/52">
                                Add your work hours for this day.
                              </p>
                            </div>
                            {renderAddShiftForm({
                              draftValue: draft,
                              formId: `day-work-shift-${day.toLowerCase()}`,
                              onCancel: () => setActiveDayForm(null),
                              onSubmit: (event) => {
                                event.preventDefault();
                                void saveNewShift(day);
                              },
                              setDraftValue: setDraft,
                              target: day,
                            })}
                          </div>
                        ) : null}

                        <div className="space-y-3">
                          {status === "loading" ? (
                            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm text-brand-ink/52">
                              Loading shifts...
                            </div>
                          ) : null}

                          {status !== "loading" && dayShifts.length === 0 ? (
                            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/60 p-4">
                              <p className="text-sm font-semibold text-brand-ink/70">
                                No shifts yet
                              </p>
                            </div>
                          ) : null}

                          {dayShifts.map((shift) =>
                            editingShiftId === shift.id ? (
                              <div
                                key={shift.id}
                                className="rounded-[24px] border border-brand-teal/18 bg-brand-teal/[0.045] p-3 sm:p-4"
                              >
                                <p className="text-sm font-semibold text-brand-ink">
                                  Edit shift
                                </p>
                                {renderShiftForm({
                                  draftValue: editDraft,
                                  formId: `edit-work-shift-${shift.id}`,
                                  onCancel: () => setEditingShiftId(null),
                                  onSubmit: (event) => {
                                    event.preventDefault();
                                    void saveEditedShift(shift.id);
                                  },
                                  setDraftValue: setEditDraft,
                                  showDayField: true,
                                  submitLabel: "Save shift",
                                  target: `edit:${shift.id}`,
                                })}
                              </div>
                            ) : (
                              <WorkShiftCard
                                key={shift.id}
                                isExiting={Boolean(exitingShiftIds[shift.id])}
                                removeError={removeErrors[shift.id]}
                                shift={shift}
                                onEdit={() => startEditingShift(shift)}
                                onRemove={() => requestRemoveShift(shift.id)}
                              />
                            ),
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          </>
        ) : null}

        <ConfirmDialog
          confirmLabel="Remove shift"
          description="This shift will be removed from your work schedule. Schedule Builder will stop treating this time as unavailable."
          destructive
          open={Boolean(pendingRemoveShift)}
          title="Remove work shift?"
          onCancel={() => setPendingRemoveShiftId(null)}
          onConfirm={() => {
            if (pendingRemoveShift) {
              removeShiftWithAnimation(pendingRemoveShift.id);
            }
          }}
        />
      </div>
    </div>
  );
}
