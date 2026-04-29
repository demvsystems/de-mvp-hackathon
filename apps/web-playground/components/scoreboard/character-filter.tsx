'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { Character } from '@/lib/types';

const order: Array<'all' | Character> = ['all', 'attention', 'opportunity', 'noteworthy', 'calm'];

const labels: Record<'all' | Character, string> = {
  all: 'All',
  attention: 'Attention',
  opportunity: 'Opportunity',
  noteworthy: 'Noteworthy',
  calm: 'Calm',
};

const accent: Record<'all' | Character, string> = {
  all: 'data-[active=true]:bg-foreground data-[active=true]:text-background',
  attention: 'data-[active=true]:bg-destructive data-[active=true]:text-destructive-foreground',
  opportunity: 'data-[active=true]:bg-emerald-600 data-[active=true]:text-white',
  noteworthy: 'data-[active=true]:bg-amber-500 data-[active=true]:text-amber-950',
  calm: 'data-[active=true]:bg-muted-foreground data-[active=true]:text-background',
};

export function CharacterFilter({ counts }: { counts: Record<'all' | Character, number> }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = (params.get('character') ?? 'all') as 'all' | Character;

  const update = useCallback(
    (key: 'all' | Character) => {
      const next = new URLSearchParams(params);
      if (key === 'all') next.delete('character');
      else next.set('character', key);
      const qs = next.toString();
      router.replace(qs ? `/?${qs}` : '/', { scroll: false });
    },
    [params, router],
  );

  const buttons = useMemo(
    () => order.map((k) => ({ key: k, label: labels[k], count: counts[k] })),
    [counts],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {buttons.map(({ key, label, count }) => (
        <button
          key={key}
          type="button"
          data-active={active === key}
          onClick={() => update(key)}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors',
            'border-border text-foreground hover:bg-muted',
            accent[key],
          )}
        >
          <span>{label}</span>
          <span
            data-active={active === key}
            className="text-muted-foreground tabular-nums data-[active=true]:text-current/80"
          >
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}
