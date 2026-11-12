// The map's index and what is built on it (docs/PERFORMANCE.md): lookups by
// id and adjacency lists, and the neighbourhood and trace walks that now use
// them. Each walk is checked against the plain scan it replaced, on the
// fixture maps and on random ones, so the faster version finds exactly the
// same nodes and edges.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { upgradeMap } from "../src/analyzer/migrate";
import { dataDirIn } from "../src/lib/dataDir";
import type { CodeMap, EdgeKind, Layer, MapEdge, MapNode } from "../src/analyzer/types";
import { buildIndex, indexOf, inOf, outOf } from "../src/lib/mapIndex";
import { edgesOf, neighbourhood, nodeById, trace } from "../src/lib/store";
import { cardClass, edgeClass, Highlight, hiStateOf, linkClass, svcClass } from "../src/components/mapHighlight";
import { buildFixture } from "./analyzer.helpers";

// ── the scans the index replaced, kept as the reference ──

function neighbourhoodScan(map: CodeMap, id: string, hops = 1, withImports = false) {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  let frontier = [id];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const e of map.edges) {
      if (!withImports && e.kind === "imports") continue;
      for (const f of frontier) {
        if (e.from === f && !nodes.has(e.to)) {
          nodes.add(e.to);
          next.push(e.to);
        }
        if (e.to === f && !nodes.has(e.from)) {
          nodes.add(e.from);
          next.push(e.from);
        }
      }
    }
    for (const e of map.edges) if (nodes.has(e.from) && nodes.has(e.to) && (withImports || e.kind !== "imports")) edges.add(e.id);
    frontier = next;
  }
  return { nodes, edges };
}

function traceScan(map: CodeMap, id: string) {
  const order: Record<string, number> = { ui: 0, api: 1, logic: 2, data: 3, external: 3 };
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const layer = (n: string) => (byId.get(n)?.kind === "channel" ? 1.5 : (order[byId.get(n)?.layer ?? "logic"] ?? 2));
  const hop = (a: string, b: string) => {
    const x = byId.get(a)?.service;
    const y = byId.get(b)?.service;
    return !!x && !!y && x !== y;
  };
  const isChan = (n: string) => byId.get(n)?.kind === "channel";
  const nodes = new Set([id]);
  const edges = new Set<string>();
  const walk = (start: string, forward: boolean, depth: number) => {
    if (depth > 8) return;
    for (const e of map.edges) {
      const [a, b] = forward ? [e.from, e.to] : [e.to, e.from];
      if (a !== start) continue;
      if (e.kind === "imports" && layer(b) === layer(a)) continue;
      const free = hop(a, b) || isChan(a) || isChan(b);
      if (!free && (forward ? layer(b) < layer(a) : layer(b) > layer(a))) continue;
      edges.add(e.id);
      if (!nodes.has(b)) {
        nodes.add(b);
        walk(b, forward, depth + 1);
      }
    }
  };
  walk(id, true, 0);
  walk(id, false, 0);
  const services = new Set<string>();
  for (const n of nodes) {
    const s = byId.get(n)?.service;
    if (s) services.add(s);
  }
  return { nodes: [...nodes], edges: [...edges], services: [...services] };
}

// ── a random map: layers, services, channels and every kind of edge, with long chains ──

function randomMap(seed: number, n = 160, m = 420): CodeMap {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const layers: Layer[] = ["ui", "api", "logic", "data", "external"];
  const kinds: EdgeKind[] = ["imports", "calls", "calls-route", "reads", "writes", "uses-service", "publishes", "consumes", "calls-rpc", "defines"];
  const nodes: MapNode[] = [];
  for (let i = 0; i < n; i++) {
    const channel = rnd() < 0.05;
    nodes.push({
      id: `n${i}`,
      name: `node ${i}`,
      kind: channel ? "channel" : "module",
      layer: channel ? "external" : pick(layers),
      area: pick(["web", "api", "lib"]),
      ...(rnd() < 0.8 ? { service: pick(["web", "users", "orders"]) } : {}),
    } as MapNode);
  }
  const edges: MapEdge[] = [];
  for (let i = 0; i < m; i++) {
    const from = rnd() < 0.3 ? `n${i % 20}` : `n${Math.floor(rnd() * n)}`; // some hubs
    const to = `n${Math.floor(rnd() * n)}`;
    edges.push({ id: `e${i}`, from, to, kind: pick(kinds), confidence: rnd() < 0.2 ? "likely" : "certain", evidence: [{ file: "x.ts", line: i + 1, text: "" }] } as MapEdge);
  }
  // A long chain so the depth limit of the trace matters.
  for (let i = 0; i < 20; i++) edges.push({ id: `c${i}`, from: `n${100 + i}`, to: `n${101 + i}`, kind: "calls", confidence: "certain", evidence: [{ file: "x.ts", line: 1, text: "" }] } as MapEdge);
  return { nodes, edges, services: [], system: { kind: "monolith", links: [] } } as unknown as CodeMap;
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

function sameWalks(map: CodeMap, ids: string[]) {
  for (const id of ids) {
    for (const [hops, imports] of [
      [0, false],
      [1, false],
      [1, true],
      [2, false],
      [2, true],
      [3, true],
    ] as const) {
      const a = neighbourhood(map, id, hops, imports);
      const b = neighbourhoodScan(map, id, hops, imports);
      assert.deepEqual(sorted(a.nodes), sorted(b.nodes), `neighbourhood nodes of ${id}, ${hops} hops, imports ${imports}`);
      assert.deepEqual(sorted(a.edges), sorted(b.edges), `neighbourhood edges of ${id}, ${hops} hops, imports ${imports}`);
    }
    const t = trace(map, id);
    const r = traceScan(map, id);
    // The same order too: the depth limit makes a trace depend on the order edges are walked.
    assert.deepEqual(t, r, `trace of ${id}`);
  }
}

describe("the map index", () => {
  it("finds nodes and edges by id, and each node's edges in and out in map order", () => {
    const map = randomMap(7);
    const ix = buildIndex(map);
    for (const n of map.nodes) assert.equal(ix.node.get(n.id), n);
    for (const e of map.edges) assert.equal(ix.edge.get(e.id), e);
    for (const n of map.nodes) {
      assert.deepEqual(outOf(ix, n.id), map.edges.filter((e) => e.from === n.id));
      assert.deepEqual(inOf(ix, n.id), map.edges.filter((e) => e.to === n.id));
    }
    assert.deepEqual(outOf(ix, "nowhere"), []);
  });

  it("is built once per map object, and a new map gets a new one", () => {
    const map = randomMap(3);
    assert.equal(indexOf(map), indexOf(map));
    const copy = { ...map, edges: [...map.edges] };
    assert.notEqual(indexOf(copy), indexOf(map));
  });

  it("nodeById and edgesOf answer as the scans did", () => {
    const map = randomMap(11);
    for (const n of map.nodes) {
      assert.equal(nodeById(map, n.id), map.nodes.find((x) => x.id === n.id));
      const { in: ins, out } = edgesOf(map, n.id);
      assert.deepEqual(ins, map.edges.filter((e) => e.to === n.id));
      assert.deepEqual(out, map.edges.filter((e) => e.from === n.id));
    }
    assert.equal(nodeById(map, "nowhere"), undefined);
  });

  it("neighbourhood and trace find what the scans found, on random maps", () => {
    for (const seed of [1, 2, 5, 42, 99]) {
      const map = randomMap(seed);
      sameWalks(map, map.nodes.filter((_, i) => i % 7 === 0 || i < 20).map((n) => n.id));
    }
  });
});

describe("the walks on real fixture maps", () => {
  const maps: CodeMap[] = [];
  before(async () => {
    maps.push((await buildFixture("monolith")).map, (await buildFixture("compose-shop")).map);
  });
  it("neighbourhood and trace match the scans for every node", () => {
    for (const map of maps) sameWalks(map, map.nodes.map((n) => n.id));
  });
});

// The big real map the speed work was measured on, when it is on this machine (it is not checked in).
const IRELIABEE = join(dataDirIn(process.cwd()), "ireliabee.map.json");
describe("the walks on the indexed iReliabee map", { skip: existsSync(IRELIABEE) ? false : "no .walkmycode/ireliabee.map.json here" }, () => {
  it("neighbourhood and trace match the scans for every node", async () => {
    const map = upgradeMap(JSON.parse(await readFile(IRELIABEE, "utf8")), "cli");
    sameWalks(map, map.nodes.map((n) => n.id));
  });
});

describe("what a click lights and dims", () => {
  const map = randomMap(5);
  const id = "n3";

  it("with nothing selected, nothing is marked", () => {
    const s = hiStateOf(map, null, null, false);
    assert.equal(s.mode, "none");
    assert.equal(cardClass(s, id), "");
    assert.equal(edgeClass(s, "e1"), "");
  });

  it("a selected card marks itself and its neighbours (imports too); the rest dim by the mode", () => {
    const s = hiStateOf(map, id, null, false);
    const near = neighbourhoodScan(map, id, 1, true);
    assert.equal(s.mode, "near");
    assert.equal(cardClass(s, id), " selected near");
    for (const n of map.nodes) assert.equal(cardClass(s, n.id).includes("near"), near.nodes.has(n.id), n.id);
    for (const e of map.edges) assert.equal(edgeClass(s, e.id), near.edges.has(e.id) ? " near" : "", e.id);
  });

  it("the system view has no neighbourhood: only the selection", () => {
    const s = hiStateOf(map, id, null, true);
    assert.equal(s.mode, "none");
    assert.equal(svcClass(s, id), " selected");
  });

  it("a trace lights its cards, arrows and services; a link lights when any of its edges does", () => {
    const lit = { nodes: new Set(["n1", "n2"]), edges: new Set(["e4"]), services: new Set(["orders"]) };
    const s = hiStateOf(map, id, lit, false);
    assert.equal(s.mode, "lit");
    assert.equal(cardClass(s, "n1"), " lit");
    assert.equal(cardClass(s, "n9"), "");
    assert.equal(svcClass(s, "orders"), " lit");
    assert.equal(svcClass(s, "n2"), " lit");
    assert.equal(linkClass(s, [["e1"], ["e2", "e4"]]), " lit");
    assert.equal(linkClass(s, [["e1"]]), "");
    assert.ok(edgeClass(s, "e4").includes("lit"));
  });

  it("the store tells its subscribers once per change, and not for the same state", () => {
    const h = new Highlight(hiStateOf(map, null, null, false));
    let calls = 0;
    const off = h.subscribe(() => calls++);
    const next = hiStateOf(map, id, null, false);
    h.set(next);
    h.set(next);
    assert.equal(calls, 1);
    assert.equal(h.get(), next);
    off();
    h.set(hiStateOf(map, null, null, false));
    assert.equal(calls, 1);
  });
});
