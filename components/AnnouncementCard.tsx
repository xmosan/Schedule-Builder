import Link from "next/link";
import type { Announcement } from "@/types/site";

type AnnouncementCardProps = {
  announcement: Announcement;
};

export function AnnouncementCard({ announcement }: AnnouncementCardProps) {
  return (
    <article className="section-shell p-6">
      <span className="pill">{announcement.tag}</span>
      <h3 className="mt-5 text-2xl font-semibold">{announcement.title}</h3>
      <p className="mt-3">{announcement.body}</p>
      {announcement.ctaHref && announcement.ctaLabel ? (
        <Link href={announcement.ctaHref} className="mt-6 inline-flex text-sm font-semibold text-brand-forest hover:text-brand-pine">
          {announcement.ctaLabel}
        </Link>
      ) : null}
    </article>
  );
}

