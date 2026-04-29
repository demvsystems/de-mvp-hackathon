'use client';

import { AgentActivity } from '@/components/scoreboard/agent-activity';

export function ActivityRail(): React.ReactElement {
  return (
    <aside className="block w-full px-6 pt-4 [grid-area:rail] xl:sticky xl:top-20 xl:self-start xl:px-0 xl:pt-10">
      <AgentActivity
        className="bg-background/95 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.35)] backdrop-blur"
        listClassName="max-h-[28rem] xl:max-h-[calc(100vh-9rem)]"
      />
    </aside>
  );
}
