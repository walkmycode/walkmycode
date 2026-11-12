"use client";
// The code's output in a dock panel of its own (src/ide/outputStore.ts): it
// shows the output of the editor last run or used, the same entry that editor
// would draw under itself. While this panel is mounted the output is "popped
// out"; closing it (Dock back, or the tab's ×) puts it back under the editor.
import { useEffect, useSyncExternalStore } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import OutputArea from "@/ide/localrun/OutputArea";
import { EMPTY_OUTPUT, outputs } from "@/ide/outputStore";
import "@/ide/ide.css";

export default function OutputPanel({ api }: IDockviewPanelProps) {
  useEffect(() => outputs.attachPanel(), []);
  const dock = useSyncExternalStore(outputs.subscribe, outputs.dock, outputs.dock);
  const state = useSyncExternalStore(
    outputs.subscribe,
    () => outputs.get(dock.owner),
    () => outputs.get(dock.owner),
  );
  const label = dock.owner ? state.label : "";
  useEffect(() => {
    api.setTitle(label ? `Output · ${label}` : "Output");
  }, [api, label]);

  const dockBack = (
    <button className="ctl" type="button" onClick={() => api.close()} title="Put the output back under the editor">
      ⧈ Dock back
    </button>
  );
  return (
    <div className="dock-panel ide frameless output-dock">
      {/* With "Output | Terminal" where code can run on this computer (src/ide/localrun). */}
      <OutputArea state={dock.owner ? state : NO_OWNER} title={label} action={dockBack} />
    </div>
  );
}

const NO_OWNER = { ...EMPTY_OUTPUT, hint: "Open a file and press Run: its output shows here." };
