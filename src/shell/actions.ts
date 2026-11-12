// What the header buttons, the tab menu and the shortcuts do to a group:
// float, pop out, dock, maximise, cycle, resize (docs/SHELL.md §6, §9).
import type { DockviewApi, DockviewGroupPanel } from "dockview-react";
import { light } from "@/lib/light";
import { POPOUT_URL, capabilities } from "./theme";
import { toast } from "./Toast";

export type GroupTarget = "active" | string;

export function groupOf(api: DockviewApi, target: GroupTarget): DockviewGroupPanel | undefined {
  return target === "active" ? api.activeGroup : (api.getGroup(target) as DockviewGroupPanel | undefined);
}

const where = (g: DockviewGroupPanel) => g.api.location.type;

export function floatGroup(api: DockviewApi, g: DockviewGroupPanel | undefined) {
  if (!g || where(g) !== "grid") return;
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
  const box = { width: Math.max(360, Math.round(g.width)), height: Math.max(260, Math.round(g.height)) };
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

/** Put a floating or popped-out group back into the grid, right of the first grid group. */
export function dockGroup(api: DockviewApi, g: DockviewGroupPanel | undefined): boolean {
  if (!g || where(g) === "grid") return false;
  const home = api.groups.find((x) => x !== g && where(x) === "grid");
  if (home) g.api.moveTo({ group: home, position: "right" });
  else g.api.moveTo({ position: "right" });
  // Docked back: the light returns to the brand.
  requestAnimationFrame(() => light.park());
  return true;
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
