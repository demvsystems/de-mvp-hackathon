'use client';

import { useState, useTransition } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { savePlaybook } from '@/lib/actions/playbook';

interface Props {
  initialJson: string;
  initialVersion: number;
  initialUpdatedAt: string;
  initialUpdatedBy: string | null;
}

export function PlaybookEditor({
  initialJson,
  initialVersion,
  initialUpdatedAt,
  initialUpdatedBy,
}: Props) {
  const [text, setText] = useState(initialJson);
  const [version, setVersion] = useState(initialVersion);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [updatedBy, setUpdatedBy] = useState(initialUpdatedBy);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    startTransition(async () => {
      const r = await savePlaybook({ playbook_json: text });
      if (r.ok && r.version !== undefined) {
        toast.success(`Playbook gespeichert (v${r.version})`);
        setVersion(r.version);
        setUpdatedAt(new Date().toISOString());
        setUpdatedBy('web:human');
      } else {
        toast.error(r.error ?? 'save failed');
      }
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Version {version}</span>
          <span className="text-muted-foreground">
            zuletzt {new Date(updatedAt).toISOString().slice(0, 16).replace('T', ' ')}Z
            {updatedBy ? ` · ${updatedBy}` : ''}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={28}
          spellCheck={false}
          className="border-border bg-background w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
        />
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={pending} size="sm">
            {pending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 size-3.5" />
            )}
            Speichern
          </Button>
          <span className="text-muted-foreground self-center text-xs">
            Beim Speichern wird gegen das Playbook-Schema validiert.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
