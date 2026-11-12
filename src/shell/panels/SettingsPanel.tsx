"use client";
// Settings as a dock panel: the same Settings view as the home page
// (src/components/settings/SettingsView.tsx), compact. The pane in view is kept
// here, and survives the tab closing and opening again; "Open settings" from an
// error (the guide's, the voice's) brings the pane it is about.
import { useEffect, useState } from "react";
import SettingsView from "@/components/settings/SettingsView";
import { OPEN_SETTINGS, paneOf, takeWanted, type PaneId } from "@/lib/settingsNav";

let last: PaneId = "ai";

export default function SettingsPanel() {
  const [pane, setPane] = useState<PaneId>(() => takeWanted() ?? last);
  useEffect(() => {
    last = pane;
  }, [pane]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      takeWanted(); // this view is open: the ask is answered here
      const p = paneOf(e);
      if (p) setPane(p);
    };
    window.addEventListener(OPEN_SETTINGS, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS, onOpen);
  }, []);
  return (
    <div className="dock-panel scroll">
      <SettingsView variant="dock" pane={pane} onPane={setPane} />
    </div>
  );
}
