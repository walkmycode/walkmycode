// The trace's choreography (docs/MOTION.md §4.3): the sweep lights lane by
// lane from pages to the database whichever card it started from, the gap
// between lanes keeps the whole sweep inside 1.2 s, a hop into another
// service carries the sweep on there, the chain the light rides runs through
// the origin, and the rider's easing keeps it one hop per arrow.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap, EdgeKind, Layer, MapEdge, MapNode } from "../src/analyzer/types";
import { cardPick, edgePick, hiStateOf, splitPick, svcPick } from "../src/components/mapHighlight";
import { arrowLength, linearEasing, riderStops, traceTiming } from "../src/components/mapTrace";
import { hopMs, SWEEP_MS } from "../src/lib/motion";
import { trace } from "../src/lib/store";

const node = (id: string, layer: Layer, service?: string, kind = "module"): MapNode => ({ id, name: id, kind, layer, area: "app", ...(service ? { service } : {}) }) as MapNode;
const edge = (id: string, from: string, to: string, kind: EdgeKind = "calls"): MapEdge => ({ id, from, to, kind, confidence: "certain", evidence: [{ file: "x.ts", line: 1, text: "" }] }) as MapEdge;
const mapOf = (nodes: MapNode[], edges: MapEdge[]): CodeMap => ({ nodes, edges, services: [], system: { kind: "monolith", links: [] } }) as unknown as CodeMap;

/** page → route → logic → table, plus a second route the page also calls. */
const chainMap = mapOf(
  [node("page", "ui"), node("route", "api"), node("logic", "logic"), node("table", "data"), node("other", "api")],
  [edge("e1", "page", "route", "calls-route"), edge("e2", "route", "logic"), edge("e3", "logic", "table", "reads"), edge("e4", "page", "other", "calls-route")],
);

const litOf = (map: CodeMap, id: string) => {
  const t = trace(map, id);
  return { nodes: new Set(t.nodes), edges: new Set(t.edges), services: new Set(t.services), origin: id };
};

describe("trace timing: lane order", () => {
  it("lights pages first and the database last, from a logic card", () => {
    const t = traceTiming(chainMap, litOf(chainMap, "logic"), "logic");
    assert.equal(t.nodeAt.get("page"), 0);
    assert.equal(t.nodeAt.get("route"), 1);
    assert.equal(t.nodeAt.get("logic"), 2);
    assert.equal(t.nodeAt.get("table"), 3);
    assert.equal(t.lanes, 4);
  });

  it("reads the same from the database end", () => {
    // Walking back from the table reaches the page but not the page's other route.
    const t = traceTiming(chainMap, litOf(chainMap, "table"), "table");
    assert.deepEqual([...t.nodeAt].sort(), [
      ["logic", 2],
      ["page", 0],
      ["route", 1],
      ["table", 3],
    ]);
  });

  it("gives an arrow the place of its earlier end", () => {
    const t = traceTiming(chainMap, litOf(chainMap, "logic"), "logic");
    assert.equal(t.edgeAt.get("e1"), 0);
    assert.equal(t.edgeAt.get("e2"), 1);
    assert.equal(t.edgeAt.get("e3"), 2);
  });

  it("starts counting at the first lane the trace touches", () => {
    // From a route with nothing above it, the route is lane 0.
    const m = mapOf([node("route", "api"), node("logic", "logic")], [edge("e1", "route", "logic")]);
    const t = traceTiming(m, litOf(m, "logic"), "logic");
    assert.equal(t.nodeAt.get("route"), 0);
    assert.equal(t.nodeAt.get("logic"), 1);
    assert.equal(t.lanes, 2);
  });

  it("a tour step without an origin sweeps from its earliest card", () => {
    const lit = { nodes: new Set(["route", "logic", "table"]), edges: new Set(["e2", "e3"]) };
    const t = traceTiming(chainMap, lit);
    assert.equal(t.nodeAt.get("route"), 0);
    assert.equal(t.nodeAt.get("table"), 2);
    assert.deepEqual(t.chain, ["e2", "e3"]);
  });
});

describe("trace timing: the hop", () => {
  it("is clamped to 120–220 ms and keeps the sweep inside 1.2 s", () => {
    assert.equal(hopMs(1), 220);
    assert.equal(hopMs(4), 220);
    assert.equal(hopMs(6), 200);
    assert.equal(hopMs(8), 150);
    assert.equal(hopMs(10), 120);
    assert.equal(hopMs(40), 120);
    for (const lanes of [5, 6, 7, 8, 9, 10]) assert.ok(hopMs(lanes) * (lanes - 1) <= SWEEP_MS, `${lanes} lanes`);
  });

  it("is the map's hop for the lanes the trace crosses", () => {
    const t = traceTiming(chainMap, litOf(chainMap, "logic"), "logic");
    assert.equal(t.hop, hopMs(4));
  });
});

describe("trace timing: across services", () => {
  /** web: page → logic; the logic calls users' route → logic → table. */
  const two = mapOf(
    [node("w.page", "ui", "web"), node("w.logic", "logic", "web"), node("u.route", "api", "users"), node("u.logic", "logic", "users"), node("u.table", "data", "users")],
    [edge("e1", "w.page", "w.logic"), edge("e2", "w.logic", "u.route", "calls-route"), edge("e3", "u.route", "u.logic"), edge("e4", "u.logic", "u.table", "reads")],
  );

  it("carries the sweep on into the next service after the one it left", () => {
    const t = traceTiming(two, litOf(two, "w.logic"), "w.logic");
    assert.equal(t.nodeAt.get("w.page"), 0);
    assert.equal(t.nodeAt.get("w.logic"), 2);
    assert.ok(t.nodeAt.get("u.route")! > t.nodeAt.get("w.logic")!, "the called route lights after the caller");
    assert.ok(t.nodeAt.get("u.table")! > t.nodeAt.get("u.route")!);
    assert.equal(t.serviceAt.get("web"), 0);
    assert.equal(t.serviceAt.get("users"), t.nodeAt.get("u.route"));
  });

  it("reads the same started from the far end", () => {
    const t = traceTiming(two, litOf(two, "u.table"), "u.table");
    assert.equal(t.nodeAt.get("w.page"), 0);
    assert.ok(t.nodeAt.get("u.route")! > t.nodeAt.get("w.logic")!);
    assert.deepEqual(t.chain, ["e1", "e2", "e3", "e4"]);
  });
});

describe("the chain", () => {
  it("runs back from the origin to the first lane, then on to the last", () => {
    const t = traceTiming(chainMap, litOf(chainMap, "logic"), "logic");
    assert.deepEqual(t.chain, ["e1", "e2", "e3"]);
  });

  it("takes the first branch in map order", () => {
    const t = traceTiming(chainMap, litOf(chainMap, "page"), "page");
    assert.deepEqual(t.chain, ["e1", "e2", "e3"], "e1 comes before e4 in the map");
  });

  it("follows a call along the same lane, prefers one into the next, and never loops", () => {
    const m = mapOf([node("a", "logic"), node("b", "logic"), node("t", "data")], [edge("e1", "a", "b"), edge("e2", "b", "a"), edge("e3", "b", "t", "reads")]);
    const lit = { nodes: new Set(["a", "b", "t"]), edges: new Set(["e1", "e2", "e3"]) };
    assert.deepEqual(traceTiming(m, lit, "a").chain, ["e1", "e3"], "a → b along the lane, then down to the table");
    assert.deepEqual(traceTiming(m, lit, "b").chain, ["e3"], "the table before the way back to a");
  });
});

describe("the highlight store carries the timing", () => {
  it("as --i after the classes, only on lit cards and arrows", () => {
    const lit = litOf(chainMap, "logic");
    const s = hiStateOf(chainMap, "logic", lit, false);
    assert.equal(cardPick(s, "page"), " lit|0");
    assert.equal(cardPick(s, "logic"), " selected lit|2");
    assert.equal(edgePick(s, "e3"), " lit near|2", "the selected card's neighbourhood still marks its arrows");
    assert.deepEqual(splitPick(cardPick(s, "table")), { cls: " lit", at: 3 });
    assert.deepEqual(splitPick(" selected"), { cls: " selected", at: undefined });
    const none = hiStateOf(chainMap, "logic", null, false);
    assert.equal(none.timing, null);
    assert.equal(cardPick(none, "logic"), " selected near");
  });

  it("gives a service card the place of its earliest lit node", () => {
    const m = mapOf([node("w.page", "ui", "web"), node("u.route", "api", "users")], [edge("e1", "w.page", "u.route", "calls-route")]);
    const s = hiStateOf(m, null, litOf(m, "w.page"), true);
    assert.equal(svcPick(s, "web"), " lit|0");
    assert.equal(svcPick(s, "users"), " lit|5", "a route one service on: lane 1, one service step (4) later");
  });
});

describe("the rider", () => {
  it("spends one hop on each arrow whatever its length", () => {
    const stops = riderStops([100, 400], [220]);
    // Start of the first arrow at t=0, its end at t=0.4 (four fifths of the first hop),
    // the start of the second at t=0.5, the end of the path at t=1.
    assert.deepEqual(
      stops.map((s) => [+s.value.toFixed(3), +s.at.toFixed(3)]),
      [
        [0, 0],
        [100 / 720, 0.4],
        [320 / 720, 0.5],
        [1, 1],
      ].map(([v, a]) => [+v.toFixed(3), +a.toFixed(3)]),
    );
    assert.equal(linearEasing(stops), "linear(0 0%, 0.1389 40%, 0.4444 50%, 1 100%)");
  });

  it("is monotonic, from 0 to 1", () => {
    const stops = riderStops([30, 500, 12, 250], [220, 221, 219]);
    for (let i = 1; i < stops.length; i++) {
      assert.ok(stops[i].value >= stops[i - 1].value);
      assert.ok(stops[i].at > stops[i - 1].at);
    }
    assert.equal(stops[0].value, 0);
    assert.equal(stops[stops.length - 1].value, 1);
  });

  it("measures a smooth-step arrow near enough", () => {
    assert.equal(arrowLength(0, 0, 100, 0), 100);
    assert.equal(arrowLength(0, 0, 100, 40), 140);
    // Back to the left: out, back past the start, and in.
    assert.equal(arrowLength(100, 0, 0, 0), 40 + 140);
  });
});
