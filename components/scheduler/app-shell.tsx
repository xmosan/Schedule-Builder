"use client";

import type { ReactNode } from "react";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { cn } from "@/lib/utils";

type SchedulerAppShellProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  fullHeight?: boolean;
  navigationVariant?: "sidebar" | "top";
};

export function SchedulerAppShell({
  children,
  className,
  contentClassName,
  fullHeight = false,
  navigationVariant = "sidebar",
}: SchedulerAppShellProps) {
  const usesTopNavigation = navigationVariant === "top";

  return (
    <div
      className={cn(
        "min-h-screen px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-5 lg:px-5 lg:pb-6",
        usesTopNavigation && "lg:px-3 lg:pb-3 lg:pt-3",
        fullHeight && "h-[100dvh] min-h-0 overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto grid w-full max-w-[1540px] items-start gap-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-5",
          usesTopNavigation && "lg:flex lg:flex-col lg:items-stretch lg:gap-2",
          fullHeight && "h-full min-h-0",
        )}
      >
        <SchedulerNav variant={navigationVariant} />
        <main
          className={cn(
            "route-content-enter min-w-0",
            usesTopNavigation && "w-full",
            fullHeight && "flex min-h-0 flex-1 flex-col",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
