// The code pane: the editor/output splitter's limits, keys and storage
// (src/ide/split.ts), and the output's one store with its dock / undock state
// (src/ide/outputStore.ts, src/shell/outputDock.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SPLIT_DEFAULT, SPLIT_GUTTER, SPLIT_KEYS, SPLIT_MIN, clampSplit, readSplit, stepSplit, writeSplit } from "../src/ide/split";
import { EMPTY_OUTPUT, addPart, createOutputStore } from "../src/ide/outputStore";
import { OUTPUT_ID, outputHost, outputPosition, type OutputDockApi } from "../src/shell/outputDock";
import { KNOWN_COMPONENTS, PANELS, panelForShortcut } from "../src/shell/panels";

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("editor/output split", () => {
  it("keeps each part above its minimum height", () => {
    const total = 600;
    const avail = total - SPLIT_GUTTER;
    assert.equal(clampSplit(0, "rows", total), SPLIT_MIN.rows.first / avail);
    assert.equal(clampSplit(1, "rows", total), 1 - SPLIT_MIN.rows.second / avail);
    assert.equal(clampSplit(0.5, "rows", total), 0.5);
  });
  it("shares a box too small for both minimums in proportion to them", () => {
    const { first, second } = SPLIT_MIN.rows;
    assert.equal(clampSplit(0.9, "rows", 100), first / (first + second));
  });
  it("without a size, keeps to 5–95 % and mends nonsense", () => {
    assert.equal(clampSplit(-3, "cols"), 0.05);
    assert.equal(clampSplit(7, "cols"), 0.95);
    assert.equal(clampSplit(Number.NaN, "cols"), SPLIT_DEFAULT.cols);
  });
  it("moves with the arrow keys of its own axis, further with Shift, and ignores others", () => {
    assert.equal(stepSplit(0.5, "ArrowDown", "rows", 800), 0.54);
    assert.equal(stepSplit(0.5, "ArrowUp", "rows", 800), 0.46);
    assert.equal(stepSplit(0.5, "ArrowRight", "cols", 1400, true), 0.62);
    assert.equal(stepSplit(0.5, "ArrowRight", "rows", 800), null);
    assert.equal(stepSplit(0.5, "Enter", "rows", 800), null);
    assert.equal(stepSplit(0.5, "Home", "rows", 800), clampSplit(0, "rows", 800));
    assert.equal(stepSplit(0.5, "End", "rows", 800), clampSplit(1, "rows", 800));
  });
  it("is kept per user under walkmycode.* keys, one per axis", () => {
    const s = memory();
    assert.equal(readSplit(s, "rows"), SPLIT_DEFAULT.rows);
    writeSplit(s, "rows", 0.71234);
    assert.equal(s.m.get(SPLIT_KEYS.rows), "0.712");
    assert.match(SPLIT_KEYS.rows, /^walkmycode\./);
    assert.equal(readSplit(s, "rows"), 0.712);
    assert.equal(readSplit(s, "cols"), SPLIT_DEFAULT.cols);
    writeSplit(s, "rows", null); // double-click: back to the default
    assert.equal(readSplit(s, "rows"), SPLIT_DEFAULT.rows);
  });
  it("falls back to the default for odd or unreadable values", () => {
    assert.equal(readSplit(memory({ [SPLIT_KEYS.rows]: "banana" }), "rows"), SPLIT_DEFAULT.rows);
    assert.equal(readSplit(memory({ [SPLIT_KEYS.rows]: "4" }), "rows"), SPLIT_DEFAULT.rows);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    assert.equal(readSplit(broken, "cols"), SPLIT_DEFAULT.cols);
    assert.doesNotThrow(() => writeSplit(broken, "cols", 0.4));
    assert.equal(readSplit(null, "rows"), SPLIT_DEFAULT.rows);
  });
});

describe("the output's one store", () => {
  it("joins printed lines of a kind into one block", () => {
    let parts = addPart([], { kind: "out", text: "a\n" });
    parts = addPart(parts, { kind: "out", text: "b\n" });
    parts = addPart(parts, { kind: "error", text: "boom" });
    assert.deepEqual(parts, [{ kind: "out", text: "a\nb\n" }, { kind: "error", text: "boom" }]);
  });
  it("announces changes, and only real ones", () => {
    const o = createOutputStore();
    let n = 0;
    o.subscribe(() => n++);
    o.update("a", { running: true });
    o.update("a", { running: true });
    assert.equal(n, 1);
    o.append("a", { kind: "out", text: "hi" });
    assert.deepEqual(o.get("a").parts, [{ kind: "out", text: "hi" }]);
    assert.equal(o.get("nobody"), EMPTY_OUTPUT);
  });
  it("is docked until a panel attaches, and docks back when the last one goes", () => {
    const o = createOutputStore();
    assert.equal(o.dock().popped, false);
    const off1 = o.attachPanel();
    const off2 = o.attachPanel(); // StrictMode mounts twice
    off1();
    assert.equal(o.dock().popped, true);
    off2();
    assert.equal(o.dock().popped, false);
  });
  it("can pop out only where a dock has registered, and the popped panel shows the IDE that popped it", () => {
    const o = createOutputStore();
    const calls: string[] = [];
    assert.equal(o.dock().canPop, false); // Learn: no dock, splitter only
    o.popOut("ide:1"); // nothing to pop into: harmless
    const off = o.setHost({ popOut: () => calls.push("out"), dockBack: () => calls.push("back") });
    assert.equal(o.dock().canPop, true);
    o.popOut("ide:2");
    assert.equal(o.dock().owner, "ide:2");
    o.dockBack();
    assert.deepEqual(calls, ["out", "back"]);
    off();
    assert.equal(o.dock().canPop, false);
  });
  it("a run shows in whichever place the output is: both read the same entry", () => {
    const o = createOutputStore();
    o.setHost({ popOut: () => {}, dockBack: () => {} });
    const detach = o.attachPanel();
    o.popOut("ide:1");
    o.append("ide:1", { kind: "out", text: "42\n" });
    // The panel draws get(owner); the editor draws get(its id): the same object.
    assert.equal(o.get(o.dock().owner), o.get("ide:1"));
    detach();
    assert.equal(o.dock().popped, false);
    assert.deepEqual(o.get("ide:1").parts, [{ kind: "out", text: "42\n" }]); // kept on docking back
  });
  it("forgets an IDE that closes, and the panel stops showing it", () => {
    const o = createOutputStore();
    o.update("ide:1", { ran: true });
    o.setOwner("ide:1");
    o.remove("ide:1");
    assert.equal(o.dock().owner, null);
    assert.equal(o.has("ide:1"), false);
  });
});

describe("the Output dock panel", () => {
  function fakeDock(ids: string[], active?: string) {
    const added: { id: string; component: string; position?: unknown }[] = [];
    const closed: string[] = [];
    const activated: string[] = [];
    const panel = (id: string) => ({ id, api: { close: () => closed.push(id), setActive: () => activated.push(id) } });
    const api = {
      get panels() {
        return ids.map(panel);
      },
      get activePanel() {
        return active ? panel(active) : undefined;
      },
      getPanel: (id: string) => (ids.includes(id) ? panel(id) : undefined),
      addPanel: (o: { id: string; component: string; position?: unknown }) => {
        added.push(o);
        ids.push(o.id);
        return panel(o.id);
      },
    } as unknown as OutputDockApi;
    return { api, added, closed, activated };
  }
  it("is in the registry, restorable from a saved layout, with its own shortcut", () => {
    assert.equal(PANELS[OUTPUT_ID].renderer, "always");
    assert.ok(KNOWN_COMPONENTS.has("output"));
    assert.equal(panelForShortcut(8), OUTPUT_ID);
  });
  it("pops out under the file being read, else under the code home", () => {
    assert.deepEqual(outputPosition(fakeDock(["map", "code:home", "code:src/a.py"], "code:src/a.py").api), { referencePanel: "code:src/a.py", direction: "below" });
    assert.deepEqual(outputPosition(fakeDock(["map", "code:home", "code:src/b.sql"], "map").api), { referencePanel: "code:src/b.sql", direction: "below" });
    assert.deepEqual(outputPosition(fakeDock(["map", "code:home"], "map").api), { referencePanel: "code:home", direction: "below" });
    assert.equal(outputPosition(fakeDock(["map"]).api), undefined);
  });
  it("opens once, then just comes forward; Dock back closes it", () => {
    const d = fakeDock(["code:home"]);
    const host = outputHost(d.api);
    host.popOut();
    host.popOut();
    assert.equal(d.added.length, 1);
    assert.equal(d.added[0].component, "output");
    assert.deepEqual(d.activated, ["output"]);
    host.dockBack();
    assert.deepEqual(d.closed, ["output"]);
  });
});
