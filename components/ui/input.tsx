import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-2xl border border-brand-ink/10 bg-white/90 px-4 text-brand-ink placeholder:text-brand-ink/40 focus:border-brand-teal/40 focus:bg-white sm:h-11",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
