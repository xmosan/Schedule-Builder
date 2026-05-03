export type SocialLink = {
  label: string;
  href: string;
};

export type MosqueInfo = {
  mosqueName: string;
  address: string;
  cityState: string;
  phone: string;
  email: string;
  donationLink: string;
  socialLinks: SocialLink[];
  jummahTime: string;
  officeHours: string;
  mapLink: string;
  visitorNotes: string[];
  parkingInstructions: string;
};

export type NavItem = {
  label: string;
  href: string;
};

export type PrayerTime = {
  name: "Fajr" | "Sunrise" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";
  adhan: string;
  iqamah?: string;
};

export type MonthlyPrayerRow = {
  date: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

export type Announcement = {
  title: string;
  body: string;
  tag: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export type EventCategory =
  | "Lecture"
  | "Youth"
  | "Sisters"
  | "Community"
  | "Fundraiser";

export type Event = {
  title: string;
  date: string;
  time: string;
  location: string;
  category: EventCategory;
  summary: string;
  audience: string;
};

export type Resource = {
  title: string;
  category: string;
  description: string;
  href: string;
  format: string;
};

