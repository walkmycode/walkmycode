"use client";
// The buttons at the right of each group's tab bar: float, pop out into a
// window, dock back, maximise. Which ones show depends on where the group is
// (the `location` prop). The group's element carries data-location so the
// CSS can mark an undocked group with a beacon.
import { useEffect } from "react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { useShell } from "./WorkspaceProvider";
import { capabilities } from "./theme";

export default function GroupActions({ group, location }: IDockviewHeaderActionsProps) {
  const { shell } = useShell();
  const where = location?.type ?? group.api.location.type;

  useEffect(() => {
    const mark = () => group.element.setAttribute("data-location", group.api.location.type);
    mark();
    const d = group.api.onDidLocationChange(mark);
    return () => d.dispose();
  }, [group]);

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
    </div>
  );
}
