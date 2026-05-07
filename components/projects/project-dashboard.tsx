"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { OnboardingPanel } from "@/components/onboarding/onboarding-panel";
import {
  CalendarIcon,
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { AddProjectForm } from "@/components/projects/add-project-form";
import { ProjectList } from "@/components/projects/project-list";
import { TopTasksCard } from "@/components/projects/top-tasks-card";
import { WeeklyPlanSection } from "@/components/projects/weekly-plan-section";
import { WeeklySummaryCard } from "@/components/projects/weekly-summary-card";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  createStarterProjectsForPlannerType,
  type OnboardingAnswers,
} from "@/lib/onboarding";
import {
  getPlannedHours,
  getProjectsStorageKey,
  parseStoredProjects,
  sortProjectsForFocus,
  starterProjects,
  type Project,
} from "@/lib/projects";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchPlannerProfileForUser,
  fetchProjectsForUser,
  fetchWeeklyPlanBlocksForUser,
  savePlannerProfileForUser,
  replaceProjectsForUser,
  replaceWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";
import {
  getWeeklyPlanStorageKey,
  parseStoredWeeklyPlan,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

type AuthStatus = "loading" | "signed_in" | "signed_out";
type OnboardingStatus = "loading" | "required" | "completed";
type SchedulerSection = "dashboard" | "projects" | "plan" | "settings";

function getSchedulerSection(pathname: string): SchedulerSection {
  if (pathname.startsWith("/projects")) {
    return "projects";
  }

  if (pathname.startsWith("/plan")) {
    return "plan";
  }

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  return "dashboard";
}

function getSchedulerErrorMessage(error: unknown) {
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

  return "Please try again shortly.";
}

function isMissingPlannerProfilesTable(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "PGRST205" &&
    typeof candidate.message === "string" &&
    candidate.message.includes("planner_profiles")
  );
}

function getOnboardingProfileErrorMessage(error: unknown) {
  if (isMissingPlannerProfilesTable(error)) {
    return "The onboarding table is missing in Supabase. Run supabase/onboarding.sql in the Supabase project connected to this app, then try again.";
  }

  return getSchedulerErrorMessage(error);
}

function getAuthRedirectUrl() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");

  return configuredSiteUrl || window.location.origin.replace(/\/$/, "");
}

function getAuthUrlErrorMessage() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash,
  );
  const errorDescription =
    searchParams.get("error_description") ??
    hashParams.get("error_description");
  const errorCode = searchParams.get("error") ?? hashParams.get("error");

  if (!errorDescription && !errorCode) {
    return null;
  }

  return errorDescription ?? `Authentication failed: ${errorCode}`;
}

function clearAuthUrlError() {
  const url = new URL(window.location.href);
  const searchParams = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
  );
  const authErrorKeys = ["error", "error_code", "error_description"];

  authErrorKeys.forEach((key) => {
    searchParams.delete(key);
    hashParams.delete(key);
  });

  url.search = searchParams.toString();
  url.hash = hashParams.toString();
  window.history.replaceState(null, "", url.toString());
}

function FocusRuleCard() {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
            <TargetIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Focus Rule
            </p>
            <p className="mt-2 text-sm leading-6 text-brand-ink/70">
              Incomplete projects are ranked by priority first, then by planned
              weekly effort.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type AccountCardProps = {
  dataMessage: string | null;
  email?: string | null;
  onSignOut: () => void;
};

function AccountCard({ dataMessage, email, onSignOut }: AccountCardProps) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
          Signed in as
        </p>
        <p className="mt-2 truncate text-sm font-semibold text-brand-ink sm:text-base">
          {email}
        </p>
        {dataMessage ? (
          <p className="mt-3 text-sm leading-6 text-brand-ink/60">
            {dataMessage}
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-brand-ink/60">
            Your schedule is connected to Supabase for cross-device planning.
          </p>
        )}
        <Button
          className="mt-4 w-full"
          size="sm"
          variant="outline"
          onClick={onSignOut}
        >
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProjectDashboard() {
  const pathname = usePathname();
  const currentSection = getSchedulerSection(pathname);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>(starterProjects);
  const [planBlocks, setPlanBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [onboardingStatus, setOnboardingStatus] =
    useState<OnboardingStatus>("loading");
  const [hasLoadedRemoteData, setHasLoadedRemoteData] = useState(false);
  const [canSyncProjects, setCanSyncProjects] = useState(false);
  const [canSyncWeeklyPlan, setCanSyncWeeklyPlan] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isOnboardingSubmitting, setIsOnboardingSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let client: SupabaseClient;

    try {
      client = getSupabaseBrowserClient();
    } catch (error) {
      setAuthError(getSchedulerErrorMessage(error));
      setAuthStatus("signed_out");
      return;
    }

    setSupabase(client);

    let isActive = true;

    async function loadSession() {
      try {
        const urlAuthError = getAuthUrlErrorMessage();

        if (urlAuthError) {
          setAuthError(urlAuthError);
          clearAuthUrlError();
        }

        const { data, error } = await client.auth.getSession();

        if (!isActive) {
          return;
        }

        if (error) {
          setAuthError(error.message);
        }

        const nextUser = data.session?.user ?? null;
        setUser(nextUser);
        setAuthStatus(nextUser ? "signed_in" : "signed_out");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setAuthError(getSchedulerErrorMessage(error));
        setAuthStatus("signed_out");
      }
    }

    void loadSession();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session: Session | null) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setAuthStatus(nextUser ? "signed_in" : "signed_out");
      setIsAuthSubmitting(false);

      if (nextUser || event === "SIGNED_OUT") {
        setAuthError(null);
      }

      if (!nextUser) {
        setProjects(starterProjects);
        setPlanBlocks([]);
        setOnboardingStatus("loading");
        setHasLoadedRemoteData(false);
        setCanSyncProjects(false);
        setCanSyncWeeklyPlan(false);
        setOnboardingError(null);
        setDataMessage(null);
      }
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      return;
    }

    const activeSupabase = supabase;
    const activeUser = user;
    let isActive = true;
    const projectStorageKey = getProjectsStorageKey(activeUser.id);
    const weeklyPlanStorageKey = getWeeklyPlanStorageKey(activeUser.id);
    const userStoredProjects = parseStoredProjects(
      window.localStorage.getItem(projectStorageKey),
    );
    const legacyStoredProjects = parseStoredProjects(
      window.localStorage.getItem(getProjectsStorageKey()),
    );
    const storedProjects = userStoredProjects ?? legacyStoredProjects;
    const userStoredPlanBlocks = parseStoredWeeklyPlan(
      window.localStorage.getItem(weeklyPlanStorageKey),
    );
    const legacyStoredPlanBlocks = parseStoredWeeklyPlan(
      window.localStorage.getItem(getWeeklyPlanStorageKey()),
    );
    const migratedPlanBlocks = userStoredPlanBlocks ?? legacyStoredPlanBlocks ?? [];

    setProjects(storedProjects ?? []);
    setPlanBlocks(migratedPlanBlocks);
    setOnboardingStatus("loading");
    setHasLoadedRemoteData(false);
    setCanSyncProjects(false);
    setCanSyncWeeklyPlan(false);
    setOnboardingError(null);
    setDataMessage("Loading your schedule from Supabase...");

    async function loadRemoteScheduler() {
      try {
        const [profileResult, projectsResult, weeklyPlanResult] = await Promise.all([
          fetchPlannerProfileForUser(activeSupabase, activeUser.id),
          fetchProjectsForUser(activeSupabase, activeUser.id),
          fetchWeeklyPlanBlocksForUser(activeSupabase, activeUser.id),
        ]);

        if (!isActive) {
          return;
        }

        const profileLoadFailed = Boolean(profileResult.error);
        const nextProfile = profileResult.error == null ? profileResult.data : null;
        const hasCompletedOnboarding = Boolean(nextProfile?.onboardingCompleted);
        const hasExistingSchedulerData =
          (projectsResult.error == null && projectsResult.data.length > 0) ||
          (weeklyPlanResult.error == null && weeklyPlanResult.data.length > 0) ||
          Boolean(userStoredProjects?.length) ||
          Boolean(userStoredPlanBlocks?.length);
        const shouldShowOnboarding =
          !hasCompletedOnboarding && !hasExistingSchedulerData;
        const nextProjects =
          projectsResult.error == null
            ? projectsResult.data.length > 0
              ? projectsResult.data
              : storedProjects ?? []
            : storedProjects ?? [];
        const nextPlanBlocks =
          weeklyPlanResult.error == null
            ? weeklyPlanResult.data.length > 0
              ? weeklyPlanResult.data
              : migratedPlanBlocks
            : migratedPlanBlocks;

        setOnboardingStatus(shouldShowOnboarding ? "required" : "completed");
        setOnboardingError(
          profileLoadFailed && shouldShowOnboarding
            ? `We could not check your onboarding profile: ${getOnboardingProfileErrorMessage(profileResult.error)}`
            : null,
        );
        setProjects(nextProjects);
        setPlanBlocks(nextPlanBlocks);
        window.localStorage.setItem(projectStorageKey, JSON.stringify(nextProjects));
        window.localStorage.setItem(
          weeklyPlanStorageKey,
          JSON.stringify(nextPlanBlocks),
        );
        setHasLoadedRemoteData(true);
        setCanSyncProjects(projectsResult.error == null);
        setCanSyncWeeklyPlan(weeklyPlanResult.error == null);

        const loadErrors = [
          profileResult.error,
          projectsResult.error,
          weeklyPlanResult.error,
        ].filter(Boolean);

        if (loadErrors.length > 0) {
          setDataMessage(
            `Supabase sync had trouble loading your schedule: ${loadErrors
              .map(getSchedulerErrorMessage)
              .join(" ")} Local backup is still in use. If onboarding does not appear, run the latest Supabase SQL.`,
          );
          return;
        }

        setDataMessage(null);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setProjects(storedProjects ?? []);
        setPlanBlocks(migratedPlanBlocks);
        setOnboardingStatus("completed");
        setHasLoadedRemoteData(true);
        setCanSyncProjects(false);
        setCanSyncWeeklyPlan(false);
        setDataMessage(
          `Supabase sync had trouble loading your schedule: ${getSchedulerErrorMessage(error)} Local backup is still in use.`,
        );
      }
    }

    void loadRemoteScheduler();

    return () => {
      isActive = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const activeUser = user;
    window.localStorage.setItem(
      getProjectsStorageKey(activeUser.id),
      JSON.stringify(projects),
    );

    if (!supabase || !hasLoadedRemoteData || !canSyncProjects) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function syncProjects() {
      let error: unknown = null;

      try {
        const result = await replaceProjectsForUser(
          activeSupabase,
          activeUser.id,
          projects,
        );
        error = result.error;
      } catch (syncError) {
        error = syncError;
      }

      if (!isActive || !error) {
        if (isActive && !error) {
          setDataMessage((current) =>
            current &&
            (current.includes("local backup") || current.includes("Saved locally"))
              ? null
              : current,
          );
        }
        return;
      }

      setDataMessage(
        `Saved locally. Supabase sync will retry after your next change. ${getSchedulerErrorMessage(error)}`,
      );
      console.error("Failed to sync projects to Supabase:", error);
    }

    void syncProjects();

    return () => {
      isActive = false;
    };
  }, [canSyncProjects, hasLoadedRemoteData, projects, supabase, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const activeUser = user;
    window.localStorage.setItem(
      getWeeklyPlanStorageKey(activeUser.id),
      JSON.stringify(planBlocks),
    );

    if (!supabase || !hasLoadedRemoteData || !canSyncWeeklyPlan) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function syncWeeklyPlan() {
      let error: unknown = null;

      try {
        const result = await replaceWeeklyPlanBlocksForUser(
          activeSupabase,
          activeUser.id,
          planBlocks,
        );
        error = result.error;
      } catch (syncError) {
        error = syncError;
      }

      if (!isActive || !error) {
        if (isActive && !error) {
          setDataMessage((current) =>
            current &&
            (current.includes("local backup") || current.includes("Saved locally"))
              ? null
              : current,
          );
        }
        return;
      }

      setDataMessage(
        `Saved locally. Supabase sync will retry after your next change. ${getSchedulerErrorMessage(error)}`,
      );
      console.error("Failed to sync weekly plan blocks to Supabase:", error);
    }

    void syncWeeklyPlan();

    return () => {
      isActive = false;
    };
  }, [canSyncWeeklyPlan, hasLoadedRemoteData, planBlocks, supabase, user]);

  const activeProjects = useMemo(
    () => projects.filter((project) => !project.completed).length,
    [projects],
  );

  const completedProjects = useMemo(
    () => projects.filter((project) => project.completed).length,
    [projects],
  );

  const totalHours = useMemo(() => getPlannedHours(projects), [projects]);

  const topThree = useMemo(
    () => sortProjectsForFocus(projects).slice(0, 3),
    [projects],
  );

  function addProject(project: Project) {
    setProjects((current) => [project, ...current]);
  }

  function toggleComplete(id: number) {
    setProjects((current) =>
      current.map((project) =>
        project.id === id
          ? { ...project, completed: !project.completed }
          : project,
      ),
    );
  }

  function addWeeklyPlanBlock(block: WeeklyPlanBlock) {
    setPlanBlocks((current) => [...current, block]);
  }

  function removeWeeklyPlanBlock(id: string) {
    setPlanBlocks((current) => current.filter((block) => block.id !== id));
  }

  async function signInWithPassword(email: string, password: string) {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setAuthError(error.message);
      }
    } catch (error) {
      setAuthError(getSchedulerErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function signUp(email: string, password: string) {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      if (!data.session) {
        setAuthMessage("Check your email to confirm your account, then sign in.");
      }
    } catch (error) {
      setAuthError(getSchedulerErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function sendMagicLink(email: string) {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      setAuthMessage("Magic link sent. Open the email on this device to sign in.");
    } catch (error) {
      setAuthError(getSchedulerErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function signInWithGoogle() {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage("Redirecting to Google...");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getAuthRedirectUrl(),
        },
      });

      if (!error) {
        return;
      }

      setAuthError(error.message);
      setAuthMessage(null);
    } catch (error) {
      setAuthError(getSchedulerErrorMessage(error));
      setAuthMessage(null);
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function signOut() {
    if (!supabase) {
      setAuthError("Supabase Auth is not configured yet.");
      return;
    }

    setDataMessage(null);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        setDataMessage(`Sign out failed: ${error.message}`);
      }
    } catch (error) {
      setDataMessage(`Sign out failed: ${getSchedulerErrorMessage(error)}`);
    }
  }

  async function completeOnboarding(answers: OnboardingAnswers) {
    if (!supabase || !user) {
      setOnboardingError("Sign in before saving onboarding.");
      return;
    }

    setIsOnboardingSubmitting(true);
    setOnboardingError(null);

    try {
      const result = await savePlannerProfileForUser(supabase, user.id, answers);

      if (result.error) {
        setOnboardingError(
          `Onboarding could not be saved: ${getOnboardingProfileErrorMessage(result.error)}`,
        );
        return;
      }

      setOnboardingStatus("completed");
      setDataMessage(null);

      if (projects.length === 0) {
        setProjects(createStarterProjectsForPlannerType(answers.plannerType));
      }
    } catch (error) {
      setOnboardingError(
        `Onboarding could not be saved: ${getOnboardingProfileErrorMessage(error)}`,
      );
    } finally {
      setIsOnboardingSubmitting(false);
    }
  }

  async function skipOnboarding() {
    await completeOnboarding({
      plannerType: "General planning",
      planningGoals: [],
      desiredIntegrations: [],
      scheduleIntensity: "Moderate",
    });
  }

  if (!isSupabaseConfigured()) {
    return (
      <AuthPanel
        error={authError}
        isConfigured={false}
        isSubmitting={false}
        message={authMessage}
        onSendMagicLink={sendMagicLink}
        onSignInWithGoogle={signInWithGoogle}
        onSignInWithPassword={signInWithPassword}
        onSignUp={signUp}
      />
    );
  }

  if (
    authStatus === "loading" ||
    (authStatus === "signed_in" &&
      (!hasLoadedRemoteData || onboardingStatus === "loading"))
  ) {
    return (
      <div className="px-3 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
        <div className="app-shell">
          <div className="mx-auto max-w-xl">
            <Card className="rounded-[30px] border-white/75 bg-white/90">
              <CardContent className="p-6 sm:p-7">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                  Loading
                </p>
                <h1 className="mt-3 text-2xl font-semibold text-brand-ink sm:text-3xl">
                  Preparing your synced scheduler...
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/65">
                  {dataMessage ?? "Checking your session and loading your latest schedule."}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === "signed_out") {
    return (
      <AuthPanel
        error={authError}
        isConfigured
        isSubmitting={isAuthSubmitting}
        message={authMessage}
        onSendMagicLink={sendMagicLink}
        onSignInWithGoogle={signInWithGoogle}
        onSignInWithPassword={signInWithPassword}
        onSignUp={signUp}
      />
    );
  }

  if (onboardingStatus === "required") {
    return (
      <OnboardingPanel
        error={onboardingError}
        isSubmitting={isOnboardingSubmitting}
        onComplete={completeOnboarding}
        onSkip={skipOnboarding}
      />
    );
  }

  return (
    <div className="pb-28 pt-5 sm:pt-6 md:pb-10 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        {currentSection === "dashboard" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
                <div className="max-w-4xl">
                  <div className="eyebrow-chip">
                    <FolderStackIcon className="h-4 w-4" />
                    Dashboard
                  </div>

                  <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl lg:text-6xl">
                    Choose the next right block of work.
                  </h1>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                    A focused home base for today&apos;s priorities, weekly
                    capacity, and the shortcuts you use most.
                  </p>

                  <div className="mt-5 flex flex-wrap gap-2.5">
                    <Badge>{activeProjects} active projects</Badge>
                    <Badge variant="subtle">{completedProjects} completed</Badge>
                    <Badge variant="subtle">{totalHours} hrs planned</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <Link
                    href="/projects"
                    className="rounded-[24px] border border-brand-ink/8 bg-white/78 p-4 text-brand-ink hover:-translate-y-0.5 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-brand-ink/6 p-2 text-brand-ink">
                        <FolderStackIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Open Projects</p>
                        <p className="text-sm text-brand-ink/58">
                          Manage lists and next actions.
                        </p>
                      </div>
                    </div>
                  </Link>

                  <Link
                    href="/plan"
                    className="rounded-[24px] border border-brand-ink/8 bg-white/78 p-4 text-brand-ink hover:-translate-y-0.5 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                        <CalendarIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Open Weekly Plan</p>
                        <p className="text-sm text-brand-ink/58">
                          Schedule blocks and export ICS.
                        </p>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            </section>

            <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
                <TopTasksCard projects={topThree} />
              </div>

              <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6">
                <WeeklySummaryCard
                  totalHours={totalHours}
                  activeProjects={activeProjects}
                  completedProjects={completedProjects}
                />
                <FocusRuleCard />
              </aside>
            </section>
          </>
        ) : null}

        {currentSection === "projects" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="max-w-3xl">
                <div className="eyebrow-chip">
                  <FolderStackIcon className="h-4 w-4" />
                  Projects
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                  Keep every project tied to a next action.
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                  Add, review, and complete the projects that feed your weekly
                  plan.
                </p>
              </div>
            </section>

            <section className="grid items-start gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="order-2 min-w-0 xl:order-1">
                <ProjectList
                  projects={projects}
                  onToggleComplete={toggleComplete}
                />
              </div>
              <aside className="order-1 min-w-0 xl:sticky xl:top-6 xl:order-2">
                <AddProjectForm onAddProject={addProject} />
              </aside>
            </section>
          </>
        ) : null}

        {currentSection === "plan" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="max-w-3xl">
                <div className="eyebrow-chip">
                  <CalendarIcon className="h-4 w-4" />
                  Weekly Plan
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                  Turn priorities into scheduled work blocks.
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                  Build your Monday-to-Sunday plan, then export it to your
                  calendar when you&apos;re ready.
                </p>
              </div>
            </section>

            <WeeklyPlanSection
              onAddBlock={addWeeklyPlanBlock}
              onRemoveBlock={removeWeeklyPlanBlock}
              planBlocks={planBlocks}
              projects={projects}
            />
          </>
        ) : null}

        {currentSection === "settings" ? (
          <>
            <section className="panel-strong overflow-hidden bg-dashboard-radial p-6 sm:p-8 lg:p-10">
              <div className="max-w-3xl">
                <div className="eyebrow-chip">
                  <TargetIcon className="h-4 w-4" />
                  Settings
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                  Account and sync status.
                </h1>
                <p className="mt-3 text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                  Check which account is signed in and confirm your schedule is
                  syncing.
                </p>
              </div>
            </section>

            <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <AccountCard
                dataMessage={dataMessage}
                email={user?.email}
                onSignOut={() => void signOut()}
              />
              <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
                <WeeklySummaryCard
                  totalHours={totalHours}
                  activeProjects={activeProjects}
                  completedProjects={completedProjects}
                />
                <FocusRuleCard />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
