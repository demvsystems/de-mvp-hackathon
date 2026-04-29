CREATE TABLE "company_playbook" (
	"id" text PRIMARY KEY NOT NULL,
	"playbook" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "reviewer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" text NOT NULL,
	"assessor" text NOT NULL,
	"model" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"status" text DEFAULT 'proposed' NOT NULL,
	"plan" jsonb NOT NULL,
	"rationale" text,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision_kind" text,
	"decision_at" timestamp with time zone,
	"decision_by" text,
	"modification_feedback" text,
	"executed_at" timestamp with time zone,
	"executor_run_id" text,
	"created_records" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "topic_action_plans" ADD CONSTRAINT "topic_action_plans_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reviewer_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_action_plans" ADD CONSTRAINT "topic_action_plans_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."topic_action_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviewer_sessions_topic" ON "reviewer_sessions" USING btree ("topic_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "topic_action_plans_topic" ON "topic_action_plans" USING btree ("topic_id","proposed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "topic_action_plans_proposed" ON "topic_action_plans" USING btree ("proposed_at" DESC NULLS LAST) WHERE status = 'proposed';--> statement-breakpoint
INSERT INTO "company_playbook" ("id", "playbook", "version", "updated_by") VALUES (
  'default',
  '{
    "slack": {
      "channels": { "bug": "#bugs", "feature": "#product", "default": "#general" },
      "placement_default": "thread",
      "always_mention_jira_in_slack": true
    },
    "jira": {
      "bug":     { "project": "SHOP", "issue_type": "Bug",   "default_labels": [] },
      "feature": { "project": "SHOP", "issue_type": "Story", "default_labels": [] }
    },
    "intercom": {
      "reply_for_confirmed_bugs": true,
      "include_jira_key_in_reply": false,
      "internal_note_for_unconfirmed": true,
      "tone": "freundlich, lösungsorientiert, ohne Schuldzuweisung"
    },
    "cross_reference_rules": {
      "always": ["slack→jira mentions", "intercom→jira mentions"],
      "never":  ["intercom→slack mentions"]
    },
    "tone": {
      "slack":    "knapp, fakt-orientiert, mit IDs",
      "intercom": "freundlich, lösungsorientiert, ohne interne Details",
      "jira":     "präzise, mit Reproduktionsschritten und Akzeptanzkriterien"
    },
    "freeform_notes": "Bei mehrfach bestätigten Bugs immer ein Jira-Ticket öffnen UND betroffene Kunden via Intercom benachrichtigen UND das Engineering-Team in Slack informieren. Wenn es einen Slack-Discovery-Thread gibt, Slack-Update als Reply in den Thread, sonst dedizierter Channel-Post."
  }'::jsonb,
  1,
  'system:migration'
);