"use client";

import type { ReactNode } from "react";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { cn } from "@/lib/utils";

type SchedulerAppShellProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  fullHeight?: boolean;
};

export function SchedulerAppShell({
  children,
  className,
  contentClassName,
  fullHeight = false,
}: SchedulerAppShellProps) {
  return (
    <div
      className={cn(
        "min-h-screen px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-5 lg:px-6 lg:pb-6",
        fullHeight && "h-[100dvh] min-h-0 overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto grid w-full max-w-[1540px] items-start gap-5 lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-6",
          fullHeight && "h-full min-h-0",
        )}
      >
        <SchedulerNav />
        <main
          className={cn(
            "route-content-enter min-w-0",
            fullHeight && "flex min-h-0 flex-col",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
