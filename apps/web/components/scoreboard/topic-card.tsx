import Link from 'next/link';
import { ArrowUpRight, Users } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { CharacterBadge } from './character-badge';
import { EscalationBar } from './escalation-bar';
import { cn } from '@/lib/utils';
import type { TriageTopic } from '@/lib/types';

const stagnationLabel: Record<TriageTopic['metadata']['stagnation_severity'], string> = {
  none: 'no stagnation',
  low: 'low stagnation',
  medium: 'medium stagnation',
  high: 'high stagnation',
};

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

export function TopicCard({ topic }: { topic: TriageTopic }) {
  const { metadata, scoring, title, snippet } = topic;
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
          {snippet ? (
            <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">{snippet}</p>
          ) : null}

          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              {metadata.member_count} members · {metadata.source_count} sources
            </span>
            <span className={cn(stagnationStyle[metadata.stagnation_severity])}>
              {stagnationLabel[metadata.stagnation_severity]}
            </span>
            <span>updated {relativeTime(metadata.last_activity_at)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
