import type { Event } from "@/types/site";

type EventCardProps = {
  event: Event;
};

export function EventCard({ event }: EventCardProps) {
  return (
    <article className="section-shell section-ornament flex h-full flex-col p-6">
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <span className="pill">{event.category}</span>
          <span className="text-sm font-medium text-brand-ink/70">
            {event.date}
          </span>
        </div>
        <h3 className="mt-5 text-2xl font-semibold">{event.title}</h3>
        <p className="mt-3">{event.summary}</p>
        <dl className="mt-6 space-y-3 text-sm text-brand-charcoal">
          <div className="flex items-start justify-between gap-4">
            <dt className="font-semibold text-brand-forest">Time</dt>
            <dd className="text-right">{event.time}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="font-semibold text-brand-forest">Location</dt>
            <dd className="text-right">{event.location}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="font-semibold text-brand-forest">Audience</dt>
            <dd className="text-right">{event.audience}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

