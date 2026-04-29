import { cn } from '@/lib/utils';
import type { Character } from '@/lib/types';

const fillByCharacter: Record<Character, string> = {
  attention: 'bg-destructive',
  opportunity: 'bg-emerald-500 dark:bg-emerald-400',
  noteworthy: 'bg-amber-500 dark:bg-amber-400',
  calm: 'bg-muted-foreground/40',
};

export function EscalationBar({
  score,
  character,
  className,
}: {
  score: number;
  character: Character;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="bg-muted relative h-1.5 w-24 overflow-hidden rounded-full">
        <div
          className={cn('absolute inset-y-0 left-0', fillByCharacter[character])}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">{score.toFixed(2)}</span>
    </div>
  );
}
