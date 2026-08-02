"use client";

import React from "react";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AssistantIcon,
  CalendarIcon,
  FolderStackIcon,
  IntegrationsIcon,
  SettingsIcon,
  WeeklyPlanIcon,
  WorkScheduleIcon,
} from "@/components/projects/icons";
import { cn } from "@/lib/utils";

type SchedulerNavItem = {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  shortLabel?: string;
};

const navItems: SchedulerNavItem[] = [
  { href: "/assistant", icon: AssistantIcon, label: "Assistant" },
  { href: "/projects", icon: FolderStackIcon, label: "Projects" },
  { href: "/plan", icon: WeeklyPlanIcon, label: "Weekly Plan", shortLabel: "Plan" },
  { href: "/calendar", icon: CalendarIcon, label: "Calendar" },
  { href: "/work", icon: WorkScheduleIcon, label: "Work Schedule", shortLabel: "Work" },
  { href: "/integrations", icon: IntegrationsIcon, label: "Integrations", shortLabel: "Connect" },
  { href: "/settings", icon: SettingsIcon, label: "Settings" },
];

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SchedulerNav({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "top";
}) {
  const pathname = usePathname();

  const mobileNavigation = (
    <nav
      aria-label="Mobile scheduler navigation"
      className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-50 grid grid-cols-7 rounded-[22px] border border-white/82 bg-white/95 p-1.5 shadow-nav backdrop-blur-xl lg:hidden"
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
            title={item.label}
            className={cn(
              "flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] px-0.5 text-center transition-all duration-150",
              active
                ? "bg-brand-ink text-white shadow-sm"
                : "text-brand-ink/52 hover:bg-brand-ink/5 hover:text-brand-ink",
            )}
          >
            <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            <span className="max-w-full text-[7.5px] font-bold leading-tight whitespace-normal break-words sm:text-[9px]">
              {item.shortLabel ?? item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );

  if (variant === "top") {
    return (
      <header className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-50 flex shrink-0 items-center rounded-[22px] border border-white/82 bg-white/95 p-1.5 shadow-nav backdrop-blur-xl lg:static lg:min-h-[58px] lg:gap-4 lg:rounded-[20px] lg:bg-white/80 lg:px-3 lg:py-2 lg:shadow-card">
        <Link
          href="/assistant"
          aria-label="Schedule Builder"
          className="hidden shrink-0 items-center gap-2.5 rounded-[14px] px-2 py-1.5 text-brand-ink transition hover:bg-brand-ink/5 lg:flex"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-brand-teal text-white shadow-[0_4px_12px_rgba(15,118,110,0.25)]">
            <AssistantIcon aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-[-0.02em]">
            Schedule Builder
          </span>
        </Link>

        <div className="mx-3 hidden h-5 w-px bg-brand-ink/10 lg:block" />

        <nav
          aria-label="Scheduler navigation"
          className="grid min-w-0 flex-1 grid-cols-7 lg:flex lg:items-center lg:justify-end lg:gap-0.5"
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
                title={item.label}
                className={cn(
                  "flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] px-0.5 text-center text-[7.5px] font-bold leading-tight transition-all duration-150 sm:text-[9px] lg:inline-flex lg:min-h-9 lg:flex-row lg:rounded-[12px] lg:px-2.5 lg:text-[12px] lg:font-semibold lg:leading-normal lg:whitespace-nowrap xl:px-3 xl:text-[13px]",
                  active
                    ? "bg-brand-ink text-white shadow-sm lg:bg-transparent lg:text-brand-teal lg:shadow-none"
                    : "text-brand-ink/55 hover:bg-brand-ink/5 hover:text-brand-ink",
                )}
              >
                <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 lg:hidden" />
                <span className="max-w-full whitespace-normal break-words leading-tight lg:whitespace-nowrap lg:leading-normal">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </header>
    );
  }

  // ── Sidebar variant (default) ──────────────────────────────────────────

  return (
    <>
      <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[26px] border border-white/78 bg-white/80 p-2.5 shadow-panel backdrop-blur-xl lg:flex">
        {/* Logo */}
        <Link
          href="/assistant"
          className="flex items-center gap-3 rounded-[20px] px-3 py-3.5 transition-all hover:bg-brand-ink/4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-brand-teal text-white shadow-[0_6px_18px_rgba(15,118,110,0.22)]">
            <AssistantIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[9.5px] font-bold uppercase tracking-[0.20em] text-brand-ink/38">
              Schedule Builder
            </span>
            <span className="mt-0.5 block text-[13px] font-semibold tracking-[-0.02em] text-brand-ink">
              Your planning space
            </span>
          </span>
        </Link>

        {/* Divider after logo */}
        <div className="mx-2 my-2 h-px bg-brand-ink/6" />

        <nav aria-label="Scheduler navigation" className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {navItems.map((item, index) => {
            const active = isActiveRoute(pathname, item.href);
            const Icon = item.icon;
            // Subtle separator before Settings (last item)
            const isLast = index === navItems.length - 1;

            return (
              <React.Fragment key={item.href}>
                {isLast && (
                  <div className="mx-2 mb-1 mt-auto pt-2">
                    <div className="h-px bg-brand-ink/6" />
                  </div>
                )}
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  className={cn(
                    "group relative flex min-h-11 items-center gap-3 rounded-[18px] px-3 text-[13.5px] font-semibold transition-all duration-150",
                    active
                      ? "bg-brand-ink text-white shadow-[0_6px_20px_rgba(18,32,47,0.18),0_2px_6px_rgba(18,32,47,0.08)]"
                      : "text-brand-ink/58 hover:bg-white/70 hover:text-brand-ink",
                  )}
                >
                  {/* Left accent bar for active */}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-teal/60"
                    />
                  )}
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 transition-colors",
                      active ? "text-white" : "text-brand-teal/65 group-hover:text-brand-teal",
                    )}
                  />
                  {item.label}
                </Link>
              </React.Fragment>
            );
          })}
        </nav>
      </aside>

      {mobileNavigation}
    </>
  );
}


