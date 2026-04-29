'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type AgentEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'tool_call'; turn: number; name: string; input: unknown }
  | { type: 'tool_result'; turn: number; name: string; ok: boolean; bytes: number }
  | { type: 'assistant_text'; turn: number; text: string }
  | {
      type: 'final';
      turn: number;
      trace_id: string | null;
      trace_url: string | null;
      fallback_reason: string | null;
    }
  | { type: 'error'; message: string };

interface ActivityEnvelope {
  topic_id: string;
  triggered_by: string;
  emitted_at: string;
  event: AgentEvent;
}

interface DisplayEntry extends ActivityEnvelope {
  id: string;
}

const MAX_ENTRIES = 60;

function shortInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return '';
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

function describe(event: AgentEvent): {
  label: string;
  tone: 'muted' | 'info' | 'ok' | 'warn';
  detail: string;
} {
  switch (event.type) {
    case 'turn_start':
      return { label: `turn ${event.turn}`, tone: 'info', detail: '' };
    case 'tool_call':
      return { label: `→ ${event.name}`, tone: 'info', detail: shortInput(event.input) };
    case 'tool_result':
      return {
        label: `← ${event.name}`,
        tone: event.ok ? 'ok' : 'warn',
        detail: `${event.bytes.toLocaleString()} bytes`,
      };
    case 'assistant_text': {
      const trimmed = event.text.length > 240 ? `${event.text.slice(0, 237)}…` : event.text;
      return { label: 'thinking', tone: 'muted', detail: trimmed };
    }
    case 'final':
      return {
        label: event.fallback_reason ? `final · ${event.fallback_reason}` : 'final',
        tone: event.fallback_reason ? 'warn' : 'ok',
        detail: '',
      };
    case 'error':
      return { label: 'error', tone: 'warn', detail: event.message };
  }
}

export function ReviewerActivity(): React.ReactElement {
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    const es = new EventSource('/api/admin/workers/reviewer/activity');

    const onOpen = (): void => setConnected(true);
    const onActivity = (e: MessageEvent<string>): void => {
      try {
        const env = JSON.parse(e.data) as ActivityEnvelope;
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
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Reviewer activity</span>
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
            Waiting for the reviewer to run. Trigger a topic update or hit Reset to see live turns
            and tool calls.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto font-mono text-xs">
            {entries.map((entry) => {
              const d = describe(entry.event);
              const toneClass =
                d.tone === 'ok'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : d.tone === 'warn'
                    ? 'text-destructive'
                    : d.tone === 'info'
                      ? 'text-foreground'
                      : 'text-muted-foreground';
              return (
                <li key={entry.id} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {fmtTime(entry.emitted_at)}
                  </span>
                  <span className="text-muted-foreground max-w-[8rem] shrink-0 truncate">
                    {entry.topic_id}
                  </span>
                  <span className={`shrink-0 font-medium ${toneClass}`}>{d.label}</span>
                  {d.detail ? (
                    <span className="text-muted-foreground truncate">{d.detail}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
