"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileMenu } from "@/components/MobileMenu";
import { mosqueInfo, siteNavigation } from "@/data/mosqueInfo";

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-brand-forest/10 bg-[#faf7f1]/85 backdrop-blur-lg">
      <div className="site-container relative flex h-20 items-center justify-between gap-6">
        <Link href="/" className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-gold/25 bg-brand-gold/10 text-brand-forest">
            <span className="font-display text-lg font-semibold">WM</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold uppercase tracking-[0.22em] text-brand-forest/70">
              {mosqueInfo.cityState}
            </p>
            <p className="truncate text-base font-semibold text-brand-forest sm:text-lg">
              {mosqueInfo.mosqueName}
            </p>
          </div>
        </Link>
        <nav aria-label="Primary navigation" className="hidden items-center gap-2 lg:flex">
          {siteNavigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === item.href
                : pathname?.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  active
                    ? "bg-brand-forest text-white"
                    : "text-brand-forest hover:bg-white/80"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <Link href="/prayer-times" className="btn-primary ml-2">
            Today's times
          </Link>
        </nav>
        <MobileMenu items={siteNavigation} />
      </div>
    </header>
  );
}

