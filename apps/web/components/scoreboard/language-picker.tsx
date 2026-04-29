'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { LANGUAGE_COOKIE, type Language } from '@/lib/language';
import { cn } from '@/lib/utils';

const labels: Record<Language, { name: string; de: string; en: string }> = {
  de: {
    name: 'Sprache',
    de: 'Deutsch',
    en: 'Englisch',
  },
  en: {
    name: 'Language',
    de: 'German',
    en: 'English',
  },
};

export function LanguagePicker({ language }: { language: Language }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const copy = labels[language];

  function updateLanguage(nextLanguage: Language): void {
    if (nextLanguage === language) return;
    document.cookie = `${LANGUAGE_COOKIE}=${nextLanguage}; Path=/; Max-Age=31536000; SameSite=Lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{copy.name}</span>
      <div className="bg-muted inline-flex rounded-full p-0.5">
        {(['de', 'en'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => updateLanguage(entry)}
            disabled={pending}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              language === entry
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {copy[entry]}
          </button>
        ))}
      </div>
    </div>
  );
}
