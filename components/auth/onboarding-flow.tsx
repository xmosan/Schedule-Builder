"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  planningInterests,
  scheduleIntensities,
  userRoles,
  type PlannerProfile,
  type PlanningInterest,
  type ScheduleIntensity,
  type UserRole,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type OnboardingFlowProps = {
  onComplete: (profile: PlannerProfile) => void;
};

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<UserRole | null>(null);
  const [interests, setInterests] = useState<PlanningInterest[]>([]);
  const [intensity, setIntensity] = useState<ScheduleIntensity>("Moderate");

  function toggleInterest(interest: PlanningInterest) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((i) => i !== interest)
        : [...current, interest],
    );
  }

  function handleSkip() {
    onComplete({
      role: "General personal planning",
      interests: [],
      intensity: "Moderate",
      onboardingCompleted: true,
    });
  }

  function handleNext() {
    if (step < 3) {
      setStep(step + 1);
    } else {
      if (role) {
        onComplete({
          role,
          interests,
          intensity,
          onboardingCompleted: true,
        });
      }
    }
  }

  return (
    <div className="px-3 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
      <div className="app-shell">
        <div className="mx-auto max-w-xl">
          <Card className="rounded-[30px] border-white/75 bg-white/90">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Onboarding</Badge>
                  <Badge variant="subtle">Step {step} of 3</Badge>
                </div>
                <button
                  onClick={handleSkip}
                  className="text-xs font-semibold uppercase tracking-widest text-brand-ink/40 hover:text-brand-ink"
                >
                  Skip
                </button>
              </div>

              <div className="mt-8">
                {step === 1 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h1 className="text-2xl font-semibold tracking-tight text-brand-ink sm:text-3xl">
                      What are you using Schedule Builder for?
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-brand-ink/60">
                      We&apos;ll use this to shape your starter projects and planning dashboard.
                    </p>
                    <div className="mt-6 grid gap-2">
                      {userRoles.map((r) => (
                        <button
                          key={r}
                          onClick={() => setRole(r)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all",
                            role === r
                              ? "border-brand-ink bg-brand-ink text-white shadow-lg"
                              : "border-brand-ink/10 bg-white hover:border-brand-ink/30",
                          )}
                        >
                          <span className="font-semibold">{r}</span>
                          {role === r && (
                            <div className="h-2 w-2 rounded-full bg-brand-teal" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h1 className="text-2xl font-semibold tracking-tight text-brand-ink sm:text-3xl">
                      What do you want help planning?
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-brand-ink/60">
                      Select one or more areas of focus.
                    </p>
                    <div className="mt-6 grid gap-2 sm:grid-cols-2">
                      {planningInterests.map((interest) => {
                        const isSelected = interests.includes(interest);
                        return (
                          <button
                            key={interest}
                            onClick={() => toggleInterest(interest)}
                            className={cn(
                              "flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all",
                              isSelected
                                ? "border-brand-teal/30 bg-brand-teal/10 text-brand-teal"
                                : "border-brand-ink/10 bg-white hover:border-brand-ink/20",
                            )}
                          >
                            <span className="text-sm font-semibold">{interest}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h1 className="text-2xl font-semibold tracking-tight text-brand-ink sm:text-3xl">
                      How intense is your schedule right now?
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-brand-ink/60">
                      This helps us calibrate your weekly commitment views.
                    </p>
                    <div className="mt-6 grid grid-cols-3 gap-2">
                      {scheduleIntensities.map((i) => (
                        <button
                          key={i}
                          onClick={() => setIntensity(i)}
                          className={cn(
                            "flex flex-col items-center justify-center rounded-2xl border py-6 transition-all",
                            intensity === i
                              ? "border-brand-ink bg-brand-ink text-white"
                              : "border-brand-ink/10 bg-white hover:border-brand-ink/20",
                          )}
                        >
                          <span className="text-sm font-semibold">{i}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-10 flex gap-3">
                {step > 1 && (
                  <Button
                    variant="outline"
                    onClick={() => setStep(step - 1)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                )}
                <Button
                  onClick={handleNext}
                  disabled={step === 1 && !role}
                  className="flex-1"
                >
                  {step === 3 ? "Complete" : "Next"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
