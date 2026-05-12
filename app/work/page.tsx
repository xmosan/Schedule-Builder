import type { Metadata } from "next";
import { WorkSchedulePage } from "@/components/work/work-schedule-page";

export const metadata: Metadata = {
  title: "Work Schedule",
  description:
    "Add weekly work shifts so Schedule Builder can plan around unavailable hours.",
};

export default function WorkScheduleRoutePage() {
  return <WorkSchedulePage />;
}
