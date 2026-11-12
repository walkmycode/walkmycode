// The splitter between the editor and its output (Ide.tsx): how far it may
// go, how a key moves it, and where it is kept. Pure, so the tests run
// without a browser. The split is the editor's share of the space the two
// share (0…1); the output gets the rest.
import { readPref, removePref } from "../lib/prefs";

/** "rows": editor above the output (Explore, phones). "cols": side by side (Learn on a wide screen). */
export type SplitAxis = "rows" | "cols";

export const SPLIT_KEYS: Record<SplitAxis, string> = {
  rows: "walkmycode.ide.split.rows",
  cols: "walkmycode.ide.split.cols",
};
export const SPLIT_DEFAULT: Record<SplitAxis, number> = { rows: 0.62, cols: 0.56 };
/** The least each part may have, in px: the editor with its Run bar, and the output with its header. */
export const SPLIT_MIN: Record<SplitAxis, { first: number; second: number }> = {
  rows: { first: 160, second: 90 },
  cols: { first: 280, second: 220 },
};
/** The handle's own thickness, in px (ide.css .ide-split). */
export const SPLIT_GUTTER = 10;

/**
 * A split kept inside its limits for a box of `total` px. With no size known
 * (0) only the 5–95 % bounds apply; in a box too small for both minimums the
 * space is shared in proportion to them.
 */
export function clampSplit(f: number, axis: SplitAxis, total = 0): number {
  const v = Number.isFinite(f) ? f : SPLIT_DEFAULT[axis];
  const avail = total - SPLIT_GUTTER;
  if (!(avail > 0)) return Math.min(0.95, Math.max(0.05, v));
  const { first, second } = SPLIT_MIN[axis];
  if (avail < first + second) return first / (first + second);
  const lo = first / avail;
  const hi = 1 - second / avail;
  return Math.min(hi, Math.max(lo, v));
}

/** Where a key moves the split, or null for a key the handle does not use. */
export function stepSplit(f: number, key: string, axis: SplitAxis, total = 0, big = false): number | null {
  const step = big ? 0.12 : 0.04;
  const back = axis === "rows" ? "ArrowUp" : "ArrowLeft";
  const fwd = axis === "rows" ? "ArrowDown" : "ArrowRight";
  switch (key) {
    case back:
      return clampSplit(f - step, axis, total);
    case fwd:
      return clampSplit(f + step, axis, total);
    case "PageUp":
      return clampSplit(f - 0.12, axis, total);
    case "PageDown":
      return clampSplit(f + 0.12, axis, total);
    case "Home":
      return clampSplit(0, axis, total);
    case "End":
      return clampSplit(1, axis, total);
    default:
      return null;
  }
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The user's split for this axis, or the default. Unreadable or odd values fall back to the default. */
export function readSplit(store: Store | null | undefined, axis: SplitAxis): number {
  try {
    const raw = store ? readPref(store, SPLIT_KEYS[axis]) : null;
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 && n < 1 ? clampSplit(n, axis) : SPLIT_DEFAULT[axis];
  } catch {
    return SPLIT_DEFAULT[axis];
  }
}

/** Keep the split (rounded to 0.1 %); null forgets it (the default again). */
export function writeSplit(store: Store | null | undefined, axis: SplitAxis, f: number | null) {
  try {
    if (!store) return;
    if (f === null) removePref(store, SPLIT_KEYS[axis]);
    else store.setItem(SPLIT_KEYS[axis], String(Math.round(clampSplit(f, axis) * 1000) / 1000));
  } catch {
    /* blocked storage: the split just isn't remembered */
  }
}
