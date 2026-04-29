import { publishCore } from '@repo/messaging';
import type { AgentEvent, AgentEventListener } from '../core';

export const AGENT_ACTIVITY_SUBJECT_PREFIX = 'agent.activity';

export type AgentActivityAgent = 'reviewer' | 'executor';

export interface AgentActivityEnvelope {
  readonly topic_id: string;
  readonly agent: AgentActivityAgent;
  readonly triggered_by: string;
  readonly emitted_at: string;
  readonly event: AgentEvent;
}

export function buildAgentActivityListener(args: {
  agent: AgentActivityAgent;
  topicId: string;
  triggeredBy: string;
}): AgentEventListener {
  const subject = `${AGENT_ACTIVITY_SUBJECT_PREFIX}.${args.topicId}`;

  return (event) => {
    const envelope: AgentActivityEnvelope = {
      topic_id: args.topicId,
      agent: args.agent,
      triggered_by: args.triggeredBy,
      emitted_at: new Date().toISOString(),
      event,
    };

    publishCore(subject, envelope).catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          msg: 'agent activity publish failed',
          agent: args.agent,
          topic_id: args.topicId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };
}
