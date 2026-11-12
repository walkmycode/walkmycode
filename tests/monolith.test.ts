// Map version 2 on a plain repo: everything v1 drew is still there with the
// same ids, plus the one app service and the new fields (SERVICES.md §9 task 1,
// §10 fixture 1, §11). The v1 snapshots were generated once from the v1 build.
import assert from "node:assert/strict";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { upgradeMap } from "../src/analyzer/migrate";
import type { CodeMap } from "../src/analyzer/types";
import { buildFixture, FIXTURES, readJson } from "./analyzer.helpers";

interface Snapshot {
  version: number;
  nodes: string[];
  edges: string[];
}

describe("v1 ids survive", () => {
  // compose-shop is a services repo: its tables are scoped by database by
  // design (§5 Tables, §10 fixture 2), so for it the check skips table ids;
  // every other v1 node and edge, requests between services included, stays.
  for (const name of ["monolith", "compose-shop"]) {
    it(`${name}: every v1 node and edge id is in the v2 map`, async () => {
      const snap = await readJson<Snapshot>(join(FIXTURES, `${name}.v1.json`));
      assert.equal(snap.version, 1);
      const { map } = await buildFixture(name);
      const nodes = new Set(map.nodes.map((n) => n.id));
      const edges = new Set(map.edges.map((e) => e.id));
      const kept = (id: string) => name === "monolith" || !id.includes("table:");
      assert.deepEqual(
        snap.nodes.filter(kept).filter((id) => !nodes.has(id)),
        [],
        "lost node ids",
      );
      assert.deepEqual(
        snap.edges.filter(kept).filter((id) => !edges.has(id)),
        [],
        "lost edge ids",
      );
    });
  }
});

describe("monolith fixture", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildFixture("monolith")).map;
  });

  it("is a version 2 monolith with exactly one app service", () => {
    assert.equal(map.version, 2);
    assert.equal(map.system.kind, "monolith");
    assert.deepEqual(map.system.links, []);
    assert.equal(map.services.length, 1);
    const [svc] = map.services;
    assert.equal(svc.kind, "app");
    assert.equal(svc.id, "svc-monolith");
    assert.deepEqual(svc.areas, map.areas);
    assert.ok(svc.evidence.length >= 1, "a service has at least one evidence line");
    assert.equal(svc.entry?.file, "package.json");
    assert.match(svc.entry?.text ?? "", /"start"/);
    assert.equal(svc.entry?.role, "config");
    assert.equal(svc.framework, "Next.js");
    assert.deepEqual(map.gateways, []);
    assert.deepEqual(map.repos, [{ label: "monolith", prefix: "", kind: "local" }]);
    assert.equal(map.stats.services, 1);
    assert.equal(map.stats.links, 0);
    assert.equal(map.stats.crossService, 0);
    assert.ok(!map.services.some((s) => s.kind === "placeholder"));
  });

  it("puts every non-external node in that service and leaves outside services alone", () => {
    const [svc] = map.services;
    for (const n of map.nodes) {
      if (n.layer === "external") assert.equal(n.service, undefined, n.id);
      else assert.equal(n.service, svc.id, n.id);
    }
    for (const f of map.files) if (!f.skipped) assert.equal(f.service, svc.id, f.path);
    const stripe = map.nodes.find((n) => n.id === "svc:stripe");
    assert.ok(stripe && stripe.layer === "external" && stripe.kind === "service" && !stripe.internal);
  });

  it("keeps monolith table ids unscoped", () => {
    const tables = map.nodes.filter((n) => n.kind === "table").map((n) => n.id).sort();
    assert.deepEqual(tables, ["table:session", "table:user"]);
  });

  it("draws the Sign in button to POST /api/login with its trigger", () => {
    const e = map.edges.find((x) => x.id === "calls-route:file:app/page.tsx->route:app/api/login/route.ts#POST /api/login");
    assert.ok(e, "edge exists");
    assert.equal(e.confidence, "certain");
    assert.equal(e.evidence[0].trigger?.label, "Sign in");
    assert.equal(e.evidence[0].trigger?.element, "button");
  });

  it("resolves the env base-URL call through .env.example, and has no unmatched-route warning", () => {
    // NEXT_PUBLIC_API_URL=http://localhost:3000: localhost in a repo with one app is that app (§10 fixture 1).
    const e = map.edges.find((x) => x.id === "calls-route:file:lib/api.ts->route:app/api/users/[id]/route.ts#GET /api/users/[id]");
    assert.ok(e, "edge exists");
    assert.equal(e.confidence, "certain");
    assert.equal(e.note, undefined);
    assert.deepEqual(
      e.evidence.map((x) => [x.file, x.line, x.role]),
      [
        ["lib/api.ts", 3, undefined],
        [".env.example", 1, "config"],
      ],
    );
    assert.equal(map.nodes.filter((n) => n.kind === "service" && n.internal).length, 0, "no placeholders in a monolith");
    assert.ok(!map.warnings.some((w) => w.includes("matched no route")), map.warnings.join("\n"));
  });

  it("never carries a secret", () => {
    assert.ok(!JSON.stringify(map).includes("sk_test_"));
  });
});

describe("upgradeMap", () => {
  const v1 = {
    version: 1,
    name: "old",
    generatedAt: "2026-01-01T00:00:00.000Z",
    areas: ["old"],
    files: [{ path: "a.ts", lang: "ts", lines: 3, area: "old" }],
    nodes: [
      { id: "file:a.ts", layer: "logic", kind: "module", name: "a", area: "old", file: "a.ts", line: 1, endLine: 3 },
      { id: "route:b.ts#GET /x", layer: "api", kind: "route", name: "GET /x", area: "old", file: "b.ts", line: 2, endLine: 5, method: "GET", path: "/x" },
      { id: "svc:stripe", layer: "external", kind: "service", name: "Stripe", area: "" },
    ],
    edges: [{ id: "calls-route:file:a.ts->route:b.ts#GET /x", from: "file:a.ts", to: "route:b.ts#GET /x", kind: "calls-route", confidence: "likely", evidence: [{ file: "a.ts", line: 2, text: "fetch" }] }],
    warnings: [],
    stats: { files: 1, parsed: 1, routes: 1, tables: 0, edges: 1, likely: 1, ms: 5 },
  };

  it("fills the v2 fields on a v1 map without touching an id", () => {
    const before = JSON.stringify({ nodes: v1.nodes.map((n) => n.id), edges: v1.edges.map((e) => e.id) });
    const m = upgradeMap(structuredClone(v1), "demo");
    assert.equal(m.version, 2);
    assert.deepEqual(m.repos, [{ label: "old", prefix: "", kind: "demo" }]);
    assert.deepEqual(m.system, { kind: "monolith", links: [] });
    assert.equal(m.services.length, 1);
    assert.equal(m.services[0].id, "svc-old");
    assert.equal(m.services[0].kind, "app");
    assert.deepEqual(m.services[0].areas, ["old"]);
    assert.equal(m.services[0].confidence, "likely");
    assert.deepEqual(m.gateways, []);
    assert.deepEqual(m.stats, { files: 1, parsed: 1, routes: 1, tables: 0, edges: 1, likely: 1, ms: 5, services: 1, links: 0, crossService: 0 });
    assert.equal(JSON.stringify({ nodes: m.nodes.map((n) => n.id), edges: m.edges.map((e) => e.id) }), before);
    assert.equal(m.nodes[0].service, "svc-old");
    assert.equal(m.nodes[1].service, "svc-old");
    assert.equal(m.nodes[2].service, undefined);
    assert.equal(m.name, "old");
    assert.equal(m.generatedAt, v1.generatedAt);
  });

  it("leaves a v2 map as it is", async () => {
    const { map } = await buildFixture("monolith");
    const again = upgradeMap(structuredClone(map));
    assert.deepEqual(again, map);
  });
});
