"use client";
// A sheet over the page (docs/design/home-redesign.html, screen 2): a dimmed
// backdrop under the top bar, so the bar stays in reach, and a card that pops
// in ("dialog") or a panel along the right edge ("drawer"). Escape, a click on
// the backdrop or the sheet's own buttons close it; Tab stays inside while it
// is open, and focus goes back where it was. Drawn into the app's root, which
// carries the fonts, not inside the top bar.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The dialog's name for screen readers: the id of its heading, or a plain label. */
  labelledBy?: string;
  label?: string;
  onClose: () => void;
  variant?: "dialog" | "drawer";
  className?: string;
  children: React.ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sheet({ labelledBy, label, onClose, variant = "dialog", className, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = panel.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`sheet-backdrop ${variant}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} tabIndex={-1} className={`sheet ${variant}${className ? ` ${className}` : ""}`}>
        {children}
      </div>
    </div>,
    document.querySelector(".root") ?? document.body,
  );
}
