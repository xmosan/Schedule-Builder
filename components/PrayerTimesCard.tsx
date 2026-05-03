import type { PrayerTime } from "@/types/site";

type PrayerTimesCardProps = {
  title: string;
  subtitle?: string;
  schedule: PrayerTime[];
};

export function PrayerTimesCard({
  title,
  subtitle,
  schedule,
}: PrayerTimesCardProps) {
  return (
    <section className="section-shell section-ornament p-6 sm:p-8" aria-labelledby="prayer-times-card-title">
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="pill">Daily schedule</p>
            <h3
              id="prayer-times-card-title"
              className="mt-4 text-2xl font-semibold"
            >
              {title}
            </h3>
            {subtitle ? <p className="mt-2 max-w-xl">{subtitle}</p> : null}
          </div>
          <div className="rounded-[28px] border border-brand-gold/20 bg-brand-gold/10 px-4 py-3 text-sm text-brand-forest">
            Prayer times can be updated later from one data source.
          </div>
        </div>
        <div className="mt-8 space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-3 text-xs font-semibold uppercase tracking-[0.22em] text-brand-ink/65">
            <span>Prayer</span>
            <span>Adhan</span>
            <span>Iqamah</span>
          </div>
          {schedule.map((item) => (
            <div
              key={item.name}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-3xl border border-brand-forest/10 bg-white/85 px-4 py-4 shadow-sm"
            >
              <span className="text-base font-semibold text-brand-forest">
                {item.name}
              </span>
              <span className="text-sm font-medium text-brand-charcoal">
                {item.adhan}
              </span>
              <span className="text-sm font-medium text-brand-charcoal">
                {item.iqamah ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

