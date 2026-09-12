"use client";

import { Pause, Play, RefreshCw } from "lucide-react";
import type { CommandActionState } from "@/lib/inbox-command";
import styles from "./search-pause-control.module.css";

export function SearchPauseControl({
  paused,
  compact = false,
  action,
  state,
  pending,
  disabled,
  onRefresh,
}: {
  paused: boolean;
  compact?: boolean;
  action: (form: FormData) => void;
  state: CommandActionState;
  pending: boolean;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const label = paused ? "Resume Scout" : "Pause Scout";
  const Icon = paused ? Play : Pause;
  return (
    <form
      action={action}
      className={compact ? styles.compact : styles.control}
      aria-busy={pending}
    >
      <input type="hidden" name="intent" value={paused ? "resume" : "pause"} />
      <input type="hidden" name="expected_paused" value={String(paused)} />
      <button
        type="submit"
        disabled={disabled || pending}
        aria-label={compact ? label : undefined}
      >
        <Icon aria-hidden="true" />
        {!compact && (pending ? "Saving…" : label)}
      </button>
      <div className={state.error ? styles.error : styles.feedback}>
        {state.error ?? state.message}
        {state.error && (
          <button type="button" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" /> Refresh inbox
          </button>
        )}
      </div>
    </form>
  );
}
