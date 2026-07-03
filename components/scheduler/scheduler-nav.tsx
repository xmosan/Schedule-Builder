"use client";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarIcon,
  ClockIcon,
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { cn } from "@/lib/utils";

type SchedulerNavItem = {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
};

const navItems: SchedulerNavItem[] = [
  { href: "/assistant", icon: TargetIcon, label: "Assistant" },
  { href: "/projects", icon: FolderStackIcon, label: "Projects" },
  { href: "/plan", icon: ClockIcon, label: "Weekly Plan" },
  { href: "/calendar", icon: CalendarIcon, label: "Calendar" },
  { href: "/work", icon: ClockIcon, label: "Work Schedule" },
  { href: "/integrations", icon: CalendarIcon, label: "Integrations" },
  { href: "/settings", icon: TargetIcon, label: "Settings" },
];

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SchedulerNav() {
  const pathname = usePathname();

  return (
    <>
      <aside className="sticky top-5 hidden h-[calc(100dvh-2.5rem)] flex-col overflow-hidden rounded-[28px] border border-white/75 bg-white/76 p-3 shadow-[0_22px_58px_rgba(18,32,47,0.1)] backdrop-blur-xl lg:flex">
        <Link
          href="/assistant"
          className="flex items-center gap-3 rounded-[22px] px-3 py-4 text-brand-ink"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-teal text-white shadow-[0_12px_28px_rgba(15,118,110,0.2)]">
            <TargetIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-brand-ink/42">
              Schedule Builder
            </span>
            <span className="mt-0.5 block text-sm font-semibold tracking-[-0.01em]">
              Planning workspace
            </span>
          </span>
        </Link>

        <nav aria-label="Scheduler navigation" className="mt-4 grid gap-1.5">
          {navItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex min-h-12 items-center gap-3 rounded-[18px] px-3.5 text-sm font-semibold",
                  active
                    ? "bg-brand-ink text-white shadow-[0_14px_32px_rgba(18,32,47,0.16)]"
                    : "text-brand-ink/62 hover:bg-white hover:text-brand-ink",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "h-4.5 w-4.5 shrink-0",
                    active ? "text-white" : "text-brand-teal/72",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-[0.13em] text-brand-ink/32">
          Supporting views stay editable
        </div>
      </aside>

      <nav
        aria-label="Mobile scheduler navigation"
        className="fixed inset-x-2 bottom-[calc(0.4rem+env(safe-area-inset-bottom))] z-50 grid grid-cols-7 gap-0.5 rounded-[24px] border border-white/80 bg-white/94 p-1.5 shadow-[0_18px_48px_rgba(18,32,47,0.2)] backdrop-blur-xl lg:hidden"
      >
        {navItems.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-[17px] px-0.5 text-center text-[8px] font-bold leading-none sm:text-[10px]",
                active
                  ? "bg-brand-ink text-white"
                  : "text-brand-ink/58 hover:bg-brand-ink/5 hover:text-brand-ink",
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="max-w-full whitespace-normal break-words leading-[1.05]">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
