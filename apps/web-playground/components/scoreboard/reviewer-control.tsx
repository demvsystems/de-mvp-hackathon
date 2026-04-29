'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type WorkerState = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

interface Worker {
  name: string;
  state: WorkerState;
  lastError?: string;
}

const POLL_MS = 2000;
const REVIEWER = 'reviewer';

const noopSubscribe = (): (() => void) => () => {};
const trueSnapshot = (): boolean => true;
const falseSnapshot = (): boolean => false;

export function ReviewerControl() {
  const [state, setState] = useState<WorkerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hydration-Guard: zustandsabhängige Buttons erst nach Mount rendern, damit
  // der Server keine `disabled={true}`-Variante emittiert, die base-ui beim
  // SSR/CSR uneinheitlich serialisiert (führt sonst zum Hydration-Mismatch).
  const hydrated = useSyncExternalStore(noopSubscribe, trueSnapshot, falseSnapshot);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/workers/workers', { cache: 'no-store' });
    const body = (await res.json()) as { workers?: Worker[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    const w = (body.workers ?? []).find((x) => x.name === REVIEWER);
    return w ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      refresh()
        .then((w) => {
          if (cancelled) return;
          setState(w?.state ?? null);
          setError(w?.lastError ?? null);
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
    (action: 'start' | 'stop'): void => {
      setBusy(true);
      fetch(`/api/admin/workers/workers/${REVIEWER}/${action}`, { method: 'POST' })
        .then(async (res) => {
          const body = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          return refresh();
        })
        .then((w) => {
          setState(w?.state ?? null);
          setError(w?.lastError ?? null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [refresh],
  );

  const resetAssessments = useCallback((): void => {
    const ok = window.confirm(
      'Delete all topic assessments and re-trigger the reviewer for every active topic?',
    );
    if (!ok) return;
    setBusy(true);
    fetch('/api/admin/workers/reviewer/reset-assessments', { method: 'POST' })
      .then(async (res) => {
        const body = (await res.json()) as {
          deleted_assessments?: number;
          retriggered_topics?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  const isRunning = state === 'running' || state === 'starting';
  const variant: 'default' | 'secondary' | 'destructive' | 'outline' =
    state === 'running'
      ? 'default'
      : state === 'error'
        ? 'destructive'
        : state === 'stopped'
          ? 'outline'
          : 'secondary';

  return (
    <div className="border-border bg-card flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Reviewer</span>
          {state ? <Badge variant={variant}>{state}</Badge> : <Badge variant="secondary">…</Badge>}
        </div>
        {error && <div className="text-destructive truncate text-xs">{error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {hydrated && isRunning ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act('stop')}>
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={hydrated ? busy || state === null : false}
            onClick={() => act('start')}
          >
            Start reviewer
          </Button>
        )}
        <Button size="sm" variant="destructive" disabled={busy} onClick={resetAssessments}>
          Reset
        </Button>
      </div>
    </div>
  );
}
