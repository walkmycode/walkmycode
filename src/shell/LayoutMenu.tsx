"use client";
// "Layout ▾" in the top bar: the presets, show or hide a panel, and reset.
// A real menu: arrow keys move, Enter or Space chooses, Escape closes.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { terminalButton, useTerminalAvailable } from "@/ide/localrun/TerminalButton";
import { PANELS, type PanelId } from "./panels";
import { PRESETS } from "./layout";
import { useShell } from "./WorkspaceProvider";

export default function LayoutMenu() {
  const { shell } = useShell();
  const open = shell.layoutMenu;
  const setOpen = shell.setLayoutMenu;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The top bar's ">_": shown or hidden from here, where code can run on this computer.
  const canTerm = useTerminalAvailable();
  const termShown = useSyncExternalStore(terminalButton.subscribe, terminalButton.get, () => true);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [])];

  // Opening moves focus to the checked preset (or the first item); a click outside closes.
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>("[aria-checked='true']") ?? items()[0];
    first?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpen]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      list[e.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const toggles = Object.keys(PANELS).filter((id) => PANELS[id].available && !PANELS[id].pinned);

  return (
    <div className="layout-menu">
      <button
        ref={button}
        type="button"
        className="ctl compact"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="layout-menu"
        title="Arrange the panels (Ctrl+Shift+L)"
        onClick={() => setOpen(!open)}
      >
        Layout ▾
      </button>
      {open && (
        <div id="layout-menu" ref={menu} role="menu" aria-label="Layout" className="panel menu" onKeyDown={onKey}>
          <div role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                role="menuitemradio"
                aria-checked={shell.presetName === p.name}
                tabIndex={-1}
                onClick={() => {
                  shell.preset(p.name);
                  close();
                }}
              >
                <span className="tick" aria-hidden>
                  {shell.presetName === p.name ? "●" : ""}
                </span>
                <span>
                  {p.label}
                  <small>{p.hint}</small>
                </span>
              </button>
            ))}
            {shell.presetName === "custom" && <p className="note menu-note">Your own arrangement (saved).</p>}
          </div>
          <hr />
          <div role="group" aria-label="Panels">
            {toggles.map((id) => {
              const on = shell.present.includes(id);
              return (
                <button key={id} type="button" role="menuitemcheckbox" aria-checked={on} tabIndex={-1} onClick={() => shell.toggle(id as PanelId)}>
                  <span className="tick" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <span>
                    {PANELS[id].title}
                    <small>Alt+{PANELS[id].shortcut}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {canTerm && (
            <>
              <hr />
              <div role="group" aria-label="Top bar">
                <button type="button" role="menuitemcheckbox" aria-checked={termShown} tabIndex={-1} onClick={() => terminalButton.set(!termShown)}>
                  <span className="tick" aria-hidden>
                    {termShown ? "✓" : ""}
                  </span>
                  <span>
                    Terminal button
                    <small>Ctrl+`</small>
                  </span>
                </button>
              </div>
            </>
          )}
          <hr />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              shell.reset();
              close();
            }}
          >
            <span className="tick" aria-hidden />
            <span>
              Reset layout
              <small>Ctrl+Shift+0</small>
            </span>
          </button>
          <p className="note menu-note">Drag a tab to move it · Shift-drag to float · ⧉ float · ↗ window · ⧈ dock · all shortcuts in Settings</p>
        </div>
      )}
    </div>
  );
}
