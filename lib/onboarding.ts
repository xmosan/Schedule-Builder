import type { Project, ProjectCategory, ProjectPriority } from "@/lib/projects";

export const plannerTypes = [
  "Student",
  "Professional",
  "Organization leader",
  "Creator / entrepreneur",
  "General planning",
] as const;

export const onboardingUseCases = [
  {
    id: "school",
    label: "School / classes",
    plannerType: "Student",
    description:
      "Plan around classes, assignments, exams, Brightspace events, and study time.",
    defaultGoals: [
      "Find open time",
      "Avoid conflicts",
      "Build weekly plans",
      "Import calendars",
    ],
  },
  {
    id: "work",
    label: "Work schedule",
    plannerType: "Professional",
    description:
      "Block unavailable hours, protect personal time, and plan around shifts or meetings.",
    defaultGoals: ["Find open time", "Avoid conflicts", "Build weekly plans"],
  },
  {
    id: "organization",
    label: "Organization / team",
    plannerType: "Organization leader",
    description:
      "Prepare for events, team tasks, meetings, outreach, and shared deadlines.",
    defaultGoals: ["Avoid conflicts", "Build weekly plans", "Import calendars"],
  },
  {
    id: "personal",
    label: "Personal projects",
    plannerType: "General planning",
    description:
      "Organize projects, standalone tasks, appointments, routines, and open time.",
    defaultGoals: ["Find open time", "Build weekly plans"],
  },
] as const;

export const onboardingHelpGoalOptions = [
  "Find open time",
  "Avoid conflicts",
  "Build weekly plans",
  "Import calendars",
  "Sync plans to Google Calendar",
] as const;

const legacyPlanningGoalOptions = [
  "Classes and assignments",
  "Projects and deadlines",
  "Meetings and events",
  "Organization tasks",
  "Content or business work",
  "Personal goals",
] as const;

export const planningGoalOptions = [
  ...onboardingHelpGoalOptions,
  ...legacyPlanningGoalOptions,
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
export type OnboardingUseCase = (typeof onboardingUseCases)[number];

export type OnboardingSetupRecommendation = {
  id: string;
  title: string;
  reason: string;
  href: string;
  actionLabel: string;
};

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

const desiredIntegrationsByPlannerType: Record<PlannerType, DesiredIntegration[]> = {
  Student: ["D2L / Brightspace", "Google Calendar", "ICS import/export"],
  Professional: ["Google Calendar", "ICS import/export"],
  "Organization leader": ["Google Calendar", "ICS import/export"],
  "Creator / entrepreneur": ["Google Calendar", "ICS import/export"],
  "General planning": ["Google Calendar", "ICS import/export"],
};

const setupRecommendationsByPlannerType: Record<
  PlannerType,
  OnboardingSetupRecommendation[]
> = {
  Student: [
    {
      id: "import-d2l",
      title: "Import D2L / Brightspace calendar",
      reason:
        "Bring course due dates, quizzes, and school events into the Calendar hub.",
      href: "/integrations",
      actionLabel: "Open guided import",
    },
    {
      id: "add-school-project",
      title: "Add courses or school projects",
      reason:
        "Projects give the Assistant concrete next actions and weekly priorities.",
      href: "/projects",
      actionLabel: "Add project",
    },
    {
      id: "connect-google",
      title: "Connect Google Calendar read-only",
      reason:
        "Use existing classes, meetings, and commitments as unavailable time.",
      href: "/integrations",
      actionLabel: "Connect calendar",
    },
    {
      id: "study-block",
      title: "Add a study block",
      reason:
        "Turn your top class or assignment into a realistic weekly work block.",
      href: "/plan",
      actionLabel: "Open Weekly Plan",
    },
    {
      id: "assistant-study-time",
      title: "Ask for open study time",
      reason:
        "The Assistant can compare work shifts, imported events, and plan blocks.",
      href: "/assistant",
      actionLabel: "Open Assistant",
    },
  ],
  Professional: [
    {
      id: "add-work-shifts",
      title: "Add work shifts or unavailable hours",
      reason:
        "Schedule Builder can avoid planning project blocks during fixed work time.",
      href: "/work",
      actionLabel: "Add shifts",
    },
    {
      id: "connect-google",
      title: "Connect Google Calendar read-only",
      reason:
        "Meetings and existing events become planning context without write access.",
      href: "/integrations",
      actionLabel: "Connect calendar",
    },
    {
      id: "add-personal-project",
      title: "Add a project or task",
      reason:
        "Capture the work you want to move forward outside fixed commitments.",
      href: "/projects",
      actionLabel: "Open Projects",
    },
    {
      id: "calendar-open-time",
      title: "Check the Calendar hub",
      reason:
        "See work, plans, external events, deadlines, and open days together.",
      href: "/calendar",
      actionLabel: "Open Calendar",
    },
    {
      id: "assistant-balance",
      title: "Ask the Assistant to balance the week",
      reason:
        "Get a quick read on open time, overload risks, and better planning windows.",
      href: "/assistant",
      actionLabel: "Open Assistant",
    },
  ],
  "Organization leader": [
    {
      id: "add-org-project",
      title: "Add organization projects or events",
      reason:
        "Track event prep, outreach, meetings, and admin work in one place.",
      href: "/projects",
      actionLabel: "Open Projects",
    },
    {
      id: "prep-blocks",
      title: "Create preparation blocks",
      reason:
        "Reserve time for agendas, follow-ups, logistics, or member tasks.",
      href: "/plan",
      actionLabel: "Open Weekly Plan",
    },
    {
      id: "import-events",
      title: "Import existing event files",
      reason:
        "Use ICS files when events already live in another calendar or platform.",
      href: "/integrations",
      actionLabel: "Import ICS",
    },
    {
      id: "connect-google",
      title: "Connect Google Calendar read-only",
      reason:
        "Bring meetings and shared calendar commitments into planning context.",
      href: "/integrations",
      actionLabel: "Connect calendar",
    },
    {
      id: "assistant-conflicts",
      title: "Ask for conflicts and prep time",
      reason:
        "The Assistant can point out crowded days and open windows for prep.",
      href: "/assistant",
      actionLabel: "Open Assistant",
    },
  ],
  "Creator / entrepreneur": [
    {
      id: "add-projects",
      title: "Add projects or launches",
      reason:
        "Give your weekly plan a clear source for content, product, and admin work.",
      href: "/projects",
      actionLabel: "Open Projects",
    },
    {
      id: "plan-blocks",
      title: "Build weekly work blocks",
      reason:
        "Turn creative or business goals into focused blocks you can actually do.",
      href: "/plan",
      actionLabel: "Open Weekly Plan",
    },
    {
      id: "connect-google",
      title: "Connect Google Calendar read-only",
      reason:
        "Keep client calls, commitments, and planning blocks visible together.",
      href: "/integrations",
      actionLabel: "Connect calendar",
    },
    {
      id: "calendar-hub",
      title: "Review the Calendar hub",
      reason:
        "Find clean work windows before committing to new launches or tasks.",
      href: "/calendar",
      actionLabel: "Open Calendar",
    },
  ],
  "General planning": [
    {
      id: "add-projects",
      title: "Add projects or standalone tasks",
      reason:
        "Capture what you want to move forward, whether or not it belongs to a project.",
      href: "/projects",
      actionLabel: "Open Projects",
    },
    {
      id: "add-unavailable-time",
      title: "Add recurring unavailable time",
      reason:
        "Protect fixed commitments so the plan fits your real week.",
      href: "/work",
      actionLabel: "Add unavailable time",
    },
    {
      id: "connect-google",
      title: "Connect Google Calendar read-only",
      reason:
        "Use your existing calendar events as planning context.",
      href: "/integrations",
      actionLabel: "Connect calendar",
    },
    {
      id: "weekly-plan",
      title: "Create a weekly plan block",
      reason:
        "Put one priority on the board and build from there.",
      href: "/plan",
      actionLabel: "Open Weekly Plan",
    },
    {
      id: "assistant-prioritize",
      title: "Ask the Assistant for open time",
      reason:
        "Get a quick recommendation for where to place the next block.",
      href: "/assistant",
      actionLabel: "Open Assistant",
    },
  ],
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

export function getUseCaseForPlannerType(plannerType: PlannerType) {
  return (
    onboardingUseCases.find((useCase) => useCase.plannerType === plannerType) ??
    onboardingUseCases[3]
  );
}

export function getDefaultGoalsForPlannerType(
  plannerType: PlannerType,
): PlanningGoal[] {
  return [...getUseCaseForPlannerType(plannerType).defaultGoals] as PlanningGoal[];
}

export function getRecommendedDesiredIntegrations(
  plannerType: PlannerType,
  planningGoals: PlanningGoal[] = [],
): DesiredIntegration[] {
  const recommended = new Set<DesiredIntegration>(
    desiredIntegrationsByPlannerType[plannerType],
  );

  if (planningGoals.includes("Import calendars")) {
    recommended.add("ICS import/export");
  }

  if (planningGoals.includes("Sync plans to Google Calendar")) {
    recommended.add("Google Calendar");
  }

  if (plannerType === "Student") {
    recommended.add("D2L / Brightspace");
  }

  return [...recommended];
}

export function getOnboardingSetupRecommendations(
  plannerType: PlannerType,
  planningGoals: PlanningGoal[] = [],
): OnboardingSetupRecommendation[] {
  const recommendations = [...setupRecommendationsByPlannerType[plannerType]];

  if (
    planningGoals.includes("Sync plans to Google Calendar") &&
    !recommendations.some((item) => item.id === "connect-google")
  ) {
    recommendations.unshift({
      id: "connect-google",
      title: "Connect Google Calendar read-only",
      reason:
        "Read-only context is the first step before manually syncing approved blocks.",
      href: "/integrations",
      actionLabel: "Connect calendar",
    });
  }

  return recommendations.slice(0, 5);
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
