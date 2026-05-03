import type { MosqueInfo, NavItem } from "@/types/site";

export const mosqueInfo: MosqueInfo = {
  mosqueName: "Wali Mahmoud Islamic Center",
  address: "235 Lahoma St, Lansing, MI 48915",
  cityState: "Lansing, MI",
  phone: "(517) 000-0000",
  email: "contact@example.com",
  donationLink: "https://example.com/donate",
  socialLinks: [
    { label: "Facebook", href: "https://facebook.com/placeholder-wmic" },
    { label: "Instagram", href: "https://instagram.com/placeholder-wmic" },
    { label: "YouTube", href: "https://youtube.com/@placeholder-wmic" },
  ],
  jummahTime: "1:30 PM",
  officeHours: "Monday to Friday, 11:00 AM to 5:00 PM",
  mapLink:
    "https://www.google.com/maps/search/?api=1&query=235+Lahoma+St+Lansing+MI+48915",
  visitorNotes: [
    "First-time visitors are welcome to stop by before or after prayer for a quick orientation.",
    "A family-friendly prayer environment and community support resources are available throughout the week.",
    "Programs and timings are updated regularly, so please check announcements before attending.",
  ],
  parkingInstructions:
    "Parking and main entrance details will be confirmed soon. For now, please use the posted visitor entrance signage when you arrive.",
};

export const siteNavigation: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Prayer Times", href: "/prayer-times" },
  { label: "Events", href: "/events" },
  { label: "Resources", href: "/resources" },
  { label: "About", href: "/about" },
  { label: "Donate", href: "/donate" },
  { label: "Contact", href: "/contact" },
];

