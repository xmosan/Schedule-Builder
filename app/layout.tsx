import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const description =
  "A clean personal project scheduling app for priorities, deadlines, weekly hours, and today's top three tasks.";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const siteName = "Project Schedule Dashboard";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "project scheduler",
    "personal dashboard",
    "task prioritization",
    "weekly planning",
    "next.js app router",
  ],
  openGraph: {
    title: siteName,
    description,
    siteName,
    url: siteUrl,
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-brand-mist text-brand-ink">
        <div className="relative min-h-screen">{children}</div>
      </body>
    </html>
  );
}
