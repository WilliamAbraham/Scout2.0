import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Home, Inbox, Settings2 } from "lucide-react";
import { SearchPreferencesForm } from "@/components/dashboard/search-preferences-form";
import { createClient } from "@/lib/supabase/server";
import { loadPreferences } from "@/lib/profile-server";
import { signedOutPreferences } from "@/lib/search-profile";
import { hasEnvVars } from "@/lib/utils";
import dashboard from "@/components/dashboard/scout-dashboard.module.css";
import styles from "./preferences.module.css";

export const metadata = { title: "Search preferences | Scout" };

async function Preferences() {
  let context = signedOutPreferences;
  if (hasEnvVars) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!error && typeof userId === "string") {
      context = await loadPreferences(supabase, userId);
    }
  }
  const inbox = context.signedIn ? "/dashboard" : "/";
  return (
    <div className={`${dashboard.app} ${styles.page}`}>
      <a href="#preferences-content" className={dashboard.skip}>
        Skip to preferences
      </a>
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Scout navigation">
          <Link href={inbox} className={styles.brand}>
            <Home aria-hidden="true" /> Scout
          </Link>
          <nav aria-label="Workspace">
            <Link href={inbox}>
              <Inbox aria-hidden="true" /> Inbox
            </Link>
            <Link href="/preferences" aria-current="page">
              <Settings2 aria-hidden="true" /> Preferences
            </Link>
          </nav>
          <div className={styles.railNote}>
            <span>Your search, your call.</span>
            <p>
              Start with the essentials. Refine the details as you find your
              place.
            </p>
          </div>
        </aside>
        <main id="preferences-content" className={styles.main}>
          <Link href={inbox} className={styles.back}>
            <ArrowLeft aria-hidden="true" /> Back to inbox
          </Link>
          <header className={styles.header}>
            <p>Your search</p>
            <h1>Search preferences</h1>
            <span>
              A place that fits your budget. Details that make it feel like
              home.
            </span>
          </header>
          <SearchPreferencesForm context={context} />
        </main>
      </div>
    </div>
  );
}

export default function PreferencesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-[#f2f3f0]">
          <p role="status">Loading your preferences…</p>
        </main>
      }
    >
      <Preferences />
    </Suspense>
  );
}
