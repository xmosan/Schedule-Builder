"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getDefaultGoalsForPlannerType,
  getOnboardingSetupRecommendations,
  getRecommendedDesiredIntegrations,
  getUseCaseForPlannerType,
  onboardingHelpGoalOptions,
  onboardingUseCases,
  scheduleIntensityOptions,
  type OnboardingAnswers,
  type OnboardingUseCase,
  type PlannerType,
  type PlanningGoal,
  type ScheduleIntensity,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type OnboardingPanelProps = {
  error: string | null;
  initialAnswers?: OnboardingAnswers | null;
  isSubmitting: boolean;
  mode?: "setup" | "edit";
  onCancel?: () => void;
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

function getInitialPlannerType(initialAnswers?: OnboardingAnswers | null) {
  return initialAnswers?.plannerType === "Creator / entrepreneur"
    ? "General planning"
    : initialAnswers?.plannerType ?? "General planning";
}

function getInitialPlanningGoals(
  plannerType: PlannerType,
  initialAnswers?: OnboardingAnswers | null,
) {
  return initialAnswers?.planningGoals.length
    ? initialAnswers.planningGoals
    : getDefaultGoalsForPlannerType(plannerType);
}

function getInitialScheduleIntensity(initialAnswers?: OnboardingAnswers | null) {
  return initialAnswers?.scheduleIntensity ?? "Moderate";
}

const goalDisplayLabels: Partial<Record<PlanningGoal, string>> = {
  "Sync plans to Google Calendar": "Send plans to Google Calendar",
};

const toolDescriptions: Partial<Record<string, string>> = {
  "Google Calendar": "bring in existing events",
  "ICS import/export": "move plans between calendar apps",
  "D2L / Brightspace": "import course events",
  "Apple Calendar": "use calendar files today",
  "Outlook Calendar": "support planned later",
};

function getGoalDisplayLabel(goal: PlanningGoal) {
  return goalDisplayLabels[goal] ?? goal;
}

function SelectedPathPill({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-brand-teal/15 bg-brand-teal/[0.08] px-3 py-1 text-xs font-semibold text-brand-teal">
      Selected path: {label}
    </span>
  );
}

function UseCaseCard({
  disabled,
  isSelected,
  useCase,
  onSelect,
}: {
  disabled: boolean;
  isSelected: boolean;
  onSelect: () => void;
  useCase: OnboardingUseCase;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "group rounded-[24px] border p-4 text-left transition-all sm:p-5",
        isSelected
          ? "border-brand-teal/30 bg-brand-teal/10 text-brand-teal shadow-[0_18px_44px_rgba(15,118,110,0.12)]"
          : "border-brand-ink/10 bg-white/78 text-brand-ink hover:-translate-y-0.5 hover:border-brand-ink/20 hover:bg-white",
      )}
      disabled={disabled}
      type="button"
      onClick={onSelect}
    >
      <span className="text-base font-semibold">{useCase.label}</span>
      <span
        className={cn(
          "mt-2 block text-sm leading-6",
          isSelected ? "text-brand-teal/78" : "text-brand-ink/58",
        )}
      >
        {useCase.description}
      </span>
    </button>
  );
}

export function OnboardingPanel({
  error,
  initialAnswers,
  isSubmitting,
  mode = "setup",
  onCancel,
  onComplete,
  onSkip,
}: OnboardingPanelProps) {
  const initialPlannerType = getInitialPlannerType(initialAnswers);
  const [step, setStep] = useState(0);
  const [plannerType, setPlannerType] =
    useState<PlannerType>(initialPlannerType);
  const [planningGoals, setPlanningGoals] = useState<PlanningGoal[]>(
    getInitialPlanningGoals(initialPlannerType, initialAnswers),
  );
  const [scheduleIntensity, setScheduleIntensity] =
    useState<ScheduleIntensity>(getInitialScheduleIntensity(initialAnswers));

  const selectedUseCase = getUseCaseForPlannerType(plannerType);
  const desiredIntegrations = useMemo(
    () => getRecommendedDesiredIntegrations(plannerType, planningGoals),
    [plannerType, planningGoals],
  );
  const setupRecommendations = useMemo(
    () => getOnboardingSetupRecommendations(plannerType, planningGoals),
    [plannerType, planningGoals],
  );
  const answers: OnboardingAnswers = {
    plannerType,
    planningGoals,
    desiredIntegrations,
    scheduleIntensity,
  };
  const progress = `${step + 1} of 3`;
  const isIntroStep = step === 0;

  function selectUseCase(useCase: OnboardingUseCase) {
    const nextPlannerType = useCase.plannerType as PlannerType;

    setPlannerType(nextPlannerType);
    setPlanningGoals(getDefaultGoalsForPlannerType(nextPlannerType));
  }

  return (
    <div className="px-3 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
      <div className="app-shell">
        <div className="mx-auto max-w-5xl">
          <Card className="overflow-hidden rounded-[32px] border-white/75 bg-white/90 shadow-[0_28px_70px_rgba(18,32,47,0.08)]">
            <CardContent className="p-5 sm:p-7 lg:p-9">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{mode === "edit" ? "Update setup" : "Guided setup"}</Badge>
                  <Badge variant="subtle">{progress}</Badge>
                  <Badge variant="subtle">No passwords required</Badge>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-brand-ink/[0.06] sm:w-52">
                  <div
                    className="h-full rounded-full bg-brand-teal transition-all"
                    style={{ width: `${((step + 1) / 3) * 100}%` }}
                  />
                </div>
              </div>

              <div
                className={cn(
                  "mt-6 grid gap-6 lg:items-start",
                  isIntroStep
                    ? "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
                    : "mx-auto max-w-3xl",
                )}
              >
                {isIntroStep ? (
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-teal">
                      Onboarding v2
                    </p>
                    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-5xl">
                      Set up the planner around your real week.
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-brand-ink/65 sm:text-base">
                      Pick your main use case. You can change this later.
                    </p>

                    <div className="mt-5 rounded-[26px] border border-brand-teal/12 bg-brand-teal/[0.06] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
                        Selected path
                      </p>
                      <p className="mt-2 text-lg font-semibold text-brand-ink">
                        {selectedUseCase.label}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        {selectedUseCase.description}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="min-w-0 rounded-[30px] border border-brand-ink/8 bg-white/76 p-4 sm:p-5">
                  {step === 0 ? (
                    <section>
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                        Step 1 of 3
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-brand-ink sm:text-2xl">
                        What are you planning around?
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        Pick the closest fit. Nothing gets locked.
                      </p>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {onboardingUseCases.map((useCase) => (
                          <UseCaseCard
                            disabled={isSubmitting}
                            isSelected={plannerType === useCase.plannerType}
                            key={useCase.id}
                            useCase={useCase}
                            onSelect={() => selectUseCase(useCase)}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {step === 1 ? (
                    <section>
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                        Step 2 of 3
                      </p>
                      <div className="mt-2">
                        <SelectedPathPill label={selectedUseCase.label} />
                      </div>
                      <h2 className="mt-2 text-xl font-semibold text-brand-ink sm:text-2xl">
                        What should Schedule Builder help with first?
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        Choose one or more.
                      </p>

                      <div className="mt-5 flex flex-wrap gap-2">
                        {onboardingHelpGoalOptions.map((option) => {
                          const isSelected = planningGoals.includes(option);

                          return (
                            <button
                              aria-pressed={isSelected}
                              className={cn(
                                "min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition-all",
                                isSelected
                                  ? "border-brand-ocean/30 bg-brand-ocean/10 text-brand-ocean shadow-[0_12px_28px_rgba(21,94,117,0.1)]"
                                  : "border-brand-ink/10 bg-white/78 text-brand-ink/68 hover:border-brand-ink/20 hover:bg-white",
                              )}
                              disabled={isSubmitting}
                              key={option}
                              type="button"
                              onClick={() =>
                                setPlanningGoals((current) =>
                                  toggleSelection(current, option),
                                )
                              }
                            >
                              {getGoalDisplayLabel(option)}
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-6 rounded-[22px] border border-brand-ink/8 bg-brand-ink/[0.025] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                          One more detail
                        </p>
                        <p className="mt-2 text-sm font-semibold text-brand-ink">
                          How full does your schedule feel?
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {scheduleIntensityOptions.map((option) => {
                            const isSelected = scheduleIntensity === option;

                            return (
                              <button
                                aria-pressed={isSelected}
                                className={cn(
                                  "rounded-[18px] border px-4 py-3 text-center text-sm font-semibold transition-all",
                                  isSelected
                                    ? "border-brand-teal/30 bg-brand-teal/10 text-brand-teal shadow-[0_14px_34px_rgba(15,118,110,0.12)]"
                                    : "border-brand-ink/10 bg-white/78 text-brand-ink/72 hover:border-brand-ink/20 hover:bg-white",
                                )}
                                disabled={isSubmitting}
                                key={option}
                                type="button"
                                onClick={() => setScheduleIntensity(option)}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {step === 2 ? (
                    <section>
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink/45">
                        Step 3 of 3
                      </p>
                      <div className="mt-2">
                        <SelectedPathPill label={selectedUseCase.label} />
                      </div>
                      <h2 className="mt-2 text-xl font-semibold text-brand-ink sm:text-2xl">
                        Your setup path is ready
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                        Start with these steps, then adjust anytime from
                        Dashboard or Settings.
                      </p>

                      {planningGoals.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {planningGoals.map((goal) => (
                            <span
                              className="rounded-full bg-brand-ink/[0.045] px-3 py-1 text-xs font-semibold text-brand-ink/58"
                              key={goal}
                            >
                              {getGoalDisplayLabel(goal)}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-5 grid gap-3">
                        {setupRecommendations.map((item, index) => (
                          <div
                            className="rounded-[22px] border border-brand-ink/8 bg-white/78 p-4"
                            key={item.id}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-brand-ink">
                                  {index + 1}. {item.title}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                                  {item.reason}
                                </p>
                              </div>
                              <span className="rounded-full bg-brand-ink/[0.045] px-3 py-1 text-xs font-semibold text-brand-ink/58">
                                {item.actionLabel}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-5 rounded-[22px] border border-brand-teal/12 bg-brand-teal/[0.06] p-4">
                        <p className="text-sm font-semibold text-brand-teal">
                          Recommended tools
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {desiredIntegrations.map((integration) => (
                            <span
                              className="rounded-[16px] bg-white/80 px-3 py-2 text-xs font-semibold text-brand-ink/72"
                              key={integration}
                            >
                              <span className="text-brand-teal">{integration}</span>
                              {toolDescriptions[integration] ? (
                                <span className="text-brand-ink/45">
                                  {" "}
                                  - {toolDescriptions[integration]}
                                </span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </div>

                      <p className="mt-5 rounded-[20px] bg-brand-ink/[0.035] px-4 py-3 text-sm font-semibold text-brand-ink">
                        You&apos;re ready to start planning.
                      </p>
                    </section>
                  ) : null}

                  {error ? (
                    <p className="mt-5 rounded-[22px] border border-brand-coral/15 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                      {error}
                    </p>
                  ) : null}

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-2">
                      {step > 0 ? (
                        <Button
                          disabled={isSubmitting}
                          type="button"
                          variant="outline"
                          onClick={() => setStep((current) => current - 1)}
                        >
                          Back
                        </Button>
                      ) : null}
                      {mode === "edit" ? (
                        <Button
                          disabled={isSubmitting}
                          type="button"
                          variant="outline"
                          onClick={onCancel}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          disabled={isSubmitting}
                          type="button"
                          variant="outline"
                          onClick={() => void onSkip()}
                        >
                          Skip for now
                        </Button>
                      )}
                    </div>

                    {step < 2 ? (
                      <Button
                        disabled={isSubmitting}
                        type="button"
                        onClick={() => setStep((current) => current + 1)}
                      >
                        Continue
                      </Button>
                    ) : (
                      <Button
                        disabled={isSubmitting}
                        type="button"
                        onClick={() => void onComplete(answers)}
                      >
                        {isSubmitting
                          ? "Saving setup..."
                          : mode === "edit"
                            ? "Save preferences"
                            : "Finish and open Dashboard"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
