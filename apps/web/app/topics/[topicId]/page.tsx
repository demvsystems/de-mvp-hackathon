import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, TrendingDown, TrendingUp, Minus, Moon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { CharacterBadge } from '@/components/scoreboard/character-badge';
import { EscalationBar } from '@/components/scoreboard/escalation-bar';
import { TopicMemberRow } from '@/components/scoreboard/topic-member-row';
import { getTopicContext } from '@/lib/fixtures';
import type { ActivityTrend } from '@/lib/types';

const trendIcon: Record<ActivityTrend, typeof TrendingUp> = {
  growing: TrendingUp,
  stable: Minus,
  declining: TrendingDown,
  dormant: Moon,
};

const trendLabel: Record<ActivityTrend, string> = {
  growing: 'growing',
  stable: 'stable',
  declining: 'declining',
  dormant: 'dormant',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

export default async function TopicDetailPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  const topic = getTopicContext(decodeURIComponent(topicId));
  if (!topic) notFound();

  const TrendIcon = trendIcon[topic.activity.trend];
  const reasoning = topic.latest_assessment.reasoning;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        back to triage
      </Link>

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <CharacterBadge character={topic.latest_assessment.character} />
          <EscalationBar
            score={topic.latest_assessment.escalation_score}
            character={topic.latest_assessment.character}
          />
          <span className="text-muted-foreground text-xs">
            assessed {formatDateTime(topic.latest_assessment.assessed_at)}
          </span>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{topic.label}</h1>
        <code className="text-muted-foreground/80 font-mono text-xs break-all">{topic.id}</code>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Members"
          value={`${topic.activity.member_count}`}
          hint={`${topic.activity.source_count} sources`}
        />
        <Stat
          label="Velocity 24h"
          value={`${topic.activity.velocity_24h}`}
          hint={`7d avg ${topic.activity.velocity_7d_avg.toFixed(1)}/day`}
        />
        <Stat
          label="Trend"
          value={
            <span className="inline-flex items-center gap-1.5">
              <TrendIcon className="size-4" />
              {trendLabel[topic.activity.trend]}
            </span>
          }
          hint={`last activity ${formatDateTime(topic.activity.last_activity_at)}`}
        />
        <Stat
          label="Stagnation"
          value={topic.stagnation.severity}
          hint={`${topic.stagnation.signal_count} signals`}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="font-heading text-base font-medium">Reasoning</h2>
            <p className="text-sm leading-relaxed">{reasoning.sentiment_aggregate}</p>

            <div className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs tracking-wide uppercase">Key signals</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {reasoning.key_signals.map((s, i) => (
                  <li key={i} className="flex gap-2 leading-relaxed">
                    <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {reasoning.key_artifacts.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-xs tracking-wide uppercase">
                  Key artifacts
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {reasoning.key_artifacts.map((id) => (
                    <li
                      key={id}
                      className="bg-muted text-foreground/80 rounded-md px-2 py-1 font-mono text-[11px]"
                    >
                      {id}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {reasoning.additional_notes ? (
              <p className="border-l-foreground/30 text-muted-foreground border-l-2 pl-3 text-sm leading-relaxed italic">
                {reasoning.additional_notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-heading text-base font-medium">Assessment history</h2>
            <ol className="flex flex-col gap-3">
              {topic.history.map((h) => (
                <li key={h.assessed_at} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <CharacterBadge character={h.character} />
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {h.escalation_score.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {formatDateTime(h.assessed_at)}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {h.brief_reasoning}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-medium">Members ({topic.members.length})</h2>
          <span className="text-muted-foreground text-xs">
            top members loaded into the assessor prompt
          </span>
        </div>
        <Card>
          <ul>
            {topic.members.map((m, idx) => (
              <TopicMemberRow key={m.id} member={m} rank={idx + 1} />
            ))}
          </ul>
        </Card>
      </section>
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
