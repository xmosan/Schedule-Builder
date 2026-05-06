import type { DesiredIntegration } from "@/lib/onboarding";

export type IntegrationCardData = {
  accentClassName: string;
  category: string;
  description: string;
  id: string;
  monogram: string;
  name: string;
  onboardingName: DesiredIntegration;
  plannedBehavior: string;
  value: string;
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
    plannedBehavior:
      "This integration will create and update scheduler events from your weekly plan so your time blocks appear alongside the rest of your Apple calendar.",
    value:
      "It will make planned work easier to see beside classes, meetings, events, and outside commitments.",
    accentClassName:
      "bg-[#f7f3ec] text-[#7a5a36] ring-1 ring-inset ring-[#e7dcc9]",
  },
  {
    id: "outlook-calendar",
    name: "Outlook Calendar",
    onboardingName: "Outlook Calendar",
    monogram: "O",
    category: "Work and organization planning",
    description:
      "Mirror focus sessions and project deadlines into Outlook when your day already lives inside Microsoft tools.",
    plannedBehavior:
      "This integration will eventually push planned work blocks into Outlook Calendar and keep projects visible next to meetings, classes, and commitments.",
    value:
      "It will help coordinate professional, academic, client, and organization work without splitting plans across separate schedules.",
    accentClassName:
      "bg-[#eef6ff] text-[#1d5fa7] ring-1 ring-inset ring-[#d1e3fb]",
  },
  {
    id: "d2l-brightspace-calendar",
    name: "D2L / Brightspace Calendar",
    onboardingName: "D2L / Brightspace",
    monogram: "D2L",
    category: "Course deadline import",
    description:
      "Bring assignment due dates, quizzes, and course events into the scheduler from Brightspace.",
    plannedBehavior:
      "This connection will pull course deadlines into your planning workflow so the planner can reflect academic commitments without manual copying.",
    value:
      "It will reduce deadline drift and make busy academic weeks easier to schedule around other active projects.",
    accentClassName:
      "bg-[#fff2ea] text-[#a44824] ring-1 ring-inset ring-[#f3d4c4]",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    onboardingName: "Google Calendar",
    monogram: "G",
    category: "Cross-device calendar sync",
    description:
      "Send weekly plan blocks and important due dates into Google Calendar for a single shared view of your time.",
    plannedBehavior:
      "This integration will eventually create calendar events from your planned work blocks and keep your project schedule close to the calendar you already use.",
    value:
      "It will make it easier to coordinate project work across laptops, phones, teams, and shared calendars.",
    accentClassName:
      "bg-[#eef9f4] text-[#1f6d52] ring-1 ring-inset ring-[#d2ebdf]",
  },
  {
    id: "ics-upload-import",
    name: "ICS Upload / Import",
    onboardingName: "ICS import/export",
    monogram: "ICS",
    category: "File-based import",
    description:
      "Import calendar data from exported `.ics` files when a direct integration is not available yet.",
    plannedBehavior:
      "This import flow will let you upload calendar feeds or exported files so deadlines and recurring commitments can seed your plan without OAuth.",
    value:
      "It will provide a flexible bridge for tools that can export calendar data even if they do not offer a native connection.",
    accentClassName:
      "bg-[#edf6fb] text-[#155e75] ring-1 ring-inset ring-[#d3e9f1]",
  },
];
