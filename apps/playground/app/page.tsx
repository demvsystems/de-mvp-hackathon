import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="bg-background flex flex-1 flex-col items-center justify-center">
      <main className="flex w-full max-w-3xl flex-1 flex-col items-start gap-6 px-6 py-20">
        <h1 className="text-3xl leading-10 font-semibold tracking-tight text-black dark:text-zinc-50">
          Playground
        </h1>
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Build a UI here to generate data for <code className="font-mono">@repo/web</code>. Edit{' '}
          <code className="font-mono">app/page.tsx</code> to start.
        </p>

        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Fixture Generator</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              Inspect source templates and metadata for Jira, Slack, Upvoty, and Intercom.
            </p>
            <Link href="/fixture-generator" className={buttonVariants()}>
              Open
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
