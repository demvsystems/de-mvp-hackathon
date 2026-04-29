'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

interface Props {
  topicId: string;
  fixtureId: string;
}

interface TriggerResponse {
  topic_id?: string;
  started_worker?: boolean;
  worker_state?: string;
  event_id?: string;
  error?: string;
}

export function GuardrailDemoTrigger({ topicId, fixtureId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function trigger(): void {
    startTransition(async () => {
      const res = await fetch(
        `/api/admin/workers/reviewer/topics/${encodeURIComponent(topicId)}/run`,
        {
          method: 'POST',
        },
      );
      const body = (await res.json()) as TriggerResponse;

      if (!res.ok) {
        toast.error(body.error ?? 'Failed to trigger reviewer');
        return;
      }

      toast.success(
        body.started_worker
          ? `Reviewer started and queued ${fixtureId}`
          : `Queued ${fixtureId} for reviewer`,
      );

      router.refresh();
      window.setTimeout(() => router.refresh(), 3000);
      window.setTimeout(() => router.refresh(), 9000);
    });
  }

  return (
    <Button size="sm" disabled={pending} onClick={trigger}>
      {pending ? 'Running…' : 'Run reviewer now'}
    </Button>
  );
}
