import { cn } from '@/lib/utils';
import type { Source } from '@/lib/types';

const styles: Record<Source, string> = {
  slack: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  intercom: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  jira: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  github: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
  upvoty: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  topic: 'bg-primary/10 text-primary',
};

export function SourcePill({ source, className }: { source: Source; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-medium tracking-wide uppercase',
        styles[source],
        className,
      )}
    >
      {source}
    </span>
  );
}
