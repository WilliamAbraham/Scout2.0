"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveSearchProfile } from "@/app/actions/profile";
import {
  parseSearchProfile,
  profileSummary,
  sampleProfile,
} from "@/lib/search-profile";
import type {
  PreferencesContext,
  ProfileActionState,
  SearchProfile,
} from "@/lib/search-profile";
import styles from "./search-preferences-form.module.css";

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const initialState: ProfileActionState = {
  error: null,
  field: null,
  savedAt: null,
};
const emptyProfile: SearchProfile = {
  budget_min: null,
  budget_max: null,
  bedrooms_min: null,
  bedrooms_max: null,
  bathrooms_min: null,
  neighborhoods: [],
  must_haves: [],
  dealbreakers: [],
  preferences: null,
  availability: [],
};
const numericFields = [
  ["budget_min", "Minimum rent"],
  ["budget_max", "Maximum rent"],
  ["bedrooms_min", "Minimum bedrooms"],
  ["bedrooms_max", "Maximum bedrooms"],
  ["bathrooms_min", "Minimum bathrooms"],
] as const;

export function SearchPreferencesForm({
  context,
}: {
  context: PreferencesContext;
}) {
  const router = useRouter();
  if (context.profileError)
    return (
      <div className={styles.unavailable}>
        <p role="alert">
          Your saved preferences couldn’t be loaded. Refresh before making
          changes.
        </p>
        <button type="button" onClick={() => router.refresh()}>
          Try again
        </button>
      </div>
    );
  if (!context.signedIn)
    return (
      <div className={styles.sample}>
        <p className={styles.intro}>Read-only sample profile</p>
        <dl>
          <div>
            <dt>Budget & bedrooms</dt>
            <dd>{profileSummary(sampleProfile)}</dd>
          </div>
          <div>
            <dt>Areas</dt>
            <dd>{sampleProfile.neighborhoods.join(", ")}</dd>
          </div>
          <div>
            <dt>Tour availability</dt>
            <dd>Monday, 5–7 PM · New York time</dd>
          </div>
        </dl>
        <Link href="/auth/login">Sign in to edit your search</Link>
        <p className={styles.hint}>
          The sample apartments are fictional. Your saved preferences apply to
          your connected search.
        </p>
      </div>
    );
  return <EditableProfileForm context={context} />;
}

function EditableProfileForm({ context }: { context: PreferencesContext }) {
  const [draft, setDraft] = useState(() => {
    const profile = context.profile ?? emptyProfile;
    return {
      budget_min: String(profile.budget_min ?? ""),
      budget_max: String(profile.budget_max ?? ""),
      bedrooms_min: String(profile.bedrooms_min ?? ""),
      bedrooms_max: String(profile.bedrooms_max ?? ""),
      bathrooms_min: String(profile.bathrooms_min ?? ""),
      neighborhoods: profile.neighborhoods.join(", "),
      must_haves: profile.must_haves.join(", "),
      dealbreakers: profile.dealbreakers.join(", "),
      preferences: profile.preferences ?? "",
    };
  });
  const [windows, setWindows] = useState(context.profile?.availability ?? []);
  const [state, formAction, pending] = useActionState(
    saveSearchProfile,
    initialState,
  );
  const [clientError, setClientError] = useState<{
    error: string;
    field: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const error =
    clientError ??
    (state.error ? { error: state.error, field: state.field } : null);
  const feedback = useRef<HTMLDivElement>(null);
  const errorMessage = error?.error;
  const errorField = error?.field;
  useEffect(() => {
    if (errorMessage) feedback.current?.focus();
  }, [errorMessage, errorField]);
  function edit(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setClientError(null);
  }
  function updateWindow(
    index: number,
    patch: Partial<(typeof windows)[number]>,
  ) {
    setWindows((current) =>
      current.map((window, position) =>
        position === index ? { ...window, ...patch } : window,
      ),
    );
    setDirty(true);
    setClientError(null);
  }
  return (
    <form
      className={styles.form}
      action={formAction}
      noValidate
      onSubmit={(event) => {
        const parsed = parseSearchProfile(new FormData(event.currentTarget));
        if (parsed.error !== null) {
          event.preventDefault();
          setClientError({ error: parsed.error, field: parsed.field });
          return;
        }
        setClientError(null);
        setDirty(false);
      }}
    >
      <p className={styles.intro}>
        {context.profile
          ? "Update what Scout should look for."
          : "Set your criteria to get your search started."}{" "}
        Blank fields mean no preference.
      </p>
      <section className={styles.connection} aria-label="Gmail connection">
        <strong>
          {context.gmailError
            ? "Connection status unavailable"
            : !context.gmail
              ? "Gmail status not reported"
              : context.gmail.sync_error
                ? "Gmail needs attention"
                : "Gmail connected"}
        </strong>
        {context.gmail && <p>{context.gmail.email_address}</p>}
        {context.gmail?.last_synced_at && (
          <p>
            Last synced{" "}
            {new Date(context.gmail.last_synced_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York",
              timeZoneName: "short",
            })}
          </p>
        )}
        {(!context.gmail || context.gmail.sync_error) && (
          <p>
            You can save preferences now. The worker does not report Gmail
            status here yet; Google connection and reconnection are not
            available.
          </p>
        )}
      </section>
      <div ref={feedback} tabIndex={-1} className={styles.feedback}>
        {error && (
          <p id="profile-error" role="alert">
            {error.error}
            {error.field && (
              <>
                {" "}
                <a href={`#profile-${error.field}`}>Review field</a>
              </>
            )}
          </p>
        )}
        {!error && !dirty && !pending && state.savedAt && (
          <p role="status" className={styles.success}>
            Search preferences saved.
          </p>
        )}
      </div>
      <fieldset disabled={pending} className={styles.fields}>
        <legend>Budget & rooms</legend>
        <div className={styles.grid}>
          {numericFields.map(([name, label]) => (
            <label key={name} htmlFor={`profile-${name}`}>
              {label}
              <input
                id={`profile-${name}`}
                name={name}
                type="text"
                inputMode="decimal"
                value={draft[name]}
                onChange={(event) => edit(name, event.target.value)}
                aria-invalid={error?.field === name}
                aria-describedby={
                  error?.field === name ? "profile-error" : undefined
                }
                placeholder="No preference"
              />
            </label>
          ))}
        </div>
        <label htmlFor="profile-neighborhoods">
          Areas
          <input
            id="profile-neighborhoods"
            name="neighborhoods"
            value={draft.neighborhoods}
            onChange={(event) => edit("neighborhoods", event.target.value)}
            placeholder="Williamsburg, Greenpoint"
          />
        </label>
        <p className={styles.hint}>Separate neighborhoods with commas.</p>
        <div className={styles.grid}>
          {(
            [
              ["must_haves", "Must haves"],
              ["dealbreakers", "Dealbreakers"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} htmlFor={`profile-${name}`}>
              {label}
              <input
                id={`profile-${name}`}
                name={name}
                value={draft[name]}
                onChange={(event) => edit(name, event.target.value)}
                placeholder="Separate items with commas"
              />
            </label>
          ))}
        </div>
        <label htmlFor="profile-preferences">
          Anything else
          <textarea
            id="profile-preferences"
            name="preferences"
            value={draft.preferences}
            onChange={(event) => edit("preferences", event.target.value)}
            rows={3}
            placeholder="Other preferences Scout should know"
          />
        </label>
      </fieldset>
      <fieldset
        id="profile-availability"
        tabIndex={-1}
        disabled={pending}
        className={styles.windows}
        aria-invalid={error?.field === "availability"}
        aria-describedby={
          error?.field === "availability" ? "profile-error" : undefined
        }
      >
        <legend>Tour availability</legend>
        <p className={styles.hint}>
          Weekly windows in New York time. A window must start and end on the
          same day.
        </p>
        <input
          type="hidden"
          name="availability"
          value={JSON.stringify(windows)}
        />
        {windows.map((window, index) => (
          <div key={index} className={styles.window}>
            <label>
              Day
              <select
                aria-label={`Window ${index + 1} day`}
                value={window.day}
                onChange={(event) =>
                  updateWindow(index, { day: Number(event.target.value) })
                }
              >
                {days.map((day, value) => (
                  <option key={day} value={value}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                aria-label={`Window ${index + 1} start`}
                type="time"
                value={window.start}
                onChange={(event) =>
                  updateWindow(index, { start: event.target.value })
                }
              />
            </label>
            <label>
              Until
              <input
                aria-label={`Window ${index + 1} end`}
                type="time"
                value={window.end}
                onChange={(event) =>
                  updateWindow(index, { end: event.target.value })
                }
              />
            </label>
            <button
              type="button"
              aria-label={`Remove window ${index + 1}`}
              onClick={() => {
                setWindows(windows.filter((_, position) => position !== index));
                setDirty(true);
                setClientError(null);
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        ))}
        {!windows.length && <p className={styles.hint}>No tour windows set.</p>}
        <button
          type="button"
          className={styles.add}
          onClick={() => {
            setWindows([...windows, { day: 1, start: "17:00", end: "19:00" }]);
            setDirty(true);
          }}
        >
          <Plus aria-hidden="true" /> Add a window
        </button>
      </fieldset>
      {/* Move-in and editable timezone wait for Person A's schema migration. */}
      <footer className={styles.footer}>
        <p className={styles.hint}>
          Saves your profile. This does not send messages or book tours.
        </p>
        <button className={styles.save} disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </button>
      </footer>
    </form>
  );
}
