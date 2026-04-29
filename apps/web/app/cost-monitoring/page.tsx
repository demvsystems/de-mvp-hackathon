import type { Metadata } from 'next';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { ArrowLeft, Camera, DollarSign, Layers3, Sparkles } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  costMonitoringSnapshot,
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  type CostBar,
} from '@/lib/cost-monitoring-snapshot';

export const metadata: Metadata = {
  title: 'DataClaw — Cost Monitoring Snapshot',
  description: 'Screenshot-ready cost monitoring proof points from Langfuse.',
};

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border-border/70 bg-card/90 shadow-[0_24px_60px_-32px_rgba(23,23,23,0.35)]">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
            {label}
          </span>
          <span className="font-heading text-4xl leading-none font-semibold tracking-tight tabular-nums">
            {value}
          </span>
          <span className="text-muted-foreground text-xs leading-relaxed">{hint}</span>
        </div>
        <span className="bg-muted text-foreground inline-flex size-10 items-center justify-center rounded-2xl">
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function ComparisonRail({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string;
  width: number;
  tone: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value}</span>
      </div>
      <div className="bg-muted h-3 overflow-hidden rounded-full">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ShareBar({
  label,
  value,
  share,
  tone,
  meta,
}: {
  label: string;
  value: string;
  share: number;
  tone: string;
  meta: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground text-xs">{meta}</span>
        </div>
        <span className="text-sm font-medium tabular-nums">{value}</span>
      </div>
      <div className="bg-muted h-3 overflow-hidden rounded-full">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
      </div>
      <span className="text-muted-foreground text-xs">{formatPercent(share)} of traced spend</span>
    </div>
  );
}

function CompositionLegend({
  rows,
  total,
  formatter,
}: {
  rows: readonly CostBar[];
  total: number;
  formatter: (value: number) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={`inline-flex size-2.5 rounded-full ${row.color}`} />
              <span className="font-medium">{row.label}</span>
            </div>
            <span className="tabular-nums">{formatter(row.value)}</span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full ${row.color}`}
              style={{ width: `${(row.value / total) * 100}%` }}
            />
          </div>
          {row.hint ? <span className="text-muted-foreground text-xs">{row.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

export default function CostMonitoringPage() {
  const snapshot = costMonitoringSnapshot;
  const maxCost = snapshot.headline.estimatedNoCacheCost;
  const totalCostComposition = snapshot.costComposition.reduce((sum, row) => sum + row.value, 0);
  const totalTokenComposition = snapshot.tokenComposition.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.15),transparent_35%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.14),transparent_30%),linear-gradient(180deg,rgba(23,23,23,0.03),transparent_22%)]" />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full border px-3 py-1"
            >
              <ArrowLeft className="size-3.5" />
              dashboard
            </Link>
            <span className="text-muted-foreground rounded-full border px-3 py-1">
              Langfuse snapshot
            </span>
            <span className="text-muted-foreground rounded-full border px-3 py-1">
              cutoff {snapshot.cutoffIso}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.22em] uppercase">
              <Camera className="size-3.5" />
              Langfuse cost snapshot
            </div>
            <div className="space-y-1.5">
              <h1 className="font-heading max-w-4xl text-4xl leading-tight font-semibold tracking-tight">
                Cost Monitoring
              </h1>
              <div className="text-muted-foreground text-sm">
                {snapshot.projectName} · {snapshot.snapshotDate}
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Traced Cost"
            value={formatCurrency(snapshot.headline.totalTracedCost)}
            hint={`${snapshot.headline.traces} traces · avg ${formatCurrency(snapshot.headline.avgTraceCost)} per trace`}
            icon={DollarSign}
          />
          <MetricCard
            label="Generations"
            value={String(snapshot.headline.generations)}
            hint="Observation-level sample behind the cost snapshot"
            icon={Layers3}
          />
          <MetricCard
            label="Cache Read Rate"
            value={formatPercent(snapshot.headline.cacheReadRate)}
            hint={`${snapshot.headline.cacheReadCount} of ${snapshot.headline.generations} generations hit cache reads`}
            icon={Sparkles}
          />
          <MetricCard
            label="Estimated Savings"
            value={formatCurrency(snapshot.headline.estimatedNetSavings)}
            hint={`${formatPercent(snapshot.headline.estimatedSavingsRate)} lower than uncached equivalent cost`}
            icon={Camera}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="border-border/70 bg-white/90">
            <CardHeader className="border-border/60 border-b">
              <CardTitle>Cache Savings</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ComparisonRail
                label="Actual generation cost"
                value={formatCurrency(snapshot.headline.totalTracedCost)}
                width={(snapshot.headline.totalTracedCost / maxCost) * 100}
                tone="bg-emerald-500"
              />
              <ComparisonRail
                label="Estimated uncached equivalent"
                value={formatCurrency(snapshot.headline.estimatedNoCacheCost)}
                width={100}
                tone="bg-neutral-900"
              />

              <div className="grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-emerald-800 uppercase">
                    Net savings
                  </span>
                  <span className="font-heading text-3xl font-semibold tracking-tight text-emerald-950 tabular-nums">
                    {formatCurrency(snapshot.headline.estimatedNetSavings)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-emerald-800 uppercase">
                    Savings rate
                  </span>
                  <span className="font-heading text-3xl font-semibold tracking-tight text-emerald-950 tabular-nums">
                    {formatPercent(snapshot.headline.estimatedSavingsRate)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-white/90">
            <CardHeader className="border-border/60 border-b">
              <CardTitle>Feature Split</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {snapshot.featureSplit.map((row) => (
                <ShareBar
                  key={row.label}
                  label={row.label}
                  value={formatCurrency(row.totalCost)}
                  share={row.share}
                  tone={row.color}
                  meta={`${row.traces} traces · avg ${formatCurrency(row.avgCost)}`}
                />
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/70 bg-white/90">
            <CardHeader className="border-border/60 border-b">
              <CardTitle>Cost Composition</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <CompositionLegend
                rows={snapshot.costComposition}
                total={totalCostComposition}
                formatter={formatCurrency}
              />
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-white/90">
            <CardHeader className="border-border/60 border-b">
              <CardTitle>Token Mix</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <CompositionLegend
                rows={snapshot.tokenComposition}
                total={totalTokenComposition}
                formatter={formatCompactNumber}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
