import { AutoRefresh } from '@/components/scoreboard/auto-refresh';
import { CharacterFilter } from '@/components/scoreboard/character-filter';
import { ReviewerControl } from '@/components/scoreboard/reviewer-control';
import { TopicCard } from '@/components/scoreboard/topic-card';
import { getScoreboard } from '@/lib/from-db';
import type { Language } from '@/lib/language';
import { getPreferredLanguage } from '@/lib/language-server';
import type { Character } from '@/lib/types';

const characters: Character[] = ['attention', 'opportunity', 'noteworthy', 'calm'];

const orderByCharacter: Record<Character, number> = {
  attention: 0,
  opportunity: 1,
  noteworthy: 2,
  calm: 3,
};

const copy: Record<
  Language,
  {
    empty: string;
  }
> = {
  de: {
    empty: 'Keine Einträge für diesen Filter.',
  },
  en: {
    empty: 'No items for this filter.',
  },
};

export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{ character?: string }>;
}) {
  const { character } = await searchParams;
  const language = await getPreferredLanguage('en');
  const filter = (characters as string[]).includes(character ?? '')
    ? (character as Character)
    : null;

  const topics = await getScoreboard(language);
  const text = copy[language];

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

      <CharacterFilter counts={counts} language={language} />

      <ReviewerControl />

      <section className="flex flex-col gap-3">
        {visible.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            {text.empty}
          </div>
        ) : (
          visible.map((topic) => <TopicCard key={topic.id} topic={topic} language={language} />)
        )}
      </section>
    </div>
  );
}
