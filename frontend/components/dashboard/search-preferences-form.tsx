"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Plus, Trash2 } from "lucide-react";
import { saveSearchProfile } from "@/app/actions/profile";
import {
  parseSearchProfile,
  profileSummary,
  sampleProfile,
  splitPreferenceList,
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
const suggestions = {
  neighborhoods: ["Williamsburg", "Greenpoint", "East Village", "Astoria"],
  must_haves: [
    "In-unit laundry",
    "Elevator",
    "Dishwasher",
    "Pets allowed",
    "Outdoor space",
  ],
  dealbreakers: ["Walk-up", "Ground floor", "No pets", "No laundry"],
};
function toDraft(profile: SearchProfile) {
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
}

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
  return <EditableProfileForm context={context} />;
}

function EditableProfileForm({ context }: { context: PreferencesContext }) {
  const sample = !context.signedIn;
  const profile = sample ? sampleProfile : (context.profile ?? emptyProfile);
  const [draft, setDraft] = useState(() => toDraft(profile));
  const [windows, setWindows] = useState(profile.availability);
  const [state, formAction, pending] = useActionState(
    async (previous: ProfileActionState, form: FormData) => {
      try {
        return await saveSearchProfile(previous, form);
      } catch {
        return {
          error:
            "Your save could not be confirmed. Your edits are still here; please try again.",
          field: null,
          savedAt: null,
        };
      }
    },
    initialState,
  );
  const [clientError, setClientError] = useState<{
    error: string;
    field: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sampleChecked, setSampleChecked] = useState(false);
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
  function inlineError(name: string) {
    return error?.field === name ? (
      <span className={styles.fieldError} id={"error-" + name}>
        {error.error}
      </span>
    ) : null;
  }
  function numberInput(
    name:
      | "budget_min"
      | "budget_max"
      | "bedrooms_min"
      | "bedrooms_max"
      | "bathrooms_min",
    label: string,
  ) {
    return (
      <label htmlFor={"profile-" + name}>
        {label}
        <input
          id={"profile-" + name}
          name={name}
          type="text"
          inputMode="decimal"
          value={draft[name]}
          onChange={(event) => edit(name, event.target.value)}
          aria-invalid={error?.field === name}
          aria-describedby={error?.field === name ? "error-" + name : undefined}
          placeholder={name.startsWith("budget") ? "No limit" : "Any"}
        />
        {inlineError(name)}
      </label>
    );
  }
  function preferenceInput(
    name: keyof typeof suggestions,
    label: string,
    placeholder: string,
  ) {
    const selected = splitPreferenceList(draft[name]);
    return (
      <div className={styles.preferenceField}>
        <label htmlFor={"profile-" + name}>
          {label}
          <input
            id={"profile-" + name}
            name={name}
            value={draft[name]}
            placeholder={placeholder}
            aria-invalid={error?.field === name}
            aria-describedby={
              error?.field === name ? "error-" + name : "hint-" + name
            }
            onChange={(event) => edit(name, event.target.value)}
          />
          {inlineError(name)}
        </label>
        <p className={styles.hint} id={"hint-" + name}>
          Separate items with commas, or choose a suggestion.
        </p>
        <div
          className={styles.chips}
          role="group"
          aria-label={label + " suggestions"}
        >
          {suggestions[name].map((item) => {
            const active = selected.some(
              (value) => value.toLowerCase() === item.toLowerCase(),
            );
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  edit(
                    name,
                    (active
                      ? selected.filter(
                          (value) => value.toLowerCase() !== item.toLowerCase(),
                        )
                      : [...selected, item]
                    ).join(", "),
                  );
                }}
              >
                {active ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                {item}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  const summaryForm = new FormData();
  for (const [key, value] of Object.entries(draft)) summaryForm.set(key, value);
  summaryForm.set("availability", JSON.stringify(windows));
  const summary = parseSearchProfile(summaryForm);
  const current = summary.profile;
  const requirements = splitPreferenceList(draft.must_haves);
  const exclusions = splitPreferenceList(draft.dealbreakers);
  const conflicting = requirements.filter((item) =>
    exclusions.some(
      (excluded) => excluded.toLowerCase() === item.toLowerCase(),
    ),
  );

  return (
    <form
      className={styles.form}
      action={sample ? undefined : formAction}
      noValidate
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => {
        const parsed = parseSearchProfile(new FormData(event.currentTarget));
        if (parsed.error !== null) {
          event.preventDefault();
          setClientError({ error: parsed.error, field: parsed.field });
          return;
        }
        setClientError(null);
        if (sample) {
          event.preventDefault();
          setSampleChecked(true);
        }
        setDirty(false);
      }}
    >
      {sample && (
        <div className={styles.sample}>
          <div>
            <strong>Try a sample search</strong>
            <p>
              Explore the filters below. Changes stay in this preview and reset
              on refresh.
            </p>
          </div>
          <Link href="/auth/login">
            Sign in to save <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      )}
      <div ref={feedback} tabIndex={-1} className={styles.feedback}>
        {error && (
          <p role="alert">
            {error.error}{" "}
            {error.field && (
              <a href={"#profile-" + error.field}>Review field</a>
            )}
          </p>
        )}
        {!error && !dirty && sampleChecked && (
          <p role="status" className={styles.success}>
            Sample preferences checked. Nothing was saved.
          </p>
        )}
        {!error && !dirty && !pending && state.savedAt && (
          <p role="status" className={styles.success}>
            Search preferences saved. They apply to newly evaluated listings.
          </p>
        )}
      </div>
      <div className={styles.layout}>
        <div className={styles.sections}>
          <fieldset disabled={pending} className={styles.section}>
            <legend>
              <span className={styles.number}>01</span> Search filters
            </legend>
            <p className={styles.description}>
              Your limits for newly evaluated listings. Leave a field blank to
              keep it open.
            </p>
            <div className={styles.fieldGroup}>
              <h2>
                Monthly rent <span>USD / month</span>
              </h2>
              <div className={styles.grid}>
                {numberInput("budget_min", "Minimum rent")}
                {numberInput("budget_max", "Maximum rent")}
              </div>
              <p className={styles.hint}>
                Uses the rent in the alert. Utilities and extra fees aren’t
                included.
              </p>
            </div>
            <div className={styles.fieldGroup}>
              <h2>Rooms</h2>
              <div className={styles.grid}>
                {numberInput("bedrooms_min", "Minimum bedrooms")}
                {numberInput("bedrooms_max", "Maximum bedrooms")}
              </div>
              <p className={styles.hint}>
                For a studio, set both bedroom limits to 0.
              </p>
              <div className={styles.bathroom}>
                {numberInput("bathrooms_min", "Minimum bathrooms")}
              </div>
            </div>
            <p className={styles.note}>
              Listings with an unknown bedroom or bathroom count can still
              match. Confirm missing details with the broker.
            </p>
          </fieldset>

          <fieldset disabled={pending} className={styles.section}>
            <legend>
              <span className={styles.number}>02</span> Apartment preferences
            </legend>
            <p className={styles.description}>
              Details for Scout’s broker conversations. These don’t
              automatically exclude listings yet.
            </p>
            {preferenceInput(
              "neighborhoods",
              "Neighborhoods",
              "e.g. Lower East Side, Park Slope",
            )}
            {preferenceInput(
              "must_haves",
              "Must-haves",
              "e.g. Elevator, enough space for a desk",
            )}
            {preferenceInput(
              "dealbreakers",
              "Dealbreakers",
              "e.g. Ground floor, no pets",
            )}
            {conflicting.length > 0 && (
              <p className={styles.note}>
                Listed in both must-haves and dealbreakers:{" "}
                {conflicting.join(", ")}. Clarify which you mean before saving.
              </p>
            )}
            <label htmlFor="profile-preferences" className={styles.notesLabel}>
              Anything else Scout should know
              <textarea
                id="profile-preferences"
                name="preferences"
                rows={3}
                value={draft.preferences}
                aria-invalid={error?.field === "preferences"}
                aria-describedby={
                  error?.field === "preferences"
                    ? "error-preferences"
                    : "notes-hint"
                }
                onChange={(event) => edit("preferences", event.target.value)}
                placeholder="Move-in timing, lease length, a commute, or details to ask the broker about…"
              />
              {inlineError("preferences")}
            </label>
            <p className={styles.hint} id="notes-hint">
              Saved as conversation notes, rather than automatic search filters.
            </p>
          </fieldset>

          <fieldset
            id="profile-availability"
            tabIndex={-1}
            disabled={pending}
            className={styles.section}
            aria-invalid={error?.field === "availability"}
            aria-describedby={
              error?.field === "availability" ? "error-availability" : undefined
            }
          >
            <legend>
              <span className={styles.number}>03</span> Tour availability
            </legend>
            <p className={styles.description}>
              Times Scout can mention when asking about a tour. All times are in
              New York time.
            </p>
            {inlineError("availability")}
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
                    aria-label={"Window " + (index + 1) + " day"}
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
                    aria-label={"Window " + (index + 1) + " start"}
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
                    aria-label={"Window " + (index + 1) + " end"}
                    type="time"
                    value={window.end}
                    onChange={(event) =>
                      updateWindow(index, { end: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={"Remove window " + (index + 1)}
                  onClick={() => {
                    setWindows(
                      windows.filter((_, position) => position !== index),
                    );
                    setDirty(true);
                    setClientError(null);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
            {!windows.length && (
              <p className={styles.note}>
                No windows set. Scout describes your availability as flexible.
              </p>
            )}
            <button
              type="button"
              className={styles.add}
              onClick={() => {
                setWindows([
                  ...windows,
                  { day: 1, start: "17:00", end: "19:00" },
                ]);
                setDirty(true);
                setClientError(null);
              }}
            >
              <Plus aria-hidden="true" /> Add a time window
            </button>
            <p className={styles.hint}>
              Each window must end on the same day. Saving availability doesn’t
              book a tour or resolve an existing scheduling question.
            </p>
          </fieldset>
        </div>

        <aside className={styles.summary} aria-label="Search summary">
          <span className={styles.eyebrow}>
            {sample ? "Sample search" : "Your search"}
          </span>
          <h2>
            {current ? profileSummary(current) : "Review your preferences"}
          </h2>
          <p className={styles.summaryState}>
            {sample
              ? "Preview only · not saved"
              : pending
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : state.error
                    ? "Changes not saved"
                    : context.profile || state.savedAt
                      ? "Saved preferences"
                      : "No preferences saved yet"}
          </p>
          <dl>
            <div>
              <dt>Bathrooms</dt>
              <dd>
                {current
                  ? current.bathrooms_min === null
                    ? "No minimum"
                    : current.bathrooms_min + "+"
                  : "Review fields"}
              </dd>
            </div>
            <div>
              <dt>Preferred neighborhoods</dt>
              <dd>
                {splitPreferenceList(draft.neighborhoods).join(", ") ||
                  "Open to any area"}
              </dd>
            </div>
            <div>
              <dt>Must-haves / dealbreakers</dt>
              <dd>{requirements.length + " / " + exclusions.length}</dd>
            </div>
          </dl>
          <div className={styles.summaryNote}>
            <Check aria-hidden="true" />
            <p>
              Rent and room limits filter new evaluations. Other preferences
              guide broker conversations.
            </p>
          </div>
          <div className={styles.sourceNote}>
            <strong>Start with your listing alerts</strong>
            <p>
              Scout reads the alerts you receive. Keep your StreetEasy saved
              search in sync with these preferences.
            </p>
          </div>
        </aside>
      </div>
      <footer className={styles.footer}>
        <p>
          Applies to newly evaluated listings. Existing inbox matches and your
          StreetEasy alerts stay unchanged.
        </p>
        {sample ? (
          <button type="submit" className={styles.preview}>
            Check sample preferences
          </button>
        ) : (
          <button className={styles.save} disabled={pending}>
            {pending ? "Saving…" : "Save preferences"}
          </button>
        )}
      </footer>
      {!sample && (
        <details className={styles.connection}>
          <summary>
            Gmail connection{" "}
            <span>
              {context.gmailError
                ? "Status unavailable"
                : !context.gmail
                  ? "Status not reported"
                  : context.gmail.sync_error
                    ? "Needs attention"
                    : "Connected"}
            </span>
          </summary>
          {context.gmail && <p>{context.gmail.email_address}</p>}
          <p>
            You can save preferences independently of the connection status.
            Google connection setup and reconnection aren’t available here yet.
          </p>
        </details>
      )}
    </form>
  );
}
