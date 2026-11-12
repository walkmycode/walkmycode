"use client";
// The bar across the top of a room: one fixed-height row that never wraps.
// Left: the WalkMyCode brand and the Explore / Learn switch (never shrink).
// Middle: what is open, truncated with "…" and shown in full on hover.
// Right: the room's actions; on a phone they fold into a "⋯" menu. Last, when
// the room passes `ai`: the AI pill and the Settings gear, which never fold
// (the pill shrinks to "● AI" instead). WalkMyCode for Claude passes `gear`
// instead: the gear alone, since the user's own Claude answers there.
// Shared so the Learn room can use the same bar.
import { useEffect, useRef, useState } from "react";
import { RoomLink, useRoom } from "@/lib/adapters/nav";
import AiPill, { GearIcon } from "./AiPill";
import { MCP } from "@/lib/adapters/target";

const ROOMS = [
  { href: "/map", label: "Explore", title: "Explore a codebase: the map, the code and the guide" },
  { href: "/learn", label: "Learn", title: "Learn any subject, with code you can run" },
] as const;

export function RoomSwitch() {
  const path = useRoom();
  // WalkMyCode for Claude has one room (docs/MCP.md §5: the Learn room isn't part of it): no switch to
  // a tab that only says so.
  if (MCP) return null;
  return (
    <nav className="rooms" aria-label="Rooms">
      {ROOMS.map((r) => {
        const here = path === r.href || path.startsWith(`${r.href}/`);
        return (
          <RoomLink key={r.href} href={r.href} className={here ? "on" : undefined} aria-current={here ? "page" : undefined} title={r.title}>
            {r.label}
          </RoomLink>
        );
      })}
    </nav>
  );
}

interface Props {
  /** The name of what is open, e.g. the repo. */
  title?: React.ReactNode;
  /** One line of detail after the title; dropped first when space runs out. */
  detail?: string;
  /** A short notice under the bar's middle (e.g. "re-open the folder"). */
  notice?: React.ReactNode;
  /** Buttons that belong to the moment (clear trace), kept outside the "⋯" menu. */
  status?: React.ReactNode;
  /** The room's actions; folded into "⋯" on a phone. */
  children?: React.ReactNode;
  /** Show who answers (the AI pill) and the Settings gear; both open Settings with this.
   * Left out in WalkMyCode Lite, where the viewer's own Claude answers. */
  ai?: { onSettings: () => void; settingsOpen?: boolean };
  /** Just the Settings gear, where there's no AI pill (WalkMyCode for Claude). `shortcut`
   * goes in its tooltip, e.g. "Alt+6". */
  gear?: { onSettings: () => void; shortcut?: string };
}

export default function TopBar({ title, detail, notice, status, children, ai, gear }: Props) {
  const [open, setOpen] = useState(false);
  const actions = useRef<HTMLDivElement>(null);

  // Close the "⋯" menu on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!actions.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <header className="top">
      <div className="top-left">
        <RoomLink href="/" className="brand" data-light="home" aria-label="WalkMyCode home">
          <span className="brand-full">WalkMyCode</span>
          <span className="brand-short" aria-hidden>
            <i className="brand-dot" />
          </span>
        </RoomLink>
        <RoomSwitch />
      </div>
      <div className="top-mid" title={detail ? `${typeof title === "string" ? `${title} · ` : ""}${detail}` : undefined}>
        {title && <span className="top-title">{title}</span>}
        {detail && <span className="top-detail">{detail}</span>}
        {notice && <span className="top-notice">{notice}</span>}
      </div>
      {status && <div className="top-status">{status}</div>}
      {children && (
        <div className="top-right">
          <button type="button" className="ctl compact top-more" aria-expanded={open} aria-controls="top-actions" aria-label="More" onClick={() => setOpen((v) => !v)}>
            ⋯
          </button>
          <div id="top-actions" ref={actions} className={`top-actions${open ? " open" : ""}`}>
            {children}
          </div>
        </div>
      )}
      {ai && <AiPill onSettings={ai.onSettings} settingsOpen={ai.settingsOpen} />}
      {!ai && gear && (
        <div className="top-ai">
          <button type="button" className="iconbtn" onClick={gear.onSettings} aria-label="Settings" title={gear.shortcut ? `Settings (${gear.shortcut})` : "Settings"}>
            <GearIcon />
          </button>
        </div>
      )}
    </header>
  );
}
