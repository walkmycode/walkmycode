"use client";
// The connected AI app's name for any component of the MCP page ("Claude",
// "Antigravity", "Cursor"…, src/lib/bridge/clientName.ts). The page host
// (McpHost) sets it from the bridge's status, so shared components (the Guide,
// the header badge, Settings) can name the client without loading the bridge.
import { useSyncExternalStore } from "react";
import { FALLBACK_CLIENT } from "@/lib/bridge/clientName";

let name = FALLBACK_CLIENT;
/** No AI app at all: the server runs in terminal mode and the page answers with its own key. */
let standalone = false;
const listeners = new Set<() => void>();

const changed = () => {
  for (const l of [...listeners]) l();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function setAiName(next: string | null | undefined): void {
  const n = next?.trim() || FALLBACK_CLIENT;
  if (n === name) return;
  name = n;
  changed();
}

export function aiNameNow(): string {
  return name;
}

/** The page host says whether an AI app is connected at all (the server's `standalone` status). */
export function setStandalone(next: boolean): void {
  if (next === standalone) return;
  standalone = next;
  changed();
}

/** The connected AI app's name, or "your AI app" until it has said ("your AI model" in terminal mode). */
export function useAiName(): string {
  return useSyncExternalStore(subscribe, () => name, () => FALLBACK_CLIENT);
}

/** True when WalkMyCode runs from a terminal with no AI app: the page's own provider answers everything. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, () => standalone, () => false);
}
