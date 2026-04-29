import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PlaybookEditor } from '@/components/scoreboard/playbook-editor';
import { getPlaybook } from '@/lib/from-db-playbook';

export default async function PlaybookPage() {
  const row = await getPlaybook();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        back to triage
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Company Playbook</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Steuert, was der Reviewer-Agent als Action-Plan vorschlägt: Slack-Channels, Jira-Projekte,
          Cross-Reference-Regeln, Tonalität pro Kanal. Wird bei jedem Review in den System-Prompt
          geladen.
        </p>
      </header>

      {row ? (
        <PlaybookEditor
          initialJson={JSON.stringify(row.playbook, null, 2)}
          initialVersion={row.version}
          initialUpdatedAt={row.updated_at}
          initialUpdatedBy={row.updated_by}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Kein Playbook gefunden. Migration <code>0004_*</code> seedet einen Default — bitte{' '}
          <code>pnpm db:migrate</code> ausführen.
        </p>
      )}
    </div>
  );
}
