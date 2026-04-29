import { AutoRefresh } from '@/components/scoreboard/auto-refresh';
import { CharacterFilter } from '@/components/scoreboard/character-filter';
import { ReviewerControl } from '@/components/scoreboard/reviewer-control';
import { TopicCard } from '@/components/scoreboard/topic-card';
import { getScoreboard } from '@/lib/from-db';
import type { Character } from '@/lib/types';

const characters: Character[] = ['attention', 'opportunity', 'noteworthy', 'calm'];

const orderByCharacter: Record<Character, number> = {
  attention: 0,
  opportunity: 1,
  noteworthy: 2,
  calm: 3,
};

export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{ character?: string }>;
}) {
  const { character } = await searchParams;
  const filter = (characters as string[]).includes(character ?? '')
    ? (character as Character)
    : null;

  const topics = await getScoreboard();

  const counts: Record<'all' | Character, number> = {
    all: topics.length,
    attention: 0,
    opportunity: 0,
    noteworthy: 0,
    calm: 0,
  };
  for (const t of topics) counts[t.metadata.character] += 1;

  const visible = (filter ? topics.filter((t) => t.metadata.character === filter) : topics)
    .slice()
    .sort((a, b) => {
      const cd = orderByCharacter[a.metadata.character] - orderByCharacter[b.metadata.character];
      if (cd !== 0) return cd;
      return b.scoring.score - a.scoring.score;
    });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <AutoRefresh intervalMs={5000} />
      <header className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">Scoreboard</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Triage</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Aktive Topics aus Slack, Jira, GitHub und Confluence — bewertet vom LLM-Bewerter. Sortiert
          nach Charakter und Eskalations-Score; Drill-down zeigt Belege und Reasoning.
        </p>
      </header>

      <CharacterFilter counts={counts} />

      <ReviewerControl />

      <section className="flex flex-col gap-3">
        {visible.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            Keine Topics für diesen Filter.
          </div>
        ) : (
          visible.map((topic) => <TopicCard key={topic.id} topic={topic} />)
        )}
      </section>
    </div>
  );
}
