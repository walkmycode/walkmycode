// A click on a dock tab whose pointer slips a few px is still a click (src/shell/tabClick.ts):
// the browser's drag that it started is dropped where it began, and the tab is shown, not moved.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DockviewApi } from "dockview-react";
import { SLIP, SLIP_MS, guardTabClicks, isSlip } from "../src/shell/tabClick";

describe("a slipped click on a dock tab", () => {
  const press = { x: 100, y: 20, t: 0 };

  it("is a drop near where the press began, soon after", () => {
    assert.equal(isSlip(press, { x: 105, y: 23, t: 120 }), true, "5 px: the browser's drag began, the user only clicked");
    assert.equal(isSlip(press, { x: 100 + SLIP, y: 20, t: 120 }), false, "a real move");
    assert.equal(isSlip(press, { x: 300, y: 400, t: 200 }), false, "a real drag to another group");
    assert.equal(isSlip(press, { x: 102, y: 20, t: SLIP_MS + 1 }), false, "held and dragged back: deliberate");
    assert.equal(isSlip(null, { x: 100, y: 20, t: 10 }), false, "no press on a tab");
  });

  it("cancels the move and shows the tab; a real drag goes through", () => {
    const doc = new EventTarget() as unknown as Document;
    let onWillDrop: ((e: unknown) => void) | null = null;
    const shown: string[] = [];
    const api = {
      onWillDrop: (fn: (e: unknown) => void) => {
        onWillDrop = fn;
        return {
          dispose: () => {
            onWillDrop = null;
          },
        };
      },
      getPanel: (id: string) => ({ api: { setActive: () => shown.push(id) } }),
    } as unknown as DockviewApi;
    const guard = guardTabClicks(api, doc);

    const pressAt = (x: number, y: number, onTab = true) => {
      const e = Object.assign(new Event("pointerdown"), { button: 0, clientX: x, clientY: y });
      // A plain EventTarget has no elements: the press's target only needs closest().
      Object.defineProperty(e, "target", { value: { closest: (s: string) => (onTab && s === ".dv-tab" ? {} : null) } });
      doc.dispatchEvent(e);
    };
    const drop = (x: number, y: number, panelId: string | null = "guide") => {
      let prevented = false;
      const preventDefault = () => {
        prevented = true;
      };
      onWillDrop?.({ nativeEvent: { clientX: x, clientY: y }, getData: () => (panelId ? { panelId } : undefined), preventDefault });
      return prevented;
    };

    pressAt(400, 30);
    assert.equal(drop(405, 31), true, "the slipped click's drop is cancelled");
    assert.deepEqual(shown, ["guide"], "and its tab is shown");

    pressAt(400, 30);
    assert.equal(drop(900, 500), false, "a real drag is left alone");

    pressAt(400, 30, false);
    assert.equal(drop(401, 30), false, "a press that was not on a tab");

    pressAt(400, 30);
    assert.equal(drop(401, 30, null), false, "a whole group dragged");

    guard.dispose();
    assert.equal(onWillDrop, null);
  });
});
