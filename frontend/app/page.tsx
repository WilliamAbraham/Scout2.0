import { ScoutDashboard } from "@/components/dashboard/scout-dashboard";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadPreferences } from "@/lib/profile-server";
import { hasEnvVars } from "@/lib/utils";

async function PreviewInbox() {
  if (!hasEnvVars) return <ScoutDashboard />;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return <ScoutDashboard />;
  const preferencesContext = await loadPreferences(supabase, userId);
  return <ScoutDashboard preferencesContext={preferencesContext} />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-[#f2f3f0]">
          <p role="status">Loading your search…</p>
        </main>
      }
    >
      <PreviewInbox />
    </Suspense>
  );
}
