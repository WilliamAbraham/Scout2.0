CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gmail_message_id" text,
	"gmail_thread_id" text NOT NULL,
	"pursuit_id" uuid,
	"direction" text NOT NULL,
	"from_address" text NOT NULL,
	"to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"rfc_message_id" text,
	"in_reply_to" text,
	"sent_at" timestamp with time zone NOT NULL,
	"text_body" text,
	"html_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_messages_user_message_unique" UNIQUE("user_id","gmail_message_id"),
	CONSTRAINT "thread_messages_direction_valid" CHECK ("thread_messages"."direction" in ('inbound', 'outbound'))
);
--> statement-breakpoint
ALTER TABLE "thread_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worker_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "worker_leases_expiry_after_acquire" CHECK ("worker_leases"."expires_at" > "worker_leases"."acquired_at")
);
--> statement-breakpoint
ALTER TABLE "worker_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"mode" text NOT NULL,
	"report" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "worker_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "gmail_thread_id" text;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD COLUMN "outcome" jsonb;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_messages_thread_idx" ON "thread_messages" USING btree ("user_id","gmail_thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "thread_messages_pursuit_idx" ON "thread_messages" USING btree ("pursuit_id","sent_at");--> statement-breakpoint
CREATE INDEX "worker_runs_recent_idx" ON "worker_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "processed_messages_retry_idx" ON "processed_messages" USING btree ("user_id","next_attempt_at") WHERE "processed_messages"."status" = 'retry';--> statement-breakpoint
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_status_valid" CHECK ("processed_messages"."status" in ('done', 'retry', 'exhausted'));--> statement-breakpoint
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_attempts_positive" CHECK ("processed_messages"."attempts" >= 1);--> statement-breakpoint
CREATE POLICY "thread_messages_select_own" ON "thread_messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("thread_messages"."user_id"));