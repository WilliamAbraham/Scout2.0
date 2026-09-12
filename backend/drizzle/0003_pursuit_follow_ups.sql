ALTER TABLE "pursuits" ADD COLUMN "next_follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pursuits" ADD COLUMN "follow_up_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "pursuits_follow_up_idx" ON "pursuits" USING btree ("next_follow_up_at") WHERE "pursuits"."next_follow_up_at" is not null and "pursuits"."needs_human_reason" is null;--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_follow_up_count_nonnegative" CHECK ("pursuits"."follow_up_count" >= 0);