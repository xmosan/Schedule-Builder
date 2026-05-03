import type { Announcement } from "@/types/site";

export const announcements: Announcement[] = [
  {
    title: "Prayer Times Will Be Finalized Before Launch",
    body:
      "The current schedule is a clean placeholder so the website can be reviewed early. Final prayer and iqamah times will be updated in one place before the site goes live.",
    tag: "Prayer Times",
    ctaLabel: "View the schedule",
    ctaHref: "/prayer-times",
  },
  {
    title: "Weekend Programs Are Expanding",
    body:
      "We are preparing space for family classes, youth gatherings, and Quran learning. Check back often as the public calendar fills out.",
    tag: "Programs",
    ctaLabel: "See events",
    ctaHref: "/events",
  },
  {
    title: "Visitor Guidance and Contact Details Coming Soon",
    body:
      "Parking notes, office hours, and community contact channels are already structured into the site and can be refined easily as information is confirmed.",
    tag: "Visitors",
    ctaLabel: "Contact the center",
    ctaHref: "/contact",
  },
];

