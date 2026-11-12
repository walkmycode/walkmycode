"use client";
// The tool-window strips either side of the dock, as in an IDE (RustRover's left and right bars):
// one icon per panel, on the side where that panel sits. A click shows a hidden panel, brings a
// background tab forward, or, when the panel is already in front, hides its whole group so the
// others get the room. Hidden groups keep their size and come back where they were; anything that
// brings a panel forward (a question, a tour, opening a file) shows its group again (Workspace.tsx).
import { useEffect, useReducer } from "react";
import type { DockviewApi } from "dockview-react";
import { PANELS } from "./panels";
import { clickStrip, stripItems, type Side, type SideMemory } from "./stripRules";
import { useShell } from "./WorkspaceProvider";

/** Shared by both strips: where each icon was last seen, so a hidden group's icons don't jump sides. */
const memory: SideMemory = new Map();

export default function ToolStrip({ side, api, dock }: { side: Side; api: DockviewApi | null; dock: React.RefObject<HTMLElement | null> }) {
  const { shell } = useShell();
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  // Sides are measured from the laid-out dock: redraw a frame after dockview changes it, and when it resizes.
  useEffect(() => {
    if (!api) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => redraw());
    };
    const subs = [api.onDidLayoutChange(later), api.onDidActivePanelChange(later), api.onDidAddPanel(later), api.onDidRemovePanel(later), api.onDidMovePanel(later)];
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    if (dock.current) ro?.observe(dock.current);
    later();
    return () => {
      cancelAnimationFrame(frame);
      subs.forEach((d) => d.dispose());
      ro?.disconnect();
    };
  }, [api, dock]);

  if (!api) return <div className={`tool-strip ${side}`} aria-hidden />;
  const box = dock.current?.getBoundingClientRect();
  const items = stripItems(api, box ?? { left: 0, right: window.innerWidth }, memory).filter((i) => i.side === side);

  // A toolbar: Tab reaches it once, the arrow keys move between its buttons.
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    e.preventDefault();
    list[next]?.focus();
  };

  return (
    <div className={`tool-strip ${side}`} role="toolbar" aria-orientation="vertical" aria-label={side === "left" ? "Panels on the left" : "Panels on the right"} onKeyDown={onKey}>
      {items.map((i, n) => {
        const def = PANELS[i.id];
        const what = !i.present ? "Open" : i.on ? "Hide" : "Show";
        return (
          <button
            key={i.id}
            type="button"
            tabIndex={n === 0 ? 0 : -1}
            className={`tool-btn${i.on ? " on" : ""}${i.present ? "" : " closed"}`}
            aria-pressed={i.on}
            aria-label={def.title}
            title={`${what} ${def.title} · Alt+${def.shortcut} shows it`}
            onClick={() => {
              clickStrip(api, i.id, shell.reveal);
              redraw();
            }}
          >
            <PanelIcon id={i.id} />
          </button>
        );
      })}
    </div>
  );
}

/** Line icons on a 16px grid, drawn in the text colour. */
function PanelIcon({ id }: { id: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const shapes: Record<string, React.ReactNode> = {
    map: (
      <>
        <rect x="1.5" y="2" width="4.5" height="3.5" rx="1" {...s} />
        <rect x="10" y="2" width="4.5" height="3.5" rx="1" {...s} />
        <rect x="5.75" y="10.5" width="4.5" height="3.5" rx="1" {...s} />
        <path d="M6 3.75h4M3.75 5.5v2.5h4.25v2.5M12.25 5.5v2.5H8" {...s} />
      </>
    ),
    "code:home": <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 2.5 7 13.5" {...s} />,
    files: <path d="M1.75 4.25c0-.7.55-1.25 1.25-1.25h3l1.5 1.75H13c.7 0 1.25.55 1.25 1.25v6.25c0 .7-.55 1.25-1.25 1.25H3c-.7 0-1.25-.55-1.25-1.25z" {...s} />,
    guide: <path d="M2 3.25C2 2.56 2.56 2 3.25 2h9.5C13.44 2 14 2.56 14 3.25v6.5c0 .69-.56 1.25-1.25 1.25H7l-3.25 3v-3h-.5C2.56 11 2 10.44 2 9.75zM5 5.5h6M5 8h3.5" {...s} />,
    details: (
      <>
        <circle cx="8" cy="8" r="6.25" {...s} />
        <path d="M8 7.25V11M8 5v.01" {...s} />
      </>
    ),
    settings: (
      <>
        <circle cx="8" cy="8" r="2.25" {...s} />
        <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" {...s} />
      </>
    ),
    output: (
      <>
        <rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" {...s} />
        <path d="m4.5 6.5 2 1.75-2 1.75M8.5 10.5h3" {...s} />
      </>
    ),
  };
  return (
    <svg className="tool-ico" viewBox="0 0 16 16" aria-hidden>
      {shapes[id]}
    </svg>
  );
}
