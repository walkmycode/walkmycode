"use client";
// The terminal one click away: a ">_" in the top bar (its name shows on hover),
// or Ctrl+` as in VS Code. The Output panel opens (or comes forward) on its
// Terminal tab, and the TerminalPane starts a shell when none is open. The
// first time, the same consent as the Terminal tab asks first (./Consent.tsx).
// Layout ▾ → "Terminal button" hides or shows the icon (this browser
// remembers); Ctrl+` works either way. Only where code can run on this
// computer (the full app, WalkMyCode for Claude; never Lite).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { outputs } from "../outputStore";
import { LOCAL_BUILD, outputMode } from "./client";
import { useConsent } from "./Consent";
import { useLocalStatus } from "./OutputArea";

const KEY = "walkmycode.terminalButton";
let shown: boolean | null = null;
const subs = new Set<() => void>();

/** Whether the top bar shows the terminal icon: on unless the user turned it off in Layout. */
export const terminalButton = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  get(): boolean {
    if (shown === null) {
      try {
        shown = localStorage.getItem(KEY) !== "off";
      } catch {
        shown = true;
      }
    }
    return shown;
  },
  set(on: boolean) {
    shown = on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // private window: remembered for this page only
    }
    subs.forEach((f) => f());
  },
};

/** Whether this page can open a terminal at all (Layout shows the toggle only then). */
export function useTerminalAvailable(): boolean {
  const status = useLocalStatus();
  return LOCAL_BUILD && !!status?.available;
}

export default function TerminalButton() {
  const status = useLocalStatus();
  const { ask, dialog } = useConsent();
  const ready = LOCAL_BUILD && !!status?.available;
  const allowed = !!status?.allowed;
  const visible = useSyncExternalStore(terminalButton.subscribe, terminalButton.get, () => true);

  const open = useCallback(async () => {
    if (!allowed && !(await ask())) return;
    outputMode.set("terminal");
    outputs.show();
  }, [allowed, ask]);

  useEffect(() => {
    if (!ready) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "`" || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      void open();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ready, open]);

  if (!ready) return null;
  return (
    <>
      {visible && (
        <button type="button" className="ctl compact term-btn" onClick={() => void open()} data-tip="Terminal · Ctrl+`" aria-label="Open a terminal (Ctrl+`)">
          <span className="term-ico" aria-hidden>
            &gt;_
          </span>
        </button>
      )}
      {dialog}
    </>
  );
}
