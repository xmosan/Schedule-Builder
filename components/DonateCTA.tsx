import Link from "next/link";
import { mosqueInfo } from "@/data/mosqueInfo";

export function DonateCTA() {
  return (
    <section className="section-shell section-ornament p-8 sm:p-10">
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <span className="eyebrow">Support the center</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Help sustain prayer, learning, and community care in Lansing.
          </h2>
          <p className="mt-4 text-base sm:text-lg">
            Donations support daily masjid operations, programming for families
            and students, seasonal services, and assistance for neighbors in
            need.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/donate" className="btn-secondary">
            Explore giving options
          </Link>
          <Link href={mosqueInfo.donationLink} className="btn-primary">
            Donate now
          </Link>
        </div>
      </div>
    </section>
  );
}

