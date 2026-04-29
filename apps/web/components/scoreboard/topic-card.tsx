import Link from 'next/link';
import { ArrowUpRight, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Language } from '@/lib/language';
import { CharacterBadge } from './character-badge';
import { EscalationBar } from './escalation-bar';
import { cn } from '@/lib/utils';
import type { TriageTopic } from '@/lib/types';

const stagnationStyle: Record<TriageTopic['metadata']['stagnation_severity'], string> = {
  none: 'text-muted-foreground',
  low: 'text-muted-foreground',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-destructive',
};

function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function getStagnationLabel(
  severity: TriageTopic['metadata']['stagnation_severity'],
  language: Language,
): string {
  if (language === 'de') {
    return {
      none: 'keine Stagnation',
      low: 'geringe Stagnation',
      medium: 'mittlere Stagnation',
      high: 'hohe Stagnation',
    }[severity];
  }

  return {
    none: 'no stagnation',
    low: 'low stagnation',
    medium: 'medium stagnation',
    high: 'high stagnation',
  }[severity];
}

const actionPlanTone: Record<
  NonNullable<TriageTopic['metadata']['action_plan']>['status'],
  string
> = {
  proposed: 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  approved: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-zinc-500/50 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  superseded: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  executing: 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  executed: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
};

function getActionPlanLabel(
  status: NonNullable<TriageTopic['metadata']['action_plan']>['status'],
  language: Language,
): string {
  if (language === 'de') {
    return {
      proposed: 'Vorschlag',
      approved: 'Genehmigt',
      rejected: 'Abgelehnt',
      superseded: 'Überarbeitet',
      executing: 'Wird ausgeführt',
      executed: 'Ausgeführt',
      failed: 'Fehlgeschlagen',
    }[status];
  }

  return {
    proposed: 'Proposed',
    approved: 'Approved',
    rejected: 'Rejected',
    superseded: 'Superseded',
    executing: 'Executing',
    executed: 'Executed',
    failed: 'Failed',
  }[status];
}

export function TopicCard({ topic, language }: { topic: TriageTopic; language: Language }) {
  const { metadata, scoring, title, snippet } = topic;
  const metaText =
    language === 'de'
      ? `${metadata.member_count} Mitglieder · ${metadata.source_count} Quellen`
      : `${metadata.member_count} members · ${metadata.source_count} sources`;
  const updatedText =
    language === 'de'
      ? `aktualisiert vor ${relativeTime(metadata.last_activity_at)}`
      : `updated ${relativeTime(metadata.last_activity_at)}`;
  const planMeta =
    metadata.action_plan === null || metadata.action_plan === undefined
      ? null
      : language === 'de'
        ? `${metadata.action_plan.action_count} Aktionen · vorgeschlagen vor ${relativeTime(metadata.action_plan.proposed_at)}`
        : `${metadata.action_plan.action_count} actions · proposed ${relativeTime(metadata.action_plan.proposed_at)}`;
  return (
    <Link
      href={`/topics/${encodeURIComponent(topic.id)}`}
      className="group focus-visible:outline-ring/60 block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Card className="hover:ring-foreground/30 transition-shadow group-hover:shadow-sm">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CharacterBadge character={metadata.character} />
              <EscalationBar score={scoring.score} character={metadata.character} />
            </div>
            <ArrowUpRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>

          <h3 className="font-heading text-base leading-snug font-medium">{title}</h3>
          {metadata.action_plan ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  'rounded-md border px-2 py-0.5',
                  actionPlanTone[metadata.action_plan.status],
                )}
              >
                {language === 'de' ? 'Action Plan' : 'Action plan'}:{' '}
                {getActionPlanLabel(metadata.action_plan.status, language)}
              </Badge>
              <span className="text-muted-foreground text-xs">{planMeta}</span>
            </div>
          ) : null}
          {snippet ? (
            <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">{snippet}</p>
          ) : null}

          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              {metaText}
            </span>
            <span className={cn(stagnationStyle[metadata.stagnation_severity])}>
              {getStagnationLabel(metadata.stagnation_severity, language)}
            </span>
            <span>{updatedText}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
