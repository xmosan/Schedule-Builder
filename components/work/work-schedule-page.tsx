"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarIcon } from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  createWorkShiftForUser,
  deleteWorkShiftForUser,
  fetchWorkShiftsForUser,
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

function WorkShiftCard({
  onRemove,
  shift,
}: {
  onRemove: (shiftId: string) => void;
  shift: WorkShift;
}) {
  return (
    <div className="rounded-[22px] border border-brand-ink/8 bg-white/78 p-4 shadow-[0_12px_28px_rgba(18,32,47,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-brand-ink">
            {formatWorkShiftRange(shift)}
          </p>
          <p className="mt-1 text-sm text-brand-ink/58">
            {getWorkShiftDurationHours(shift)} hrs
            {shift.location ? ` · ${shift.location}` : ""}
          </p>
        </div>
        <Badge variant="subtle">
          {shift.recurring ? "Weekly" : "One-time"}
        </Badge>
      </div>

      {shift.notes ? (
        <p className="mt-3 text-sm leading-6 text-brand-ink/62">
          {shift.notes}
        </p>
      ) : null}

      <Button
        className="mt-4 w-full"
        size="sm"
        variant="outline"
        onClick={() => onRemove(shift.id)}
      >
        Remove shift
      </Button>
    </div>
  );
}

export function WorkSchedulePage() {
  const [status, setStatus] = useState<WorkScheduleStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [draft, setDraft] = useState<WorkShiftDraft>(defaultWorkShiftDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const shiftsByDay = useMemo(() => {
    return new Map<WeekDay, WorkShift[]>(
      weekDays.map((day) => [
        day,
        sortWorkShifts(shifts.filter((shift) => shift.day === day)),
      ]),
    );
  }, [shifts]);

  const weeklyHours = useMemo(() => {
    return shifts
      .filter((shift) => shift.recurring)
      .reduce((sum, shift) => sum + getWorkShiftDurationHours(shift), 0);
  }, [shifts]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validateWorkShiftDraft(draft);

    if (validationError) {
      setError(validationError);
      return;
    }

    if (!userId) {
      setError("Sign in before saving work shifts.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const result = await createWorkShiftForUser(supabase, userId, draft);

      if (result.error || !result.data) {
        setError(getMissingTableMessage(result.error));
        return;
      }

      const savedShift = result.data;
      setShifts((current) => sortWorkShifts([...current, savedShift]));
      setDraft(defaultWorkShiftDraft);
      setMessage("Work shift saved.");
    } catch (saveError) {
      setError(getMissingTableMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeShift(shiftId: string) {
    if (!userId) {
      setError("Sign in before removing work shifts.");
      return;
    }

    const confirmed = window.confirm("Remove this work shift?");

    if (!confirmed) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const result = await deleteWorkShiftForUser(supabase, userId, shiftId);

      if (result.error) {
        setError(getMissingTableMessage(result.error));
        return;
      }

      setShifts((current) => current.filter((shift) => shift.id !== shiftId));
      setMessage("Work shift removed.");
    } catch (removeError) {
      setError(getMissingTableMessage(removeError));
    }
  }

  return (
    <div className="px-3 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_320px] lg:items-end">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Work Schedule
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                Add the hours you are unavailable.
              </h1>
              <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                Enter recurring or one-time work shifts so Schedule Builder can
                avoid planning project blocks during work.
              </p>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88">
              <CardContent className="p-4 sm:p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                  Weekly work
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-brand-ink">
                  {weeklyHours} hrs
                </p>
                <p className="mt-2 text-sm leading-6 text-brand-ink/62">
                  Recurring shifts only.
                </p>
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
          <section className="grid items-start gap-5 sm:gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
            <Card className="rounded-[30px] border-white/70 bg-white/88">
              <CardContent className="p-5 sm:p-6">
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                  Add work shift
                </h2>
                <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                  Use this for jobs, recurring work hours, or one-time shifts.
                </p>

                <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
                  <div>
                    <label className="field-label" htmlFor="work-day">
                      Day
                    </label>
                    <Select
                      id="work-day"
                      value={draft.day}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          day: event.target.value as WeekDay,
                        }))
                      }
                    >
                      {weekDays.map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label" htmlFor="work-start">
                        Start
                      </label>
                      <Input
                        id="work-start"
                        required
                        type="time"
                        value={draft.startTime}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            startTime: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="work-end">
                        End
                      </label>
                      <Input
                        id="work-end"
                        required
                        type="time"
                        value={draft.endTime}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            endTime: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label" htmlFor="work-location">
                      Location optional
                    </label>
                    <Input
                      id="work-location"
                      placeholder="Office, campus, remote..."
                      value={draft.location}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          location: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div>
                    <label className="field-label" htmlFor="work-notes">
                      Notes optional
                    </label>
                    <Input
                      id="work-notes"
                      placeholder="Lunch break, commute, manager..."
                      value={draft.notes}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <label className="flex items-center gap-3 rounded-[20px] border border-brand-ink/8 bg-white/72 p-4 text-sm font-semibold text-brand-ink">
                    <input
                      checked={draft.recurring}
                      className="h-4 w-4 accent-brand-teal"
                      type="checkbox"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          recurring: event.target.checked,
                        }))
                      }
                    />
                    Repeat weekly
                  </label>

                  <Button
                    className="w-full"
                    disabled={isSaving || status === "loading"}
                    type="submit"
                  >
                    {isSaving ? "Saving shift..." : "Add work shift"}
                  </Button>
                </form>

                {message ? (
                  <div className="mt-5 rounded-[22px] border border-brand-teal/18 bg-brand-teal/8 p-4 text-sm leading-6 text-brand-teal">
                    {message}
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-5 rounded-[22px] border border-brand-coral/18 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                    {error}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {weekDays.map((day) => {
                const dayShifts = shiftsByDay.get(day) ?? [];

                return (
                  <Card
                    key={day}
                    className="rounded-[30px] border-white/70 bg-white/84"
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                            {day}
                          </h2>
                          <p className="text-sm text-brand-ink/55">
                            {dayShifts.length} {dayShifts.length === 1 ? "shift" : "shifts"}
                          </p>
                        </div>
                        <Badge variant="subtle">
                          {dayShifts.reduce(
                            (sum, shift) => sum + getWorkShiftDurationHours(shift),
                            0,
                          )}{" "}
                          hrs
                        </Badge>
                      </div>

                      <div className="mt-4 grid gap-3">
                        {status === "loading" ? (
                          <div className="rounded-[22px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm text-brand-ink/52">
                            Loading shifts...
                          </div>
                        ) : null}

                        {status !== "loading" && dayShifts.length === 0 ? (
                          <div className="rounded-[22px] border border-dashed border-brand-ink/12 bg-white/60 p-4 text-sm leading-6 text-brand-ink/52">
                            No work shifts planned.
                          </div>
                        ) : null}

                        {dayShifts.map((shift) => (
                          <WorkShiftCard
                            key={shift.id}
                            shift={shift}
                            onRemove={removeShift}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
