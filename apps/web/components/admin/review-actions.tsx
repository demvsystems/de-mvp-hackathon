'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { setFeedbackStatus } from '@/lib/actions/review-feedback';

interface Props {
  feedbackId: string;
}

export function ReviewActions({ feedbackId }: Props) {
  const [pending, startTransition] = useTransition();

  function act(status: 'reviewed' | 'dismissed'): void {
    startTransition(async () => {
      const result = await setFeedbackStatus({ id: feedbackId, status });
      if (result.ok) {
        toast.success(status === 'reviewed' ? 'Marked reviewed' : 'Dismissed');
      } else {
        toast.error(result.error ?? 'Failed to update');
      }
    });
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" disabled={pending} onClick={() => act('reviewed')}>
        Mark reviewed
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => act('dismissed')}>
        Dismiss
      </Button>
    </div>
  );
}
