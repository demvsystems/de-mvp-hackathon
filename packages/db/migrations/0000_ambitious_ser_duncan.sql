CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "edges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence" jsonb,
	CONSTRAINT "edges_uniq" UNIQUE("from_id","to_id","type","source")
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"record_id" text NOT NULL,
	"chunk_idx" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"model_version" text NOT NULL,
	"vector" vector(1024) NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "embeddings_record_id_chunk_idx_model_version_pk" PRIMARY KEY("record_id","chunk_idx","model_version")
);
--> statement-breakpoint
CREATE TABLE "events_archive" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"evidence" jsonb,
	"causation_id" text,
	"correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"title" text,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('german', coalesce(title, '')), 'A') || setweight(to_tsvector('german', coalesce(body, '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "topic_assessments" (
	"topic_id" text NOT NULL,
	"assessor" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"character" text NOT NULL,
	"escalation_score" real NOT NULL,
	"reasoning" jsonb NOT NULL,
	"triggered_by" text,
	CONSTRAINT "topic_assessments_topic_id_assessor_assessed_at_pk" PRIMARY KEY("topic_id","assessor","assessed_at")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"label" text,
	"description" text,
	"discovered_at" timestamp with time zone NOT NULL,
	"discovered_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"superseded_by" text,
	"member_count" integer DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"unique_authors_7d" integer DEFAULT 0 NOT NULL,
	"first_activity_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"velocity_24h" integer,
	"velocity_7d_avg" real,
	"spread_24h" integer,
	"activity_trend" text,
	"computed_at" timestamp with time zone,
	"stagnation_signal_count" integer DEFAULT 0 NOT NULL,
	"stagnation_severity" text DEFAULT 'none' NOT NULL,
	"centroid" vector(1024),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_superseded_by_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edges_from" ON "edges" USING btree ("from_id","type") WHERE valid_to IS NULL;--> statement-breakpoint
CREATE INDEX "edges_to" ON "edges" USING btree ("to_id","type") WHERE valid_to IS NULL;--> statement-breakpoint
CREATE INDEX "edges_source" ON "edges" USING btree ("source");--> statement-breakpoint
CREATE INDEX "embeddings_vec_hnsw" ON "embeddings" USING hnsw ("vector" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "events_archive_subject" ON "events_archive" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "events_archive_correlation" ON "events_archive" USING btree ("correlation_id") WHERE correlation_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_archive_observed" ON "events_archive" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "records_source_type" ON "records" USING btree ("source","type");--> statement-breakpoint
CREATE INDEX "records_updated" ON "records" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "records_search" ON "records" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "records_payload_gin" ON "records" USING gin ("payload");--> statement-breakpoint
CREATE INDEX "topic_assessments_recent" ON "topic_assessments" USING btree ("topic_id","assessed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "topics_status" ON "topics" USING btree ("status") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "topics_activity" ON "topics" USING btree ("last_activity_at" DESC NULLS LAST) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "topics_centroid" ON "topics" USING hnsw ("centroid" vector_cosine_ops) WHERE status = 'active' AND centroid IS NOT NULL;