"use client";
// Who answers, as GET /api/config says (src/lib/aiPill.ts reads it): asked once
// per page when the first pill shows, and again whenever Settings or the setup
// sheet saves (the `settings-saved` event). One store, so the pill and the sheet
// never disagree. Keys never come back from the server, only whether one is set.
import { useSyncExternalStore } from "react";
import type { AiConfig, AiStatus } from "./aiPill";

let status: AiStatus = { state: "loading" };
let asking: Promise<void> | null = null;
/** A save landed while a request was out: ask once more when it is back. */
let again = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: AiStatus) {
  status = next;
  for (const l of listeners) l();
}

/** Ask the server again (after a save, or when the setup sheet opens). */
export function refreshAi(): Promise<void> {
  if (asking) {
    again = true;
    return asking;
  }
  asking = fetch("/api/config")
    .then(async (r) => {
      if (!r.ok) throw new Error(`The WalkMyCode server answered ${r.status}.`);
      set({ state: "ok", config: (await r.json()) as AiConfig });
    })
    .catch((e: Error) => set({ state: "failed", message: e.message }))
    .finally(() => {
      asking = null;
      if (again) {
        again = false;
        void refreshAi();
      }
    });
  return asking;
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!started) {
    started = true;
    void refreshAi();
    window.addEventListener("settings-saved", () => void refreshAi());
  }
  return () => {
    listeners.delete(l);
  };
}

const LOADING: AiStatus = { state: "loading" };

export function useAiStatus(): AiStatus {
  return useSyncExternalStore(subscribe, () => status, () => LOADING);
}
