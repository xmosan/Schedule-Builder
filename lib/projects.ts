export const projectCategories = ["Must-do", "Growth", "Maintenance"] as const;
export const priorityLevels = ["High", "Medium", "Low"] as const;
export const projectsStorageKeyBase = "project-schedule-dashboard:projects";

export function getProjectsStorageKey(userId?: string) {
  return userId ? `${projectsStorageKeyBase}:${userId}` : projectsStorageKeyBase;
}

export type ProjectCategory = (typeof projectCategories)[number];
export type ProjectPriority = (typeof priorityLevels)[number];

export type Project = {
  id: number;
  name: string;
  category: ProjectCategory;
  priority: ProjectPriority;
  deadline: string;
  nextAction: string;
  weeklyHours: number;
  completed: boolean;
};

export type ProjectDraft = {
  name: string;
  category: ProjectCategory;
  priority: ProjectPriority;
  deadline: string;
  nextAction: string;
  weeklyHours: string;
};

export const defaultProjectDraft: ProjectDraft = {
  name: "",
  category: "Must-do",
  priority: "Medium",
  deadline: "",
  nextAction: "",
  weeklyHours: "2",
};

export const starterProjects: Project[] = [
  {
    id: 1,
    name: "School / Exams",
    category: "Must-do",
    priority: "High",
    deadline: "This week",
    nextAction: "Finish the highest-deadline assignment",
    weeklyHours: 10,
    completed: false,
  },
  {
    id: 2,
    name: "SaaS Project",
    category: "Growth",
    priority: "High",
    deadline: "Long-term",
    nextAction: "Fix one feature or bug",
    weeklyHours: 6,
    completed: false,
  },
  {
    id: 3,
    name: "Career / Internships",
    category: "Must-do",
    priority: "High",
    deadline: "Weekly",
    nextAction: "Apply to one strong internship or follow up",
    weeklyHours: 3,
    completed: false,
  },
  {
    id: 4,
    name: "Islamic School / MSA",
    category: "Maintenance",
    priority: "Medium",
    deadline: "Saturday",
    nextAction: "Prepare next lesson or session plan",
    weeklyHours: 3,
    completed: false,
  },
];

export const categoryStyles: Record<ProjectCategory, string> = {
  "Must-do": "border-[#f5c3b4] bg-[#fff1eb] text-[#a44322]",
  Growth: "border-[#b9dde9] bg-[#edf8fc] text-[#155e75]",
  Maintenance: "border-[#cce5d9] bg-[#edf8f2] text-[#2f6f59]",
};

export const priorityStyles: Record<ProjectPriority, string> = {
  High: "border-brand-coral/20 bg-brand-coral/10 text-brand-coral",
  Medium: "border-brand-ocean/20 bg-brand-ocean/10 text-brand-ocean",
  Low: "border-brand-ink/10 bg-brand-ink/5 text-brand-ink/70",
};

export const priorityScore: Record<ProjectPriority, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

function isProjectCategory(value: unknown): value is ProjectCategory {
  return typeof value === "string" && projectCategories.includes(value as ProjectCategory);
}

function isProjectPriority(value: unknown): value is ProjectPriority {
  return typeof value === "string" && priorityLevels.includes(value as ProjectPriority);
}

function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Project>;

  return (
    typeof candidate.id === "number" &&
    Number.isFinite(candidate.id) &&
    typeof candidate.name === "string" &&
    isProjectCategory(candidate.category) &&
    isProjectPriority(candidate.priority) &&
    typeof candidate.deadline === "string" &&
    typeof candidate.nextAction === "string" &&
    typeof candidate.weeklyHours === "number" &&
    Number.isFinite(candidate.weeklyHours) &&
    typeof candidate.completed === "boolean"
  );
}

export function parseStoredProjects(value: string | null): Project[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return null;
    }

    const projects = parsed.filter(isProject);
    return projects.length === parsed.length ? projects : null;
  } catch {
    return null;
  }
}

export function sortProjectsForFocus(projects: Project[]) {
  return [...projects]
    .filter((project) => !project.completed)
    .sort((a, b) => {
      return (
        priorityScore[b.priority] - priorityScore[a.priority] ||
        b.weeklyHours - a.weeklyHours
      );
    });
}

export function getPlannedHours(projects: Project[]) {
  return projects
    .filter((project) => !project.completed)
    .reduce((sum, project) => sum + project.weeklyHours, 0);
}

export function createProjectFromDraft(draft: ProjectDraft): Project | null {
  const weeklyHours = Number(draft.weeklyHours);

  if (!draft.name.trim() || !draft.nextAction.trim() || weeklyHours < 1) {
    return null;
  }

  return {
    id: Date.now(),
    name: draft.name.trim(),
    category: draft.category,
    priority: draft.priority,
    deadline: draft.deadline.trim(),
    nextAction: draft.nextAction.trim(),
    weeklyHours,
    completed: false,
  };
}
