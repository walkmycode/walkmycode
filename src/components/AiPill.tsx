"use client";
// The top bar's AI pill and Settings gear (docs/design/home-redesign.html).
// Ready: "● AI · Claude Opus 5.5" in green, and a click opens Settings. Not
// ready: an amber "Set up AI", and a click opens the setup sheet. The sheet
// (SetupAI) is loaded only when it opens, or when the pointer heads for the
// pill; it also opens by itself the first time the guide finds no AI set up
// (the SETUP_EVENT, src/lib/aiPill.ts), and from the guide's "Open settings".
// Not in WalkMyCode Lite, where the viewer's own Claude answers.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { pillState, SETUP_EVENT } from "@/lib/aiPill";
import { CloseIcon } from "./home/icons";
import { useAiStatus } from "@/lib/aiStatus";
import { OPEN_SETTINGS, paneOf } from "@/lib/settingsNav";

const loadSheet = () => import("./SetupAI");
const SetupAI = dynamic(loadSheet, { ssr: false });

export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export default function AiPill({ onSettings, settingsOpen = false }: { onSettings: () => void; settingsOpen?: boolean }) {
  const status = useAiStatus();
  const pill = pillState(status);
  const [sheet, setSheet] = useState(false);
  // The listeners below read the latest without being added again on every change.
  const latest = useRef({ ready: false, onSettings });
  useEffect(() => {
    latest.current = { ready: pill.kind === "ready", onSettings };
  });

  useEffect(() => {
    const open = () => setSheet(true);
    // "Open settings" from the guide's errors (the dock shows Settings → AI model): when nothing
    // answers yet, the setup sheet opens over it.
    const settings = (e: Event) => {
      if (!latest.current.ready && paneOf(e) === "ai") setSheet(true);
    };
    window.addEventListener(SETUP_EVENT, open);
    window.addEventListener(OPEN_SETTINGS, settings);
    return () => {
      window.removeEventListener(SETUP_EVENT, open);
      window.removeEventListener(OPEN_SETTINGS, settings);
    };
  }, []);

  const click = () => {
    if (pill.kind === "ready") onSettings();
    else if (pill.kind === "setup") setSheet(true);
  };
  const warm = () => {
    if (pill.kind !== "ready") void loadSheet();
  };

  return (
    <div className="top-ai">
      <button
        type="button"
        className={`ai-pill ${pill.kind}`}
        onClick={click}
        onPointerEnter={warm}
        onFocus={warm}
        aria-disabled={pill.kind === "loading" || undefined}
        aria-label={pill.kind === "ready" ? `AI: ${pill.model}. Open Settings` : pill.kind === "setup" ? "Set up AI" : "AI"}
        title={pill.kind === "loading" ? "Checking who answers…" : pill.title}
      >
        <span className="ai-led" aria-hidden />
        {/* Keyed by state, so the words fade in when readiness is known rather than jump. */}
        {pill.kind === "setup" ? (
          <span key="setup" className="ai-txt">
            <span className="ai-word">Set up </span>AI
          </span>
        ) : (
          <span key={pill.kind} className="ai-txt">
            AI
            {pill.kind === "ready" && (
              <span className="ai-model">
                <span className="ai-sep"> · </span>
                <b>{pill.model}</b>
              </span>
            )}
          </span>
        )}
      </button>
      <button type="button" className="iconbtn" onClick={onSettings} aria-label={settingsOpen ? "Close Settings" : "Settings"} title={settingsOpen ? "Close Settings" : "Settings"} aria-expanded={settingsOpen}>
        {settingsOpen ? <CloseIcon /> : <GearIcon />}
      </button>
      {sheet && <SetupAI status={status} onClose={() => setSheet(false)} />}
    </div>
  );
}
