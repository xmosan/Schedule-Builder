import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-2xl border border-brand-ink/10 bg-white/82 px-4 text-sm text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-brand-ink/36 focus:border-brand-teal/35 focus:bg-white sm:h-11",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
