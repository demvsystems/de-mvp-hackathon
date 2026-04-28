import { read } from '@repo/db';
import type { ToolSpec } from '@repo/agent-core';

export const reviewerTools: ToolSpec[] = [
  {
    name: 'get_topics',
    description:
      'Fetch topic metadata, activity metrics (member_count, source_count, velocity, trend, stagnation), and the most recent assessments for one or more topic IDs. Always the first call when reviewing a topic — gives shape and prior context.',
    inputSchema: read.GetTopicsInput,
    handler: read.getTopics,
  } satisfies ToolSpec<read.GetTopicsInput, unknown>,
  {
    name: 'get_records',
    description:
      "List records matching filters with full body text. Use `topic_id` to fetch a topic's members. Use `exclude_ids` to skip records already covered by a prior summary. `sort_by` defaults to created_at desc (newest first). `ids` filter is for hydrating specific known IDs.",
    inputSchema: read.GetRecordsInput,
    handler: read.getRecords,
  } satisfies ToolSpec<read.GetRecordsInput, unknown>,
  {
    name: 'get_neighbors',
    description:
      'Walk the edge graph from one or more anchor record IDs. Use `edge_types: ["replies_to"]` with depth>1 to reconstruct a Slack thread. Use `edge_types: ["mentions"]` to find cross-source references. Use `edge_types: ["authored_by", "posted_in"]` to surface authorship/channel context.',
    inputSchema: read.GetNeighborsInput,
    handler: read.getNeighbors,
  } satisfies ToolSpec<read.GetNeighborsInput, unknown>,
  {
    name: 'find_similar',
    description:
      'Embedding-based nearest-neighbor lookup over records. Returns records semantically similar to the anchor IDs, ranked by cosine similarity. Useful for catching cross-topic resonance the clusterer missed. May return [] when embeddings are not yet populated.',
    inputSchema: read.FindSimilarInput,
    handler: read.findSimilar,
  } satisfies ToolSpec<read.FindSimilarInput, unknown>,
];
