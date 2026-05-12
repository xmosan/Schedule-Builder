import type { Metadata } from "next";
import { CalendarPage } from "@/components/calendar/calendar-page";

export const metadata: Metadata = {
  title: "Calendar",
  description:
    "See work shifts, planned blocks, and project deadlines in one weekly view.",
};

export default function CalendarRoutePage() {
  return <CalendarPage />;
}
