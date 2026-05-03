"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "@/types/site";

type MobileMenuProps = {
  items: NavItem[];
};

export function MobileMenu({ items }: MobileMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-brand-forest/15 bg-white/85 text-brand-forest shadow-sm"
        aria-expanded={open}
        aria-controls="mobile-site-menu"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sr-only">Menu</span>
        <div className="flex flex-col gap-1.5">
          <span
            className={`h-0.5 w-5 rounded-full bg-current ${open ? "translate-y-2 rotate-45" : ""}`}
          />
          <span className={`h-0.5 w-5 rounded-full bg-current ${open ? "opacity-0" : ""}`} />
          <span
            className={`h-0.5 w-5 rounded-full bg-current ${open ? "-translate-y-2 -rotate-45" : ""}`}
          />
        </div>
      </button>
      {open ? (
        <div
          id="mobile-site-menu"
          className="absolute inset-x-4 top-[5.5rem] rounded-[28px] border border-brand-forest/12 bg-[color:var(--surface-strong)] p-4 shadow-glow backdrop-blur-lg"
        >
          <nav aria-label="Mobile navigation" className="flex flex-col gap-2">
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === item.href
                  : pathname?.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                    active
                      ? "bg-brand-forest text-white"
                      : "bg-white/80 text-brand-forest hover:bg-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

