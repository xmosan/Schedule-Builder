import type { Project, ProjectCategory, ProjectPriority } from "@/lib/projects";

export const plannerTypes = [
  "Student",
  "Professional",
  "Organization leader",
  "Creator / entrepreneur",
  "General planning",
] as const;

export const planningGoalOptions = [
  "Classes and assignments",
  "Projects and deadlines",
  "Meetings and events",
  "Organization tasks",
  "Content or business work",
  "Personal goals",
] as const;

export const desiredIntegrationOptions = [
  "Google Calendar",
  "Apple Calendar",
  "Outlook Calendar",
  "D2L / Brightspace",
  "ICS import/export",
  "Work schedule imports",
] as const;

export const scheduleIntensityOptions = ["Light", "Moderate", "Heavy"] as const;

export type PlannerType = (typeof plannerTypes)[number];
export type PlanningGoal = (typeof planningGoalOptions)[number];
export type DesiredIntegration = (typeof desiredIntegrationOptions)[number];
export type ScheduleIntensity = (typeof scheduleIntensityOptions)[number];

export type PlannerProfile = {
  userId: string;
  plannerType: PlannerType;
  planningGoals: PlanningGoal[];
  desiredIntegrations: DesiredIntegration[];
  scheduleIntensity: ScheduleIntensity;
  onboardingCompleted: boolean;
};

export type OnboardingAnswers = {
  plannerType: PlannerType;
  planningGoals: PlanningGoal[];
  desiredIntegrations: DesiredIntegration[];
  scheduleIntensity: ScheduleIntensity;
};

type StarterProjectTemplate = {
  name: string;
  category: ProjectCategory;
  priority: ProjectPriority;
  deadline: string;
  nextAction: string;
  weeklyHours: number;
};

const starterProjectsByPlannerType: Record<PlannerType, StarterProjectTemplate[]> = {
  Student: [
    {
      name: "Courses / Classes",
      category: "Must-do",
      priority: "High",
      deadline: "Weekly",
      nextAction: "Review upcoming course requirements and choose the next class task",
      weeklyHours: 6,
    },
    {
      name: "Assignments",
      category: "Must-do",
      priority: "High",
      deadline: "This week",
      nextAction: "Complete the highest-priority assignment step",
      weeklyHours: 5,
    },
    {
      name: "Exams / Study Blocks",
      category: "Growth",
      priority: "High",
      deadline: "Upcoming exam",
      nextAction: "Schedule the next focused study block",
      weeklyHours: 4,
    },
    {
      name: "Career / Internships",
      category: "Growth",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Apply, follow up, or update one career item",
      weeklyHours: 2,
    },
  ],
  Professional: [
    {
      name: "Work Projects",
      category: "Must-do",
      priority: "High",
      deadline: "This week",
      nextAction: "Move the highest-priority work project forward",
      weeklyHours: 6,
    },
    {
      name: "Meetings / Follow-ups",
      category: "Maintenance",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Send one follow-up or prepare the next meeting",
      weeklyHours: 3,
    },
    {
      name: "Deadlines",
      category: "Must-do",
      priority: "High",
      deadline: "Upcoming",
      nextAction: "Finish the next deadline-driven deliverable",
      weeklyHours: 5,
    },
    {
      name: "Skill Development",
      category: "Growth",
      priority: "Low",
      deadline: "Ongoing",
      nextAction: "Practice or learn one useful skill",
      weeklyHours: 2,
    },
  ],
  "Organization leader": [
    {
      name: "Events",
      category: "Must-do",
      priority: "High",
      deadline: "Next event",
      nextAction: "Confirm the next event milestone",
      weeklyHours: 4,
    },
    {
      name: "Meetings",
      category: "Maintenance",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Prepare the next agenda or recap",
      weeklyHours: 2,
    },
    {
      name: "Outreach",
      category: "Growth",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Send one outreach message or partnership follow-up",
      weeklyHours: 3,
    },
    {
      name: "Admin / Funding",
      category: "Maintenance",
      priority: "Medium",
      deadline: "Monthly",
      nextAction: "Complete one admin, budget, or funding task",
      weeklyHours: 2,
    },
    {
      name: "Member Tasks",
      category: "Maintenance",
      priority: "Low",
      deadline: "Weekly",
      nextAction: "Assign or check one member-owned task",
      weeklyHours: 2,
    },
  ],
  "Creator / entrepreneur": [
    {
      name: "Content Planning",
      category: "Growth",
      priority: "High",
      deadline: "Weekly",
      nextAction: "Outline the next piece of content",
      weeklyHours: 4,
    },
    {
      name: "Product Development",
      category: "Must-do",
      priority: "High",
      deadline: "This week",
      nextAction: "Ship the next useful product improvement",
      weeklyHours: 6,
    },
    {
      name: "Marketing",
      category: "Growth",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Publish or test one growth activity",
      weeklyHours: 3,
    },
    {
      name: "Client / Admin Work",
      category: "Maintenance",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Clear the next client or admin follow-up",
      weeklyHours: 3,
    },
  ],
  "General planning": [
    {
      name: "Personal Goals",
      category: "Growth",
      priority: "High",
      deadline: "This week",
      nextAction: "Choose the next visible step for one goal",
      weeklyHours: 3,
    },
    {
      name: "Weekly Priorities",
      category: "Must-do",
      priority: "High",
      deadline: "Weekly",
      nextAction: "Pick the most important priority for the week",
      weeklyHours: 4,
    },
    {
      name: "Admin Tasks",
      category: "Maintenance",
      priority: "Medium",
      deadline: "Weekly",
      nextAction: "Clear one task that reduces future friction",
      weeklyHours: 2,
    },
    {
      name: "Projects",
      category: "Must-do",
      priority: "Medium",
      deadline: "Ongoing",
      nextAction: "Move one active project to its next milestone",
      weeklyHours: 4,
    },
  ],
};

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  options: Values,
): value is Values[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

export function normalizePlannerType(value: unknown): PlannerType {
  return isOneOf(value, plannerTypes) ? value : "General planning";
}

export function normalizePlanningGoals(value: unknown): PlanningGoal[] {
  return Array.isArray(value)
    ? value.filter((item): item is PlanningGoal => isOneOf(item, planningGoalOptions))
    : [];
}

export function normalizeDesiredIntegrations(value: unknown): DesiredIntegration[] {
  return Array.isArray(value)
    ? value.filter((item): item is DesiredIntegration =>
        isOneOf(item, desiredIntegrationOptions),
      )
    : [];
}

export function normalizeScheduleIntensity(value: unknown): ScheduleIntensity {
  return isOneOf(value, scheduleIntensityOptions) ? value : "Moderate";
}

export function createStarterProjectsForPlannerType(
  plannerType: PlannerType,
): Project[] {
  const templates = starterProjectsByPlannerType[plannerType];
  const idBase = Date.now();

  return templates.map((template, index) => ({
    id: idBase + index,
    ...template,
    completed: false,
  }));
}
