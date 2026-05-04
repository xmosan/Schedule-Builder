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
    href: "/integrations",
    label: "Integrations",
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
    <div className="panel flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
      <Link
        href="/"
        className="flex min-w-0 items-center gap-3 rounded-[22px] text-brand-ink"
      >
        <div className="rounded-2xl bg-brand-teal/10 p-2.5 text-brand-teal">
          <FolderStackIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
            Personal Scheduler
          </p>
          <p className="truncate text-sm font-semibold text-brand-ink sm:text-base">
            Projects, weekly plan, and upcoming integrations
          </p>
        </div>
      </Link>

      <nav
        aria-label="Scheduler navigation"
        className="grid grid-cols-2 gap-2 sm:flex sm:items-center"
      >
        {navItems.map((item) => {
          const isActive = isActiveRoute(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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
  );
}
