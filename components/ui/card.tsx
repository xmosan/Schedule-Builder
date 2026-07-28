import * as React from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "elevated" | "flat" | "tinted";

const cardVariantStyles: Record<CardVariant, string> = {
  default: "panel",
  elevated:
    "rounded-[var(--radius-panel)] border border-white/80 bg-white/92 shadow-panel backdrop-blur-sm",
  flat: "rounded-[var(--radius-card)] border border-brand-ink/6 bg-white/65",
  tinted:
    "rounded-[var(--radius-card)] border border-brand-teal/12 bg-brand-teal/[0.04]",
};

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

export function Card({ className, variant = "default", ...props }: CardProps) {
  return (
    <div className={cn(cardVariantStyles[variant], className)} {...props} />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-b border-brand-ink/6 px-5 py-4 sm:px-6 sm:py-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 sm:p-6", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-t border-brand-ink/6 px-5 py-4 sm:px-6 sm:py-5",
        className,
      )}
      {...props}
    />
  );
}
