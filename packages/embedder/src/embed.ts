import {
  EmbeddingCreatedBodyOnly,
  EmbeddingCreatedWithNeighbors,
  publish,
  type MessageContext,
  type RecordPayload,
} from '@repo/messaging';
import { createEmbedder, type Embedder } from './client';
import { loadStructuralNeighbors, type NeighborBlock, type StructuralNeighbors } from './neighbors';

const MAX_CHARS = Number(process.env['EMBEDDING_MAX_CHARS'] ?? 24000);
const NEIGHBOR_BUDGET_FLOOR = 200;
const NEIGHBOR_BLOCK_MIN_CHARS = 80;
const SECTION_SEPARATOR = '\n\n--- context ---\n\n';

interface CachedEmbedder {
  embedder: Embedder;
  modelVersion: string;
}

const caches: Record<'body-only' | 'with-neighbors', CachedEmbedder | null> = {
  'body-only': null,
  'with-neighbors': null,
};

function get(strategy: 'body-only' | 'with-neighbors'): CachedEmbedder {
  const cached = caches[strategy];
  if (cached) return cached;
  const embedder = createEmbedder();
  const fresh: CachedEmbedder = {
    embedder,
    modelVersion: `${embedder.modelTag}:${strategy}:v1`,
  };
  caches[strategy] = fresh;
  return fresh;
}

export async function embedRecordBodyOnly(
  payload: RecordPayload,
  ctx: MessageContext,
): Promise<void> {
  const text = nodeText(payload);
  if (text.length === 0) return;

  const { embedder, modelVersion } = get('body-only');
  const truncated = text.slice(0, MAX_CHARS);
  const vector = await embedder.embed(truncated);
  const generatedAt = new Date().toISOString();

  await publish(EmbeddingCreatedBodyOnly, {
    source: 'embedder:v1',
    occurred_at: generatedAt,
    subject_id: `embedding:${payload.id}:0:${modelVersion}`,
    payload: {
      record_id: payload.id,
      chunk_idx: 0,
      chunk_text: truncated,
      model_version: modelVersion,
      vector,
      generated_at: generatedAt,
    },
    causation_id: ctx.envelope.event_id,
  });
}

export async function embedRecordWithNeighbors(
  payload: RecordPayload,
  ctx: MessageContext,
): Promise<void> {
  const node = nodeText(payload);
  if (node.length === 0) return;

  const remaining = MAX_CHARS - node.length;
  const neighbors =
    remaining >= NEIGHBOR_BUDGET_FLOOR ? await loadStructuralNeighbors(payload.id) : empty();
  const text = buildWithNeighborsText(node, neighbors, remaining);

  const { embedder, modelVersion } = get('with-neighbors');
  const truncated = text.slice(0, MAX_CHARS);
  const vector = await embedder.embed(truncated);
  const generatedAt = new Date().toISOString();

  await publish(EmbeddingCreatedWithNeighbors, {
    source: 'embedder:v1',
    occurred_at: generatedAt,
    subject_id: `embedding:${payload.id}:0:${modelVersion}`,
    payload: {
      record_id: payload.id,
      chunk_idx: 0,
      chunk_text: truncated,
      model_version: modelVersion,
      vector,
      generated_at: generatedAt,
    },
    causation_id: ctx.envelope.event_id,
  });
}

function nodeText(payload: RecordPayload): string {
  return [payload.title, payload.body].filter((s): s is string => Boolean(s)).join('\n\n');
}

function empty(): StructuralNeighbors {
  return { threadParent: null, references: [], recentComments: [] };
}

// Greedy fill: node text first, then thread parent, recent comments, references —
// each block trimmed to fit the remaining budget. Bodies < NEIGHBOR_BLOCK_MIN_CHARS
// are dropped rather than emitting a stub.
function buildWithNeighborsText(
  node: string,
  neighbors: StructuralNeighbors,
  initialRemaining: number,
): string {
  const ordered: NeighborBlock[] = [
    ...(neighbors.threadParent ? [neighbors.threadParent] : []),
    ...neighbors.recentComments,
    ...neighbors.references,
  ];

  const out: string[] = [node];
  let remaining = initialRemaining;
  for (const block of ordered) {
    if (remaining < NEIGHBOR_BLOCK_MIN_CHARS + SECTION_SEPARATOR.length) break;
    const formatted = formatBlock(block, remaining - SECTION_SEPARATOR.length);
    if (!formatted) continue;
    out.push(SECTION_SEPARATOR);
    out.push(formatted);
    remaining -= SECTION_SEPARATOR.length + formatted.length;
  }
  return out.join('');
}

function formatBlock(block: NeighborBlock, budget: number): string | null {
  const head =
    block.relation === 'thread_parent'
      ? '[thread parent]'
      : block.relation === 'recent_comment'
        ? '[recent comment]'
        : '[references]';
  const body = [block.title, block.body].filter((s): s is string => Boolean(s)).join('\n');
  if (body.length === 0) return null;
  const headerLen = head.length + 1; // +1 for newline
  const available = Math.max(0, budget - headerLen);
  const trimmed = body.slice(0, available);
  // Only enforce the floor when truncation actually happened — a genuinely
  // short comment is worth including in full; only reject hard-truncated stubs.
  if (trimmed.length < body.length && trimmed.length < NEIGHBOR_BLOCK_MIN_CHARS) return null;
  return `${head}\n${trimmed}`;
}
