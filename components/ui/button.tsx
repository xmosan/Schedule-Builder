import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm";
};

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default:
    "bg-brand-ink text-white shadow-[0_16px_40px_rgba(18,32,47,0.18)] hover:-translate-y-0.5 hover:bg-brand-teal",
  outline:
    "border border-brand-ink/10 bg-white/75 text-brand-ink hover:-translate-y-0.5 hover:border-brand-ink/20 hover:bg-white",
  secondary:
    "bg-brand-ink/6 text-brand-ink hover:bg-brand-ink/10",
};

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  default: "h-12 px-4 text-sm sm:h-11",
  sm: "h-10 px-3 text-sm",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      type = "button",
      variant = "default",
      size = "default",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
