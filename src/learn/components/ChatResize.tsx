"use client";
// The professor's panel made wider or narrower from its left edge (the owner: "the chat's width should be resizable by
// dragging"), moved the way the Code room's split is: drag it, or the arrow keys (Shift for bigger steps); a
// double-click or Home gives the default back. The width is the studio's --prof-col (learn.css) and is remembered in
// this browser. Not shown where the studio stacks (a phone): there the panel is full width already.
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

const KEY = "walkmycode:learn-chat-width";
/** The narrowest the panel goes: its tabs and the ask box still fit. */
export const CHAT_MIN = 300;
/** The widest it goes: the board keeps at least a third of the room. */
export const CHAT_MAX_SHARE = 0.65;

/** A width the panel may take in a studio this wide. */
export function clampChat(px: number, studioWidth: number): number {
  const most = Math.max(CHAT_MIN, Math.floor(studioWidth * CHAT_MAX_SHARE));
  return Math.round(Math.min(most, Math.max(CHAT_MIN, px)));
}

const studioOf = (el: Element | null) => el?.closest<HTMLElement>(".studio") ?? null;

function remembered(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function remember(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(px));
  } catch {
    // Storage blocked: the width lasts until the page closes.
  }
}

export default function ChatResize() {
  const ref = useRef<HTMLDivElement>(null);
  /** The width set by the student, or null for the default. */
  const width = useRef<number | null>(null);

  const set = (px: number | null) => {
    const studio = studioOf(ref.current);
    if (!studio) return;
    width.current = px === null ? null : clampChat(px, studio.clientWidth);
    if (width.current === null) studio.style.removeProperty("--prof-col");
    else studio.style.setProperty("--prof-col", `${width.current}px`);
    ref.current?.setAttribute("aria-valuenow", String(Math.round(ref.current.parentElement?.getBoundingClientRect().width ?? 0)));
  };
  const shown = () => width.current ?? ref.current?.parentElement?.getBoundingClientRect().width ?? 420;

  // The width kept from last time, and kept inside the room when the window changes size.
  useEffect(() => {
    const saved = remembered();
    if (saved) set(saved);
    const onResize = () => {
      if (width.current !== null) set(width.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const studio = studioOf(e.currentTarget);
    if (e.button !== 0 || !studio) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    studio.classList.add("resizing");
    const right = studio.getBoundingClientRect().right;
    let next = shown();
    let frame = 0;
    const move = (ev: globalThis.PointerEvent) => {
      next = right - ev.clientX;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          set(next);
        });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      set(next);
      remember(width.current);
      studio.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Home") {
      e.preventDefault();
      set(null);
      remember(null);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    // The handle is on the panel's left edge: left makes the panel wider.
    set(shown() + (e.key === "ArrowLeft" ? 1 : -1) * (e.shiftKey ? 64 : 16));
    remember(width.current);
  };

  return (
    <div
      ref={ref}
      className="prof-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the professor's panel"
      aria-valuemin={CHAT_MIN}
      tabIndex={0}
      title="Drag to make the professor's panel wider or narrower · ← → keys move it · double-click resets it"
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={() => {
        set(null);
        remember(null);
      }}
      data-testid="chat-resize"
    />
  );
}
