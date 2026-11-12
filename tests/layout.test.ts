// The three views of one map (SERVICES.md §7, §9 tasks 8-9, §10): today's
// lanes stay exactly where v1 put them, a service's lanes get portals to the
// services it talks to, the system view has one card per service, and the
// palette, trace and hash all know which service a thing lives in.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { CodeMap, Layer } from "../src/analyzer/types";
import { cardColumns, cardHeight, checkView, defaultView, hashOf, layoutFor, parseHash, scopeOf, viewFor, type CardItem, type LinkItem, type PortalItem, type SvcItem } from "../src/components/mapLayout";
import { searchMap } from "../src/components/Palette";
import { serviceOf, trace, traceService } from "../src/lib/store";
import { buildFixture } from "./analyzer.helpers";

/** The v1 lane layout, copied from MapView.tsx before views existed, as the reference; since then a
 * table card that lists its columns is taller, and the cards under it move down by as much. */
function v1Positions(map: CodeMap): Map<string, { x: number; y: number }> {
  const lanes: Layer[] = ["ui", "api", "logic", "data", "external"];
  const out = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const layer of lanes) {
    const inLane = map.nodes.filter((n) => n.layer === layer).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
    const cols = Math.max(1, Math.min(3, Math.ceil(inLane.length / 40)));
    const rows = Math.ceil(inLane.length / cols) || 1;
    out.set(`lane:${layer}`, { x, y: -60 });
    let y = 0;
    inLane.forEach((n, i) => {
      if (i % rows === 0) y = 0;
      out.set(n.id, { x: x + Math.floor(i / rows) * 260, y });
      y += cardHeight(n) + 10;
    });
    x += cols * 260 - (260 - 220) + 90;
  }
  return out;
}

function positions(map: CodeMap, view: Parameters<typeof layoutFor>[1]) {
  return new Map(layoutFor(map, view).nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

describe("monolith: one picture, as today", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildFixture("monolith")).map;
  });

  it("gives a table card a line per column, and \"+N more\" past six", () => {
    const user = map.nodes.find((n) => n.id === "table:user")!;
    assert.deepEqual(cardColumns(user), { shown: user.columns, more: 0 });
    assert.equal(cardHeight(user), 46 + 5 + 2 * 14);
    const wide = { ...user, columns: Array.from({ length: 9 }, (_, i) => ({ name: `c${i}` })) };
    assert.deepEqual([cardColumns(wide).shown.length, cardColumns(wide).more, cardHeight(wide)], [6, 3, 46 + 5 + 7 * 14]);
    // Seven fit in the room "+1 more" would take.
    assert.equal(cardColumns({ ...user, columns: wide.columns.slice(0, 7) }).more, 0);
    assert.equal(cardHeight(map.nodes.find((n) => n.kind === "route")!), 46);
  });

  it("draws every lane card where v1 drew it, and nothing else", () => {
    assert.deepEqual(positions(map, { kind: "all" }), v1Positions(map));
  });

  it("has no system level, no portals, and ignores the hash", () => {
    assert.deepEqual(defaultView(map), { kind: "all" });
    assert.deepEqual(checkView(map, { kind: "system" }), { kind: "all" });
    assert.deepEqual(positions(map, { kind: "system" }), v1Positions(map), "asking for the system view still draws the lanes");
    const { nodes, edges } = layoutFor(map, { kind: "all" });
    assert.ok(!nodes.some((n) => n.type === "portal" || n.type === "svc"));
    assert.ok(!nodes.some((n) => n.type === "card" && n.badge), "no badges on a monolith");
    assert.ok(edges.every((e) => e.type === "edge"));
    assert.equal(parseHash(map, "#system"), null);
    assert.deepEqual(viewFor(map, map.nodes[0].id, { kind: "all" }), { kind: "all" });
  });

  it("the palette groups everything under the repo name", () => {
    const groups = searchMap(map, "login");
    assert.ok(groups.length > 0);
    assert.ok(!groups.some((g) => g.group === "Services"), "no services section for one app");
    assert.ok(groups.some((g) => g.group === "in monolith"));
  });
});

describe("compose-shop: system, service and everything", () => {
  let map: CodeMap;
  const usersById = "route:services/users/src/index.js#GET /users/:id";
  const apiToUsers = `calls-route:file:web/src/lib/api.ts->${usersById}`;
  before(async () => {
    map = (await buildFixture("compose-shop")).map;
  });

  it("opens on every lane while the map is small, and every lane is v1's layout", () => {
    assert.ok(map.nodes.length <= 150);
    assert.deepEqual(defaultView(map), { kind: "all" });
    assert.deepEqual(positions(map, { kind: "all" }), v1Positions(map));
  });

  it("draws web's lanes with a portal in the Routes lane for the users door it calls", () => {
    const { nodes, edges } = layoutFor(map, { kind: "service", id: "svc-web" });
    const cards = nodes.filter((n): n is CardItem => n.type === "card");
    assert.ok(cards.every((c) => c.node.service === "svc-web"), "only web's own cards");
    // One stub per door: api.ts and the page (through the rewrite) both call GET /users/:id.
    const doors = nodes.filter((n): n is PortalItem => n.type === "portal" && n.target === usersById);
    assert.equal(doors.length, 1, "one portal for the users door, however many lines call it");
    const [portal] = doors;
    assert.match(portal.id, /^portal:calls-route:file:web\/(src\/lib\/api\.ts|app\/page\.tsx)->/);
    assert.equal(portal.layer, "api");
    assert.equal(portal.target, usersById);
    assert.match(portal.name, /→ users · GET \/users\/:id/);
    assert.match(portal.sub, /door in the users service/);
    const laneX = (l: Layer) => nodes.find((n) => n.id === `lane:${l}`)!.x;
    assert.ok(portal.x >= laneX("api") && portal.x < laneX("logic"), "sits in the Routes lane");
    const arrow = edges.find((e) => e.id === apiToUsers);
    assert.ok(arrow && arrow.source === "file:web/src/lib/api.ts" && arrow.target === portal.id, "the arrow ends on the portal");
    const fromPage = edges.find((e) => e.type === "edge" && e.source === "file:web/app/page.tsx" && e.target === portal.id);
    assert.ok(fromPage, "the page's request through the rewrite ends on the same portal");
    const outside = nodes.find((n) => n.id === "lane:external");
    assert.ok(outside && outside.type === "lane" && outside.title === "Outside & other services");
  });

  it("badges users' door with who calls it, and orders gets portals for users' table and the payments placeholder", () => {
    const users = layoutFor(map, { kind: "service", id: "svc-users" });
    const door = users.nodes.find((n): n is CardItem => n.id === usersById);
    assert.match(door?.badge ?? "", /← called by .*web/);
    assert.match(door?.badge ?? "", /orders/);
    const orders = layoutFor(map, { kind: "service", id: "svc-orders" }).nodes.filter((n): n is PortalItem => n.type === "portal");
    const table = orders.find((p) => p.target === "table:svc-postgres/shop/users");
    assert.ok(table && table.layer === "data" && /shared with users/.test(table.sub), "users' table, written by orders");
    const pay = orders.find((p) => p.target === "svc-int:svc-payments");
    assert.ok(pay && pay.layer === "external", "the service whose code is not here");
  });

  it("draws the system view: one card per service, arrows coloured by kind, declarations apart", () => {
    const { nodes, edges } = layoutFor(map, { kind: "system" });
    const cards = nodes.filter((n): n is SvcItem => n.type === "svc");
    assert.deepEqual(
      cards.map((c) => c.id),
      ["svc-web", "svc-orders", "svc-users", "svc-postgres", "svc-kafka", "svc-payments"],
    );
    const at = (id: string) => cards.find((c) => c.id === id)!;
    assert.ok(at("svc-web").x < at("svc-orders").x && at("svc-orders").x < at("svc-users").x, "columns follow the flow");
    assert.ok(at("svc-users").x < at("svc-postgres").x, "infrastructure after the apps");
    assert.equal(at("svc-web").card.kind, "app");
    assert.equal(at("svc-web").card.openable, true);
    assert.equal(at("svc-payments").card.kind, "placeholder");
    assert.equal(at("svc-payments").card.openable, false);
    assert.match(at("svc-postgres").card.lines.join(" "), /shared by/);
    const links = edges.filter((e): e is LinkItem => e.type === "link");
    const link = (id: string) => links.find((l) => l.id === id);
    for (const id of ["link:svc-web->svc-users|request", "link:svc-web->svc-orders|request", "link:svc-orders->svc-users|request", "link:svc-orders->svc-payments|request"]) {
      assert.ok(link(id), id);
      assert.match(link(id)!.label, /request/);
    }
    const data = link("link:svc-users->svc-postgres|data");
    assert.ok(data && data.links.map((l) => l.kind).sort().join() === "reads,writes", "reads and writes share one green arrow");
    const declared = links.filter((l) => l.group === "declared");
    assert.ok(declared.length >= 4 && declared.every((l) => l.label === "" && l.links.every((x) => x.kind === "depends-on")));
    assert.ok(!links.some((l) => l.group === "request" && l.target === "svc-postgres"), "no request arrow into a database");
    for (const l of links) for (const s of l.links) for (const e of s.edgeIds) assert.ok(map.edges.some((x) => x.id === e), `${l.id}: ${e} is a real edge`);
  });

  it("knows which view shows a thing, and keeps it in the hash", () => {
    assert.deepEqual(viewFor(map, usersById, { kind: "system" }), { kind: "service", id: "svc-users" });
    assert.deepEqual(viewFor(map, usersById, { kind: "service", id: "svc-web" }), { kind: "service", id: "svc-users" });
    assert.deepEqual(viewFor(map, "file:web/src/lib/api.ts", { kind: "service", id: "svc-web" }), { kind: "service", id: "svc-web" });
    assert.deepEqual(viewFor(map, "svc-int:svc-payments", { kind: "service", id: "svc-orders" }), { kind: "system" });
    assert.deepEqual(viewFor(map, "svc-postgres", { kind: "service", id: "svc-web" }), { kind: "system" });
    assert.deepEqual(viewFor(map, usersById, { kind: "all" }), { kind: "all" }, "every lane already shows it");
    assert.deepEqual(viewFor(map, "svc-users", { kind: "all" }), { kind: "service", id: "svc-users" }, "picking a service opens its lanes");
    const h = hashOf({ kind: "service", id: "svc-users" }, usersById);
    assert.deepEqual(parseHash(map, `#${h}`), { view: { kind: "service", id: "svc-users" }, selected: usersById });
    assert.deepEqual(parseHash(map, "#system"), { view: { kind: "system" }, selected: null });
    assert.deepEqual(parseHash(map, "#svc-postgres")?.view, defaultView(map), "a database has no lanes to open");
    assert.ok(scopeOf(map, "svc-web").has("file:web/app/page.tsx"));
  });

  it("traces from the Show me button across into the users service", () => {
    const t = trace(map, "file:web/app/page.tsx");
    assert.ok(t.nodes.includes(usersById), "the request crosses the service boundary");
    assert.ok(t.services.includes("svc-web") && t.services.includes("svc-users"));
    // Logic calling a route is backwards by layer; into another service the layers start again.
    assert.ok(trace(map, "file:web/src/lib/api.ts").nodes.includes(usersById), "api.ts (logic) → users' door (route)");
    assert.equal(serviceOf(map, usersById), "svc-users");
    assert.equal(serviceOf(map, "svc-users"), "svc-users");
    const s = traceService(map, "svc-web");
    for (const id of ["svc-web", "svc-users", "svc-orders", "svc-postgres"]) assert.ok(s.services.includes(id), id);
    assert.ok(!s.services.includes("svc-kafka"), "a declared start-up order is not a flow");
    assert.ok(s.edges.includes(apiToUsers));
  });

  it("the palette finds the users service from its setting, hostname or prefix", () => {
    const [first] = searchMap(map, "USERS_URL");
    assert.equal(first.group, "Services");
    assert.equal(first.hits[0].id, "svc-users");
    assert.match(first.hits[0].sub, /USERS_URL points here \(docker-compose\.yml:\d+\)/);
    assert.equal(searchMap(map, "users:8080")[0].hits[0].id, "svc-users");
    const routes = searchMap(map, "route:/users");
    assert.ok(routes.length && routes.every((g) => g.hits.every((h) => h.id.startsWith("route:"))));
    assert.ok(routes.some((g) => g.group === "in users service"));
    const files = searchMap(map, "docker-compose").find((g) => g.group === "Files");
    assert.ok(files?.hits.some((h) => h.id === "docker-compose.yml"), "config files open in the Code panel");
  });
});
