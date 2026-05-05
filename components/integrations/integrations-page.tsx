import Link from "next/link";
import { CalendarIcon } from "@/components/projects/icons";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { integrations } from "@/lib/integrations";

export function IntegrationsPage() {
  return (
    <div className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_320px] lg:items-end lg:gap-6">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <CalendarIcon className="h-4 w-4" />
                Settings / Integrations
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                Prepare Schedule Builder for calendar connections.
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                These placeholders show where calendar and import workflows can
                connect later. OAuth, imports, and email-based automation are
                intentionally not enabled yet.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>5 planned integrations</Badge>
                <Badge variant="subtle">UI placeholders only</Badge>
                <Badge variant="subtle">Planner stays focused</Badge>
              </div>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
              <CardContent className="p-4 sm:p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                  Current scope
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-[22px] border border-brand-ink/8 bg-white/75 p-4">
                    <p className="text-sm font-semibold text-brand-ink">
                      No accounts are connected yet
                    </p>
                    <p className="mt-2 text-sm leading-6 text-brand-ink/65">
                      This page keeps integration settings separate so the main
                      planning workspace stays simple.
                    </p>
                  </div>

                  <Link
                    href="/"
                    className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-brand-ink/10 bg-white/75 px-4 text-sm font-semibold text-brand-ink hover:-translate-y-0.5 hover:border-brand-ink/20 hover:bg-white"
                  >
                    Back to planner
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </section>

        <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Roadmap note</Badge>
              <Badge variant="subtle">No OAuth yet</Badge>
              <Badge variant="subtle">No email scanning yet</Badge>
            </div>

            <p className="mt-4 text-sm leading-6 text-brand-ink/70 sm:text-base">
              The next implementation phase can focus on real connection flows
              without changing the planning layout. Until then, this page keeps
              the integration surface visible and easy to extend.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
