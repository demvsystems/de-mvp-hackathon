'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import type { Character } from '@/lib/types';

const order: Character[] = ['attention', 'opportunity', 'noteworthy', 'calm'];

const copy = {
  all: 'All topics',
  clear: 'Clear filter',
  statusAll: 'Showing all topics',
  statusFiltered: (label: string) => `Showing ${label.toLowerCase()}`,
  summary: {
    attention: {
      label: 'Attention',
      hint: 'critical',
      tone: 'border-destructive/20 bg-destructive/6 text-destructive',
      activeTone: 'border-destructive bg-destructive text-destructive-foreground',
    },
    opportunity: {
      label: 'Opportunity',
      hint: 'medium urgency',
      tone: 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700',
      activeTone: 'border-emerald-600 bg-emerald-600 text-white',
    },
    noteworthy: {
      label: 'Noteworthy',
      hint: 'optional',
      tone: 'border-amber-500/25 bg-amber-500/8 text-amber-700',
      activeTone: 'border-amber-500 bg-amber-500 text-amber-950',
    },
    calm: {
      label: 'Calm',
      hint: 'no action',
      tone: 'border-border bg-muted/40 text-foreground',
      activeTone: 'border-foreground bg-foreground text-background',
    },
  },
};

export function CharacterFilter({ counts }: { counts: Record<'all' | Character, number> }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get('character');
  const active = order.includes(current as Character) ? (current as Character) : 'all';

  const update = (key: 'all' | Character) => {
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete('character');
    else next.set('character', key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const activeLabel = active === 'all' ? copy.all : copy.summary[active].label;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {active === 'all' ? copy.statusAll : copy.statusFiltered(activeLabel)}
        </p>
        <button
          type="button"
          data-active={active === 'all'}
          onClick={() => update('all')}
          className={cn(
            'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors',
            active === 'all'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {active === 'all' ? copy.all : copy.clear}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {order.map((key) => {
          const summary = copy.summary[key];
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
              onClick={() => update(key)}
              className={cn(
                'rounded-xl border p-6 text-left transition-all',
                'hover:-translate-y-0.5 hover:shadow-sm',
                isActive ? `${summary.activeTone} shadow-sm` : summary.tone,
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium tracking-[0.18em] text-current/80 uppercase">
                    {summary.label}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      isActive ? 'text-current/80' : 'text-muted-foreground',
                    )}
                  >
                    {summary.hint}
                  </span>
                </div>
                <span className="font-heading text-5xl font-semibold tabular-nums">
                  {counts[key]}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
