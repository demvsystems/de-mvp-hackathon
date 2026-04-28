'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type WorkerState = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

interface Worker {
  name: string;
  state: WorkerState;
  consumer: string;
  lastError?: string;
}

interface ListResponse {
  workers?: Worker[];
  error?: string;
}

const POLL_MS = 2000;

export function WorkersDashboard() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/workers/workers', { cache: 'no-store' });
    const body = (await res.json()) as ListResponse;
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body.workers ?? [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      refresh()
        .then((next) => {
          if (cancelled) return;
          setWorkers(next);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh]);

  const act = useCallback(
    (name: string, action: 'start' | 'stop' | 'reset'): void => {
      if (action === 'reset') {
        const ok = window.confirm(
          `Reset "${name}"? This deletes the JetStream consumer and replays all events from the beginning.`,
        );
        if (!ok) return;
      }
      setBusy((b) => ({ ...b, [name]: true }));
      fetch(`/api/admin/workers/workers/${name}/${action}`, { method: 'POST' })
        .then(async (res) => {
          const body = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          return refresh();
        })
        .then((next) => {
          setWorkers(next);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setBusy((b) => ({ ...b, [name]: false }));
        });
    },
    [refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {workers.length === 0 && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
      {workers.map((w) => (
        <Card key={w.name} size="sm">
          <CardContent className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{w.name}</span>
                <StatePill state={w.state} />
              </div>
              <div className="text-muted-foreground truncate text-xs">consumer: {w.consumer}</div>
              {w.lastError && (
                <div className="text-destructive truncate text-xs">{w.lastError}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {w.state === 'running' || w.state === 'starting' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy[w.name]}
                  onClick={() => act(w.name, 'stop')}
                >
                  Stop
                </Button>
              ) : (
                <Button size="sm" disabled={busy[w.name]} onClick={() => act(w.name, 'start')}>
                  Start
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                disabled={busy[w.name]}
                onClick={() => act(w.name, 'reset')}
              >
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatePill({ state }: { state: WorkerState }) {
  const variant: 'default' | 'secondary' | 'destructive' | 'outline' =
    state === 'running'
      ? 'default'
      : state === 'error'
        ? 'destructive'
        : state === 'stopped'
          ? 'outline'
          : 'secondary';
  return <Badge variant={variant}>{state}</Badge>;
}
