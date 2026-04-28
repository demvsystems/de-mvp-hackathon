import { sql } from '@repo/db';
import type {
  AssessmentCreatedPayload,
  EdgeObservedPayload,
  EmbeddingCreatedPayload,
  MessageContext,
  RecordIdPayload,
  RecordPayload,
  TopicArchivedPayload,
  TopicCreatedPayload,
  TopicSupersededPayload,
  TopicUpdatedPayload,
} from '@repo/messaging';

export async function handleRecordObserved(
  payload: RecordPayload,
  ctx: MessageContext,
): Promise<void> {
  if (payload.type === 'user') {
    // Pilot scope: no users table. Ack and skip.
    return;
  }

  await sql`
    INSERT INTO records (id, type, source, title, body, payload,
                         created_at, updated_at, ingested_at, is_deleted)
    VALUES (${payload.id}, ${payload.type}, ${payload.source},
            ${payload.title}, ${payload.body}, ${JSON.stringify(payload.payload)}::jsonb,
            ${payload.created_at}, ${payload.updated_at},
            ${ctx.envelope.observed_at}, false)
    ON CONFLICT (id) DO UPDATE
      SET title      = EXCLUDED.title,
          body       = EXCLUDED.body,
          payload    = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      WHERE records.updated_at <= EXCLUDED.updated_at
  `;
}

export async function handleRecordDeleted(
  payload: RecordIdPayload,
  ctx: MessageContext,
): Promise<void> {
  // Soft-delete and edge invalidation must be atomic.
  await sql.begin(async (tx) => {
    await tx`
      UPDATE records
         SET is_deleted = true, updated_at = ${ctx.envelope.occurred_at}
       WHERE id = ${payload.id}
         AND updated_at <= ${ctx.envelope.occurred_at}
    `;
    await tx`
      UPDATE edges
         SET valid_to = ${ctx.envelope.occurred_at}
       WHERE (from_id = ${payload.id} OR to_id = ${payload.id})
         AND valid_to IS NULL
    `;
  });
}

export async function handleEdgeObserved(
  payload: EdgeObservedPayload,
  ctx: MessageContext,
): Promise<void> {
  const evidence = ctx.envelope.evidence === null ? null : JSON.stringify(ctx.envelope.evidence);
  await sql`
    INSERT INTO edges (from_id, to_id, type, source, confidence, weight,
                       valid_from, valid_to, observed_at, evidence)
    VALUES (${payload.from_id}, ${payload.to_id}, ${payload.type}, ${payload.source},
            ${payload.confidence}, ${payload.weight},
            ${payload.valid_from}, ${payload.valid_to},
            ${ctx.envelope.observed_at},
            ${evidence}::jsonb)
    ON CONFLICT (from_id, to_id, type, source) DO UPDATE
      SET confidence  = EXCLUDED.confidence,
          weight      = EXCLUDED.weight,
          valid_to    = EXCLUDED.valid_to,
          evidence    = EXCLUDED.evidence,
          observed_at = EXCLUDED.observed_at
      WHERE edges.observed_at <= EXCLUDED.observed_at
  `;
}

export async function handleTopicCreated(
  payload: TopicCreatedPayload,
  ctx: MessageContext,
): Promise<void> {
  await sql`
    INSERT INTO topics (id, status, discovered_at, discovered_by, payload)
    VALUES (${payload.id}, 'active',
            ${ctx.envelope.occurred_at}, ${payload.discovered_by},
            ${JSON.stringify(payload.initial_centroid_summary)}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
}

// No trigger in pilot — kept ready for Phase-2 curator actions that rename or
// re-describe a topic. COALESCE preserves existing fields when payload is null.
export async function handleTopicUpdated(payload: TopicUpdatedPayload): Promise<void> {
  await sql`
    UPDATE topics
       SET label       = COALESCE(${payload.label}, topics.label),
           description = COALESCE(${payload.description}, topics.description)
     WHERE id = ${payload.id}
  `;
}

export async function handleTopicArchived(
  payload: TopicArchivedPayload,
  ctx: MessageContext,
): Promise<void> {
  await sql`
    UPDATE topics
       SET status = 'archived', archived_at = ${ctx.envelope.occurred_at}
     WHERE id = ${payload.id}
       AND status <> 'archived'
  `;
}

export async function handleTopicSuperseded(payload: TopicSupersededPayload): Promise<void> {
  await sql`
    UPDATE topics
       SET status = 'superseded', superseded_by = ${payload.superseded_by}
     WHERE id = ${payload.id}
       AND status <> 'superseded'
  `;
}

export async function handleEmbeddingCreated(payload: EmbeddingCreatedPayload): Promise<void> {
  const vectorLiteral = `[${payload.vector.join(',')}]`;
  await sql`
    INSERT INTO embeddings (record_id, chunk_idx, chunk_text, model_version, vector, generated_at)
    VALUES (${payload.record_id}, ${payload.chunk_idx}, ${payload.chunk_text}, ${payload.model_version},
            ${vectorLiteral}::vector, ${payload.generated_at})
    ON CONFLICT (record_id, chunk_idx, model_version) DO UPDATE
      SET chunk_text   = EXCLUDED.chunk_text,
          vector       = EXCLUDED.vector,
          generated_at = EXCLUDED.generated_at
      WHERE embeddings.generated_at <= EXCLUDED.generated_at
  `;
}

export async function handleAssessmentCreated(payload: AssessmentCreatedPayload): Promise<void> {
  await sql`
    INSERT INTO topic_assessments
      (topic_id, assessor, assessed_at, character, escalation_score, reasoning, triggered_by)
    VALUES
      (${payload.topic_id}, ${payload.assessor}, ${payload.assessed_at},
       ${payload.character}, ${payload.escalation_score},
       ${JSON.stringify(payload.reasoning)}::jsonb, ${payload.triggered_by})
    ON CONFLICT (topic_id, assessor, assessed_at) DO NOTHING
  `;
}
