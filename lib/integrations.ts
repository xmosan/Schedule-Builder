import type { DesiredIntegration } from "@/lib/onboarding";

export type IntegrationCardData = {
  id: string;
  name: string;
  onboardingName: DesiredIntegration;
  monogram: string;
  category: string;
  description: string;
  whyItHelps: string;
  accentClassName: string;
  status: "available" | "coming_soon";
  priority?: "planned_next";
};

export const integrations: IntegrationCardData[] = [
  {
    id: "apple-calendar",
    name: "Apple Calendar",
    onboardingName: "Apple Calendar",
    monogram: "A",
    category: "Native calendar sync",
    description:
      "Keep project blocks and deadlines aligned with Calendar across Apple devices.",
    whyItHelps:
      "Makes planned work easier to see beside classes, meetings, and outside commitments.",
    accentClassName:
      "bg-[#f7f3ec] text-[#7a5a36] ring-1 ring-inset ring-[#e7dcc9]",
    status: "coming_soon",
  },
  {
    id: "outlook-calendar",
    name: "Outlook Calendar",
    onboardingName: "Outlook Calendar",
    monogram: "O",
    category: "Work and organization planning",
    description:
      "Mirror focus sessions and project deadlines into Outlook when your day already lives inside Microsoft tools.",
    whyItHelps:
      "Helps coordinate professional, academic, and organization work without splitting plans.",
    accentClassName:
      "bg-[#eef6ff] text-[#1d5fa7] ring-1 ring-inset ring-[#d1e3fb]",
    status: "coming_soon",
  },
  {
    id: "d2l-brightspace-calendar",
    name: "D2L / Brightspace Calendar",
    onboardingName: "D2L / Brightspace",
    monogram: "D2L",
    category: "Course deadline import",
    description:
      "Bring assignment due dates, quizzes, and course events into the scheduler from Brightspace.",
    whyItHelps:
      "Reduces deadline drift and makes busy academic weeks easier to schedule around.",
    accentClassName:
      "bg-[#fff2ea] text-[#a44824] ring-1 ring-inset ring-[#f3d4c4]",
    status: "coming_soon",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    onboardingName: "Google Calendar",
    monogram: "G",
    category: "Cross-device calendar sync",
    description:
      "Send weekly plan blocks and important due dates into Google Calendar for a single shared view of your time.",
    whyItHelps:
      "Makes it easier to coordinate project work across laptops, phones, and shared calendars.",
    accentClassName:
      "bg-[#eef9f4] text-[#1f6d52] ring-1 ring-inset ring-[#d2ebdf]",
    status: "coming_soon",
    priority: "planned_next",
  },
  {
    id: "work-schedule-imports",
    name: "Work Schedule Imports",
    onboardingName: "Work schedule imports",
    monogram: "W",
    category: "Shift scheduling",
    description:
      "Import your shift schedule or part-time work hours so they automatically block out time in your week.",
    whyItHelps:
      "Helps you confidently plan project blocks without accidentally overlapping with paid shifts.",
    accentClassName:
      "bg-[#f0edfd] text-[#553c9a] ring-1 ring-inset ring-[#d8cbf9]",
    status: "coming_soon",
    priority: "planned_next",
  },
  {
    id: "ics-upload-import",
    name: "Calendar Import / Export",
    onboardingName: "ICS import/export",
    monogram: "ICS",
    category: "Import and export available",
    description:
      "Export your weekly plan or import calendar files from school, work, or calendar apps.",
    whyItHelps:
      "Provides a flexible bridge for moving schedule data in or out before native connections launch.",
    accentClassName:
      "bg-[#edf6fb] text-[#155e75] ring-1 ring-inset ring-[#d3e9f1]",
    status: "available",
  },
];
