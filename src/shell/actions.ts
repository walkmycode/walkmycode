// What the header buttons, the tab menu and the shortcuts do to a group:
// float, pop out, dock, maximise, cycle, resize (docs/SHELL.md §6, §9).
import type { DockviewApi, DockviewGroupPanel } from "dockview-react";
import { closeOpened } from "@/lib/desktop";
import { light } from "@/lib/light";
import { homeFrom, homeOf, opposite, saveHome, type Box, type Side } from "./home";
import { POPOUT_URL, capabilities } from "./theme";
import { toast } from "./Toast";

export type GroupTarget = "active" | string;

export function groupOf(api: DockviewApi, target: GroupTarget): DockviewGroupPanel | undefined {
  return target === "active" ? api.activeGroup : (api.getGroup(target) as DockviewGroupPanel | undefined);
}

const where = (g: DockviewGroupPanel) => g.api.location.type;

function boxOf(g: DockviewGroupPanel): Box {
  const r = g.element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** The other visible groups in the grid, with their boxes. */
function gridNeighbours(api: DockviewApi, g: DockviewGroupPanel) {
  return api.groups.filter((x) => x !== g && where(x) === "grid" && x.api.isVisible).map((x) => ({ id: x.id, box: boxOf(x) }));
}

type Size = { width: number; height: number };

/** Two frames: the split a move made has been laid out by then. */
const afterLayout = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

/** Give groups back the sizes they had. A group's setSize takes the space from the next group in its
 * row (or column), so widths go left to right and heights top to bottom, and the last group in each
 * direction is left alone: it ends up with what remains, which is its own old size. */
function resizeAll(api: DockviewApi, sizes: Record<string, Size>) {
  const groups = Object.keys(sizes)
    .map((id) => api.getGroup(id) as DockviewGroupPanel | undefined)
    .filter((x): x is DockviewGroupPanel => !!x && where(x) === "grid" && x.api.isVisible)
    .map((x) => ({ x, box: boxOf(x), size: sizes[x.id] }));
  const right = Math.max(...groups.map((g) => g.box.left + g.box.width));
  const bottom = Math.max(...groups.map((g) => g.box.top + g.box.height));
  // Sizes are kept as boxes on screen, and setSize's units are a few px off those: set, measure, correct.
  const fit = (x: DockviewGroupPanel, key: "width" | "height", want: number) => {
    x.api.setSize({ [key]: Math.round(want) });
    const got = boxOf(x)[key];
    if (Math.abs(got - want) > 0.5) x.api.setSize({ [key]: Math.round(want + (want - got)) });
  };
  for (const g of [...groups].sort((a, b) => a.box.left - b.box.left)) {
    if (g.box.left + g.box.width < right - 2) fit(g.x, "width", g.size.width);
  }
  for (const g of [...groups].sort((a, b) => a.box.top - b.box.top)) {
    if (g.box.top + g.box.height < bottom - 2) fit(g.x, "height", g.size.height);
  }
}

/** Every grid group's size, but `except`'s. */
function gridSizes(api: DockviewApi, except: DockviewGroupPanel): Record<string, Size> {
  const out: Record<string, Size> = {};
  for (const x of api.groups) if (x !== except && where(x) === "grid" && x.api.isVisible) out[x.id] = { width: boxOf(x).width, height: boxOf(x).height };
  return out;
}

/** Put a group back beside `beside`, on `side`, at the size it had and its neighbours at theirs;
 * false when that neighbour is gone. */
function placeBeside(api: DockviewApi, g: DockviewGroupPanel, beside: string, side: Side, size: Size, others: Record<string, Size> = {}): boolean {
  const target = api.getGroup(beside) as DockviewGroupPanel | undefined;
  if (!target || target === g || where(target) !== "grid") return false;
  g.api.moveTo({ group: target, position: side });
  const sizes = { ...others, [g.id]: size };
  // Once laid out, and again when the dock has finished settling after the move.
  afterLayout(() => resizeAll(api, sizes));
  setTimeout(() => resizeAll(api, sizes), 250);
  return true;
}

export function floatGroup(api: DockviewApi, g: DockviewGroupPanel | undefined) {
  if (!g || where(g) !== "grid") return;
  // Where it sat, so "Dock back" puts it there again (home.ts).
  const home = homeFrom(g.id, boxOf(g), gridNeighbours(api, g));
  saveHome(g.id, home ? { ...home, sizes: gridSizes(api, g) } : null);
  api.addFloatingGroup(g, { width: Math.max(320, Math.round(g.width)), height: Math.max(220, Math.round(g.height)), x: 40, y: 40 });
  // The light follows the panel (MOTION.md §4.14): it hops onto the beacon at the
  // start of the floating group's tab bar, once the box is in place.
  requestAnimationFrame(() => {
    const bar = g.element.querySelector<HTMLElement>(".dv-tabs-and-actions-container");
    if (bar) light.settleOn(bar, { at: "left", dx: 12, handoff: true });
  });
}

/** Pop a group into its own window; if the browser blocks it, float it instead.
 * The window is dressed once /popout.html has loaded, by Workspace's onDidAddPopoutGroup (popout.ts). */
export async function popoutGroup(api: DockviewApi, g: DockviewGroupPanel | undefined): Promise<boolean> {
  if (!g || !capabilities.popout || where(g) === "popout") return false;
  // At least wide enough for the tabs and, in the desktop app, the empty bar that drags the window.
  const box = { width: Math.max(520, Math.round(g.width)), height: Math.max(260, Math.round(g.height)) };
  const ok = await api.addPopoutGroup(g, {
    popoutUrl: POPOUT_URL,
    position: { left: window.screenX + 60, top: window.screenY + 60, ...box },
  });
  // A failed addPopoutGroup may already have moved the group: never float it twice.
  if (!ok && api.getGroup(g.id) && where(g) !== "floating") {
    api.addFloatingGroup(g, { x: 40, y: 40, ...box });
    toast("This browser blocked the window, so the panel is floating instead.");
  }
  return ok;
}

/** Put a floating or popped-out group back into the grid, where it was before it left. */
export function dockGroup(api: DockviewApi, g: DockviewGroupPanel | undefined): boolean {
  if (!g || where(g) === "grid") return false;
  const location = g.api.location;
  if (location.type === "popout") {
    // Dockview kept the group's slot in the grid (hidden, empty) and gives the panels back to it
    // when the window closes: closing the window is docking it back, to exactly where it was.
    const win = location.getWindow();
    if (win && !win.closed) {
      void closeOpened(win);
      requestAnimationFrame(() => light.park());
      return true;
    }
  }
  const saved = homeOf(g.id);
  if (saved && placeBeside(api, g, saved.beside, saved.side, saved, saved.sizes)) {
    saveHome(g.id, null);
    requestAnimationFrame(() => light.park());
    return true;
  }
  const home = api.groups.find((x) => x !== g && where(x) === "grid");
  if (home) g.api.moveTo({ group: home, position: "right" });
  else g.api.moveTo({ position: "right" });
  // Docked back: the light returns to the brand.
  requestAnimationFrame(() => light.park());
  return true;
}

/** The grid groups a group can swap places with: those sharing a whole edge with it (siblings in the
 * same split), and which side of each it is on. */
export function swapTargets(api: DockviewApi, g: DockviewGroupPanel): { group: DockviewGroupPanel; side: Side }[] {
  if (where(g) !== "grid") return [];
  const mine = boxOf(g);
  const out: { group: DockviewGroupPanel; side: Side }[] = [];
  for (const n of gridNeighbours(api, g)) {
    const home = homeFrom(g.id, mine, [n]);
    const sibling = home && (home.side === "left" || home.side === "right" ? Math.abs(n.box.height - mine.height) <= 6 : Math.abs(n.box.width - mine.width) <= 6);
    const group = api.getGroup(n.id) as DockviewGroupPanel | undefined;
    if (home && sibling && group) out.push({ group, side: home.side });
  }
  return out;
}

/** Swap a group with a neighbour: each takes the other's side and size. The arrangement is saved
 * like any other (Workspace saves on every layout change). */
export function swapGroups(api: DockviewApi, g: DockviewGroupPanel, other: DockviewGroupPanel, side: Side): void {
  const mine = boxOf(g);
  const theirs = boxOf(other);
  // g is on `side` of other; it moves to the opposite side and takes other's size, other takes g's,
  // and every other group keeps its own.
  const rest = gridSizes(api, g);
  delete rest[other.id];
  placeBeside(api, g, other.id, opposite[side], { width: theirs.width, height: theirs.height }, { ...rest, [other.id]: { width: mine.width, height: mine.height } });
}

export function maximiseGroup(g: DockviewGroupPanel | undefined) {
  if (!g || where(g) !== "grid") return;
  if (g.api.isMaximized()) g.api.exitMaximized();
  else g.api.maximize();
}

export function cycleTab(api: DockviewApi, dir: 1 | -1) {
  const g = api.activeGroup;
  if (!g || g.panels.length < 2) return;
  const i = g.panels.findIndex((p) => p === g.activePanel);
  g.panels[(i + dir + g.panels.length) % g.panels.length].api.setActive();
}

/** Grid groups first, then floating, then pop-outs. */
export function cycleGroup(api: DockviewApi, dir: 1 | -1) {
  const rank = { grid: 0, floating: 1, popout: 2 } as Record<string, number>;
  const all = [...api.groups].sort((a, b) => (rank[where(a)] ?? 3) - (rank[where(b)] ?? 3));
  if (all.length < 2) return;
  const i = Math.max(0, all.findIndex((g) => g === api.activeGroup));
  all[(i + dir + all.length) % all.length].api.setActive();
}

/** The keyboard path to width resizing: sashes only take a pointer. */
export function resizeGroup(api: DockviewApi, dx: number, dy: number) {
  const g = api.activeGroup;
  if (!g) return;
  if (dx) g.api.setSize({ width: Math.max(120, g.width + dx) });
  if (dy) g.api.setSize({ height: Math.max(80, g.height + dy) });
}

/** Every pop-out whose window didn't open (restored without a click): float it. */
export function floatFailedPopouts(api: DockviewApi, message: string) {
  let moved = false;
  for (const p of api.getPopouts()) {
    if (p.window && !p.window.closed) continue;
    if (!api.getGroup(p.group.id)) continue;
    api.addFloatingGroup(p.group, { x: 40, y: 40, width: Math.max(360, Math.round(p.group.width)), height: Math.max(260, Math.round(p.group.height)) });
    moved = true;
  }
  if (moved) toast(message);
}
