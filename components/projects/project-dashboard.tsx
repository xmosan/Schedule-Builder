"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderStackIcon, TargetIcon } from "@/components/projects/icons";
import { AddProjectForm } from "@/components/projects/add-project-form";
import { ProjectList } from "@/components/projects/project-list";
import { TopTasksCard } from "@/components/projects/top-tasks-card";
import { WeeklyPlanSection } from "@/components/projects/weekly-plan-section";
import { WeeklySummaryCard } from "@/components/projects/weekly-summary-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  getPlannedHours,
  parseStoredProjects,
  projectsStorageKey,
  sortProjectsForFocus,
  starterProjects,
  type Project,
} from "@/lib/projects";

export function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>(starterProjects);
  const [hasLoadedProjects, setHasLoadedProjects] = useState(false);

  useEffect(() => {
    const savedProjects = parseStoredProjects(
      window.localStorage.getItem(projectsStorageKey),
    );

    if (savedProjects) {
      setProjects(savedProjects);
    }

    setHasLoadedProjects(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedProjects) {
      return;
    }

    window.localStorage.setItem(projectsStorageKey, JSON.stringify(projects));
  }, [hasLoadedProjects, projects]);

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

  return (
    <div className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
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

        <WeeklyPlanSection projects={projects} />
      </div>
    </div>
  );
}
