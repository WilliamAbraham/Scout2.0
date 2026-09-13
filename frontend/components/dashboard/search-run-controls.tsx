"use client";

import { useState, useTransition } from "react";
import { Mail, RefreshCw, Search, Send } from "lucide-react";
import type { CommandActionState } from "@/lib/inbox-command";
import styles from "./search-run-controls.module.css";

/**
 * The two on-demand agent commands.
 *
 * Both are deliberately explicit buttons rather than something the page does
 * on load: one costs money to run and the other sends real mail, so each needs
 * a press. While a run is in flight the other button is disabled too — they
 * write the same pursuits, and letting them overlap would send from a state
 * the sender had not finished computing.
 */
export function SearchRunControls({
  readyToSend,
  paused,
  disabled,
  onStartSearch,
  onSend,
  onRefresh,
}: {
  readyToSend: number;
  paused: boolean;
  disabled: boolean;
  onStartSearch: () => Promise<CommandActionState>;
  onSend: () => Promise<CommandActionState>;
  onRefresh: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"search" | "send" | null>(null);
  const [state, setState] = useState<CommandActionState | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (which: "search" | "send", command: () => Promise<CommandActionState>) => {
    setRunning(which);
    setState(null);
    startTransition(async () => {
      const result = await command();
      setState(result);
      setRunning(null);
      if (!result.error) onRefresh();
    });
  };

  const busy = pending || running !== null;
  const blocked = disabled || busy;

  return (
    <div className={styles.controls}>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={blocked}
          onClick={() => {
            setConfirming(false);
            run("search", onStartSearch);
          }}
        >
          {running === "search" ? (
            <RefreshCw aria-hidden="true" className={styles.spin} />
          ) : (
            <Search aria-hidden="true" />
          )}
          {running === "search" ? "Searching…" : "Start search"}
        </button>

        {confirming ? (
          <span className={styles.confirm} role="group" aria-label="Confirm sending">
            <span>
              Send {readyToSend} opening {readyToSend === 1 ? "email" : "emails"}?
            </span>
            <button
              type="button"
              className={styles.primary}
              disabled={blocked}
              onClick={() => {
                setConfirming(false);
                run("send", onSend);
              }}
            >
              <Send aria-hidden="true" /> Send
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.secondary}
            disabled={blocked || readyToSend === 0}
            onClick={() => setConfirming(true)}
          >
            {running === "send" ? (
              <RefreshCw aria-hidden="true" className={styles.spin} />
            ) : (
              <Mail aria-hidden="true" />
            )}
            {running === "send"
              ? "Sending…"
              : readyToSend === 0
                ? "Nothing ready to send"
                : `Send ${readyToSend} ${readyToSend === 1 ? "email" : "emails"}`}
          </button>
        )}
      </div>

      <p className={styles.note}>
        {paused
          ? "Scout is paused. Resume it before running a search."
          : running === "search"
            ? "Scoring listings against your preferences and researching the agent for each match. This can take a minute."
            : running === "send"
              ? "Sending the opening emails."
              : "Start search scores new listings and finds each agent. Sending is always a separate press."}
      </p>

      {state && (state.error || state.message) && (
        <p
          className={state.error ? styles.error : styles.result}
          role={state.error ? "alert" : "status"}
        >
          {state.error ?? state.message}
          {state.error && (
            <button type="button" onClick={onRefresh}>
              <RefreshCw aria-hidden="true" /> Refresh inbox
            </button>
          )}
        </p>
      )}
    </div>
  );
}
