"use client";
/**
 * "Larger": a scene or a diagram in an answer fills the window. An answer
 * sits inside a docked panel, where a fixed box is still held inside the
 * panel, so while it is large the scene is drawn in the app's root instead
 * (where the fonts and the theme still reach it), in the window it is in (a
 * pop-out has its own). It takes the focus, so the arrow keys still step it.
 */
import { useCallback, useEffect, useState, type ReactElement, type ReactPortal, type RefObject } from "react";
import { createPortal } from "react-dom";

export function useFull(root: RefObject<HTMLElement | null>) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const setFull = useCallback(
    (to: boolean | ((was: boolean) => boolean)) =>
      setHost((was) => {
        const on = typeof to === "function" ? to(!!was) : to;
        if (!on) return null;
        return was ?? root.current?.closest<HTMLElement>(".root") ?? root.current?.ownerDocument.body ?? null;
      }),
    [root],
  );
  const full = !!host;
  useEffect(() => {
    if (full) root.current?.focus({ preventScroll: true });
  }, [full, root]);
  const wrap = (node: ReactElement): ReactElement | ReactPortal => (host ? createPortal(node, host) : node);
  return { full, setFull, wrap };
}
