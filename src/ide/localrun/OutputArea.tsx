"use client";
// The Output area with "Output | Terminal" where code can run on this computer
// (the full app, WalkMyCode for Claude; never Lite, never hosted): the run's
// output as before, or the terminals. The same switch under the editor and in
// the popped-out Output panel. Choosing Terminal the first time asks for
// consent (./Consent.tsx).
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Output from "../Output";
import type { OutputState } from "../outputStore";
import { LOCAL_BUILD, loadLocalStatus, localStatus, outputMode } from "./client";
import { useConsent } from "./Consent";
import "./localrun.css";

// xterm.js comes only with the terminal.
const TerminalPane = dynamic(() => import("./TerminalPane"), { ssr: false, loading: () => <div className="lr-terms"><p className="lr-term-empty">Starting the terminal…</p></div> });

/** The local-run status, asked once per page (null until it answers, and always in Lite). */
export function useLocalStatus() {
  useEffect(() => {
    if (LOCAL_BUILD) void loadLocalStatus();
  }, []);
  return useSyncExternalStore(localStatus.subscribe, localStatus.get, localStatus.get).status;
}

export default function OutputArea({ state, action, title }: { state: OutputState; action?: ReactNode; title?: string }) {
  const status = useLocalStatus();
  const mode = useSyncExternalStore(outputMode.subscribe, outputMode.get, outputMode.get);
  const { ask, dialog } = useConsent();
  if (!LOCAL_BUILD || !status?.available) return <Output state={state} action={action} title={title} />;

  const terminal = mode === "terminal" && status.allowed;
  const showTerminal = async () => {
    if (!status.allowed && !(await ask())) return;
    outputMode.set("terminal");
  };
  const tabs = (
    <div className="out-tabs" role="tablist" aria-label="Output or terminal">
      <button type="button" role="tab" aria-selected={!terminal} onClick={() => outputMode.set("output")}>
        Output
      </button>
      <button type="button" role="tab" aria-selected={terminal} onClick={() => void showTerminal()} title="A shell on this computer">
        Terminal
      </button>
    </div>
  );
  return (
    <>
      <Output state={state} action={action} title={terminal ? undefined : title} tabs={tabs}>
        {terminal ? <TerminalPane /> : undefined}
      </Output>
      {dialog}
    </>
  );
}
