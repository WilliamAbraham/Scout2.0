CREATE TYPE "public"."needs_human_reason" AS ENUM('no_contact', 'unanswerable_question', 'no_fitting_slot', 'portal_link', 'missing_document', 'decision');--> statement-breakpoint
CREATE TYPE "public"."pursuit_stage" AS ENUM('matched', 'contacted', 'tour_scheduled', 'toured', 'applied', 'decided', 'dead');--> statement-breakpoint
CREATE TABLE "user_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"source_message_id" text,
	"is_match" boolean,
	"match_score" numeric(4, 3),
	"match_reason" text,
	"scored_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_listings_user_listing_unique" UNIQUE("user_id","listing_id"),
	CONSTRAINT "user_listings_score_range" CHECK ("user_listings"."match_score" is null or ("user_listings"."match_score" >= 0 and "user_listings"."match_score" <= 1))
);
--> statement-breakpoint
ALTER TABLE "user_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gmail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_address" text NOT NULL,
	"history_id" text,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "gmail_accounts_email_not_empty" CHECK (length(trim("gmail_accounts"."email_address")) > 0)
);
--> statement-breakpoint
ALTER TABLE "gmail_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gmail_tokens" (
	"gmail_account_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"scopes" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmail_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"user_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"route" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_messages_user_id_gmail_message_id_pk" PRIMARY KEY("user_id","gmail_message_id")
);
--> statement-breakpoint
ALTER TABLE "processed_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "documents_size_positive" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_label_not_empty" CHECK (length(trim("documents"."label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "search_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"budget_min" numeric(12, 2),
	"budget_max" numeric(12, 2),
	"bedrooms_min" numeric(4, 1),
	"bedrooms_max" numeric(4, 1),
	"bathrooms_min" numeric(4, 1),
	"neighborhoods" text[] DEFAULT '{}'::text[] NOT NULL,
	"must_haves" text[] DEFAULT '{}'::text[] NOT NULL,
	"dealbreakers" text[] DEFAULT '{}'::text[] NOT NULL,
	"availability" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" text,
	"learned_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"daily_send_cap" integer DEFAULT 10 NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "search_profiles_budget_order" CHECK ("search_profiles"."budget_min" is null or "search_profiles"."budget_max" is null
        or "search_profiles"."budget_max" >= "search_profiles"."budget_min"),
	CONSTRAINT "search_profiles_bedrooms_order" CHECK ("search_profiles"."bedrooms_min" is null or "search_profiles"."bedrooms_max" is null
        or "search_profiles"."bedrooms_max" >= "search_profiles"."bedrooms_min"),
	CONSTRAINT "search_profiles_budget_positive" CHECK ("search_profiles"."budget_min" is null or "search_profiles"."budget_min" >= 0),
	CONSTRAINT "search_profiles_send_cap_sane" CHECK ("search_profiles"."daily_send_cap" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "search_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pursuit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pursuit_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pursuit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pursuits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_listing_id" uuid NOT NULL,
	"stage" "pursuit_stage" DEFAULT 'matched' NOT NULL,
	"needs_human_reason" "needs_human_reason",
	"needs_human_note" text,
	"needs_human_at" timestamp with time zone,
	"thread_id" text,
	"contact_snapshot" jsonb,
	"enriched_at" timestamp with time zone,
	"last_agent_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pursuits_user_listing_id_unique" UNIQUE("user_listing_id"),
	CONSTRAINT "pursuits_user_thread_unique" UNIQUE("user_id","thread_id"),
	CONSTRAINT "pursuits_needs_human_consistent" CHECK (("pursuits"."needs_human_reason" is null) = ("pursuits"."needs_human_at" is null)),
	CONSTRAINT "pursuits_contacted_has_thread" CHECK ("pursuits"."stage" in ('matched', 'dead') or "pursuits"."thread_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "pursuits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "brokerage" text;--> statement-breakpoint
ALTER TABLE "user_listings" ADD CONSTRAINT "user_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_listings" ADD CONSTRAINT "user_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD CONSTRAINT "gmail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_tokens" ADD CONSTRAINT "gmail_tokens_gmail_account_id_gmail_accounts_id_fk" FOREIGN KEY ("gmail_account_id") REFERENCES "public"."gmail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_events" ADD CONSTRAINT "pursuit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuit_events" ADD CONSTRAINT "pursuit_events_pursuit_id_pursuits_id_fk" FOREIGN KEY ("pursuit_id") REFERENCES "public"."pursuits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pursuits" ADD CONSTRAINT "pursuits_user_listing_id_user_listings_id_fk" FOREIGN KEY ("user_listing_id") REFERENCES "public"."user_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_listings_feed_idx" ON "user_listings" USING btree ("user_id","first_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_listings_unscored_idx" ON "user_listings" USING btree ("user_id") WHERE is_match is null;--> statement-breakpoint
CREATE INDEX "processed_messages_recent_idx" ON "processed_messages" USING btree ("user_id","processed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pursuit_events_cap_idx" ON "pursuit_events" USING btree ("user_id","type","created_at");--> statement-breakpoint
CREATE INDEX "pursuit_events_timeline_idx" ON "pursuit_events" USING btree ("pursuit_id","created_at");--> statement-breakpoint
CREATE INDEX "pursuits_needs_human_idx" ON "pursuits" USING btree ("user_id","needs_human_at") WHERE "pursuits"."needs_human_reason" is not null;--> statement-breakpoint
CREATE INDEX "pursuits_actionable_idx" ON "pursuits" USING btree ("stage") WHERE "pursuits"."needs_human_reason" is null;--> statement-breakpoint
CREATE INDEX "pursuits_thread_idx" ON "pursuits" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE POLICY "listings_select_own" ON "listings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (
      select 1 from public.user_listings ul
      where ul.listing_id = "listings"."id" and public.scout_owns(ul.user_id)
    ));--> statement-breakpoint
CREATE POLICY "user_listings_select_own" ON "user_listings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("user_listings"."user_id"));--> statement-breakpoint
CREATE POLICY "user_listings_update_own" ON "user_listings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (scout_owns("user_listings"."user_id")) WITH CHECK (scout_owns("user_listings"."user_id"));--> statement-breakpoint
CREATE POLICY "gmail_accounts_select_own" ON "gmail_accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("gmail_accounts"."user_id"));--> statement-breakpoint
CREATE POLICY "gmail_accounts_delete_own" ON "gmail_accounts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (scout_owns("gmail_accounts"."user_id"));--> statement-breakpoint
CREATE POLICY "documents_select_own" ON "documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("documents"."user_id"));--> statement-breakpoint
CREATE POLICY "documents_insert_own" ON "documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (scout_owns("documents"."user_id"));--> statement-breakpoint
CREATE POLICY "documents_delete_own" ON "documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (scout_owns("documents"."user_id"));--> statement-breakpoint
CREATE POLICY "search_profiles_select_own" ON "search_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("search_profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "search_profiles_insert_own" ON "search_profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (scout_owns("search_profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "search_profiles_update_own" ON "search_profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (scout_owns("search_profiles"."user_id")) WITH CHECK (scout_owns("search_profiles"."user_id"));--> statement-breakpoint
CREATE POLICY "pursuit_events_select_own" ON "pursuit_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("pursuit_events"."user_id"));--> statement-breakpoint
CREATE POLICY "pursuits_select_own" ON "pursuits" AS PERMISSIVE FOR SELECT TO "authenticated" USING (scout_owns("pursuits"."user_id"));--> statement-breakpoint
CREATE POLICY "pursuits_update_own" ON "pursuits" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (scout_owns("pursuits"."user_id")) WITH CHECK (scout_owns("pursuits"."user_id"));