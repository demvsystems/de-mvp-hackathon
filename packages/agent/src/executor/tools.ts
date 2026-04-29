import { randomUUID } from 'node:crypto';
import { db, schema } from '@repo/db';
import { z } from 'zod';
import type { ToolSpec } from '../core';
import { EXECUTOR_ID } from './output-schema';

interface ExecutorContext {
  readonly topicId: string;
  readonly actionPlanId: string;
  readonly createdRecordIds: string[];
  jiraKeyCounter: number;
}

const CreateJiraInput = z.object({
  project: z.string(),
  issue_type: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).optional(),
  parent_key: z.string().optional(),
});

const PostSlackInput = z.object({
  channel: z.string(),
  body: z.string(),
  thread_root_record_id: z.string().optional(),
  mentioned_record_ids: z.array(z.string()).optional(),
});

const ReplyIntercomInput = z.object({
  conversation_record_id: z.string(),
  body: z.string(),
  internal_note: z.boolean().optional(),
  mentioned_record_ids: z.array(z.string()).optional(),
});

function nextJiraKey(ctx: ExecutorContext, project: string): string {
  ctx.jiraKeyCounter += 1;
  return `${project}-A${String(ctx.jiraKeyCounter).padStart(3, '0')}`;
}

async function insertEdge(args: {
  fromId: string;
  toId: string;
  type: 'replies_to' | 'mentions';
  actionPlanId: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.edges)
    .values({
      fromId: args.fromId,
      toId: args.toId,
      type: args.type,
      source: EXECUTOR_ID,
      confidence: 1,
      weight: 1,
      validFrom: now,
      observedAt: now,
      evidence: { agent_authored: true, action_plan_id: args.actionPlanId },
    })
    .onConflictDoNothing();
}

export function executorTools(ctx: ExecutorContext): ToolSpec[] {
  return [
    {
      name: 'mock_create_jira_ticket',
      description:
        'Mock-create a Jira ticket. Inserts a `records` row with source="jira", agent_authored=true. Returns { record_id, jira_key } so subsequent calls can reference the ticket.',
      inputSchema: CreateJiraInput,
      async handler(input) {
        const recordId = `record:jira:agent:${randomUUID()}`;
        const jiraKey = nextJiraKey(ctx, input.project);
        const now = new Date();
        await db.insert(schema.records).values({
          id: recordId,
          source: 'jira',
          type: 'ticket',
          title: input.title,
          body: input.body,
          payload: {
            jira_key: jiraKey,
            project: input.project,
            issue_type: input.issue_type,
            labels: input.labels ?? [],
            parent_key: input.parent_key ?? null,
            agent_authored: true,
            action_plan_id: ctx.actionPlanId,
            topic_id: ctx.topicId,
          },
          createdAt: now,
          updatedAt: now,
          ingestedAt: now,
        });
        ctx.createdRecordIds.push(recordId);
        return { record_id: recordId, jira_key: jiraKey };
      },
    } satisfies ToolSpec<z.infer<typeof CreateJiraInput>, unknown>,
    {
      name: 'mock_post_slack_message',
      description:
        'Mock-post a Slack message. Inserts a `records` row with source="slack", agent_authored=true. If `thread_root_record_id` is given, also inserts a `replies_to` edge. If `mentioned_record_ids` is given, inserts `mentions` edges to each. Returns { record_id }.',
      inputSchema: PostSlackInput,
      async handler(input) {
        const recordId = `record:slack:agent:${randomUUID()}`;
        const now = new Date();
        await db.insert(schema.records).values({
          id: recordId,
          source: 'slack',
          type: 'chat_message',
          body: input.body,
          payload: {
            channel: input.channel,
            thread_root_record_id: input.thread_root_record_id ?? null,
            agent_authored: true,
            action_plan_id: ctx.actionPlanId,
            topic_id: ctx.topicId,
          },
          createdAt: now,
          updatedAt: now,
          ingestedAt: now,
        });
        ctx.createdRecordIds.push(recordId);
        if (input.thread_root_record_id) {
          await insertEdge({
            fromId: recordId,
            toId: input.thread_root_record_id,
            type: 'replies_to',
            actionPlanId: ctx.actionPlanId,
          });
        }
        for (const mentionId of input.mentioned_record_ids ?? []) {
          await insertEdge({
            fromId: recordId,
            toId: mentionId,
            type: 'mentions',
            actionPlanId: ctx.actionPlanId,
          });
        }
        return { record_id: recordId };
      },
    } satisfies ToolSpec<z.infer<typeof PostSlackInput>, unknown>,
    {
      name: 'mock_send_intercom_reply',
      description:
        'Mock-send an Intercom conversation reply. Inserts a `records` row with source="intercom", agent_authored=true, and a `replies_to` edge to the conversation_record_id. If `mentioned_record_ids` is given, also inserts `mentions` edges. Returns { record_id }.',
      inputSchema: ReplyIntercomInput,
      async handler(input) {
        const recordId = `record:intercom:agent:${randomUUID()}`;
        const now = new Date();
        await db.insert(schema.records).values({
          id: recordId,
          source: 'intercom',
          type: 'conversation_reply',
          body: input.body,
          payload: {
            conversation_record_id: input.conversation_record_id,
            internal_note: input.internal_note ?? false,
            agent_authored: true,
            action_plan_id: ctx.actionPlanId,
            topic_id: ctx.topicId,
          },
          createdAt: now,
          updatedAt: now,
          ingestedAt: now,
        });
        ctx.createdRecordIds.push(recordId);
        await insertEdge({
          fromId: recordId,
          toId: input.conversation_record_id,
          type: 'replies_to',
          actionPlanId: ctx.actionPlanId,
        });
        for (const mentionId of input.mentioned_record_ids ?? []) {
          await insertEdge({
            fromId: recordId,
            toId: mentionId,
            type: 'mentions',
            actionPlanId: ctx.actionPlanId,
          });
        }
        return { record_id: recordId };
      },
    } satisfies ToolSpec<z.infer<typeof ReplyIntercomInput>, unknown>,
  ];
}

export function makeExecutorContext(topicId: string, actionPlanId: string): ExecutorContext {
  return { topicId, actionPlanId, createdRecordIds: [], jiraKeyCounter: 0 };
}

export function getCreatedRecordIds(ctx: ExecutorContext): readonly string[] {
  return ctx.createdRecordIds;
}
