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
  statusLabel?: string;
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
      "Use calendar files today; native Apple Calendar support is planned later.",
    whyItHelps:
      "ICS export keeps plans portable now while a deeper Apple Calendar connection stays on the roadmap.",
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
      "Import assignment due dates, quizzes, and course events by exporting or subscribing to your Brightspace calendar file.",
    whyItHelps:
      "Turns course calendar files into reviewable Schedule Builder events without asking for your school login.",
    accentClassName:
      "bg-[#fff2ea] text-[#a44824] ring-1 ring-inset ring-[#f3d4c4]",
    status: "available",
    statusLabel: "Guided setup",
  },
  {
    id: "canvas-calendar",
    name: "Canvas Calendar",
    onboardingName: "Canvas",
    monogram: "CAN",
    category: "Course calendar import",
    description:
      "Import assignments, quizzes, course events, and due dates by using your Canvas calendar export or calendar feed.",
    whyItHelps:
      "Turns Canvas calendar files into reviewable school events without asking for your Canvas login.",
    accentClassName:
      "bg-[#fff5f2] text-[#b33b24] ring-1 ring-inset ring-[#f5d3c9]",
    status: "available",
    statusLabel: "Guided setup",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    onboardingName: "Google Calendar",
    monogram: "G",
    category: "Read-only calendar connection",
    description:
      "Connect Google Calendar read-only so Schedule Builder can see upcoming commitments while planning.",
    whyItHelps:
      "Helps the Calendar and Assistant avoid suggesting project blocks over meetings, classes, and events.",
    accentClassName:
      "bg-[#eef9f4] text-[#1f6d52] ring-1 ring-inset ring-[#d2ebdf]",
    status: "available",
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
    name: "Calendar import/export",
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
