DROP INDEX "embeddings_vec_hnsw";--> statement-breakpoint
DROP INDEX "topics_centroid";--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "vector" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "topics" ALTER COLUMN "centroid" SET DATA TYPE vector(1536);--> statement-breakpoint
CREATE INDEX "embeddings_vec_hnsw" ON "embeddings" USING hnsw ("vector" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "topics_centroid" ON "topics" USING hnsw ("centroid" vector_cosine_ops) WHERE status = 'active' AND centroid IS NOT NULL;
