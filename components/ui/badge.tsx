import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "outline" | "subtle";
};

const variantStyles: Record<NonNullable<BadgeProps["variant"]>, string> = {
  outline: "border border-brand-ink/10 bg-white/70 text-brand-ink",
  subtle: "border border-transparent bg-brand-ink/5 text-brand-ink/75",
};

export function Badge({
  className,
  variant = "outline",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold leading-none sm:py-1",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
