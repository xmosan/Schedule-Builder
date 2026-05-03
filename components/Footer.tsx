import Link from "next/link";
import { mosqueInfo, siteNavigation } from "@/data/mosqueInfo";

export function Footer() {
  return (
    <footer className="border-t border-brand-forest/10 bg-brand-forest text-white">
      <div className="site-container py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_0.9fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-brand-gold">
              Serving the Lansing Muslim community
            </p>
            <h2 className="mt-4 font-display text-3xl text-white">
              {mosqueInfo.mosqueName}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-white/80">
              A welcoming space for prayer, learning, service, and connection.
              This first version of the site is designed to make prayer times,
              Jummah, events, and community information easy to find.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-brand-gold">
              Quick links
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-white/85">
              {siteNavigation.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-brand-gold">
              Visit and support
            </h3>
            <div className="mt-4 space-y-3 text-sm text-white/85">
              <p>{mosqueInfo.address}</p>
              <p>{mosqueInfo.phone}</p>
              <p>{mosqueInfo.email}</p>
              <Link
                href={mosqueInfo.donationLink}
                className="inline-flex rounded-full border border-white/20 px-4 py-2 font-semibold text-white hover:bg-white/10"
              >
                Donation link
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-10 h-px bg-white/10" />
        <div className="mt-6 flex flex-col gap-3 text-sm text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {mosqueInfo.mosqueName}. All rights
            reserved.
          </p>
          <p>Built to be clear, calm, and useful for the local community.</p>
        </div>
      </div>
    </footer>
  );
}
