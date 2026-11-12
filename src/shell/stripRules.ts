// The tool strips' rules (ToolStrip.tsx): which side each panel's icon sits on, and what a click
// does. No React here, so tests can load it.
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { isEditorId, PANELS, type PanelId } from "./panels";

export type Side = "left" | "right";
/** Where a panel's icon goes when the panel isn't in the dock grid (closed, floating or popped out). */
const HOME_SIDE: Record<string, Side> = { map: "left", "code:home": "left", guide: "right", details: "right", files: "left", settings: "right", output: "right" };
const STRIP_IDS = Object.keys(HOME_SIDE);

export interface StripItem {
  id: string;
  side: Side;
  /** In the dock (anywhere). */
  present: boolean;
  /** Its group is shown and it is the tab in front (for Code: any editor tab counts). */
  on: boolean;
}

const inFront = (id: string, p: IDockviewPanel) => {
  const front = p.group.activePanel?.id;
  return front === id || (id === "code:home" && !!front && isEditorId(front));
};

/** Where each panel's icon was last seen, so a hidden group's icons stay put (its box is 0 wide). */
export type SideMemory = Map<string, Side>;

/** A group's first panel in strip order: a group in the middle puts all its icons on that panel's usual side. */
const lead = (g: IDockviewPanel["group"]) => STRIP_IDS.find((id) => g.panels.some((p) => p.id === id));

const gridGroups = (api: DockviewApi) => api.groups.filter((g) => g.api.location.type === "grid");

/** The strips' contents for the dock as it is now. `box` is the dock's left and right edge on screen:
 * a group against the left edge has its icons on the left strip, against the right edge on the right,
 * and one in the middle (the code, usually) goes to its first panel's usual side, all its icons together. A hidden group's icons stay where
 * they were last seen (`memory`). */
export function stripItems(api: DockviewApi, box: { left: number; right: number }, memory: SideMemory = new Map()): StripItem[] {
  return STRIP_IDS.filter((id) => PANELS[id]?.available && (id !== "output" || !!api.getPanel(id))).map((id) => {
    const p = api.getPanel(id);
    if (!p) return { id, side: memory.get(id) ?? HOME_SIDE[id], present: false, on: false };
    const g = p.group;
    let side = memory.get(id) ?? HOME_SIDE[id];
    if (g.api.location.type === "grid" && g.api.isVisible) {
      const r = g.element.getBoundingClientRect();
      if (r.width > 0) {
        side = r.left - box.left < 8 ? "left" : box.right - r.right < 8 ? "right" : HOME_SIDE[lead(g) ?? id];
        memory.set(id, side);
      }
    }
    return { id, side, present: true, on: g.api.isVisible && inFront(id, p) };
  });
}

/** One click on a panel's icon. Returns what it did, for tests and the tooltip. */
export function clickStrip(api: DockviewApi, id: string, reveal: (id: PanelId) => void): "shown" | "front" | "hidden" {
  const p = api.getPanel(id);
  if (!p) {
    reveal(id as PanelId);
    return "shown";
  }
  const g = p.group;
  if (!g.api.isVisible) {
    g.api.setVisible(true);
    p.api.setActive();
    return "shown";
  }
  const others = gridGroups(api).filter((x) => x !== g && x.api.isVisible);
  // The last group showing is never hidden: an empty dock has nothing to click to bring it back.
  if (inFront(id, p) && g.api.location.type === "grid" && others.length) {
    g.api.setVisible(false);
    // Hand the focus to a group still showing, so a later "show this file" in the hidden one is a
    // real change of panel, which shows its group again (Workspace.tsx).
    others[0].activePanel?.api.setActive();
    return "hidden";
  }
  p.api.setActive();
  return "front";
}

/** After a saved layout is restored: never a dock with nothing showing, and the focus on a group that shows. */
export function settleHidden(api: DockviewApi): void {
  const grid = gridGroups(api);
  const shown = grid.filter((g) => g.api.isVisible);
  if (grid.length && !shown.length) for (const g of grid) g.api.setVisible(true);
  const active = api.activeGroup;
  if (active && active.api.location.type === "grid" && !active.api.isVisible) (shown[0] ?? grid[0])?.activePanel?.api.setActive();
}
