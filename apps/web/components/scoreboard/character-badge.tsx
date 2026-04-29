import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Character } from '@/lib/types';

const labels: Record<Character, string> = {
  attention: 'Attention',
  opportunity: 'Opportunity',
  noteworthy: 'Noteworthy',
  calm: 'Calm',
};

const styles: Record<Character, string> = {
  attention: 'bg-destructive/10 text-destructive border-destructive/30 dark:bg-destructive/20',
  opportunity:
    'bg-amber-500/10 text-amber-700 border-amber-600/30 dark:bg-amber-500/15 dark:text-amber-300',
  noteworthy:
    'bg-emerald-500/10 text-emerald-700 border-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-300',
  calm: 'bg-muted text-muted-foreground border-border',
};

export function CharacterBadge({
  character,
  className,
}: {
  character: Character;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('tracking-wide uppercase', styles[character], className)}
    >
      {labels[character]}
    </Badge>
  );
}
