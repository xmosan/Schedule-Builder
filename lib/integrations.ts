export type IntegrationCardData = {
  accentClassName: string;
  category: string;
  description: string;
  id: string;
  monogram: string;
  name: string;
  plannedBehavior: string;
  value: string;
};

export const integrations: IntegrationCardData[] = [
  {
    id: "apple-calendar",
    name: "Apple Calendar",
    monogram: "A",
    category: "Native calendar sync",
    description:
      "Keep project blocks and deadlines aligned with Calendar across iPhone, iPad, and Mac.",
    plannedBehavior:
      "This integration will create and update scheduler events from your weekly plan so your time blocks appear alongside the rest of your Apple calendar.",
    value:
      "It will make your study, work, and personal project schedule visible on the devices you already check all day.",
    accentClassName:
      "bg-[#f7f3ec] text-[#7a5a36] ring-1 ring-inset ring-[#e7dcc9]",
  },
  {
    id: "outlook-calendar",
    name: "Outlook Calendar",
    monogram: "O",
    category: "School and work planning",
    description:
      "Mirror focus sessions and project deadlines into Outlook when your day already lives inside Microsoft tools.",
    plannedBehavior:
      "This integration will eventually push planned work blocks into Outlook Calendar and let you keep projects visible next to meetings, classes, and commitments.",
    value:
      "It will help you coordinate internship, school, and personal work without splitting your attention across separate schedules.",
    accentClassName:
      "bg-[#eef6ff] text-[#1d5fa7] ring-1 ring-inset ring-[#d1e3fb]",
  },
  {
    id: "d2l-brightspace-calendar",
    name: "D2L / Brightspace Calendar",
    monogram: "D2L",
    category: "Course deadline import",
    description:
      "Bring assignment due dates, quizzes, and course events into the scheduler from Brightspace.",
    plannedBehavior:
      "This connection will pull school deadlines into your planning workflow so the dashboard can reflect academic commitments without manual copying.",
    value:
      "It will reduce deadline drift and make exam weeks easier to schedule around your other active projects.",
    accentClassName:
      "bg-[#fff2ea] text-[#a44824] ring-1 ring-inset ring-[#f3d4c4]",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    monogram: "G",
    category: "Cross-device calendar sync",
    description:
      "Send weekly plan blocks and important due dates into Google Calendar for a single shared view of your time.",
    plannedBehavior:
      "This integration will eventually create calendar events from your planned work blocks and keep your project schedule close to the calendar you already use.",
    value:
      "It will make it easier to coordinate your scheduler across laptops, phones, and shared Google accounts.",
    accentClassName:
      "bg-[#eef9f4] text-[#1f6d52] ring-1 ring-inset ring-[#d2ebdf]",
  },
  {
    id: "ics-upload-import",
    name: "ICS Upload / Import",
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
