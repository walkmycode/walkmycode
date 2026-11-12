// A click on a dock tab must show that tab. With a mouse, dockview drags a tab with the
// browser's own drag and drop, which starts after a move of only ~4 px: a click whose pointer
// slips that far between press and release became a drag, dropped where it began, and
// dockview moved the tab out to the edge of the layout (the panel showing in its group did not
// change, so the click looked swallowed). A drop that lands within SLIP px of where the press
// began is a click: the move is cancelled and the tab shown.
import type { DockviewApi } from "dockview-react";

/** How far (px) a press may wander and still be a click on the tab. */
export const SLIP = 12;
/** A press held longer than this before the drop is a deliberate drag, however short. */
export const SLIP_MS = 1500;

export interface Press {
  x: number;
  y: number;
  t: number;
}

/** Was this drop a click that slipped? Only when it lands near where its press began, soon after. */
export function isSlip(press: Press | null, drop: { x: number; y: number; t: number }): boolean {
  if (!press) return false;
  return Math.hypot(drop.x - press.x, drop.y - press.y) < SLIP && drop.t - press.t < SLIP_MS;
}

/** Watch the presses on the dock's tabs; a tab dropped where it was pressed is shown instead of moved. */
export function guardTabClicks(api: DockviewApi, doc: Document = document): { dispose(): void } {
  let press: Press | null = null;
  const down = (e: PointerEvent) => {
    const tab = e.button === 0 && (e.target as Element | null)?.closest?.(".dv-tab");
    press = tab ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  };
  doc.addEventListener("pointerdown", down, true);
  const sub = api.onWillDrop((e) => {
    const id = e.getData()?.panelId;
    if (!id || !isSlip(press, { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, t: performance.now() })) return;
    press = null;
    e.preventDefault();
    api.getPanel(id)?.api.setActive();
  });
  return {
    dispose() {
      doc.removeEventListener("pointerdown", down, true);
      sub.dispose();
    },
  };
}
