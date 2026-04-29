'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '@repo/agent';
import type { AgentActivityEnvelope } from '@repo/agent/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DisplayEntry extends AgentActivityEnvelope {
  id: string;
}

interface AgentActivityProps {
  className?: string;
  listClassName?: string;
}

const MAX_ENTRIES = 80;

function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

function fmtArgs(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object') return String(input);
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      if (typeof v === 'string') {
        const trimmed = v.length > 32 ? `${v.slice(0, 29)}…` : v;
        return `${k}="${trimmed}"`;
      }
      if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${String(v)}`;
      if (Array.isArray(v)) return `${k}=[${v.length}]`;
      if (v && typeof v === 'object') return `${k}={…}`;
      return `${k}=${String(v)}`;
    })
    .join(', ');
}

type Tone = 'muted' | 'info' | 'ok' | 'warn';

interface Rendered {
  kind: 'tool' | 'thinking' | 'final' | 'error' | 'tool_failed';
  label: string;
  detail: string;
  tone: Tone;
}

function describe(event: AgentEvent): Rendered | null {
  switch (event.type) {
    case 'tool_call':
      return {
        kind: 'tool',
        label: `→ ${event.name}`,
        detail: fmtArgs(event.input),
        tone: 'info',
      };
    case 'tool_result':
      if (event.ok) return null;
      return {
        kind: 'tool_failed',
        label: `← ${event.name}`,
        detail: 'failed',
        tone: 'warn',
      };
    case 'assistant_text': {
      const text = event.text.trim();
      if (text.length === 0) return null;
      return { kind: 'thinking', label: 'thinking', detail: text, tone: 'muted' };
    }
    case 'final':
      return {
        kind: 'final',
        label: event.fallback_reason ? `done · ${event.fallback_reason}` : 'done',
        detail: '',
        tone: event.fallback_reason ? 'warn' : 'ok',
      };
    case 'error':
      return { kind: 'error', label: 'error', detail: event.message, tone: 'warn' };
    case 'turn_start':
      return null;
  }
}

const toneClasses: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-destructive',
  info: 'text-foreground',
  muted: 'text-muted-foreground',
};

export function AgentActivity({
  className,
  listClassName,
}: AgentActivityProps): React.ReactElement {
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    const es = new EventSource('/api/admin/workers/agent/activity');

    const onOpen = (): void => setConnected(true);
    const onActivity = (e: MessageEvent<string>): void => {
      try {
        const env = JSON.parse(e.data) as AgentActivityEnvelope;
        if (describe(env.event) === null) return;
        counter.current += 1;
        const id = `${env.emitted_at}-${counter.current}`;
        setEntries((prev) => {
          const next = [{ ...env, id }, ...prev];
          return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
        });
      } catch {
        // ignore malformed
      }
    };
    const onError = (): void => setConnected(false);

    es.addEventListener('open', onOpen);
    es.addEventListener('activity', onActivity);
    es.addEventListener('error', onError);

    return () => {
      es.removeEventListener('open', onOpen);
      es.removeEventListener('activity', onActivity);
      es.removeEventListener('error', onError);
      es.close();
    };
  }, []);

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Agent activity</span>
            <Badge variant={connected ? 'default' : 'secondary'}>
              {connected ? 'live' : 'connecting'}
            </Badge>
          </div>
          <span className="text-muted-foreground text-xs">
            {entries.length} event{entries.length === 1 ? '' : 's'}
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Waiting for an agent run. Trigger a topic update, approve a plan, or hit Reset to see
            tool calls and reasoning.
          </p>
        ) : (
          <ul
            className={cn(
              'flex flex-col gap-3 overflow-y-auto font-mono text-xs',
              listClassName ?? 'max-h-[28rem]',
            )}
          >
            {entries.map((entry) => {
              const r = describe(entry.event);
              if (!r) return null;
              const tone = toneClasses[r.tone];
              return (
                <li key={entry.id} className="flex flex-col gap-0.5">
                  <div className="text-muted-foreground flex items-baseline gap-2 text-[10.5px]">
                    <span className="tabular-nums">{fmtTime(entry.emitted_at)}</span>
                    <span className="tracking-wide uppercase">{entry.agent}</span>
                    <span className="truncate">{entry.topic_id}</span>
                  </div>
                  <div className="pl-1">
                    <span className={cn('font-medium', tone)}>{r.label}</span>
                    {r.detail ? (
                      <span
                        className={cn(
                          'text-foreground/80 ml-2 break-words whitespace-pre-wrap',
                          r.kind === 'thinking' && 'text-muted-foreground italic',
                        )}
                      >
                        {r.detail}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
