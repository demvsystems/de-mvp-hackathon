UPDATE "topics"
   SET "centroid" = "centroid_body_only"
 WHERE "centroid" IS NULL AND "centroid_body_only" IS NOT NULL;--> statement-breakpoint
UPDATE "topics" t
   SET "member_count" = COALESCE((
         SELECT count(*)::int FROM "edges" e
          WHERE e."to_id" = t."id"
            AND e."type" = 'discusses'
            AND e."valid_to" IS NULL
       ), 0);--> statement-breakpoint
DROP INDEX "topics_centroid_body_only";--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN "centroid_body_only";--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN "member_count_body_only";
