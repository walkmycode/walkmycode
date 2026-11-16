"use client";
// The desktop app's window buttons (docs/DESKTOP.md, "Title bar"; mockup in
// docs/design/desktop-titlebar.html): minimise, maximise / restore and close. The
// windows have no frame of their own, so these are their only buttons: at the main
// window's top bar's right end, and at the end of a popped-out panel's tab bar
// (`win`, src/shell/GroupActions.tsx), where closing docks the panel back.
// Rendered only in the desktop app; in a browser this is nothing.
import { useEffect, useState } from "react";
import { appWindowOf, useDesktop } from "@/lib/desktop";

/** Line icons on the tool strips' 16px grid (src/shell/ToolStrip.tsx), square caps for square corners. */
const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "square" } as const;
const ICONS = {
  minimise: <path d="M3 8.5h10" {...s} />,
  maximise: <rect x="3.5" y="3.5" width="9" height="9" {...s} />,
  restore: (
    <>
      <rect x="3" y="5.5" width="7.5" height="7.5" {...s} />
      <path d="M5.5 5.5V3H13v7.5h-2.5" {...s} />
    </>
  ),
  close: <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" {...s} />,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="winctl-ico" viewBox="0 0 16 16" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export default function WindowControls({ win, closeLabel = "Close" }: { win?: Window; closeLabel?: string }) {
  const desktop = useDesktop();
  const [maximised, setMaximised] = useState(false);
  const [focused, setFocused] = useState(true);

  // Follow the window: maximised (also by double-clicking the bar, Win+Up or Snap) and focused.
  useEffect(() => {
    if (!desktop) return;
    const target = win ?? window;
    const app = appWindowOf(target);
    if (!app) return;
    let gone = false;
    // Double-clicking the bar maximises the window under the pointer, so the second click lands on
    // the page and selects the word there. A selection made as the window changes size is dropped.
    let resizedAt = 0;
    const unselect = () => {
      if (performance.now() - resizedAt < 400) target.getSelection()?.removeAllRanges();
    };
    const sync = () => {
      resizedAt = performance.now();
      void app.isMaximized().then((m) => !gone && setMaximised(m), () => {});
    };
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    void app.isMaximized().then((m) => !gone && setMaximised(m), () => {});
    // Where focus is now, once this frame is done (not straight from the effect).
    const first = requestAnimationFrame(() => !gone && setFocused(target.document.hasFocus()));
    target.document.addEventListener("selectionchange", unselect);
    target.addEventListener("resize", sync);
    target.addEventListener("focus", onFocus);
    target.addEventListener("blur", onBlur);
    return () => {
      gone = true;
      cancelAnimationFrame(first);
      target.document.removeEventListener("selectionchange", unselect);
      target.removeEventListener("resize", sync);
      target.removeEventListener("focus", onFocus);
      target.removeEventListener("blur", onBlur);
    };
  }, [desktop, win]);

  if (!desktop) return null;
  const act = (fn: "minimize" | "toggleMaximize" | "close") => () => void appWindowOf(win ?? window)?.[fn]().catch(() => {});
  return (
    <div className={`winctl${focused ? "" : " away"}`} role="group" aria-label="Window">
      <button type="button" onClick={act("minimize")} title="Minimise" aria-label="Minimise">
        <Icon name="minimise" />
      </button>
      <button type="button" onClick={act("toggleMaximize")} title={maximised ? "Restore" : "Maximise"} aria-label={maximised ? "Restore" : "Maximise"}>
        <Icon name={maximised ? "restore" : "maximise"} />
      </button>
      <button type="button" className="winctl-close" onClick={act("close")} title={closeLabel} aria-label={closeLabel}>
        <Icon name="close" />
      </button>
    </div>
  );
}
