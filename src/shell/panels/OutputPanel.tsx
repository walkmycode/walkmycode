"use client";
// The Run panel (owner, 14 Nov: "this whole section ... including debug ... should be able to move to its own
// panel section and toggle it at either the left or right sidebars"). The code's whole run section in a dock
// panel of its own: the run bar (Run, Debug, Run on), the live debugger, the program's input and the Output or
// Terminal, for the editor last run or used. That editor draws them here itself (src/ide/Ide.tsx, a portal
// into this panel's slot), so a run or a debug carries on as it moves, and the editor keeps its whole height.
// Like any panel it moves, tabs, floats, and sits in either sidebar, whose strip icon (ToolStrip) shows and
// hides it. With no editor to fill it (no file open yet), it shows the Output and Terminal on their own.
// Closing it (Dock back, or the tab's ×) puts everything back under the editor.
import { useCallback, useEffect, useSyncExternalStore } from "react";
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
    api.setTitle(label ? `Run · ${label}` : "Run");
  }, [api, label]);
  // The slot the owning editor draws into; gone with the panel.
  const slot = useCallback((el: HTMLDivElement | null) => outputs.setSlot(el), []);

  return (
    <div className="dock-panel ide frameless output-dock run-panel">
      <div className="run-panel-head">
        <span className="run-panel-of" title={label || undefined}>
          {label || "No file yet"}
        </span>
        <span className="sp" />
        <button className="ctl compact" type="button" onClick={() => api.close()} title="Put the run bar, the debugger and the output back under the editor">
          ⧈ Dock back
        </button>
      </div>
      <div className="run-slot" ref={slot} />
      {/* Shown only while the slot is empty (CSS): the Output and Terminal on their own. */}
      <div className="run-fallback">
        <OutputArea state={dock.owner ? state : NO_OWNER} title={label} />
      </div>
    </div>
  );
}

const NO_OWNER = { ...EMPTY_OUTPUT, hint: "Open a file and press Run or Debug: its run bar, debugger and output show here." };
