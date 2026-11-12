// The light's store (docs/MOTION.md §5, docs/SHELL.md §8), run in Node with a
// fake window and a driver that records what it is asked: where a target's
// rect puts the dot, retargeting mid-flight, handoff on arrival, hiding when
// the target is in a hidden tab or clipped out of its panel, the hop between
// windows, parking at the brand, and the reduced-motion jump.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchorPoint, HIDDEN, inside, LightStore, type Box, type LightDriver, type SpringName, type TargetElement } from "../src/lib/light";

type Call = { op: string; x?: number; y?: number; spring?: SpringName | null };

/** A driver that records its calls and lands when told to. */
function fakeDriver() {
  const calls: Call[] = [];
  let pending: (() => void) | null = null;
  const driver: LightDriver = {
    moveTo(x, y, spring, done) {
      calls.push({ op: "move", x, y, spring });
      if (spring === null) done();
      else pending = done;
    },
    show: () => void calls.push({ op: "show" }),
    fade: () => void calls.push({ op: "fade" }),
    dim: () => void calls.push({ op: "dim" }),
    land: () => void calls.push({ op: "land" }),
    destroy: () => void calls.push({ op: "destroy" }),
  };
  return {
    driver,
    calls,
    /** The springs settle. */
    arrive() {
      const d = pending;
      pending = null;
      d?.();
    },
    ops: () => calls.map((c) => c.op),
    moves: () => calls.filter((c) => c.op === "move"),
  };
}

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

interface FakeEl extends TargetElement {
  rect: Box;
  visible: boolean;
  clip: FakeEl | null;
}
function fakeWindow(): Window {
  return { document: { querySelector: () => null } } as unknown as Window;
}
function el(win: Window, rect: Box, o: { visible?: boolean; clip?: FakeEl | null } = {}): FakeEl {
  const e: FakeEl = {
    rect,
    visible: o.visible ?? true,
    clip: o.clip ?? null,
    ownerDocument: { defaultView: win },
    getBoundingClientRect: () => e.rect,
    closest: (sel) => (sel === HIDDEN ? (e.visible ? null : e) : e.clip),
  };
  return e;
}

function store(reduced = false) {
  const timers: { fn: () => void; ms: number }[] = [];
  const s = new LightStore({ reduced: () => reduced, setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => {} });
  return { s, timers };
}

describe("anchors", () => {
  it("land on the centre, or the middle of a side, plus a nudge", () => {
    const r = box(10, 20, 100, 40);
    assert.deepEqual(anchorPoint(r), { x: 60, y: 40 });
    assert.deepEqual(anchorPoint(r, "left"), { x: 10, y: 40 });
    assert.deepEqual(anchorPoint(r, "right", -4), { x: 106, y: 40 });
    assert.deepEqual(anchorPoint(r, "top", 0, 26), { x: 60, y: 46 });
    assert.deepEqual(anchorPoint(r, "bottom"), { x: 60, y: 60 });
  });
  it("knows what is inside a box, with a little slack", () => {
    const r = box(0, 0, 100, 100);
    assert.ok(inside({ x: 50, y: 50 }, r));
    assert.ok(inside({ x: -1, y: 101 }, r));
    assert.ok(!inside({ x: -5, y: 50 }, r));
  });
});

describe("a flight", () => {
  it("measures the target's rect and glides there, showing the dot", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    const card = el(win, box(100, 200, 220, 46));
    assert.equal(s.flyTo(card, { at: "left", dx: -4 }), true);
    assert.deepEqual(d.moves(), [{ op: "move", x: 96, y: 223, spring: "glide" }]);
    assert.ok(d.ops().includes("show"));
    assert.equal(s.state.mode, "flying");
    assert.equal(s.state.win, win);
  });

  it("lands with a squash and stays, then dims when idle", () => {
    const { s, timers } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(0, 0, 10, 10)));
    d.arrive();
    assert.equal(s.state.mode, "landed");
    assert.ok(d.ops().includes("land"));
    assert.ok(!d.ops().includes("fade"));
    assert.equal(timers.length, 1);
    timers[0].fn();
    assert.equal(d.ops().at(-1), "dim");
  });

  it("hands off to the surface's beacon: fades on arrival", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(0, 0, 10, 10)), { handoff: true });
    d.arrive();
    assert.equal(s.state.mode, "handed");
    assert.deepEqual(d.ops().slice(-2), ["land", "fade"]);
  });

  it("retargets mid-flight: a stale landing never fires", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(0, 0, 10, 10)), { handoff: true });
    const first = d.calls.length;
    s.flyTo(el(win, box(300, 300, 10, 10)), { spring: "hop" });
    // The first flight's springs are retargeted: only the newest landing counts.
    d.arrive();
    assert.equal(s.state.mode, "landed");
    assert.equal(d.moves().at(-1)?.spring, "hop");
    assert.equal(d.calls.slice(first).filter((c) => c.op === "fade").length, 0, "the first flight's handoff never ran");
  });

  it("departs from a given element: a jump, then the flight", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    const cite = el(win, box(40, 40, 60, 16));
    s.flyTo(el(win, box(500, 500, 10, 10)), { from: cite, spring: "hop" });
    assert.deepEqual(d.moves(), [
      { op: "move", x: 70, y: 48, spring: null },
      { op: "move", x: 505, y: 505, spring: "hop" },
    ]);
  });

  it("settleOn hops", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.settleOn(box(0, 0, 10, 10), { handoff: true });
    assert.equal(d.moves()[0].spring, "hop");
  });

  it("orbit goes to the board's top right and hands off", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.orbit(el(win, box(100, 100, 400, 300)));
    assert.deepEqual(d.moves()[0], { op: "move", x: 470, y: 126, spring: "glide" });
    d.arrive();
    assert.equal(s.state.mode, "handed");
    assert.ok(!d.ops().includes("land"));
  });
});

describe("hiding", () => {
  it("a target in a hidden tab, or with no size, hides the dot", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(0, 0, 10, 10)));
    assert.equal(s.flyTo(el(win, box(0, 0, 10, 10), { visible: false })), false);
    assert.equal(s.state.mode, "hidden");
    assert.equal(d.ops().at(-1), "fade");
    assert.equal(s.flyTo(el(win, box(0, 0, 0, 0))), false);
  });

  it("a target clipped out of its panel hides the dot", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    const panel = el(win, box(0, 0, 400, 400));
    assert.equal(s.flyTo(el(win, box(100, 100, 50, 20), { clip: panel })), true);
    assert.equal(s.flyTo(el(win, box(900, 100, 50, 20), { clip: panel })), false);
    assert.equal(s.state.mode, "hidden");
  });

  it("hide() fades a flying dot and cancels its landing; a handed-off dot needs nothing", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(0, 0, 10, 10)));
    s.hide();
    assert.equal(d.ops().at(-1), "fade");
    d.arrive();
    assert.equal(s.state.mode, "hidden");
    assert.ok(!d.ops().includes("land"));
    const n = d.calls.length;
    s.hide();
    assert.equal(d.calls.length, n, "already hidden: nothing to do");
  });

  it("a target in a window without a light hides the dot", () => {
    const { s } = store();
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    const other = fakeWindow();
    assert.equal(s.flyTo(el(other, box(0, 0, 10, 10))), false);
    assert.equal(s.state.mode, "hidden");
  });
});

describe("windows", () => {
  it("hops to a pop-out: this dot fades, that one rises from its tab beacon", () => {
    const { s } = store();
    const main = fakeWindow();
    const dm = fakeDriver();
    s.mount(main, dm.driver);
    const bar = el(main, box(10, 10, 300, 34));
    const pop = { document: { querySelector: (q: string) => (q.includes("popout") ? bar : null) } } as unknown as Window;
    const dp = fakeDriver();
    s.mount(pop, dp.driver);
    s.flyTo(el(main, box(0, 0, 10, 10)));
    s.flyTo(el(pop, box(200, 200, 10, 10)));
    assert.equal(dm.ops().at(-1), "fade");
    assert.deepEqual(dp.moves(), [
      { op: "move", x: 22, y: 27, spring: null },
      { op: "move", x: 205, y: 205, spring: "glide" },
    ]);
    assert.equal(s.state.win, pop);
  });

  it("dropping a window forgets its dot; the main window stays the main window", () => {
    const { s } = store();
    const main = fakeWindow();
    const pop = fakeWindow();
    const dm = fakeDriver();
    const dp = fakeDriver();
    s.mount(main, dm.driver);
    const unmount = s.mount(pop, dp.driver);
    s.flyTo(el(pop, box(0, 0, 10, 10)));
    unmount();
    assert.equal(dp.ops().at(-1), "destroy");
    assert.equal(s.state.mode, "hidden");
    assert.equal(s.flyTo(el(pop, box(0, 0, 10, 10))), false);
    assert.equal(s.flyTo(box(5, 5, 10, 10)), true, "a box goes to the main window");
    assert.equal(s.state.win, main);
  });
});

describe("parking", () => {
  it("goes to the brand's dot in the main window and hands off", () => {
    const { s } = store();
    const brand = { ...el(fakeWindow(), box(20, 10, 90, 26)), classList: { contains: (c: string) => c === "brand-full" }, querySelectorAll: () => [] } as unknown as FakeEl & { classList: DOMTokenList };
    const main = { document: { querySelector: (q: string) => (q.includes("home") ? { querySelectorAll: () => [brand] } : null) } } as unknown as Window;
    (brand.ownerDocument as { defaultView: Window | null }).defaultView = main;
    const d = fakeDriver();
    s.mount(main, d.driver);
    assert.equal(s.park(), true);
    assert.deepEqual(d.moves()[0], { op: "move", x: 106, y: 17, spring: "glide" });
    d.arrive();
    assert.equal(s.state.mode, "handed");
  });

  it("with no home on the page, hides", () => {
    const { s } = store();
    const main = fakeWindow();
    const d = fakeDriver();
    s.mount(main, d.driver);
    s.flyTo(box(0, 0, 10, 10));
    assert.equal(s.park(), false);
    assert.equal(s.state.mode, "hidden");
  });
});

describe("deferred (in the browser)", () => {
  it("measures nothing until the frame is laid out, then flies only to the last target asked for", () => {
    const runs: (() => void)[] = [];
    const s = new LightStore({ reduced: () => false, setTimer: () => 0, clearTimer: () => {}, defer: (run) => void runs.push(run) });
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    let reads = 0;
    const counted = (b: Box) => ({ ...el(win, b), getBoundingClientRect: () => (reads++, b) });
    assert.equal(s.flyTo(counted(box(0, 0, 10, 10))), true);
    s.flyTo(counted(box(300, 300, 10, 10)), { spring: "hop" });
    assert.equal(reads, 0, "no rect read during the click");
    assert.equal(runs.length, 1, "one measurement scheduled for both");
    runs[0]();
    assert.equal(reads, 1);
    assert.deepEqual(d.moves(), [{ op: "move", x: 305, y: 305, spring: "hop" }]);
  });

  it("hide() drops a flight still waiting to be measured", () => {
    const runs: (() => void)[] = [];
    const s = new LightStore({ reduced: () => false, setTimer: () => 0, clearTimer: () => {}, defer: (run) => void runs.push(run) });
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(0, 0, 10, 10)));
    s.hide();
    runs[0]();
    assert.equal(d.moves().length, 0);
    assert.equal(s.state.mode, "hidden");
  });
});

describe("reduced motion", () => {
  it("jumps to the target, no squash, and still hands off", () => {
    const { s } = store(true);
    const win = fakeWindow();
    const d = fakeDriver();
    s.mount(win, d.driver);
    s.flyTo(el(win, box(100, 100, 10, 10)), { handoff: true, spring: "hop" });
    assert.deepEqual(d.moves(), [{ op: "move", x: 105, y: 105, spring: null }]);
    assert.ok(!d.ops().includes("land"));
    assert.equal(s.state.mode, "handed");
    assert.equal(d.ops().at(-1), "fade");
  });
});
