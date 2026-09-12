"use client";

import { useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { CommandActionState } from "@/lib/inbox-command";
import type { BlockerReason } from "./inbox-model";
import styles from "./live-pursuit-controls.module.css";

type SharedControlProps = {
  pursuitId: string;
  expectedUpdatedAt: string;
  action: (form: FormData) => void;
  state: CommandActionState;
  pending: boolean;
  disabled: boolean;
  onRefresh: () => void;
};

export function LiveBlockerControl({
  blockerReason,
  openPreferences,
  ...props
}: SharedControlProps & {
  blockerReason: BlockerReason;
  openPreferences: () => void;
}) {
  if (blockerReason !== "no_contact") {
    return (
      <BlockerStub
        blockerReason={blockerReason}
        openPreferences={openPreferences}
      />
    );
  }
  return <ContactForm {...props} />;
}

function ContactForm({
  pursuitId,
  expectedUpdatedAt,
  action,
  state,
  pending,
  disabled,
  onRefresh,
}: SharedControlProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);

  const unavailable = disabled || pending;
  return (
    <form
      action={action}
      className={styles.form}
      aria-busy={pending}
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="command" value="supply_contact" />
      <input type="hidden" name="pursuit_id" value={pursuitId} />
      <input
        type="hidden"
        name="expected_updated_at"
        value={expectedUpdatedAt}
      />
      <label htmlFor={`contact-name-${pursuitId}`}>
        Broker name (optional)
      </label>
      <input
        id={`contact-name-${pursuitId}`}
        name="contact_name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={unavailable}
      />
      <label htmlFor={`contact-email-${pursuitId}`}>Broker email</label>
      <input
        id={`contact-email-${pursuitId}`}
        name="contact_email"
        type="email"
        autoComplete="email"
        placeholder="broker@example.com"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={unavailable}
      />
      <label htmlFor={`contact-source-${pursuitId}`}>
        Where you found it (optional)
      </label>
      <input
        id={`contact-source-${pursuitId}`}
        name="source_url"
        type="url"
        inputMode="url"
        placeholder="https://listing.example/contact"
        value={sourceUrl}
        onChange={(event) => setSourceUrl(event.target.value)}
        disabled={unavailable}
      />
      <label className={styles.authorization}>
        <input
          name="authorize_contact"
          type="checkbox"
          value="yes"
          checked={authorized}
          onChange={(event) => setAuthorized(event.target.checked)}
          required
          disabled={unavailable}
        />
        <span>
          <strong>Use this contact to prepare outreach</strong>
          The worker will use this address directly. There is no later
          verification step.
        </span>
      </label>
      <button
        className={styles.primaryButton}
        disabled={unavailable || !email.trim() || !authorized}
      >
        {pending ? "Saving contact…" : "Use this contact"}
        <ChevronRight aria-hidden="true" />
      </button>
      {state.command === "supply_contact" &&
        state.pursuitId === pursuitId &&
        !pending && <ActionFeedback state={state} onRefresh={onRefresh} />}
    </form>
  );
}

export function LiveClosePursuitControl({
  pursuitId,
  expectedUpdatedAt,
  action,
  state,
  pending,
  disabled,
  onRefresh,
}: SharedControlProps) {
  return (
    <form action={action} className={styles.closeForm} aria-busy={pending}>
      <input type="hidden" name="command" value="close" />
      <input type="hidden" name="pursuit_id" value={pursuitId} />
      <input
        type="hidden"
        name="expected_updated_at"
        value={expectedUpdatedAt}
      />
      <button className={styles.secondaryButton} disabled={disabled || pending}>
        {pending ? "Stopping…" : "Stop pursuing"}
      </button>
      <p className={styles.timingNote}>
        Applies to the next worker cycle. Work already in flight may finish.
      </p>
      {state.command === "close" &&
        state.pursuitId === pursuitId &&
        !pending && <ActionFeedback state={state} onRefresh={onRefresh} />}
    </form>
  );
}

function ActionFeedback({
  state,
  onRefresh,
}: {
  state: CommandActionState;
  onRefresh: () => void;
}) {
  if (!state.error && !state.message) return null;
  return (
    <div className={state.error ? styles.error : styles.success}>
      <p>{state.error ?? state.message}</p>
      {state.error && (
        <button type="button" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" /> Refresh inbox
        </button>
      )}
    </div>
  );
}

function BlockerStub({
  blockerReason,
  openPreferences,
}: {
  blockerReason: Exclude<BlockerReason, "no_contact">;
  openPreferences: () => void;
}) {
  const copy: Record<Exclude<BlockerReason, "no_contact">, string> = {
    unanswerable_question:
      "Answer submission is not available here yet. Scout will wait for this detail.",
    no_fitting_slot:
      "None of the recorded availability fits. Updating availability does not clear this request yet; Scout will keep waiting here.",
    portal_link:
      "This broker requires a portal step. Portal handoff is not available here yet.",
    missing_document:
      "This broker requires a document. Secure document upload is not available here yet.",
    decision:
      "A decision is needed. Decision submission is not available here yet.",
  };
  return (
    <div className={styles.stub}>
      <p>{copy[blockerReason]}</p>
      {blockerReason === "no_fitting_slot" && (
        <button type="button" onClick={openPreferences}>
          Update availability
        </button>
      )}
    </div>
  );
}
