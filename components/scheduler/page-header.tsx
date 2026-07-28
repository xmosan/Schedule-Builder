import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SchedulerPageHeaderVariant = "default" | "compact" | "hero";

type SchedulerPageHeaderProps = {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: string;
  eyebrow?: string;
  icon?: ReactNode;
  title: string;
  trustNote?: string;
  variant?: SchedulerPageHeaderVariant;
};

export function SchedulerPageHeader({
  actions,
  children,
  className,
  description,
  eyebrow,
  icon,
  title,
  trustNote,
  variant = "default",
}: SchedulerPageHeaderProps) {
  if (variant === "compact") {
    return (
      <header
        className={cn(
          "page-header-compact",
          className,
        )}
      >
        {icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-brand-teal/10 text-brand-teal">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
          <h1 className="text-lg font-semibold tracking-[-0.03em] text-brand-ink leading-none sm:text-xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-sm text-brand-ink/55">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
    );
  }

  return (
    <header className={cn("page-header", className)}>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-center gap-3">
          {icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-brand-teal/10 text-brand-teal">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
            <h1 className="page-title">{title}</h1>
          </div>
        </div>
        {description ? (
          <p className={cn("page-contract", icon ? "ml-12" : "")}>{description}</p>
        ) : null}
        {trustNote ? (
          <p className={cn("page-trust-note", icon ? "ml-12" : "")}>{trustNote}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
