import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScoutDashboard } from "@/components/dashboard/scout-dashboard";
import { projectRecords } from "@/components/dashboard/inbox-records";
import type { StoredUserListing } from "@/components/dashboard/inbox-records";
import { loadPreferences } from "@/lib/profile-server";
import { profileSummary } from "@/lib/search-profile";

async function ConnectedInbox() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/auth/login");
  const userId = auth.claims.sub;
  const [feed, preferencesContext] = await Promise.all([
    supabase
      .from("user_listings")
      .select(
        "id,is_match,match_reason,dismissed_at,first_seen_at,listings!inner(rental_id,address,price,bedrooms,bathrooms,listing_url),pursuits(id,stage,needs_human_reason,needs_human_note,needs_human_at,updated_at,contact_snapshot,pursuit_events(id,type,created_at))",
      )
      .eq("user_id", userId)
      .order("first_seen_at", { ascending: false }),
    loadPreferences(supabase, userId),
  ]);
  const error = Boolean(
    feed.error ||
    preferencesContext.gmailError ||
    preferencesContext.profileError,
  );
  const google = preferencesContext.gmail;
  const status = error
    ? "Inbox unavailable"
    : !google
      ? "Gmail not connected"
      : google.sync_error
        ? "Gmail needs attention"
        : !google.last_synced_at
          ? "Waiting for first sync"
          : "Gmail connected";
  const detail = error
    ? "Your inbox could not be loaded. Try refreshing; if it continues, the data connection needs attention."
    : !google
      ? "No Gmail account is connected. Google connection setup is not available yet."
      : google.sync_error
        ? "Gmail sync needs attention. Reconnection is not available in this preview yet."
        : google.last_synced_at
          ? `Last synced ${new Date(google.last_synced_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}`
          : "The account is connected, but no successful sync is recorded.";
  const summary = profileSummary(preferencesContext.profile);
  return (
    <ScoutDashboard
      initialListings={
        feed.error
          ? []
          : projectRecords((feed.data ?? []) as unknown as StoredUserListing[])
      }
      mode="live"
      preferencesContext={preferencesContext}
      account={{
        status,
        detail,
        paused: preferencesContext.paused,
        profileSummary: summary,
        error,
      }}
    />
  );
}
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-[#f2f3f0]">
          <p role="status">Loading your inbox…</p>
        </main>
      }
    >
      <ConnectedInbox />
    </Suspense>
  );
}
