import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SchedulerPageHeaderProps = {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description: string;
  eyebrow?: string;
  title: string;
  trustNote?: string;
};

export function SchedulerPageHeader({
  actions,
  children,
  className,
  description,
  eyebrow,
  title,
  trustNote,
}: SchedulerPageHeaderProps) {
  return (
    <header className={cn("page-header", className)}>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        <p className="page-contract">{description}</p>
        {trustNote ? <p className="page-trust-note">{trustNote}</p> : null}
        {children}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
