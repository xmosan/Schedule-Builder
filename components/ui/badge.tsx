import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "outline"
  | "subtle"
  | "success"
  | "warning"
  | "error"
  | "source"
  | "applied"
  | "undone"
  | "info";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const variantStyles: Record<BadgeVariant, string> = {
  outline: "border border-brand-ink/10 bg-white/70 text-brand-ink",
  subtle: "border border-transparent bg-brand-ink/5 text-brand-ink/72",
  success: "border border-brand-teal/20 bg-brand-teal/10 text-brand-teal",
  warning: "border border-brand-amber/22 bg-brand-amber/10 text-brand-amber",
  error: "border border-brand-coral/22 bg-brand-coral/10 text-brand-coral",
  source: "border border-brand-ocean/18 bg-brand-ocean/10 text-brand-ocean",
  applied: "border border-brand-teal/25 bg-brand-teal/12 text-brand-teal",
  undone:
    "border border-brand-ink/10 bg-brand-ink/[0.04] text-brand-ink/50 line-through decoration-brand-ink/25",
  info: "border border-brand-ocean/20 bg-brand-ocean/10 text-brand-ocean",
};

export function Badge({
  className,
  variant = "outline",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[0.01em]",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
