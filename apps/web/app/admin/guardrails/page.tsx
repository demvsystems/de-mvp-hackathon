import Link from 'next/link';
import { ArrowLeft, ExternalLink, ShieldAlert } from 'lucide-react';

import { GuardrailDemoTrigger } from '@/components/admin/guardrail-demo-trigger';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getGuardrailDemoModel } from '@/lib/guardrail-demo';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

function langfuseTraceUrl(traceId: string): string | null {
  const base = process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'];
  const projectId = process.env['LANGFUSE_PROJECT_ID'];
  if (!base) return null;
  if (projectId) return `${base}/project/${projectId}/traces/${traceId}`;
  return `${base}/traces/${traceId}`;
}

function severityVariant(
  severity: 'info' | 'warn' | 'error',
): 'secondary' | 'outline' | 'destructive' {
  if (severity === 'error') return 'destructive';
  if (severity === 'warn') return 'secondary';
  return 'outline';
}

function decisionVariant(
  decision: 'allow' | 'flag' | 'downgrade' | 'block',
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (decision === 'block') return 'destructive';
  if (decision === 'downgrade') return 'secondary';
  if (decision === 'flag') return 'outline';
  return 'default';
}

export default async function GuardrailsDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string }>;
}) {
  const { fixture } = await searchParams;
  const model = await getGuardrailDemoModel(fixture);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        back to triage
      </Link>

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Guardrail demo</Badge>
          <Badge variant="outline">{model.selected.id}</Badge>
          <Badge variant="outline">{model.selected.topic.label ?? model.selected.topic.id}</Badge>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Active guardrails, visible end to end
          </h1>
          <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
            One page for the screenshot: adversarial input, detected flags, blocked compromised
            output, safe allowed output, and any live guardrail events already logged for this
            topic.
          </p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Fixture" value={model.selected.id} hint={`${model.records.length} records`} />
        <Stat
          label="Suspicious"
          value={`${model.records.filter((record) => record.guardrail.flags.length > 0).length}`}
          hint="records flagged by detection"
        />
        <Stat
          label="Flags"
          value={`${model.suspicious_flags.length}`}
          hint={model.suspicious_flags.join(', ') || 'none'}
        />
        <Stat
          label="Live events"
          value={`${model.live_events.length}`}
          hint="logged reviewable trips"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-base font-medium">Attack input</h2>
                <p className="text-muted-foreground text-sm">
                  Raw records from the adversarial fixture. Suspicious evidence is flagged before it
                  reaches the reviewer.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {model.fixtures.map((fixtureOption) => (
                  <Link
                    key={fixtureOption.id}
                    href={`/admin/guardrails?fixture=${encodeURIComponent(fixtureOption.id)}`}
                    className={`rounded-full px-3 py-1 text-xs ring-1 ${
                      fixtureOption.id === model.selected.id
                        ? 'bg-foreground text-background ring-foreground'
                        : 'text-muted-foreground hover:text-foreground ring-border'
                    }`}
                  >
                    {fixtureOption.id.replace('adversarial-', '')}
                  </Link>
                ))}
              </div>
            </div>

            <ul className="flex flex-col gap-3">
              {model.records.map((record) => (
                <li key={record.id}>
                  <Card size="sm" className="bg-muted/20">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{record.source}</Badge>
                        <Badge variant="outline">{record.type}</Badge>
                        {record.guardrail.flags.length > 0 ? (
                          <>
                            <Badge variant="destructive">flagged</Badge>
                            {record.guardrail.flags.map((flag) => (
                              <Badge key={flag} variant="secondary">
                                {flag}
                              </Badge>
                            ))}
                          </>
                        ) : (
                          <Badge variant="outline">clean</Badge>
                        )}
                      </div>

                      {record.title ? (
                        <p className="leading-snug font-medium">{record.title}</p>
                      ) : null}

                      <pre className="bg-background overflow-x-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap ring-1 ring-black/5">
                        {record.body ?? '(no body)'}
                      </pre>

                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span>risk score {record.guardrail.risk_score}</span>
                        <span className="font-mono break-all">{record.id}</span>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div>
                <h2 className="font-heading text-base font-medium">Runtime decision</h2>
                <p className="text-muted-foreground text-sm">
                  Simulated with the same validator used before publish. Bad output is blocked; safe
                  output passes.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {model.assessments.map((assessment) => (
                  <div key={assessment.label} className="rounded-xl border p-3">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">{assessment.label}</span>
                        <span className="text-muted-foreground text-xs">
                          character {assessment.output.character} · escalation{' '}
                          {assessment.output.escalation_score.toFixed(2)}
                        </span>
                      </div>
                      <Badge variant={decisionVariant(assessment.decision)}>
                        {assessment.decision}
                      </Badge>
                    </div>

                    <p className="mb-3 text-sm leading-relaxed">{assessment.output.summary.text}</p>

                    {assessment.events.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {assessment.events
                          .filter((event) => event.decision !== 'allow')
                          .map((event, index) => (
                            <li
                              key={`${event.rule_id}-${index}`}
                              className="bg-muted/50 rounded-lg p-2"
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                                <Badge variant={severityVariant(event.severity)}>
                                  {event.severity}
                                </Badge>
                                <Badge variant={decisionVariant(event.decision)}>
                                  {event.decision}
                                </Badge>
                                <span className="font-mono">{event.rule_id}</span>
                              </div>
                              <p className="text-sm leading-relaxed">{event.detail}</p>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <div className="text-muted-foreground text-sm">No violations.</div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-4">
              <div>
                <h2 className="font-heading text-base font-medium">Narration track</h2>
                <p className="text-muted-foreground text-sm">Use this for a 20-second recording.</p>
              </div>
              <ol className="flex flex-col gap-2 text-sm">
                <li className="flex gap-2">
                  <span className="text-muted-foreground">1.</span>
                  <span>Point at the injected record and the attached guardrail flags.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted-foreground">2.</span>
                  <span>
                    Show the compromised output being blocked by the publish-time validator.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted-foreground">3.</span>
                  <span>
                    Show the safe output being allowed and any live reviewable events below.
                  </span>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4" />
              <h2 className="font-heading text-base font-medium">Live review trail</h2>
            </div>
            <GuardrailDemoTrigger topicId={model.selected.topic.id} fixtureId={model.selected.id} />
          </div>
          {model.live_events.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm leading-relaxed">
                No live guardrail event is logged for this topic yet. Trigger the reviewer for
                fixture <code>{model.selected.id}</code> here and this page will refresh to surface
                the persisted event queue once the run lands.
              </p>
              <p className="text-muted-foreground text-xs">
                The button republishes a single topic event through the normal reviewer worker path.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {model.live_events.map((event) => {
                const traceUrl = event.trace_id ? langfuseTraceUrl(event.trace_id) : null;
                return (
                  <li key={event.id}>
                    <Card size="sm" className="bg-muted/20">
                      <CardContent className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={severityVariant(event.severity)}>{event.severity}</Badge>
                          <Badge variant={decisionVariant(event.decision)}>{event.decision}</Badge>
                          <Badge variant="outline">{event.stage}</Badge>
                          <span className="font-mono">{event.rule_id}</span>
                        </div>

                        <p className="text-sm leading-relaxed">{event.detail}</p>

                        {event.record_ids.length > 0 ? (
                          <div className="text-muted-foreground text-xs">
                            records: {event.record_ids.join(', ')}
                          </div>
                        ) : null}

                        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                          <span>assessment {fmt(event.assessed_at)}</span>
                          <span>logged {fmt(event.created_at)}</span>
                          {traceUrl ? (
                            <a
                              href={traceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-foreground inline-flex items-center gap-1"
                            >
                              <ExternalLink className="size-3" /> trace
                            </a>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
        <span className="font-heading text-lg font-medium">{value}</span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}
