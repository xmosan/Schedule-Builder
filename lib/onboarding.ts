import type { Project } from "@/lib/projects";

export type UserRole =
  | "Student"
  | "Professional"
  | "Organization leader"
  | "Creator / entrepreneur"
  | "General personal planning";

export const userRoles: UserRole[] = [
  "Student",
  "Professional",
  "Organization leader",
  "Creator / entrepreneur",
  "General personal planning",
];

export type PlanningInterest =
  | "Classes and assignments"
  | "Projects and deadlines"
  | "Meetings and events"
  | "Content or business work"
  | "Personal goals"
  | "Organization tasks";

export const planningInterests: PlanningInterest[] = [
  "Classes and assignments",
  "Projects and deadlines",
  "Meetings and events",
  "Content or business work",
  "Personal goals",
  "Organization tasks",
];

export type ScheduleIntensity = "Light" | "Moderate" | "Heavy";

export const scheduleIntensities: ScheduleIntensity[] = [
  "Light",
  "Moderate",
  "Heavy",
];

export type PlannerProfile = {
  role: UserRole;
  interests: PlanningInterest[];
  intensity: ScheduleIntensity;
  onboardingCompleted: boolean;
};

export function getStarterProjectsForRole(role: UserRole): Project[] {
  const now = Date.now();
  
  switch (role) {
    case "Student":
      return [
        {
          id: now + 1,
          name: "Courses / Classes",
          category: "Must-do",
          priority: "High",
          deadline: "Semester",
          nextAction: "Review syllabus for all courses",
          weeklyHours: 15,
          completed: false,
        },
        {
          id: now + 2,
          name: "Assignments",
          category: "Must-do",
          priority: "High",
          deadline: "Weekly",
          nextAction: "List all due dates for the month",
          weeklyHours: 10,
          completed: false,
        },
        {
          id: now + 3,
          name: "Exams / Study Blocks",
          category: "Must-do",
          priority: "High",
          deadline: "Varies",
          nextAction: "Schedule first study session",
          weeklyHours: 8,
          completed: false,
        },
        {
          id: now + 4,
          name: "Career / Internships",
          category: "Growth",
          priority: "Medium",
          deadline: "Ongoing",
          nextAction: "Update resume and LinkedIn",
          weeklyHours: 4,
          completed: false,
        },
      ];
    case "Professional":
      return [
        {
          id: now + 1,
          name: "Work Projects",
          category: "Must-do",
          priority: "High",
          deadline: "Quarterly",
          nextAction: "Define main project milestones",
          weeklyHours: 20,
          completed: false,
        },
        {
          id: now + 2,
          name: "Meetings / Follow-ups",
          category: "Maintenance",
          priority: "Medium",
          deadline: "Daily",
          nextAction: "Clear pending email follow-ups",
          weeklyHours: 5,
          completed: false,
        },
        {
          id: now + 3,
          name: "Deadlines",
          category: "Must-do",
          priority: "High",
          deadline: "Varies",
          nextAction: "Review upcoming critical dates",
          weeklyHours: 8,
          completed: false,
        },
        {
          id: now + 4,
          name: "Skill Development",
          category: "Growth",
          priority: "Medium",
          deadline: "Ongoing",
          nextAction: "Pick one course or book to start",
          weeklyHours: 3,
          completed: false,
        },
      ];
    case "Organization leader":
      return [
        {
          id: now + 1,
          name: "Events",
          category: "Must-do",
          priority: "High",
          deadline: "Varies",
          nextAction: "Finalize next event date",
          weeklyHours: 10,
          completed: false,
        },
        {
          id: now + 2,
          name: "Meetings",
          category: "Maintenance",
          priority: "Medium",
          deadline: "Weekly",
          nextAction: "Prepare agenda for board meeting",
          weeklyHours: 4,
          completed: false,
        },
        {
          id: now + 3,
          name: "Outreach",
          category: "Growth",
          priority: "Medium",
          deadline: "Ongoing",
          nextAction: "Contact three potential partners",
          weeklyHours: 6,
          completed: false,
        },
        {
          id: now + 4,
          name: "Admin / Funding",
          category: "Must-do",
          priority: "High",
          deadline: "Monthly",
          nextAction: "Review budget and grant status",
          weeklyHours: 5,
          completed: false,
        },
        {
          id: now + 5,
          name: "Member Tasks",
          category: "Maintenance",
          priority: "Low",
          deadline: "Daily",
          nextAction: "Check member requests and updates",
          weeklyHours: 3,
          completed: false,
        },
      ];
    case "Creator / entrepreneur":
      return [
        {
          id: now + 1,
          name: "Content Planning",
          category: "Must-do",
          priority: "High",
          deadline: "Weekly",
          nextAction: "Draft content calendar for next week",
          weeklyHours: 10,
          completed: false,
        },
        {
          id: now + 2,
          name: "Product Development",
          category: "Growth",
          priority: "High",
          deadline: "Launch date",
          nextAction: "Complete the primary feature MVP",
          weeklyHours: 15,
          completed: false,
        },
        {
          id: now + 3,
          name: "Marketing",
          category: "Growth",
          priority: "Medium",
          deadline: "Ongoing",
          nextAction: "Schedule three social media posts",
          weeklyHours: 8,
          completed: false,
        },
        {
          id: now + 4,
          name: "Client / Admin Work",
          category: "Maintenance",
          priority: "Medium",
          deadline: "Varies",
          nextAction: "Review current client project status",
          weeklyHours: 6,
          completed: false,
        },
      ];
    case "General personal planning":
    default:
      return [
        {
          id: now + 1,
          name: "Personal Goals",
          category: "Growth",
          priority: "High",
          deadline: "Yearly",
          nextAction: "Write down top three personal goals",
          weeklyHours: 5,
          completed: false,
        },
        {
          id: now + 2,
          name: "Weekly Priorities",
          category: "Must-do",
          priority: "High",
          deadline: "Sunday",
          nextAction: "Plan top priorities for the week",
          weeklyHours: 3,
          completed: false,
        },
        {
          id: now + 3,
          name: "Admin Tasks",
          category: "Maintenance",
          priority: "Medium",
          deadline: "Ongoing",
          nextAction: "Organize digital files or workspace",
          weeklyHours: 4,
          completed: false,
        },
        {
          id: now + 4,
          name: "Projects",
          category: "Growth",
          priority: "Medium",
          deadline: "Varies",
          nextAction: "Define next step for main project",
          weeklyHours: 8,
          completed: false,
        },
      ];
  }
}
