// Where a panel group sat in the dock before it floated, so "Dock back" puts it
// exactly there again (docs/SHELL.md §6). A popped-out group needs none of this:
// dockview keeps its slot in the grid (an empty, hidden group) and hands the
// panels back to it when the window closes (actions.ts, dockGroup).
//
// A slot is described by a neighbour: the grid group it shared a whole edge
// with, which side of that neighbour it was on, and its size. Pure, so tests
// feed it rectangles; the homes themselves are kept in localStorage, so a
// floating group still knows its way back after a reload.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Which side of the neighbour the group sits on: dockview's moveTo positions. */
export type Side = "left" | "right" | "top" | "bottom";

export interface Home {
  /** The neighbouring grid group's id. */
  beside: string;
  side: Side;
  width: number;
  height: number;
  /** Every other grid group's size when it left: they grew into its space, and give it back. */
  sizes?: Record<string, { width: number; height: number }>;
}

/** Edges this close count as touching (the sash between two groups is 8px). */
export const TOUCH = 12;
/** Sides this close in length count as the same (siblings in one split). */
const SAME = 6;

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** The neighbour a group's slot is best described by, among the other grid groups' boxes.
 * A neighbour whose shared edge is as long as the group's own (a sibling in the same split)
 * wins over a longer one: putting the group back beside it rebuilds the same split. */
export function homeFrom(id: string, box: Box, others: { id: string; box: Box }[]): Home | null {
  let best: { home: Home; score: number } | null = null;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  for (const o of others) {
    if (o.id === id) continue;
    const b = o.box;
    const oRight = b.left + b.width;
    const oBottom = b.top + b.height;
    const vertical = overlap(box.top, bottom, b.top, oBottom);
    const horizontal = overlap(box.left, right, b.left, oRight);
    const candidates: [Side, boolean, number, boolean][] = [
      // The group is to the right of o: put it back on o's right.
      ["right", Math.abs(b.left + b.width - box.left) <= TOUCH, vertical, Math.abs(b.height - box.height) <= SAME],
      ["left", Math.abs(right - b.left) <= TOUCH, vertical, Math.abs(b.height - box.height) <= SAME],
      ["bottom", Math.abs(b.top + b.height - box.top) <= TOUCH, horizontal, Math.abs(b.width - box.width) <= SAME],
      ["top", Math.abs(bottom - b.top) <= TOUCH, horizontal, Math.abs(b.width - box.width) <= SAME],
    ];
    for (const [side, touching, shared, sibling] of candidates) {
      if (!touching || shared <= 0) continue;
      const score = shared + (sibling ? 100_000 : 0);
      if (!best || score > best.score) best = { home: { beside: o.id, side, width: box.width, height: box.height }, score };
    }
  }
  return best?.home ?? null;
}

const KEY = "walkmycode.dock.homes";

type Store = Pick<Storage, "getItem" | "setItem">;

function store(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readAll(s: Store | null = store()): Record<string, Home> {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, Home>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Home>, s: Store | null = store()) {
  try {
    s?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the home lasts until the page reloads */
  }
}

const memory: Record<string, Home> = {};

/** Remember where a group lives before it leaves the grid. */
export function saveHome(groupId: string, home: Home | null, s: Store | null = store()) {
  const all = { ...readAll(s), ...memory };
  if (home) all[groupId] = memory[groupId] = home;
  else {
    delete all[groupId];
    delete memory[groupId];
  }
  writeAll(all, s);
}

/** Where a group lived, if it was remembered. */
export function homeOf(groupId: string, s: Store | null = store()): Home | null {
  return memory[groupId] ?? readAll(s)[groupId] ?? null;
}

/** The side opposite: swapping two neighbours puts each on the other's side. */
export const opposite: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
