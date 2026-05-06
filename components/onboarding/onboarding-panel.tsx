"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  desiredIntegrationOptions,
  plannerTypes,
  planningGoalOptions,
  scheduleIntensityOptions,
  type DesiredIntegration,
  type OnboardingAnswers,
  type PlannerType,
  type PlanningGoal,
  type ScheduleIntensity,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type OnboardingPanelProps = {
  error: string | null;
  isSubmitting: boolean;
  onComplete: (answers: OnboardingAnswers) => Promise<void>;
  onSkip: () => Promise<void>;
};

function toggleSelection<Option extends string>(
  current: Option[],
  option: Option,
) {
  return current.includes(option)
    ? current.filter((item) => item !== option)
    : [...current, option];
}

export function OnboardingPanel({
  error,
  isSubmitting,
  onComplete,
  onSkip,
}: OnboardingPanelProps) {
  const [plannerType, setPlannerType] = useState<PlannerType>("General planning");
  const [planningGoals, setPlanningGoals] = useState<PlanningGoal[]>([]);
  const [desiredIntegrations, setDesiredIntegrations] = useState<
    DesiredIntegration[]
  >([]);
  const [scheduleIntensity, setScheduleIntensity] =
    useState<ScheduleIntensity>("Moderate");

  const answers: OnboardingAnswers = {
    plannerType,
    planningGoals,
    desiredIntegrations,
    scheduleIntensity,
  };

  return (
    <div className="px-3 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
      <div className="app-shell">
        <div className="mx-auto max-w-3xl">
          <Card className="overflow-hidden rounded-[30px] border-white/75 bg-white/90">
            <CardContent className="p-5 sm:p-7 lg:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Quick setup</Badge>
                <Badge variant="subtle">2 minutes</Badge>
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-4xl">
                Personalize Schedule Builder.
              </h1>

              <p className="mt-3 text-sm leading-6 text-brand-ink/65 sm:text-base">
                We&apos;ll use this to shape your starter projects and
                recommend useful integrations later.
              </p>

              <div className="mt-6 space-y-4 sm:mt-7 sm:space-y-5">
                <section className="rounded-[26px] border border-brand-ink/8 bg-white/70 p-4 sm:p-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                      Question 1
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-brand-ink sm:text-xl">
                      What are you using Schedule Builder for?
                    </h2>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {plannerTypes.map((option) => {
                      const isSelected = plannerType === option;

                      return (
                        <button
                          key={option}
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[20px] border px-4 py-3 text-left text-sm font-semibold",
                            isSelected
                              ? "border-brand-teal/30 bg-brand-teal/10 text-brand-teal shadow-[0_14px_34px_rgba(15,118,110,0.12)]"
                              : "border-brand-ink/10 bg-white/78 text-brand-ink/72 hover:border-brand-ink/20 hover:bg-white",
                          )}
                          disabled={isSubmitting}
                          type="button"
                          onClick={() => setPlannerType(option)}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-[26px] border border-brand-ink/8 bg-white/70 p-4 sm:p-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                      Question 2
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-brand-ink sm:text-xl">
                      What do you want help planning?
                    </h2>
                    <p className="mt-1 text-sm text-brand-ink/55">
                      Choose as many as apply.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {planningGoalOptions.map((option) => {
                      const isSelected = planningGoals.includes(option);

                      return (
                        <button
                          key={option}
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[20px] border px-4 py-3 text-left text-sm font-semibold",
                            isSelected
                              ? "border-brand-ocean/30 bg-brand-ocean/10 text-brand-ocean shadow-[0_14px_34px_rgba(21,94,117,0.1)]"
                              : "border-brand-ink/10 bg-white/78 text-brand-ink/72 hover:border-brand-ink/20 hover:bg-white",
                          )}
                          disabled={isSubmitting}
                          type="button"
                          onClick={() =>
                            setPlanningGoals((current) =>
                              toggleSelection(current, option),
                            )
                          }
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-[26px] border border-brand-ink/8 bg-white/70 p-4 sm:p-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                      Question 3
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-brand-ink sm:text-xl">
                      Which integrations might you want later?
                    </h2>
                    <p className="mt-1 text-sm text-brand-ink/55">
                      We will not connect calendars or AI yet.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {desiredIntegrationOptions.map((option) => {
                      const isSelected = desiredIntegrations.includes(option);

                      return (
                        <button
                          key={option}
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[20px] border px-4 py-3 text-left text-sm font-semibold",
                            isSelected
                              ? "border-brand-coral/30 bg-brand-coral/10 text-brand-coral shadow-[0_14px_34px_rgba(199,91,57,0.1)]"
                              : "border-brand-ink/10 bg-white/78 text-brand-ink/72 hover:border-brand-ink/20 hover:bg-white",
                          )}
                          disabled={isSubmitting}
                          type="button"
                          onClick={() =>
                            setDesiredIntegrations((current) =>
                              toggleSelection(current, option),
                            )
                          }
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-[26px] border border-brand-ink/8 bg-white/70 p-4 sm:p-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                      Question 4
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-brand-ink sm:text-xl">
                      How intense is your schedule right now?
                    </h2>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {scheduleIntensityOptions.map((option) => {
                      const isSelected = scheduleIntensity === option;

                      return (
                        <button
                          key={option}
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[20px] border px-4 py-3 text-center text-sm font-semibold",
                            isSelected
                              ? "border-brand-teal/30 bg-brand-teal/10 text-brand-teal shadow-[0_14px_34px_rgba(15,118,110,0.12)]"
                              : "border-brand-ink/10 bg-white/78 text-brand-ink/72 hover:border-brand-ink/20 hover:bg-white",
                          )}
                          disabled={isSubmitting}
                          type="button"
                          onClick={() => setScheduleIntensity(option)}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              {error ? (
                <p className="mt-5 rounded-[22px] border border-brand-coral/15 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                  {error}
                </p>
              ) : null}

              <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <Button
                  className="w-full sm:w-auto"
                  disabled={isSubmitting}
                  type="button"
                  onClick={() => void onComplete(answers)}
                >
                  {isSubmitting ? "Saving setup..." : "Finish setup"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={isSubmitting}
                  type="button"
                  variant="outline"
                  onClick={() => void onSkip()}
                >
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
