import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScoutDashboard } from "@/components/dashboard/scout-dashboard";
import { projectRecords } from "@/components/dashboard/inbox-records";
import type { StoredUserListing } from "@/components/dashboard/inbox-records";

async function ConnectedInbox() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/auth/login");
  const userId = auth.claims.sub;
  const [feed, connection, profile] = await Promise.all([
    supabase
      .from("user_listings")
      .select(
        "id,is_match,match_reason,dismissed_at,first_seen_at,listings!inner(rental_id,address,price,bedrooms,bathrooms,listing_url),pursuits(id,stage,needs_human_reason,needs_human_note,needs_human_at,updated_at,contact_snapshot,pursuit_events(id,type,created_at))",
      )
      .eq("user_id", userId)
      .order("first_seen_at", { ascending: false }),
    supabase
      .from("gmail_accounts")
      .select("last_synced_at,sync_error")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("search_profiles")
      .select("budget_max,bedrooms_min,paused_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const error = Boolean(feed.error || connection.error || profile.error);
  const google = connection.data;
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
  const summary = profile.data
    ? [
        profile.data.bedrooms_min === null
          ? "Bedrooms not set"
          : `${profile.data.bedrooms_min}+ bedrooms`,
        profile.data.budget_max === null
          ? "Budget not set"
          : `Up to $${Number(profile.data.budget_max).toLocaleString("en-US")}`,
      ].join(" · ")
    : "Search profile not configured";
  return (
    <ScoutDashboard
      initialListings={
        feed.error
          ? []
          : projectRecords((feed.data ?? []) as unknown as StoredUserListing[])
      }
      mode="live"
      account={{
        status,
        detail,
        paused: Boolean(profile.data?.paused_at),
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
