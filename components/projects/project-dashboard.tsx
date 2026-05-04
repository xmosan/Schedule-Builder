"use client";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { FolderStackIcon, TargetIcon } from "@/components/projects/icons";
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
  getPlannedHours,
  getProjectsStorageKey,
  parseStoredProjects,
  sortProjectsForFocus,
  starterProjects,
  type Project,
} from "@/lib/projects";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchProjectsForUser,
  fetchWeeklyPlanBlocksForUser,
  replaceProjectsForUser,
  replaceWeeklyPlanBlocksForUser,
} from "@/lib/supabase/scheduler";
import {
  getWeeklyPlanStorageKey,
  parseStoredWeeklyPlan,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

type AuthStatus = "loading" | "signed_in" | "signed_out";

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

export function ProjectDashboard() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>(starterProjects);
  const [planBlocks, setPlanBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [hasLoadedRemoteData, setHasLoadedRemoteData] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    const client = getSupabaseBrowserClient();
    setSupabase(client);

    let isActive = true;

    async function loadSession() {
      const {
        data: { session },
      } = await client.auth.getSession();

      if (!isActive) {
        return;
      }

      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setAuthStatus(nextUser ? "signed_in" : "signed_out");
    }

    void loadSession();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session: Session | null) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setAuthStatus(nextUser ? "signed_in" : "signed_out");
      setAuthError(null);

      if (!nextUser) {
        setProjects(starterProjects);
        setPlanBlocks([]);
        setHasLoadedRemoteData(false);
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
    const migratedProjects =
      parseStoredProjects(window.localStorage.getItem(projectStorageKey)) ??
      parseStoredProjects(
        window.localStorage.getItem(getProjectsStorageKey()),
      ) ??
      starterProjects;
    const migratedPlanBlocks =
      parseStoredWeeklyPlan(window.localStorage.getItem(weeklyPlanStorageKey)) ??
      parseStoredWeeklyPlan(
        window.localStorage.getItem(getWeeklyPlanStorageKey()),
      ) ??
      [];

    setProjects(migratedProjects);
    setPlanBlocks(migratedPlanBlocks);
    setHasLoadedRemoteData(false);
    setDataMessage("Loading your schedule from Supabase...");

    async function loadRemoteScheduler() {
      const [projectsResult, weeklyPlanResult] = await Promise.all([
        fetchProjectsForUser(activeSupabase, activeUser.id),
        fetchWeeklyPlanBlocksForUser(activeSupabase, activeUser.id),
      ]);

      if (!isActive) {
        return;
      }

      const nextProjects =
        projectsResult.error == null
          ? projectsResult.data.length > 0
            ? projectsResult.data
            : migratedProjects
          : migratedProjects;
      const nextPlanBlocks =
        weeklyPlanResult.error == null
          ? weeklyPlanResult.data.length > 0
            ? weeklyPlanResult.data
            : migratedPlanBlocks
          : migratedPlanBlocks;

      setProjects(nextProjects);
      setPlanBlocks(nextPlanBlocks);
      window.localStorage.setItem(projectStorageKey, JSON.stringify(nextProjects));
      window.localStorage.setItem(
        weeklyPlanStorageKey,
        JSON.stringify(nextPlanBlocks),
      );
      setHasLoadedRemoteData(true);

      const loadErrors = [projectsResult.error, weeklyPlanResult.error].filter(
        Boolean,
      );

      if (loadErrors.length > 0) {
        setDataMessage(
          `Supabase sync had trouble loading your schedule: ${loadErrors
            .map(getSchedulerErrorMessage)
            .join(" ")} Local backup is still in use.`,
        );
        return;
      }

      setDataMessage(null);
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

    if (!supabase || !hasLoadedRemoteData) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function syncProjects() {
      const { error } = await replaceProjectsForUser(
        activeSupabase,
        activeUser.id,
        projects,
      );

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
  }, [hasLoadedRemoteData, projects, supabase, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const activeUser = user;
    window.localStorage.setItem(
      getWeeklyPlanStorageKey(activeUser.id),
      JSON.stringify(planBlocks),
    );

    if (!supabase || !hasLoadedRemoteData) {
      return;
    }

    const activeSupabase = supabase;
    let isActive = true;

    async function syncWeeklyPlan() {
      const { error } = await replaceWeeklyPlanBlocksForUser(
        activeSupabase,
        activeUser.id,
        planBlocks,
      );

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
  }, [hasLoadedRemoteData, planBlocks, supabase, user]);

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
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthError(error.message);
    }

    setIsAuthSubmitting(false);
  }

  async function signUp(email: string, password: string) {
    if (!supabase) {
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthError(error.message);
      setIsAuthSubmitting(false);
      return;
    }

    if (!data.session) {
      setAuthMessage("Check your email to confirm your account, then sign in.");
    }

    setIsAuthSubmitting(false);
  }

  async function sendMagicLink(email: string) {
    if (!supabase) {
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthError(error.message);
      setIsAuthSubmitting(false);
      return;
    }

    setAuthMessage("Magic link sent. Open the email on this device to sign in.");
    setIsAuthSubmitting(false);
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    setDataMessage(null);
    await supabase.auth.signOut();
  }

  if (!isSupabaseConfigured()) {
    return (
      <AuthPanel
        error={authError}
        isConfigured={false}
        isSubmitting={false}
        message={authMessage}
        onSendMagicLink={sendMagicLink}
        onSignInWithPassword={signInWithPassword}
        onSignUp={signUp}
      />
    );
  }

  if (authStatus === "loading" || (authStatus === "signed_in" && !hasLoadedRemoteData)) {
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
        onSignInWithPassword={signInWithPassword}
        onSignUp={signUp}
      />
    );
  }

  return (
    <div className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_320px] lg:items-end lg:gap-6">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <FolderStackIcon className="h-4 w-4" />
                Personal Project Control Center
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl lg:text-6xl">
                Schedule your projects without wasting attention.
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                Track active projects, define the next action, protect your
                weekly capacity, and let the dashboard surface the Top 3 tasks
                that deserve today&apos;s focus.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>{activeProjects} active projects</Badge>
                <Badge variant="subtle">{completedProjects} completed</Badge>
                <Badge variant="subtle">{totalHours} hrs planned</Badge>
              </div>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                    <TargetIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                      Focus Rule
                    </p>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/70">
                      Incomplete projects rise by priority first, then by weekly
                      time commitment.
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-[22px] border border-brand-ink/8 bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                    Signed in as
                  </p>
                  <p className="mt-2 truncate text-sm font-semibold text-brand-ink">
                    {user?.email}
                  </p>
                  {dataMessage ? (
                    <p className="mt-2 text-sm leading-6 text-brand-ink/60">
                      {dataMessage}
                    </p>
                  ) : null}
                  <Button
                    className="mt-4 w-full"
                    size="sm"
                    variant="outline"
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_360px] lg:gap-6">
          <div className="order-2 lg:order-1">
            <ProjectList projects={projects} onToggleComplete={toggleComplete} />
          </div>

          <div className="order-1 flex flex-col gap-5 sm:gap-6 lg:order-2">
            <WeeklySummaryCard
              totalHours={totalHours}
              activeProjects={activeProjects}
              completedProjects={completedProjects}
            />
            <TopTasksCard projects={topThree} />
            <AddProjectForm onAddProject={addProject} />
          </div>
        </section>

        <WeeklyPlanSection
          onAddBlock={addWeeklyPlanBlock}
          onRemoveBlock={removeWeeklyPlanBlock}
          planBlocks={planBlocks}
          projects={projects}
        />
      </div>
    </div>
  );
}
