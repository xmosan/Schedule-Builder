import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { IntegrationCardData } from "@/lib/integrations";

type IntegrationCardProps = {
  integration: IntegrationCardData;
  isRecommended?: boolean;
  recommendationReason?: string;
};

export function IntegrationCard({
  integration,
  isRecommended = false,
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
            {isRecommended ? (
              <Badge className="border-brand-teal/20 bg-brand-teal/10 text-brand-teal">
                Recommended for you
              </Badge>
            ) : null}
            <Badge variant="subtle">Placeholder</Badge>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
            {integration.category}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-brand-ink">
            {integration.name}
          </h2>
          <p className="mt-3 text-sm leading-6 text-brand-ink/65 sm:text-base">
            {integration.description}
          </p>
        </div>

        <div className="mt-5 space-y-3">
          {isRecommended && recommendationReason ? (
            <div className="rounded-[22px] border border-brand-teal/15 bg-brand-teal/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">
                Why this fits
              </p>
              <p className="mt-2 text-sm leading-6 text-brand-ink/70">
                {recommendationReason}
              </p>
            </div>
          ) : null}

          <div className="rounded-[22px] border border-brand-ink/8 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              What it will do
            </p>
            <p className="mt-2 text-sm leading-6 text-brand-ink/70">
              {integration.plannedBehavior}
            </p>
          </div>

          <div className="rounded-[22px] border border-brand-ink/8 bg-brand-ink/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Why it helps
            </p>
            <p className="mt-2 text-sm leading-6 text-brand-ink/70">
              {integration.value}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Badge variant="outline">OAuth later</Badge>
          <Badge variant="outline">No sync yet</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
