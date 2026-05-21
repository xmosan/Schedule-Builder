"use client";

import { useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
};

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel,
  description,
  destructive = false,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [loading, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-brand-ink/28 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md rounded-[2rem] border border-brand-ink/10 bg-white p-5 shadow-[0_30px_90px_rgba(18,32,47,0.24)] sm:p-6"
        role="dialog"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-1 h-3 w-3 shrink-0 rounded-full",
              destructive ? "bg-brand-coral" : "bg-brand-teal",
            )}
          />
          <div className="min-w-0">
            <h2
              className="text-xl font-semibold tracking-[-0.02em] text-brand-ink"
              id={titleId}
            >
              {title}
            </h2>
            <p
              className="mt-3 text-sm leading-6 text-brand-ink/62"
              id={descriptionId}
            >
              {description}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <Button
            className="h-12 rounded-2xl"
            disabled={loading}
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            className={cn(
              "h-12 rounded-2xl",
              destructive &&
                "bg-brand-coral text-white hover:bg-brand-coral/90",
            )}
            disabled={loading}
            type="button"
            onClick={onConfirm}
          >
            {loading ? "Working..." : confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
