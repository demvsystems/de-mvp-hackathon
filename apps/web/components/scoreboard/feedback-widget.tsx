'use client';

import { useState, useTransition } from 'react';
import { ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { submitTopicFeedback } from '@/lib/actions/topic-feedback';
import type { TopicFeedbackInput } from '@/lib/topic-feedback';
import type { Character } from '@/lib/types';
import { cn } from '@/lib/utils';

const characters: Character[] = ['attention', 'opportunity', 'noteworthy', 'calm'];

interface Props {
  topicId: string;
  assessor: string;
  assessedAt: string;
  traceId: string | null;
  currentCharacter: Character;
  currentEscalationScore: number;
}

export function FeedbackWidget({
  topicId,
  assessor,
  assessedAt,
  traceId,
  currentCharacter,
  currentEscalationScore,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [correctedCharacter, setCorrectedCharacter] = useState<Character | ''>('');
  const [correctedScore, setCorrectedScore] = useState<string>('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
        Thanks — feedback recorded.{' '}
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            setThumb(null);
            setRating(null);
            setCorrectedCharacter('');
            setCorrectedScore('');
            setNote('');
            setExpanded(false);
          }}
          className="hover:text-foreground underline underline-offset-2"
        >
          submit another
        </button>
        .
      </div>
    );
  }

  function submit(payload: Partial<TopicFeedbackInput> = {}): void {
    const parsedScore = correctedScore.trim() === '' ? null : Number(correctedScore);
    const input: TopicFeedbackInput = {
      topic_id: topicId,
      assessor,
      assessed_at: assessedAt,
      trace_id: traceId,
      thumb,
      rating,
      corrected_character: correctedCharacter === '' ? null : correctedCharacter,
      corrected_escalation_score:
        parsedScore !== null && Number.isFinite(parsedScore) ? parsedScore : null,
      note: note.trim() || null,
      ...payload,
    };
    startTransition(async () => {
      const result = await submitTopicFeedback(input);
      if (result.ok) {
        setSubmitted(true);
        toast.success('Feedback recorded');
      } else {
        toast.error(result.error ?? 'Failed to submit feedback');
      }
    });
  }

  function quickThumb(value: 'up' | 'down'): void {
    setThumb(value);
    if (!expanded) {
      submit({ thumb: value });
    }
  }

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Was this assessment useful?</span>
          <Button
            type="button"
            size="icon-sm"
            variant={thumb === 'up' ? 'default' : 'outline'}
            disabled={pending}
            aria-pressed={thumb === 'up'}
            aria-label="Thumbs up"
            onClick={() => quickThumb('up')}
          >
            <ThumbsUp />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant={thumb === 'down' ? 'destructive' : 'outline'}
            disabled={pending}
            aria-pressed={thumb === 'down'}
            aria-label="Thumbs down"
            onClick={() => quickThumb('down')}
          >
            <ThumbsDown />
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
          {expanded ? 'less' : 'add details'}
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-muted-foreground text-xs tracking-wide uppercase">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={pending}
                  onClick={() => setRating(rating === n ? null : n)}
                  aria-pressed={rating !== null && rating >= n}
                  className={cn(
                    'rounded p-1 transition-colors',
                    rating !== null && rating >= n
                      ? 'text-yellow-500'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-label={`Rate ${n}`}
                >
                  <Star
                    className="size-5"
                    fill={rating !== null && rating >= n ? 'currentColor' : 'none'}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="corrected-character"
                className="text-muted-foreground text-xs tracking-wide uppercase"
              >
                Correct character (was {currentCharacter})
              </label>
              <select
                id="corrected-character"
                value={correctedCharacter}
                disabled={pending}
                onChange={(e) => setCorrectedCharacter(e.target.value as Character | '')}
                className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
              >
                <option value="">— no change —</option>
                {characters.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="corrected-score"
                className="text-muted-foreground text-xs tracking-wide uppercase"
              >
                Correct escalation 0–1 (was {currentEscalationScore.toFixed(2)})
              </label>
              <Input
                id="corrected-score"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={correctedScore}
                disabled={pending}
                onChange={(e) => setCorrectedScore(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="feedback-note"
              className="text-muted-foreground text-xs tracking-wide uppercase"
            >
              Note (optional)
            </label>
            <textarea
              id="feedback-note"
              value={note}
              disabled={pending}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="What was wrong, missing, or right?"
              className="border-input bg-background placeholder:text-muted-foreground rounded-lg border px-2.5 py-2 text-sm outline-none focus-visible:ring-3"
            />
          </div>

          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={pending} onClick={() => submit()}>
              Submit feedback
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
