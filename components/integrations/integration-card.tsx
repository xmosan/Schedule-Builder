import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { IntegrationCardData } from "@/lib/integrations";

type IntegrationCardProps = {
  integration: IntegrationCardData;
  isRecommended?: boolean;
  recommendationLabel?: string;
  recommendationReason?: string;
};

export function IntegrationCard({
  integration,
  isRecommended = false,
  recommendationLabel = "Recommended for you",
  recommendationReason,
}: IntegrationCardProps) {
  return (
    <Card
      className={`rounded-[28px] bg-white/86 sm:rounded-[32px] ${
        isRecommended
          ? "border-brand-teal/25 shadow-[0_22px_55px_rgba(15,118,110,0.12)]"
          : "border-white/70"
      }`}
    >
      <CardContent className="flex h-full flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div
            className={`inline-flex min-h-12 min-w-12 items-center justify-center rounded-[18px] px-3 text-sm font-semibold ${integration.accentClassName}`}
          >
            {integration.monogram}
          </div>
          <div className="flex flex-col items-end gap-2">
            {integration.priority === "planned_next" ? (
              <Badge className="border-brand-ink/10 bg-brand-ink text-white">
                Planned next
              </Badge>
            ) : isRecommended ? (
              <Badge className="border-brand-teal/20 bg-brand-teal/10 text-brand-teal">
                {recommendationLabel}
              </Badge>
            ) : null}
            <Badge variant={integration.status === "available" ? undefined : "subtle"}>
              {integration.status === "available" ? "Available now" : "Coming soon"}
            </Badge>
          </div>
        </div>

        <div className="mt-5">
          {integration.status !== "available" ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              {integration.category}
            </p>
          ) : null}
          <h2 className="mt-2 text-xl font-semibold text-brand-ink">
            {integration.name}
          </h2>
          <p className="mt-3 text-sm leading-6 text-brand-ink/65 sm:text-base">
            {integration.description}
          </p>
        </div>

        <div className="mt-5 flex-1">
          <div className="rounded-[18px] border border-brand-ink/8 bg-brand-ink/[0.02] p-4">
            <p className="text-sm leading-6 text-brand-ink/70">
              <span className="font-semibold text-brand-ink">Why it helps:</span> {integration.whyItHelps}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {integration.status === "available" ? (
            <>
              <Link
                href="/plan"
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-ink px-6 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-ink/90 sm:w-auto"
              >
                Export from Weekly Plan
              </Link>
              {integration.id === "ics-upload-import" ? (
                <Link
                  href="#import-ics"
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand-ink/10 bg-white/75 px-6 text-sm font-semibold text-brand-ink transition-all hover:-translate-y-0.5 hover:bg-white sm:w-auto"
                >
                  Import ICS File
                </Link>
              ) : null}
            </>
          ) : (
            <div className="inline-flex h-11 items-center justify-center px-1 text-sm font-medium text-brand-ink/40">
              Connection planned
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
