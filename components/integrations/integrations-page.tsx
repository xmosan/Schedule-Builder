"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "@/components/projects/icons";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { integrations } from "@/lib/integrations";
import {
  type DesiredIntegration,
  type PlannerType,
} from "@/lib/onboarding";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchPlannerProfileForUser } from "@/lib/supabase/scheduler";

type ProfileStatus = "loading" | "loaded" | "signed_out" | "error";

const defaultRecommendationsByPlannerType: Record<
  PlannerType,
  DesiredIntegration[]
> = {
  Student: ["D2L / Brightspace", "Google Calendar", "ICS import/export"],
  Professional: ["Google Calendar", "Outlook Calendar", "ICS import/export"],
  "Organization leader": [
    "Google Calendar",
    "Outlook Calendar",
    "Apple Calendar",
  ],
  "Creator / entrepreneur": [
    "Google Calendar",
    "Apple Calendar",
    "ICS import/export",
  ],
  "General planning": ["Google Calendar", "Apple Calendar", "ICS import/export"],
};

const recommendationReasons: Record<
  PlannerType,
  Record<DesiredIntegration, string>
> = {
  Student: {
    "Google Calendar":
      "Useful for keeping classes, study blocks, and project work visible across devices.",
    "Apple Calendar":
      "Helpful if your personal schedule already lives across Apple devices.",
    "Outlook Calendar":
      "A good fit when school, work, or internship commitments live in Microsoft tools.",
    "D2L / Brightspace":
      "Most relevant for pulling course deadlines, quizzes, and assignment dates into planning.",
    "ICS import/export":
      "A flexible fallback for importing course calendars or exported academic schedules.",
  },
  Professional: {
    "Google Calendar":
      "Strong for coordinating focus blocks, project deadlines, and shared calendars.",
    "Apple Calendar":
      "Useful when personal commitments and work blocks need to sit beside each other.",
    "Outlook Calendar":
      "A natural fit for meetings, follow-ups, deadlines, and Microsoft-based workdays.",
    "D2L / Brightspace":
      "Less central for most professional workflows unless you also manage coursework.",
    "ICS import/export":
      "Helpful for moving calendar data between tools without a direct connection.",
  },
  "Organization leader": {
    "Google Calendar":
      "Helpful for shared events, team reminders, and coordinating schedules with others.",
    "Apple Calendar":
      "Useful for keeping organization work visible beside personal commitments.",
    "Outlook Calendar":
      "A good fit for formal meetings, admin work, and organization communications.",
    "D2L / Brightspace":
      "Useful only if your organization planning overlaps with course-based schedules.",
    "ICS import/export":
      "Helpful for sharing events or importing calendars from tools that export files.",
  },
  "Creator / entrepreneur": {
    "Google Calendar":
      "Useful for content blocks, client commitments, launches, and cross-device planning.",
    "Apple Calendar":
      "Helpful when creative work needs to stay visible beside personal scheduling.",
    "Outlook Calendar":
      "A good fit if clients, admin work, or meetings already run through Microsoft tools.",
    "D2L / Brightspace":
      "Less central unless your creator or business work also overlaps with coursework.",
    "ICS import/export":
      "Useful for exporting launches, content plans, or important work blocks into other tools.",
  },
  "General planning": {
    "Google Calendar":
      "A balanced option for keeping weekly plans visible across devices and shared calendars.",
    "Apple Calendar":
      "A practical fit if your everyday schedule lives on Apple devices.",
    "Outlook Calendar":
      "Useful when meetings, work commitments, or admin tasks live in Microsoft tools.",
    "D2L / Brightspace":
      "Best when classes, assignments, or course calendars are part of your planning.",
    "ICS import/export":
      "A flexible option for moving calendar data in or out without a direct integration.",
  },
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

  return "Personalized recommendations are unavailable right now.";
}

export function IntegrationsPage() {
  const [plannerType, setPlannerType] =
    useState<PlannerType>("General planning");
  const [desiredIntegrations, setDesiredIntegrations] = useState<
    DesiredIntegration[]
  >([]);
  const [profileStatus, setProfileStatus] =
    useState<ProfileStatus>("loading");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setProfileStatus("signed_out");
      setProfileMessage("Sign in to personalize integration recommendations.");
      return;
    }

    let isActive = true;

    async function loadPlannerProfile() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (!isActive) {
          return;
        }

        if (sessionError) {
          setProfileStatus("error");
          setProfileMessage(sessionError.message);
          return;
        }

        const userId = sessionData.session?.user.id;

        if (!userId) {
          setProfileStatus("signed_out");
          setProfileMessage("Sign in to personalize integration recommendations.");
          return;
        }

        const profileResult = await fetchPlannerProfileForUser(supabase, userId);

        if (!isActive) {
          return;
        }

        if (profileResult.error) {
          setProfileStatus("error");
          setProfileMessage(getErrorMessage(profileResult.error));
          return;
        }

        if (profileResult.data) {
          setPlannerType(profileResult.data.plannerType);
          setDesiredIntegrations(profileResult.data.desiredIntegrations);
          setProfileMessage(null);
        } else {
          setPlannerType("General planning");
          setDesiredIntegrations([]);
          setProfileMessage("Using balanced recommendations until onboarding is saved.");
        }

        setProfileStatus("loaded");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setProfileStatus("error");
        setProfileMessage(getErrorMessage(error));
      }
    }

    void loadPlannerProfile();

    return () => {
      isActive = false;
    };
  }, []);

  const selectedIntegrations = useMemo(() => {
    return new Set<DesiredIntegration>(desiredIntegrations);
  }, [desiredIntegrations]);

  const workflowRecommendedIntegrations = useMemo(() => {
    return new Set<DesiredIntegration>(
      defaultRecommendationsByPlannerType[plannerType],
    );
  }, [plannerType]);

  const visibleIntegrations = useMemo(() => {
    return [...integrations].sort((first, second) => {
      const firstSelected = selectedIntegrations.has(first.onboardingName);
      const secondSelected = selectedIntegrations.has(second.onboardingName);
      const firstWorkflowRecommended = workflowRecommendedIntegrations.has(
        first.onboardingName,
      );
      const secondWorkflowRecommended = workflowRecommendedIntegrations.has(
        second.onboardingName,
      );
      const firstScore = (firstSelected ? 2 : 0) + (firstWorkflowRecommended ? 1 : 0);
      const secondScore =
        (secondSelected ? 2 : 0) + (secondWorkflowRecommended ? 1 : 0);

      return secondScore - firstScore;
    });
  }, [selectedIntegrations, workflowRecommendedIntegrations]);

  const recommendationSource =
    desiredIntegrations.length > 0
      ? "Recommended for you"
      : `Recommended for ${plannerType.toLowerCase()}`;

  return (
    <div className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_320px] lg:items-end lg:gap-6">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Settings / Integrations
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                Prepare Schedule Builder for calendar connections.
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                These placeholders show where calendar and import workflows can
                connect later. OAuth, imports, and email-based automation are
                intentionally not enabled yet.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>5 planned integrations</Badge>
                <Badge variant="subtle">{recommendationSource}</Badge>
                <Badge variant="subtle">UI placeholders only</Badge>
              </div>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
              <CardContent className="p-4 sm:p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                  Current scope
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-[22px] border border-brand-ink/8 bg-white/75 p-4">
                    <p className="text-sm font-semibold text-brand-ink">
                      Recommendations only
                    </p>
                    <p className="mt-2 text-sm leading-6 text-brand-ink/65">
                      {profileStatus === "loading"
                        ? "Loading your onboarding preferences..."
                        : profileMessage ??
                          "Highlighted cards reflect your onboarding profile. No accounts are connected yet."}
                    </p>
                  </div>

                  <Link
                    href="/"
                    className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-brand-ink/10 bg-white/75 px-4 text-sm font-semibold text-brand-ink hover:-translate-y-0.5 hover:border-brand-ink/20 hover:bg-white"
                  >
                    Back to planner
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
          {visibleIntegrations.map((integration) => {
            const wasSelectedDuringSetup = selectedIntegrations.has(
              integration.onboardingName,
            );
            const isUsefulForWorkflow = workflowRecommendedIntegrations.has(
              integration.onboardingName,
            );
            const isRecommended =
              wasSelectedDuringSetup || isUsefulForWorkflow;
            const recommendationLabel = wasSelectedDuringSetup
              ? "Selected during setup"
              : "Useful for your workflow";

            return (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                isRecommended={isRecommended}
                recommendationLabel={recommendationLabel}
                recommendationReason={
                  isRecommended
                    ? recommendationReasons[plannerType][integration.onboardingName]
                    : undefined
                }
              />
            );
          })}
        </section>

        <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Roadmap note</Badge>
              <Badge variant="subtle">No OAuth yet</Badge>
              <Badge variant="subtle">No email scanning yet</Badge>
            </div>

            <p className="mt-4 text-sm leading-6 text-brand-ink/70 sm:text-base">
              The next implementation phase can focus on real connection flows
              without changing the planning layout. Until then, this page keeps
              the integration surface visible and easy to extend.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
