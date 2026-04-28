import { SourcePill } from './source-pill';
import { cn } from '@/lib/utils';
import type { TopicMember } from '@/lib/types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

export function TopicMemberRow({ member, rank }: { member: TopicMember; rank: number }) {
  return (
    <li className="border-border/60 flex flex-col gap-2 border-t px-4 py-3 first:border-t-0">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-foreground/80 tabular-nums">#{rank}</span>
        <SourcePill source={member.source} />
        <span>{member.type}</span>
        <span>·</span>
        <span>{formatDate(member.occurred_at)}</span>
        {member.author_display_name ? (
          <>
            <span>·</span>
            <span className="text-foreground/80">{member.author_display_name}</span>
          </>
        ) : null}
        <span className="ml-auto tabular-nums">conf {member.edge_confidence.toFixed(2)}</span>
      </div>
      {member.title ? <p className="leading-snug font-medium">{member.title}</p> : null}
      <p className={cn('text-muted-foreground text-sm leading-relaxed')}>{member.body_snippet}</p>
      <code className="text-muted-foreground/70 font-mono text-[11px] break-all">{member.id}</code>
    </li>
  );
}
