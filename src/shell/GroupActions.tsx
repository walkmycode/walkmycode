"use client";
// The buttons at the right of each group's tab bar: float, pop out into a
// window, dock back, maximise. Which ones show depends on where the group is
// (the `location` prop). The group's element carries data-location so the
// CSS can mark an undocked group with a beacon.
// In the desktop app a popped-out group's tab bar is its window's title bar
// (docs/DESKTOP.md, "Pop-outs"): its empty space drags the window, and the
// window's own buttons end it. Closing that window docks the panel back.
import { useEffect } from "react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import WindowControls from "@/components/WindowControls";
import { appWindowOf, useDesktop } from "@/lib/desktop";
import { useShell } from "./WorkspaceProvider";
import { capabilities } from "./theme";

export default function GroupActions({ group, location }: IDockviewHeaderActionsProps) {
  const { shell } = useShell();
  const where = location?.type ?? group.api.location.type;
  const desktop = useDesktop();
  const titleBar = desktop && where === "popout";
  const win = titleBar && group.api.location.type === "popout" ? group.api.location.getWindow() : undefined;

  useEffect(() => {
    const mark = () => group.element.setAttribute("data-location", group.api.location.type);
    mark();
    const d = group.api.onDidLocationChange(mark);
    return () => d.dispose();
  }, [group]);

  // The tab bar's empty space drags the pop-out's window, and a double press maximises or restores it.
  // Dockview takes the pointer on that space (it drags groups there), so Tauri's own drag region,
  // which waits for a mousedown, never hears it: the press is caught first, here, and handed to the
  // pop-out's window. Tabs and buttons are other elements and work as before.
  useEffect(() => {
    if (!titleBar || !win) return;
    const app = appWindowOf(win);
    const bar = group.element.querySelector<HTMLElement>(".dv-tabs-and-actions-container");
    if (!app || !bar) return;
    // The pop-out's own elements: instanceof would test against the main window's Element.
    const drags = (t: EventTarget | null) => !!t && (t === bar || !!(t as Element).classList?.contains("dv-void-container"));
    // A pointer press carries no click count, so a double press is two within the double-click time, in place.
    let last = { at: -Infinity, x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !drags(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const double = e.timeStamp - last.at < 500 && Math.abs(e.screenX - last.x) < 5 && Math.abs(e.screenY - last.y) < 5;
      last = double ? { at: -Infinity, x: 0, y: 0 } : { at: e.timeStamp, x: e.screenX, y: e.screenY };
      void (double ? app.toggleMaximize() : app.startDragging()).catch(() => {});
    };
    bar.addEventListener("pointerdown", down, true);
    bar.classList.add("is-titlebar");
    return () => {
      bar.removeEventListener("pointerdown", down, true);
      bar.classList.remove("is-titlebar");
    };
  }, [group, titleBar, win]);

  return (
    <div className="hdr-acts">
      {where === "grid" && (
        <button type="button" className="hdr-act" aria-label="Float this group" title="Float (Ctrl+Shift+F)" onClick={() => shell.float(group.id)}>
          ⧉
        </button>
      )}
      {capabilities.popout && where !== "popout" && (
        <button type="button" className="hdr-act" aria-label="Pop this group out into a window" title="Pop out into a window (Ctrl+Shift+O)" onClick={() => void shell.popout(group.id)}>
          ↗
        </button>
      )}
      {where !== "grid" && (
        <button type="button" className="hdr-act" aria-label="Dock this group back" title="Dock back (Ctrl+Shift+D, or Esc when floating)" onClick={() => shell.dock(group.id)}>
          ⧈
        </button>
      )}
      {where === "grid" && (
        <button type="button" className="hdr-act" aria-label="Maximise or restore this group" title="Maximise or restore (Ctrl+Shift+M)" onClick={() => shell.maximise(group.id)}>
          ⛶
        </button>
      )}
      {titleBar && win && <WindowControls win={win} closeLabel="Close (the panel docks back)" />}
    </div>
  );
}
