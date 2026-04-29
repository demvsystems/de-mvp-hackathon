CREATE TABLE "golden_example_candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"assessor" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	"category" text DEFAULT 'edge' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "golden_example_candidates" ADD CONSTRAINT "golden_example_candidates_feedback_uniq" UNIQUE("feedback_id");--> statement-breakpoint
CREATE INDEX "golden_example_candidates_topic" ON "golden_example_candidates" USING btree ("topic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "golden_example_candidates_open" ON "golden_example_candidates" USING btree ("status","created_at" DESC NULLS LAST) WHERE status = 'open';
