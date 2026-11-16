"use client";
// Explore's mute in the top bar (lib/voice/mute.ts): one press silences tours,
// fly-throughs, Read aloud and Claude's narration; they keep their pace. The
// Learn room keeps its own "Read only".
import { setExploreMuted, useExploreMuted } from "@/lib/voice/mute";

export default function MuteButton() {
  const muted = useExploreMuted();
  const label = muted ? "Unmute: read tours and answers aloud again" : "Mute: nothing is read aloud; tours still move on by themselves";
  return (
    <button type="button" className={`ctl compact icon mute-btn${muted ? " on" : ""}`} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} title={label} onClick={() => setExploreMuted(!muted)} data-testid="explore-mute">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        {muted ? (
          <path d="M11 6l3.5 4M14.5 6l-3.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        ) : (
          <path d="M11 5.5c1.1 1.4 1.1 3.6 0 5M12.8 3.8c2 2.4 2 6 0 8.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
