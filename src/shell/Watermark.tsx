"use client";
// What an empty dock says: every panel was closed or floated away.
import { useShell } from "./WorkspaceProvider";

export default function Watermark() {
  const { shell } = useShell();
  return (
    <div className="dock-empty">
      <p className="note">Nothing is docked here.</p>
      <button type="button" className="ctl compact" onClick={() => shell.reset()}>
        Reset layout
      </button>
    </div>
  );
}
