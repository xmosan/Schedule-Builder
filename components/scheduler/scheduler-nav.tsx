"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderStackIcon } from "@/components/projects/icons";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
  },
  {
    href: "/projects",
    label: "Projects",
  },
  {
    href: "/plan",
    label: "Plan",
  },
  {
    href: "/integrations",
    label: "Integrations",
  },
  {
    href: "/settings",
    label: "Settings",
  },
] as const;

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SchedulerNav() {
  const pathname = usePathname();

  return (
    <>
      <div className="panel flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-[22px] text-brand-ink"
        >
          <div className="rounded-2xl bg-brand-teal/10 p-2.5 text-brand-teal">
            <FolderStackIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Schedule Builder
            </p>
            <p className="truncate text-sm font-semibold text-brand-ink sm:text-base">
              Projects, weekly planning, and integrations
            </p>
          </div>
        </Link>

        <nav
          aria-label="Scheduler navigation"
          className="hidden items-center gap-2 md:flex"
        >
          {navItems.map((item) => {
            const isActive = isActiveRoute(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold",
                  isActive
                    ? "bg-brand-ink text-white shadow-[0_14px_36px_rgba(18,32,47,0.16)]"
                    : "border border-brand-ink/10 bg-white/70 text-brand-ink/70 hover:border-brand-ink/20 hover:bg-white hover:text-brand-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <nav
        aria-label="Mobile scheduler navigation"
        className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-5 gap-1 rounded-[26px] border border-white/70 bg-white/92 p-2 shadow-[0_18px_44px_rgba(18,32,47,0.18)] backdrop-blur md:hidden"
      >
        {navItems.map((item) => {
          const isActive = isActiveRoute(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex min-h-12 items-center justify-center rounded-[20px] px-1 text-center text-[11px] font-semibold leading-tight",
                isActive
                  ? "bg-brand-ink text-white"
                  : "text-brand-ink/62 hover:bg-brand-ink/5 hover:text-brand-ink",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
