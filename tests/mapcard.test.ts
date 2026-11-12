// The home page's cards (src/lib/mapCard.ts, docs/design/home-redesign.html):
// lane counts from a map, the card's tag and line, the lane preview's blocks,
// and "when" in words.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap, Layer, MapNode } from "../src/analyzer/types";
import { cardMeta, cardOf, exampleTitle, isExample, laneBlocks, laneCounts, timeAgo, wholeRows, type MapCard } from "../src/lib/mapCard";
import { buildFixture } from "./analyzer.helpers";

const node = (id: string, layer: Layer, kind: MapNode["kind"] = "module"): MapNode => ({ id, layer, kind, name: id, area: "" });

function map(o: Partial<CodeMap> & { nodes: MapNode[] }): CodeMap {
  return {
    version: 2,
    name: "shop",
    generatedAt: "2026-10-01T10:00:00.000Z",
    repos: [{ label: "shop", prefix: "", kind: "local" }],
    system: { kind: "monolith", links: [] },
    services: [],
    gateways: [],
    areas: [],
    files: [],
    edges: [],
    warnings: [],
    stats: { files: 12, parsed: 10, routes: 3, tables: 2, edges: 0, likely: 0, ms: 1, services: 1, links: 0, crossService: 0 },
    ...o,
  } as CodeMap;
}

const card = (o: Partial<MapCard> = {}): MapCard => ({
  name: "shop",
  repos: ["shop"],
  apps: [],
  frameworks: [],
  files: 1142,
  routes: 507,
  tables: 0,
  lanes: { ui: 0, api: 0, logic: 0, data: 0, external: 0 },
  generatedAt: "2026-10-01T10:00:00.000Z",
  ...o,
});

describe("laneCounts", () => {
  it("counts a map's cards in each of its five lanes", () => {
    const m = map({ nodes: [node("a", "ui", "component"), node("b", "ui", "component"), node("c", "api", "route"), node("d", "logic"), node("e", "data", "table"), node("f", "data", "table"), node("g", "data", "table"), node("h", "external", "service")] });
    assert.deepEqual(laneCounts(m), { ui: 2, api: 1, logic: 1, data: 3, external: 1 });
  });

  it("gives an empty map empty lanes", () => {
    assert.deepEqual(laneCounts(map({ nodes: [] })), { ui: 0, api: 0, logic: 0, data: 0, external: 0 });
  });

  it("matches the lanes of a map the analyzer built", async () => {
    const { map: m } = await buildFixture("monolith");
    const counts = laneCounts(m);
    for (const layer of ["ui", "api", "logic", "data", "external"] as Layer[]) {
      assert.equal(counts[layer], m.nodes.filter((n) => n.layer === layer).length, layer);
    }
    assert.ok(counts.api > 0 && counts.data > 0, "the shop has routes and tables");
  });
});

describe("cardOf and cardMeta", () => {
  it("names a multi-repo system by its stack and counts its repos", () => {
    const m = map({
      nodes: [node("a", "ui")],
      repos: [
        { label: "web", prefix: "web/", kind: "local" },
        { label: "mobile", prefix: "mobile/", kind: "local" },
        { label: "api", prefix: "api/", kind: "local" },
      ],
      system: { kind: "services", links: [] },
      services: [
        { id: "svc-web", name: "web", kind: "app", framework: "Next.js" },
        { id: "svc-mobile", name: "mobile", kind: "app", framework: "Flutter" },
        { id: "svc-api", name: "api", kind: "app", framework: "FastAPI" },
        { id: "svc-db", name: "db", kind: "db" },
      ] as CodeMap["services"],
      stats: { files: 1142, parsed: 900, routes: 507, tables: 9, edges: 0, likely: 0, ms: 1, services: 4, links: 0, crossService: 0 },
    });
    const c = cardOf(m, "ahofe-all");
    assert.equal(c.name, "ahofe-all");
    assert.deepEqual(c.apps, ["web", "mobile", "api"]);
    assert.deepEqual(cardMeta(c), { tag: "3 repos", line: "Next.js + Flutter + FastAPI — 1,142 files · 507 routes" });
  });

  it("tags one repo of several services with how many, and names them when no framework is known", () => {
    assert.deepEqual(cardMeta(card({ apps: ["desktop", "backend", "website"], files: 621, routes: 1 })), { tag: "3 services", line: "desktop · backend · website — 621 files · 1 route" });
  });

  it("says just the counts for a plain one-folder map", () => {
    assert.deepEqual(cardMeta(card({ files: 1, routes: 0 })), { tag: null, line: "1 file · 0 routes" });
  });

  it("shortens a long stack", () => {
    assert.equal(cardMeta(card({ frameworks: ["A", "B", "C", "D", "E"] })).line.split(" — ")[0], "A + B + C +2");
  });
});

describe("laneBlocks", () => {
  it("gives the fullest lane eight blocks and the others their share, at least one each", () => {
    assert.deepEqual(laneBlocks({ ui: 307, api: 573, logic: 325, data: 208, external: 14 }), [4, 8, 5, 3, 1]);
  });

  it("leaves an empty lane empty", () => {
    assert.deepEqual(laneBlocks({ ui: 10, api: 0, logic: 5, data: 0, external: 0 }), [8, 0, 4, 0, 0]);
    assert.deepEqual(laneBlocks({ ui: 0, api: 0, logic: 0, data: 0, external: 0 }), [0, 0, 0, 0, 0]);
  });
});

describe("wholeRows", () => {
  it("shows whole rows only, two at most, three cards in one column, and every card when they fit in one row", () => {
    assert.equal(wholeRows(5, 4), 4);
    assert.equal(wholeRows(5, 3), 3);
    assert.equal(wholeRows(5, 2), 4);
    assert.equal(wholeRows(5, 1), 3);
    assert.equal(wholeRows(9, 4), 8);
    assert.equal(wholeRows(3, 4), 3);
    assert.equal(wholeRows(4, 4), 4);
    assert.equal(wholeRows(5, 0), 5, "before the grid is measured, all");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("says when in words", () => {
    assert.equal(timeAgo("2026-10-01T11:59:40Z", now), "just now");
    assert.equal(timeAgo("2026-10-01T11:35:00Z", now), "25 min ago");
    assert.equal(timeAgo("2026-10-01T10:00:00Z", now), "2 h ago");
    assert.equal(timeAgo("2026-09-30T09:00:00Z", now), "Yesterday");
    assert.equal(timeAgo("2026-09-27T12:00:00Z", now), "4 days ago");
    // The month's short name is the runtime's (ICU's) own: "Sep" or "Sept".
    const sep = new Date("2026-09-12T12:00:00Z").toLocaleDateString("en-GB", { month: "short" });
    assert.equal(timeAgo("2026-09-12T12:00:00Z", now), `12 ${sep}`);
    assert.equal(timeAgo("2025-09-12T12:00:00Z", now), `12 ${sep} 2025`);
    assert.equal(timeAgo("not a date", now), "");
  });
});

describe("examples", () => {
  it("offers maps named example-… as examples, titled in words", () => {
    assert.equal(isExample("example-online-shop"), true);
    assert.equal(isExample("ahofe-all"), false);
    assert.equal(exampleTitle("example-online-shop"), "Online shop");
  });
});
