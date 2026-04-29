CREATE TABLE "guardrail_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"assessor" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	"stage" text NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"decision" text NOT NULL,
	"detail" text NOT NULL,
	"record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "guardrail_events_topic" ON "guardrail_events" USING btree ("topic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "guardrail_events_open" ON "guardrail_events" USING btree ("status","created_at" DESC NULLS LAST) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "guardrail_events_trace" ON "guardrail_events" USING btree ("trace_id");
