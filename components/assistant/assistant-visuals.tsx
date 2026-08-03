import { AssistantIcon } from "@/components/projects/icons";
import { cn } from "@/lib/utils";

export function AssistantBrandMark({
  className,
  size = "hero",
}: {
  className?: string;
  size?: "hero" | "message" | "small";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "assistant-brand-mark",
        size === "hero" && "assistant-brand-mark-hero",
        size === "message" && "assistant-brand-mark-message",
        size === "small" && "assistant-brand-mark-small",
        className,
      )}
    >
      <AssistantIcon />
    </span>
  );
}

export function AssistantStatusPill({
  busy = false,
  label,
  warning = false,
}: {
  busy?: boolean;
  label: string;
  warning?: boolean;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="assistant-status-pill"
      role="status"
    >
      <span
        aria-hidden="true"
        className={cn(
          "assistant-status-dot",
          warning ? "assistant-status-dot-warning" : "assistant-status-dot-ready",
          busy && "animate-pulse",
        )}
      />
      <span key={label} className="animate-assistant-message">
        {label}
      </span>
    </div>
  );
}
