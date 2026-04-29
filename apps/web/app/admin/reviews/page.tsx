import Link from 'next/link';
import { ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { GuardrailReviewActions } from '@/components/admin/guardrail-review-actions';
import { ReviewActions } from '@/components/admin/review-actions';
import {
  listOpenFeedback,
  listOpenGuardrailEvents,
  type OpenFeedback,
  type OpenGuardrailEvent,
} from '@/lib/from-db-feedback';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

function langfuseTraceUrl(traceId: string): string | null {
  const base = process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'];
  const projectId = process.env['LANGFUSE_PROJECT_ID'];
  if (!base) return null;
  if (projectId) return `${base}/project/${projectId}/traces/${traceId}`;
  return `${base}/traces/${traceId}`;
}

export default async function ReviewsPage(): Promise<React.ReactElement> {
  const [items, guardrailEvents] = await Promise.all([
    listOpenFeedback(),
    listOpenGuardrailEvents(),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold">Review queue</h1>
        <p className="text-muted-foreground text-sm">
          Negative feedback and guardrail trips awaiting review. Mark reviewed once acted on;
          dismiss if not actionable.
        </p>
      </div>

      {items.length === 0 && guardrailEvents.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground text-sm">Queue is empty.</CardContent>
        </Card>
      ) : null}

      {items.length > 0 ? (
        <section className="mb-8">
          <div className="mb-3">
            <h2 className="font-medium">User feedback</h2>
          </div>
          <ul className="flex flex-col gap-3">
            {items.map((f) => (
              <FeedbackRow key={f.id} feedback={f} />
            ))}
          </ul>
        </section>
      ) : null}

      {guardrailEvents.length > 0 ? (
        <section>
          <div className="mb-3">
            <h2 className="font-medium">Guardrail events</h2>
          </div>
          <ul className="flex flex-col gap-3">
            {guardrailEvents.map((event) => (
              <GuardrailEventRow key={event.id} event={event} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function FeedbackRow({ feedback }: { feedback: OpenFeedback }): React.ReactElement {
  const traceUrl = feedback.trace_id ? langfuseTraceUrl(feedback.trace_id) : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/topics/${encodeURIComponent(feedback.topic_id)}`}
                className="font-medium hover:underline"
              >
                {feedback.topic_label ?? feedback.topic_id}
              </Link>
              {feedback.thumb === 'up' ? (
                <ThumbsUp className="text-muted-foreground size-4" />
              ) : feedback.thumb === 'down' ? (
                <ThumbsDown className="text-destructive size-4" />
              ) : null}
              {feedback.rating !== null ? (
                <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
                  rating {feedback.rating}/5
                </span>
              ) : null}
            </div>
            <span className="text-muted-foreground text-xs">
              feedback {fmt(feedback.created_at)} · assessment {fmt(feedback.assessed_at)} ·{' '}
              {feedback.assessor}
            </span>
          </div>
          <ReviewActions feedbackId={feedback.id} />
        </div>

        {feedback.corrected_character !== null || feedback.corrected_escalation_score !== null ? (
          <div className="bg-muted/40 flex flex-wrap gap-x-6 gap-y-1 rounded-md px-3 py-2 text-xs">
            {feedback.corrected_character !== null ? (
              <span>
                <span className="text-muted-foreground">character:</span>{' '}
                <span className="line-through opacity-60">{feedback.current_character ?? '?'}</span>{' '}
                → <span className="font-medium">{feedback.corrected_character}</span>
              </span>
            ) : null}
            {feedback.corrected_escalation_score !== null ? (
              <span>
                <span className="text-muted-foreground">escalation:</span>{' '}
                <span className="line-through opacity-60">
                  {feedback.current_escalation_score?.toFixed(2) ?? '?'}
                </span>{' '}
                →{' '}
                <span className="font-medium">
                  {feedback.corrected_escalation_score.toFixed(2)}
                </span>
              </span>
            ) : null}
          </div>
        ) : null}

        {feedback.note ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{feedback.note}</p>
        ) : null}

        {traceUrl ? (
          <a
            href={traceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <ExternalLink className="size-3" /> open trace in Langfuse
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GuardrailEventRow({ event }: { event: OpenGuardrailEvent }): React.ReactElement {
  const traceUrl = event.trace_id ? langfuseTraceUrl(event.trace_id) : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/topics/${encodeURIComponent(event.topic_id)}`}
                className="font-medium hover:underline"
              >
                {event.topic_label ?? event.topic_id}
              </Link>
              <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{event.stage}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  event.severity === 'error'
                    ? 'bg-destructive/15 text-destructive'
                    : event.severity === 'warn'
                      ? 'bg-amber-500/15 text-amber-700'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {event.severity}
              </span>
              <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{event.decision}</span>
            </div>
            <span className="text-muted-foreground text-xs">
              rule {event.rule_id} · assessment {fmt(event.assessed_at)} · logged{' '}
              {fmt(event.created_at)} · {event.assessor}
            </span>
          </div>
          <GuardrailReviewActions eventId={event.id} />
        </div>

        <p className="text-sm leading-relaxed whitespace-pre-wrap">{event.detail}</p>

        {event.record_ids.length > 0 ? (
          <div className="bg-muted/40 rounded-md px-3 py-2 text-xs">
            records: {event.record_ids.join(', ')}
          </div>
        ) : null}

        {traceUrl ? (
          <a
            href={traceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <ExternalLink className="size-3" /> open trace in Langfuse
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
