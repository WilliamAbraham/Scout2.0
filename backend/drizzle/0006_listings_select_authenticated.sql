DROP POLICY IF EXISTS "listings_select_own" ON "listings";--> statement-breakpoint
CREATE POLICY "listings_select_authenticated" ON "listings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
