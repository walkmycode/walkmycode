"use client";
// Settings from the home page: the Settings view full screen under the top bar
// (docs/design/home-redesign.html, screen 3), where the gear turns into ✕. The
// page keeps the pane in the URL hash (#settings/voice). Escape closes it, and
// focus goes back where it was. Loaded only when it opens.
import { useEffect, useRef } from "react";
import SettingsView from "@/components/settings/SettingsView";
import type { PaneId } from "@/lib/settingsNav";
import { CloseIcon } from "./icons";

interface Props {
  pane: PaneId;
  onPane: (p: PaneId) => void;
  onClose: () => void;
  /** A close button of its own, where the top bar has no gear to turn into ✕ (WalkMyCode Lite). */
  closeHere: boolean;
}

export default function SettingsPage({ pane, onPane, onClose, closeHere }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus moves into Settings (Tab reaches the menu next), without lighting a tab up.
    box.current?.focus({ preventScroll: true });
    // A sheet over Settings (the setup sheet) takes Escape first and stops it there.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div ref={box} className="setv-page" role="region" aria-label="Settings" tabIndex={-1}>
      {closeHere && (
        <button type="button" className="iconbtn setv-close" onClick={onClose} aria-label="Close Settings">
          <CloseIcon />
        </button>
      )}
      <SettingsView variant="page" pane={pane} onPane={onPane} />
    </div>
  );
}
