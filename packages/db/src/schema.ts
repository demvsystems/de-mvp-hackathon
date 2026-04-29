import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

export const records = pgTable(
  'records',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    source: text('source').notNull(),
    title: text('title'),
    body: text('body'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull(),
    isDeleted: boolean('is_deleted').notNull().default(false),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('german', coalesce(title, '')), 'A') || setweight(to_tsvector('german', coalesce(body, '')), 'B')`,
    ),
  },
  (t) => [
    index('records_source_type').on(t.source, t.type),
    index('records_updated').on(t.updatedAt.desc()),
    index('records_search').using('gin', t.searchVector),
    index('records_payload_gin').using('gin', t.payload),
  ],
);

export const edges = pgTable(
  'edges',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    type: text('type').notNull(),
    source: text('source').notNull(),
    confidence: real('confidence').notNull().default(1.0),
    weight: real('weight').notNull().default(1.0),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    evidence: jsonb('evidence'),
  },
  (t) => [
    unique('edges_uniq').on(t.fromId, t.toId, t.type, t.source),
    index('edges_from')
      .on(t.fromId, t.type)
      .where(sql`valid_to IS NULL`),
    index('edges_to')
      .on(t.toId, t.type)
      .where(sql`valid_to IS NULL`),
    index('edges_source').on(t.source),
  ],
);

export const topics = pgTable(
  'topics',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    label: text('label'),
    description: text('description'),

    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull(),
    discoveredBy: text('discovered_by').notNull(),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    supersededBy: text('superseded_by'),

    memberCount: integer('member_count').notNull().default(0),
    sourceCount: integer('source_count').notNull().default(0),
    uniqueAuthors7d: integer('unique_authors_7d').notNull().default(0),
    firstActivityAt: timestamp('first_activity_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    velocity24h: integer('velocity_24h'),
    velocity7dAvg: real('velocity_7d_avg'),
    spread24h: integer('spread_24h'),
    activityTrend: text('activity_trend'),
    computedAt: timestamp('computed_at', { withTimezone: true }),

    stagnationSignalCount: integer('stagnation_signal_count').notNull().default(0),
    stagnationSeverity: text('stagnation_severity').notNull().default('none'),

    centroid: vector('centroid', { dimensions: 1536 }),

    payload: jsonb('payload').notNull().default({}),
  },
  (t) => [
    foreignKey({
      columns: [t.supersededBy],
      foreignColumns: [t.id],
      name: 'topics_superseded_by_fk',
    }),
    index('topics_status')
      .on(t.status)
      .where(sql`status = 'active'`),
    index('topics_activity')
      .on(t.lastActivityAt.desc())
      .where(sql`status = 'active'`),
    index('topics_centroid')
      .using('hnsw', t.centroid.op('vector_cosine_ops'))
      .where(sql`status = 'active' AND centroid IS NOT NULL`),
  ],
);

export const topicAssessments = pgTable(
  'topic_assessments',
  {
    topicId: text('topic_id').notNull(),
    assessor: text('assessor').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),

    character: text('character').notNull(),
    escalationScore: real('escalation_score').notNull(),
    reasoning: jsonb('reasoning').notNull(),
    triggeredBy: text('triggered_by'),
    traceId: text('trace_id'),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.assessor, t.assessedAt] }),
    index('topic_assessments_recent').on(t.topicId, t.assessedAt.desc()),
  ],
);

export const topicFeedback = pgTable(
  'topic_feedback',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    topicId: text('topic_id').notNull(),
    assessor: text('assessor').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    thumb: text('thumb'),
    rating: integer('rating'),
    correctedCharacter: text('corrected_character'),
    correctedEscalationScore: real('corrected_escalation_score'),
    note: text('note'),

    status: text('status').notNull().default('open'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('topic_feedback_topic').on(t.topicId, t.createdAt.desc()),
    index('topic_feedback_open')
      .on(t.status, t.createdAt.desc())
      .where(sql`status = 'open'`),
    index('topic_feedback_assessment').on(t.topicId, t.assessor, t.assessedAt),
  ],
);

export const guardrailEvents = pgTable(
  'guardrail_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    topicId: text('topic_id').notNull(),
    assessor: text('assessor').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    traceId: text('trace_id'),
    stage: text('stage').notNull(),
    ruleId: text('rule_id').notNull(),
    severity: text('severity').notNull(),
    decision: text('decision').notNull(),
    detail: text('detail').notNull(),
    recordIds: jsonb('record_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('open'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('guardrail_events_topic').on(t.topicId, t.createdAt.desc()),
    index('guardrail_events_open')
      .on(t.status, t.createdAt.desc())
      .where(sql`status = 'open'`),
    index('guardrail_events_trace').on(t.traceId),
  ],
);

export const goldenExampleCandidates = pgTable(
  'golden_example_candidates',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    feedbackId: text('feedback_id').notNull(),
    topicId: text('topic_id').notNull(),
    assessor: text('assessor').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    traceId: text('trace_id'),
    category: text('category').notNull().default('edge'),
    reason: text('reason').notNull(),
    note: text('note'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('open'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    unique('golden_example_candidates_feedback_uniq').on(t.feedbackId),
    index('golden_example_candidates_topic').on(t.topicId, t.createdAt.desc()),
    index('golden_example_candidates_open')
      .on(t.status, t.createdAt.desc())
      .where(sql`status = 'open'`),
  ],
);

export const reviewerSessions = pgTable(
  'reviewer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: text('topic_id').notNull(),
    assessor: text('assessor').notNull(),
    model: text('model').notNull(),
    messages: jsonb('messages').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reviewer_sessions_topic').on(t.topicId, t.updatedAt.desc())],
);

export const topicActionPlans = pgTable(
  'topic_action_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: text('topic_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    supersedesId: uuid('supersedes_id'),
    status: text('status').notNull().default('proposed'),
    plan: jsonb('plan').notNull(),
    rationale: text('rationale'),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    decisionKind: text('decision_kind'),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    decisionBy: text('decision_by'),
    modificationFeedback: text('modification_feedback'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    executorRunId: text('executor_run_id'),
    createdRecords: jsonb('created_records'),
    error: text('error'),
  },
  (t) => [
    foreignKey({
      columns: [t.sessionId],
      foreignColumns: [reviewerSessions.id],
      name: 'topic_action_plans_session_fk',
    }),
    foreignKey({
      columns: [t.supersedesId],
      foreignColumns: [t.id],
      name: 'topic_action_plans_supersedes_fk',
    }),
    index('topic_action_plans_topic').on(t.topicId, t.proposedAt.desc()),
    index('topic_action_plans_proposed')
      .on(t.proposedAt.desc())
      .where(sql`status = 'proposed'`),
  ],
);

export const companyPlaybook = pgTable('company_playbook', {
  id: text('id').primaryKey(),
  playbook: jsonb('playbook').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

export const embeddings = pgTable(
  'embeddings',
  {
    recordId: text('record_id').notNull(),
    chunkIdx: integer('chunk_idx').notNull().default(0),
    chunkText: text('chunk_text').notNull(),
    modelVersion: text('model_version').notNull(),
    vectorValue: vector('vector', { dimensions: 1536 }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recordId, t.chunkIdx, t.modelVersion] }),
    index('embeddings_vec_hnsw').using('hnsw', t.vectorValue.op('vector_cosine_ops')),
  ],
);

export const eventsArchive = pgTable(
  'events_archive',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    sourceEventId: text('source_event_id'),
    subjectKind: text('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    payload: jsonb('payload').notNull(),
    evidence: jsonb('evidence'),
    causationId: text('causation_id'),
    correlationId: text('correlation_id'),
  },
  (t) => [
    index('events_archive_subject').on(t.subjectKind, t.subjectId),
    index('events_archive_correlation')
      .on(t.correlationId)
      .where(sql`correlation_id IS NOT NULL`),
    index('events_archive_observed').on(t.observedAt),
  ],
);
