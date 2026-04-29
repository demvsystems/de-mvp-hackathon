'use client';

import { useState, useTransition } from 'react';
import { Check, Edit2, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { approveActionPlan, modifyActionPlan, rejectActionPlan } from '@/lib/actions/action-plans';
import type { Language } from '@/lib/language';
import type { ActionPlanRow } from '@/lib/from-db-action-plans';
import { cn } from '@/lib/utils';

interface Props {
  plans: ActionPlanRow[];
  language: Language;
}

const STATUS_TONE: Record<ActionPlanRow['status'], string> = {
  proposed: 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  approved: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-zinc-500/50 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  superseded: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  executing: 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  executed: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

function getStatusLabel(status: ActionPlanRow['status'], language: Language): string {
  if (language === 'de') {
    return {
      proposed: 'Vorschlag',
      approved: 'Genehmigt',
      rejected: 'Abgelehnt',
      superseded: 'Überarbeitet',
      executing: 'Wird ausgeführt',
      executed: 'Ausgeführt',
      failed: 'Fehlgeschlagen',
    }[status];
  }

  return {
    proposed: 'Proposed',
    approved: 'Approved',
    rejected: 'Rejected',
    superseded: 'Superseded',
    executing: 'Executing',
    executed: 'Executed',
    failed: 'Failed',
  }[status];
}

export function ActionPlanCard({ plans, language }: Props) {
  if (plans.length === 0) return null;
  const active = plans[0]!;
  const history = plans.slice(1);
  const proposedText = language === 'de' ? 'vorgeschlagen' : 'proposed';

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-base font-medium">Action Plan</h2>
        <span className="text-muted-foreground text-xs">
          {getStatusLabel(active.status, language)} · {proposedText}{' '}
          {formatDateTime(active.proposed_at)}
        </span>
      </div>

      <PlanCard plan={active} interactive={active.status === 'proposed'} language={language} />

      {history.length > 0 ? <PlanHistory history={history} language={language} /> : null}
    </section>
  );
}

function PlanCard({
  plan,
  interactive,
  language,
}: {
  plan: ActionPlanRow;
  interactive: boolean;
  language: Language;
}) {
  const [pending, startTransition] = useTransition();
  const [showModifyBox, setShowModifyBox] = useState(false);
  const [feedback, setFeedback] = useState('');

  const onApprove = () => {
    startTransition(async () => {
      const r = await approveActionPlan({ plan_id: plan.id });
      if (r.ok) {
        toast.success(
          language === 'de'
            ? 'Plan genehmigt — Executor läuft.'
            : 'Plan approved; executor started.',
        );
      } else {
        toast.error(r.error ?? 'approve failed');
      }
    });
  };

  const onReject = () => {
    startTransition(async () => {
      const r = await rejectActionPlan({ plan_id: plan.id });
      if (r.ok) toast.success(language === 'de' ? 'Plan abgelehnt.' : 'Plan rejected.');
      else toast.error(r.error ?? 'reject failed');
    });
  };

  const onModify = () => {
    if (feedback.trim().length === 0) {
      toast.error(language === 'de' ? 'Bitte Feedback eingeben.' : 'Please enter feedback.');
      return;
    }
    startTransition(async () => {
      const r = await modifyActionPlan({ plan_id: plan.id, feedback: feedback.trim() });
      if (r.ok) {
        toast.success(
          language === 'de'
            ? 'Modifikation angefordert — Reviewer überarbeitet.'
            : 'Revision requested; reviewer is updating the plan.',
        );
        setShowModifyBox(false);
        setFeedback('');
      } else {
        toast.error(r.error ?? 'modify failed');
      }
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge className={cn('rounded-md border px-2 py-0.5', STATUS_TONE[plan.status])}>
            {getStatusLabel(plan.status, language)}
          </Badge>
          {plan.supersedes_id ? (
            <span className="text-muted-foreground text-xs">
              {language === 'de' ? 'überarbeitet aus' : 'supersedes'}{' '}
              {plan.supersedes_id.slice(0, 8)}
            </span>
          ) : null}
          <code className="text-muted-foreground/70 ml-auto font-mono text-[11px]">
            {plan.id.slice(0, 8)}
          </code>
        </div>

        {plan.rationale ? <p className="text-sm leading-relaxed">{plan.rationale}</p> : null}

        <ol className="flex flex-col gap-3">
          {plan.plan.actions.map((action, idx) => (
            <li
              key={idx}
              className="border-border bg-muted/20 flex flex-col gap-1.5 rounded-md border-l-2 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground tabular-nums">{idx + 1}.</span>
                <ActionKindBadge kind={action.kind} />
                <ActionTargetSummary action={action} />
              </div>
              {'body' in action ? <p className="text-sm leading-relaxed">{action.body}</p> : null}
              {action.kind === 'create_jira_ticket' ? (
                <p className="font-heading text-sm">{action.title}</p>
              ) : null}
            </li>
          ))}
        </ol>

        {plan.plan.cross_references.length > 0 ? (
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <span className="tracking-wide uppercase">
              {language === 'de' ? 'Querverweise' : 'Cross-references'}
            </span>
            <ul className="flex flex-col gap-0.5">
              {plan.plan.cross_references.map((cr, i) => (
                <li key={i} className="font-mono">
                  Action {cr.from_action_idx + 1} → Action {cr.to_action_idx + 1} ({cr.type})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan.status === 'executed' && plan.created_records ? (
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <span className="tracking-wide uppercase">
              {language === 'de' ? 'Erstellte Records' : 'Created records'}
            </span>
            <ul className="flex flex-wrap gap-1.5">
              {plan.created_records.map((id) => (
                <li
                  key={id}
                  className="bg-muted text-foreground/80 rounded-md px-2 py-1 font-mono text-[11px]"
                >
                  {id}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan.error ? (
          <p className="border-l-2 border-l-red-500/50 pl-3 text-sm text-red-700 dark:text-red-300">
            {plan.error}
          </p>
        ) : null}

        {interactive ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            {!showModifyBox ? (
              <div className="flex gap-2">
                <Button onClick={onApprove} disabled={pending} size="sm">
                  {pending ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-1 size-3.5" />
                  )}
                  {language === 'de' ? 'Genehmigen' : 'Approve'}
                </Button>
                <Button
                  onClick={() => setShowModifyBox(true)}
                  disabled={pending}
                  size="sm"
                  variant="outline"
                >
                  <Edit2 className="mr-1 size-3.5" />
                  {language === 'de' ? 'Überarbeiten' : 'Modify'}
                </Button>
                <Button
                  onClick={onReject}
                  disabled={pending}
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                >
                  <X className="mr-1 size-3.5" />
                  {language === 'de' ? 'Ablehnen' : 'Reject'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={
                    language === 'de'
                      ? 'Was soll am Plan geändert werden? (z.B. anderen Slack-Channel, Body-Text anpassen, Aktion entfernen...)'
                      : 'What should change in the plan? For example: different Slack channel, adjust the message body, remove an action...'
                  }
                  rows={3}
                  className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button onClick={onModify} disabled={pending} size="sm">
                    {pending ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : (
                      <Edit2 className="mr-1 size-3.5" />
                    )}
                    {language === 'de' ? 'Plan überarbeiten lassen' : 'Request revision'}
                  </Button>
                  <Button
                    onClick={() => {
                      setShowModifyBox(false);
                      setFeedback('');
                    }}
                    disabled={pending}
                    size="sm"
                    variant="ghost"
                  >
                    {language === 'de' ? 'Abbrechen' : 'Cancel'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PlanHistory({ history, language }: { history: ActionPlanRow[]; language: Language }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {language === 'de' ? 'Verlauf' : 'History'} ({history.length})
      </button>
      {open ? (
        <ul className="flex flex-col gap-2">
          {history.map((p) => (
            <li key={p.id}>
              <Card>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className={cn('rounded-md border px-2 py-0.5', STATUS_TONE[p.status])}>
                      {getStatusLabel(p.status, language)}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(p.proposed_at)}
                    </span>
                    <code className="text-muted-foreground/70 ml-auto font-mono text-[11px]">
                      {p.id.slice(0, 8)}
                    </code>
                  </div>
                  {p.rationale ? (
                    <p className="text-muted-foreground text-sm">{p.rationale}</p>
                  ) : null}
                  {p.modification_feedback ? (
                    <p className="border-l-2 border-l-amber-500/50 pl-3 text-sm leading-relaxed text-amber-700 italic dark:text-amber-300">
                      {language === 'de' ? 'User-Feedback' : 'User feedback'}:{' '}
                      {p.modification_feedback}
                    </p>
                  ) : null}
                  {p.error ? (
                    <p className="border-l-2 border-l-red-500/50 pl-3 text-xs text-red-700 dark:text-red-300">
                      {p.error}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionKindBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; className: string }> = {
    create_jira_ticket: {
      label: 'Jira',
      className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/40',
    },
    post_slack_message: {
      label: 'Slack',
      className: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/40',
    },
    reply_intercom: {
      label: 'Intercom',
      className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/40',
    },
    no_action: {
      label: 'No-Op',
      className: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/40',
    },
  };
  const entry = map[kind] ?? map['no_action']!;
  return (
    <span
      className={cn(
        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase',
        entry.className,
      )}
    >
      {entry.label}
    </span>
  );
}

function ActionTargetSummary({ action }: { action: ActionPlanRow['plan']['actions'][number] }) {
  if (action.kind === 'create_jira_ticket') {
    return (
      <span className="text-muted-foreground font-mono text-[11px]">
        {action.project} / {action.issue_type}
      </span>
    );
  }
  if (action.kind === 'post_slack_message') {
    return (
      <span className="text-muted-foreground font-mono text-[11px]">
        {action.channel}
        {action.placement.mode === 'thread' ? ' · thread' : ' · channel'}
      </span>
    );
  }
  if (action.kind === 'reply_intercom') {
    return (
      <span className="text-muted-foreground font-mono text-[11px]">
        → {action.conversation_record_id}
      </span>
    );
  }
  return null;
}
