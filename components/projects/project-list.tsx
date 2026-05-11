"use client";

import { useMemo, useState } from "react";
import { FolderStackIcon } from "@/components/projects/icons";
import { ProjectCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { priorityScore, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

type ProjectFilter = "active" | "completed" | "all";
type ProjectSort = "priority" | "deadline" | "weeklyHours" | "category";

type ProjectListProps = {
  onDeleteProject: (id: number) => void;
  onToggleComplete: (id: number) => void;
  onUpdateProject: (project: Project) => void;
  projects: Project[];
};

const filterLabels: Record<ProjectFilter, string> = {
  active: "Active",
  completed: "Completed",
  all: "All",
};

const sortLabels: Record<ProjectSort, string> = {
  priority: "Priority",
  deadline: "Deadline",
  weeklyHours: "Weekly hours",
  category: "Category",
};

function getDeadlineSortValue(deadline: string) {
  return deadline.trim().toLowerCase() || "zzzzzz";
}

function sortProjects(projects: Project[], sortBy: ProjectSort) {
  return [...projects].sort((a, b) => {
    if (sortBy === "priority") {
      return (
        priorityScore[b.priority] - priorityScore[a.priority] ||
        b.weeklyHours - a.weeklyHours ||
        a.name.localeCompare(b.name)
      );
    }

    if (sortBy === "weeklyHours") {
      return b.weeklyHours - a.weeklyHours || a.name.localeCompare(b.name);
    }

    if (sortBy === "category") {
      return (
        a.category.localeCompare(b.category) ||
        priorityScore[b.priority] - priorityScore[a.priority] ||
        a.name.localeCompare(b.name)
      );
    }

    return (
      getDeadlineSortValue(a.deadline).localeCompare(
        getDeadlineSortValue(b.deadline),
      ) || a.name.localeCompare(b.name)
    );
  });
}

function EmptyProjectState({ filter }: { filter: ProjectFilter }) {
  const copy =
    filter === "completed"
      ? "Completed projects will collect here after you mark work as done."
      : "Add a project to start building your command center.";

  return (
    <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/58 p-6 text-center">
      <p className="text-sm font-semibold text-brand-ink">No projects here yet</p>
      <p className="mt-2 text-sm leading-6 text-brand-ink/60">{copy}</p>
    </div>
  );
}

export function ProjectList({
  onDeleteProject,
  onToggleComplete,
  onUpdateProject,
  projects,
}: ProjectListProps) {
  const [filter, setFilter] = useState<ProjectFilter>("active");
  const [sortBy, setSortBy] = useState<ProjectSort>("priority");

  const activeProjects = useMemo(
    () => sortProjects(projects.filter((project) => !project.completed), sortBy),
    [projects, sortBy],
  );
  const completedProjects = useMemo(
    () => sortProjects(projects.filter((project) => project.completed), sortBy),
    [projects, sortBy],
  );

  const shouldShowActive = filter === "active" || filter === "all";
  const shouldShowCompleted = filter === "completed" || filter === "all";
  const visibleProjectCount =
    (shouldShowActive ? activeProjects.length : 0) +
    (shouldShowCompleted ? completedProjects.length : 0);

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-ink/6 p-2 text-brand-ink">
              <FolderStackIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                Project Command Center
              </h2>
              <p className="text-sm leading-6 text-brand-ink/60">
                Review active work, refine next actions, and choose what to plan next.
              </p>
            </div>
          </div>
          <Badge>{visibleProjectCount} visible</Badge>
        </div>

        <div className="mb-5 grid gap-3 rounded-[24px] border border-brand-ink/8 bg-brand-ink/[0.025] p-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as ProjectFilter[]).map((option) => (
              <button
                key={option}
                className={cn(
                  "h-10 rounded-2xl px-4 text-sm font-semibold transition active:scale-[0.98]",
                  filter === option
                    ? "bg-brand-ink text-white shadow-[0_12px_26px_rgba(18,32,47,0.14)]"
                    : "bg-white/75 text-brand-ink/65 hover:bg-white hover:text-brand-ink",
                )}
                type="button"
                onClick={() => setFilter(option)}
              >
                {filterLabels[option]}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="sr-only">Sort projects</span>
            <Select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as ProjectSort)}
            >
              {(Object.keys(sortLabels) as ProjectSort[]).map((option) => (
                <option key={option} value={option}>
                  Sort by {sortLabels[option]}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="space-y-4">
          {shouldShowActive ? (
            <section className="space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-brand-ink/45">
                  Active projects
                </h3>
                <span className="text-xs font-semibold text-brand-ink/45">
                  {activeProjects.length}
                </span>
              </div>

              {activeProjects.length > 0 ? (
                activeProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onDeleteProject={onDeleteProject}
                    onToggleComplete={onToggleComplete}
                    onUpdateProject={onUpdateProject}
                  />
                ))
              ) : (
                <EmptyProjectState filter={filter} />
              )}
            </section>
          ) : null}

          {shouldShowCompleted ? (
            <details
              key={filter}
              className="group rounded-[26px] border border-brand-ink/8 bg-white/58 p-3"
              open={filter === "completed"}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[20px] px-2 py-2 text-sm font-semibold text-brand-ink">
                <span>Completed projects</span>
                <span className="rounded-full bg-brand-ink/6 px-3 py-1 text-xs text-brand-ink/60">
                  {completedProjects.length}
                </span>
              </summary>

              <div className="mt-3 space-y-3 sm:space-y-4">
                {completedProjects.length > 0 ? (
                  completedProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onDeleteProject={onDeleteProject}
                      onToggleComplete={onToggleComplete}
                      onUpdateProject={onUpdateProject}
                    />
                  ))
                ) : (
                  <EmptyProjectState filter="completed" />
                )}
              </div>
            </details>
          ) : null}

        </div>
      </CardContent>
    </Card>
  );
}
