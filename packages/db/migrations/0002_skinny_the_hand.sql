ALTER TABLE "topics" ADD COLUMN "centroid_body_only" vector(1536);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "member_count_body_only" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "topics_centroid_body_only" ON "topics" USING hnsw ("centroid_body_only" vector_cosine_ops) WHERE status = 'active' AND centroid_body_only IS NOT NULL;