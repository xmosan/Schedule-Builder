import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "success";

type ButtonSize = "default" | "sm" | "lg" | "icon";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantStyles: Record<ButtonVariant, string> = {
  default:
    "bg-brand-ink text-white shadow-[0_12px_32px_rgba(18,32,47,0.16)] hover:-translate-y-0.5 hover:bg-brand-ink/90 active:translate-y-0 active:shadow-[0_6px_18px_rgba(18,32,47,0.12)]",
  outline:
    "border border-brand-ink/12 bg-white/80 text-brand-ink hover:-translate-y-0.5 hover:border-brand-ink/20 hover:bg-white active:translate-y-0",
  secondary:
    "bg-brand-ink/6 text-brand-ink hover:bg-brand-ink/10 active:bg-brand-ink/14",
  ghost:
    "bg-transparent text-brand-ink/65 hover:bg-brand-ink/6 hover:text-brand-ink active:bg-brand-ink/10",
  destructive:
    "bg-brand-coral text-white shadow-[0_12px_28px_rgba(199,91,57,0.20)] hover:-translate-y-0.5 hover:bg-brand-coral/90 active:translate-y-0",
  success:
    "bg-brand-teal text-white shadow-[0_12px_28px_rgba(15,118,110,0.20)] hover:-translate-y-0.5 hover:bg-brand-teal/90 active:translate-y-0",
};

const sizeStyles: Record<ButtonSize, string> = {
  default: "h-12 px-4 text-sm sm:h-11",
  sm: "h-10 px-3 text-sm",
  lg: "h-13 px-6 text-base sm:h-12",
  icon: "h-10 w-10 p-0",
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
          "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold whitespace-nowrap",
          "transition-all duration-150",
          "disabled:cursor-not-allowed disabled:opacity-45",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal/40",
          "active:scale-[0.98]",
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
