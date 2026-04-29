CREATE TABLE "topic_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"assessor" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thumb" text,
	"rating" integer,
	"corrected_character" text,
	"corrected_escalation_score" real,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "topic_assessments" ADD COLUMN "trace_id" text;--> statement-breakpoint
CREATE INDEX "topic_feedback_topic" ON "topic_feedback" USING btree ("topic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "topic_feedback_open" ON "topic_feedback" USING btree ("status","created_at" DESC NULLS LAST) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "topic_feedback_assessment" ON "topic_feedback" USING btree ("topic_id","assessor","assessed_at");