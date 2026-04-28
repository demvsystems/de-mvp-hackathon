import {
  EmbeddingCreated,
  publish,
  type MessageContext,
  type RecordPayload,
} from '@repo/messaging';
import { createEmbedder, type Embedder } from './client';

const embedder: Embedder = createEmbedder();
const MODEL_VERSION = `${embedder.modelTag}:body-only:v1`;
const MAX_CHARS = Number(process.env['EMBEDDING_MAX_CHARS'] ?? 24000);

export async function embedRecordBodyOnly(
  payload: RecordPayload,
  ctx: MessageContext,
): Promise<void> {
  const text = [payload.title, payload.body].filter((s): s is string => Boolean(s)).join('\n\n');
  if (text.length === 0) return;

  const truncated = text.slice(0, MAX_CHARS);
  const vector = await embedder.embed(truncated);
  const generatedAt = new Date().toISOString();

  await publish(EmbeddingCreated, {
    source: 'embedder:v1',
    occurred_at: generatedAt,
    subject_id: `embedding:${payload.id}:0:${MODEL_VERSION}`,
    payload: {
      record_id: payload.id,
      chunk_idx: 0,
      chunk_text: truncated,
      model_version: MODEL_VERSION,
      vector,
      generated_at: generatedAt,
    },
    causation_id: ctx.envelope.event_id,
  });
}
