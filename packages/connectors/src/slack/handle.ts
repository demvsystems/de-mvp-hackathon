import { edgeSource, type ConnectorOutput, type EdgeOutput, type RecordOutput } from '../core';
import {
  SlackChannelRow,
  SlackMessageRow,
  SlackUserRow,
  SlackWorkspaceRow,
  type SlackRow,
} from './schema';
import { SOURCE, channelId, messageId, userId, workspaceId } from './ids';

const EDGE_SOURCE = edgeSource(SOURCE);

export function handleRow(row: SlackRow): ConnectorOutput {
  switch (row.kind) {
    case 'workspace':
      return handleWorkspace(SlackWorkspaceRow.parse(row));
    case 'channel':
      return handleChannel(SlackChannelRow.parse(row));
    case 'user':
      return handleUser(SlackUserRow.parse(row));
    case 'message':
      return handleMessage(SlackMessageRow.parse(row));
  }
}

function handleWorkspace(r: SlackWorkspaceRow): ConnectorOutput {
  const id = workspaceId(r.team_id);
  const record: RecordOutput = {
    id,
    kind: 'workspace',
    source: SOURCE,
    occurred_at: r.occurred_at,
    source_event_id: null,
    title: r.name,
    body: null,
    payload: { team_id: r.team_id, name: r.name, domain: r.domain ?? null },
    created_at: r.occurred_at,
    updated_at: r.occurred_at,
  };
  return { records: [record], edges: [] };
}

function handleChannel(r: SlackChannelRow): ConnectorOutput {
  const id = channelId(r.team_id, r.channel_id);
  const record: RecordOutput = {
    id,
    kind: 'channel',
    source: SOURCE,
    occurred_at: r.occurred_at,
    source_event_id: null,
    title: r.name,
    body: null,
    payload: {
      team_id: r.team_id,
      channel_id: r.channel_id,
      name: r.name,
      is_private: r.is_private,
    },
    created_at: r.occurred_at,
    updated_at: r.occurred_at,
  };
  const edges: EdgeOutput[] = [
    {
      from_id: id,
      to_id: workspaceId(r.team_id),
      type: 'posted_in',
      source: EDGE_SOURCE,
      confidence: 1,
      weight: 1,
      valid_from: r.occurred_at,
      valid_to: null,
    },
  ];
  return { records: [record], edges };
}

function handleUser(r: SlackUserRow): ConnectorOutput {
  const id = userId(r.team_id, r.user_id);
  const record: RecordOutput = {
    id,
    kind: 'user',
    source: SOURCE,
    occurred_at: r.occurred_at,
    source_event_id: null,
    title: r.display_name ?? r.real_name,
    body: null,
    payload: {
      team_id: r.team_id,
      user_id: r.user_id,
      display_name: r.display_name,
      real_name: r.real_name,
      is_bot: r.is_bot,
      is_external: r.is_external,
    },
    created_at: r.occurred_at,
    updated_at: r.occurred_at,
  };
  return { records: [record], edges: [] };
}

function handleMessage(r: SlackMessageRow): ConnectorOutput {
  const id = messageId(r.team_id, r.channel_id, r.ts);
  const record: RecordOutput = {
    id,
    kind: 'message',
    source: SOURCE,
    occurred_at: r.occurred_at,
    source_event_id: `${r.team_id}.${r.channel_id}.${r.ts}`,
    title: null,
    body: r.text,
    payload: {
      workspace_id: r.team_id,
      channel_id: r.channel_id,
      ts: r.ts,
      thread_ts: r.thread_ts ?? null,
      author_id: r.user_id,
    },
    created_at: r.occurred_at,
    updated_at: r.occurred_at,
  };

  const edges: EdgeOutput[] = [
    {
      from_id: id,
      to_id: userId(r.team_id, r.user_id),
      type: 'authored_by',
      source: EDGE_SOURCE,
      confidence: 1,
      weight: 1,
      valid_from: r.occurred_at,
      valid_to: null,
    },
    {
      from_id: id,
      to_id: channelId(r.team_id, r.channel_id),
      type: 'posted_in',
      source: EDGE_SOURCE,
      confidence: 1,
      weight: 1,
      valid_from: r.occurred_at,
      valid_to: null,
    },
  ];

  // Per design: replies_to fires only when thread_ts !== ts (i.e. not the parent itself).
  if (r.thread_ts && r.thread_ts !== r.ts) {
    edges.push({
      from_id: id,
      to_id: messageId(r.team_id, r.channel_id, r.thread_ts),
      type: 'replies_to',
      source: EDGE_SOURCE,
      confidence: 1,
      weight: 1,
      valid_from: r.occurred_at,
      valid_to: null,
    });
  }

  return { records: [record], edges };
}
