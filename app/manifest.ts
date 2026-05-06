import type { MetadataRoute } from "next";

const description =
  "Plan projects, weekly work blocks, priorities, deadlines, and today's Top 3 tasks.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Schedule Builder",
    short_name: "Scheduler",
    description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f2ea",
    theme_color: "#12202f",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/maskable-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
