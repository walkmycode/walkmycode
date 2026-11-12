// The tool strips either side of the dock (src/shell/stripRules.ts): which side each panel's icon
// sits on, and what a click does, against a small stand-in for dockview's api.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DockviewApi } from "dockview-react";
import { clickStrip, settleHidden, stripItems } from "../src/shell/stripRules";

interface FakeGroup {
  visible: boolean;
  active: string;
  where: "grid" | "floating";
  rect: { left: number; width: number };
}

function dock(groups: Record<string, FakeGroup & { panels: string[] }>) {
  const state = { active: Object.values(groups)[0] as FakeGroup | undefined };
  const panels = new Map<string, unknown>();
  const views = Object.values(groups).map((g) => {
    const view = {
      get activePanel() {
        return panels.get(g.active);
      },
      panels: g.panels.map((id) => ({ id })),
      element: { getBoundingClientRect: () => ({ left: g.rect.left, width: g.visible ? g.rect.width : 0, right: g.rect.left + (g.visible ? g.rect.width : 0) }) },
      api: {
        get isVisible() {
          return g.visible;
        },
        setVisible: (v: boolean) => (g.visible = v),
        location: { type: g.where },
      },
    };
    for (const id of g.panels)
      panels.set(id, {
        id,
        group: view,
        api: {
          setActive: () => {
            g.active = id;
            state.active = g;
          },
        },
      });
    return { g, view };
  });
  return {
    getPanel: (id: string) => panels.get(id),
    groups: views.map((v) => v.view),
    get activeGroup() {
      return views.find((v) => v.g === state.active)?.view;
    },
  } as unknown as DockviewApi;
}

const box = { left: 0, right: 1200 };
const three = () => ({
  map: { panels: ["map"], visible: true, active: "map", where: "grid" as "grid" | "floating", rect: { left: 0, width: 400 } },
  code: { panels: ["code:home", "code:src/a.ts"], visible: true, active: "code:src/a.ts", where: "grid" as "grid" | "floating", rect: { left: 400, width: 400 } },
  side: { panels: ["guide", "details", "files"], visible: true, active: "guide", where: "grid" as "grid" | "floating", rect: { left: 800, width: 400 } },
});

describe("tool strips: where the icons go", () => {
  it("puts a group's icons on the edge it touches; the middle one keeps its usual side", () => {
    const items = stripItems(dock(three()), box);
    const side = Object.fromEntries(items.map((i) => [i.id, i.side]));
    assert.deepEqual(side, { map: "left", "code:home": "left", guide: "right", details: "right", files: "right", settings: "right" });
  });

  it("lights the tab in front of a shown group; an editor tab counts for Code", () => {
    const on = stripItems(dock(three()), box).filter((i) => i.on).map((i) => i.id);
    assert.deepEqual(on, ["map", "code:home", "guide"]);
  });

  it("follows the map when it is moved to the right edge", () => {
    const g = three();
    g.map.rect.left = 800;
    g.side.rect.left = 0;
    const side = Object.fromEntries(stripItems(dock(g), box).map((i) => [i.id, i.side]));
    assert.equal(side.map, "right");
    assert.equal(side.guide, "left");
  });
});

describe("tool strips: a click", () => {
  it("hides the group of the tab in front, and shows it again", () => {
    const g = three();
    const api = dock(g);
    assert.equal(clickStrip(api, "map", () => {}), "hidden");
    assert.equal(g.map.visible, false);
    assert.equal(stripItems(api, box).find((i) => i.id === "map")?.on, false);
    assert.equal(clickStrip(api, "map", () => {}), "shown");
    assert.equal(g.map.visible, true);
  });

  it("brings a background tab forward without hiding anything", () => {
    const g = three();
    assert.equal(clickStrip(dock(g), "details", () => {}), "front");
    assert.equal(g.side.active, "details");
    assert.equal(g.side.visible, true);
  });

  it("shows a hidden group with the clicked tab in front", () => {
    const g = three();
    g.side.visible = false;
    assert.equal(clickStrip(dock(g), "files", () => {}), "shown");
    assert.deepEqual([g.side.visible, g.side.active], [true, "files"]);
  });

  it("opens a closed panel through the shell's reveal", () => {
    const asked: string[] = [];
    assert.equal(clickStrip(dock(three()), "settings", (id) => asked.push(id)), "shown");
    assert.deepEqual(asked, ["settings"]);
  });

  it("never hides a floating group (it has no place in the grid to give back)", () => {
    const g = three();
    g.side.where = "floating";
    assert.equal(clickStrip(dock(g), "guide", () => {}), "front");
    assert.equal(g.side.visible, true);
  });

  it("never hides the last group showing", () => {
    const g = three();
    g.map.visible = false;
    g.side.visible = false;
    assert.equal(clickStrip(dock(g), "code:home", () => {}), "front");
    assert.equal(g.code.visible, true);
  });

  it("hands the focus to a group still showing, so showing a file there later is a real change", () => {
    const g = three();
    const api = dock(g);
    clickStrip(api, "details", () => {}); // the side group becomes the active one
    clickStrip(api, "guide", () => {});
    assert.equal(api.activeGroup, api.getPanel("guide")?.group);
    assert.equal(clickStrip(api, "guide", () => {}), "hidden");
    assert.equal(api.activeGroup?.api.isVisible, true, "the focus moved to a group that shows");
  });
});

describe("tool strips: memory and restore", () => {
  it("keeps a hidden group's icons where they were last seen", () => {
    const g = three();
    g.map.rect.left = 800; // the map against the right edge
    g.side.rect.left = 0;
    const api = dock(g);
    const memory = new Map();
    assert.equal(stripItems(api, box, memory).find((i) => i.id === "map")?.side, "right");
    clickStrip(api, "map", () => {});
    assert.equal(g.map.visible, false);
    assert.equal(stripItems(api, box, memory).find((i) => i.id === "map")?.side, "right", "no jump to its usual left");
  });

  it("after a restore, shows everything if nothing would show, and moves the focus off a hidden group", () => {
    const g = three();
    for (const x of Object.values(g)) x.visible = false;
    settleHidden(dock(g));
    assert.deepEqual(Object.values(g).map((x) => x.visible), [true, true, true]);
    const h = three();
    h.map.visible = false; // the saved active group was the hidden map
    const api = dock(h);
    settleHidden(api);
    assert.equal(api.activeGroup?.api.isVisible, true);
    assert.equal(h.map.visible, false, "a hidden group stays hidden");
  });
});

describe("tool strips: a group in the middle", () => {
  it("keeps all its icons together, on its first panel's side", () => {
    const g = {
      map: { panels: ["map"], visible: true, active: "map", where: "grid" as "grid" | "floating", rect: { left: 0, width: 300 } },
      side: { panels: ["guide", "files", "settings"], visible: true, active: "settings", where: "grid" as "grid" | "floating", rect: { left: 300, width: 500 } },
      code: { panels: ["code:home"], visible: true, active: "code:home", where: "grid" as "grid" | "floating", rect: { left: 800, width: 400 } },
    };
    const side = Object.fromEntries(stripItems(dock(g), box).map((i) => [i.id, i.side]));
    assert.deepEqual([side.guide, side.files, side.settings], ["right", "right", "right"]);
    assert.equal(side["code:home"], "right");
  });
});
