CREATE TABLE "outreach_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pursuit_id" uuid NOT NULL,
	"action_key" text NOT NULL,
	"state" text NOT NULL,
	"to_addrs" text[] NOT NULL,
	"cc_addrs" text[] NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"thread_id" text,
	"rfc822_message_id" text,
	"provider_message_id" text,
	"provider_thread_id" text,
	"error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_outbox_user_action_unique" UNIQUE("user_id","pursuit_id","action_key"),
	CONSTRAINT "outreach_outbox_state_known" CHECK ("outreach_outbox"."state" in ('intended','claimed','sent','failed','uncertain','cancelled')),
	CONSTRAINT "outreach_outbox_action_key_not_empty" CHECK (length(trim("outreach_outbox"."action_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "outreach_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outreach_outbox" ADD CONSTRAINT "outreach_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_outbox" ADD CONSTRAINT "outreach_outbox_pursuit_id_pursuits_id_fk" FOREIGN KEY ("pursuit_id") REFERENCES "public"."pursuits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_outbox_state_idx" ON "outreach_outbox" USING btree ("user_id","state");