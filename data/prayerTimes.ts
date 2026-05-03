import type { MonthlyPrayerRow, PrayerTime } from "@/types/site";

export const prayerTimesUpdatedLabel = "Placeholder schedule for launch planning";

export const todayPrayerTimes: PrayerTime[] = [
  { name: "Fajr", adhan: "5:12 AM", iqamah: "5:40 AM" },
  { name: "Sunrise", adhan: "6:38 AM" },
  { name: "Dhuhr", adhan: "1:26 PM", iqamah: "1:40 PM" },
  { name: "Asr", adhan: "5:07 PM", iqamah: "5:25 PM" },
  { name: "Maghrib", adhan: "8:18 PM", iqamah: "8:23 PM" },
  { name: "Isha", adhan: "9:37 PM", iqamah: "9:55 PM" },
];

export const prayerTimesNotes = [
  "Prayer and iqamah times are currently placeholders and will be updated before launch.",
  "Future updates can be managed directly in this data file or connected to an admin dashboard or API later.",
];

export const monthlyPrayerCalendar: MonthlyPrayerRow[] = [
  {
    date: "May 1",
    fajr: "5:12 AM",
    sunrise: "6:38 AM",
    dhuhr: "1:26 PM",
    asr: "5:07 PM",
    maghrib: "8:18 PM",
    isha: "9:37 PM",
  },
  {
    date: "May 2",
    fajr: "5:10 AM",
    sunrise: "6:36 AM",
    dhuhr: "1:26 PM",
    asr: "5:08 PM",
    maghrib: "8:19 PM",
    isha: "9:38 PM",
  },
  {
    date: "May 3",
    fajr: "5:09 AM",
    sunrise: "6:35 AM",
    dhuhr: "1:26 PM",
    asr: "5:08 PM",
    maghrib: "8:20 PM",
    isha: "9:39 PM",
  },
  {
    date: "May 4",
    fajr: "5:07 AM",
    sunrise: "6:33 AM",
    dhuhr: "1:26 PM",
    asr: "5:09 PM",
    maghrib: "8:21 PM",
    isha: "9:41 PM",
  },
  {
    date: "May 5",
    fajr: "5:06 AM",
    sunrise: "6:32 AM",
    dhuhr: "1:26 PM",
    asr: "5:10 PM",
    maghrib: "8:22 PM",
    isha: "9:42 PM",
  },
  {
    date: "May 6",
    fajr: "5:04 AM",
    sunrise: "6:30 AM",
    dhuhr: "1:26 PM",
    asr: "5:11 PM",
    maghrib: "8:23 PM",
    isha: "9:43 PM",
  },
  {
    date: "May 7",
    fajr: "5:03 AM",
    sunrise: "6:29 AM",
    dhuhr: "1:26 PM",
    asr: "5:12 PM",
    maghrib: "8:24 PM",
    isha: "9:44 PM",
  },
];

