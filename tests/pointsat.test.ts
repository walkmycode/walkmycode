// "Where does this point?" (SERVICES.md §13): settings a request's base URL is
// built on that nothing in the workspace gives a value are found and listed;
// the user's answer stands in for config (after config, before the setting's
// name), and the arrows it settles are solid but say "you told WalkMyCode". With
// no answer nothing drawn before changes, and an answer survives upgradeMap
// and a re-index. A request no route answers goes to a stand-in for where its
// base points, a request for a file in public/ is not an API call, and a door a
// service doesn't have is listed as "Called but not found".
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { isAssetPath } from "../src/analyzer/config/files";
import { upgradeMap } from "../src/analyzer/migrate";
import type { Assertion, CodeMap, SourceFile } from "../src/analyzer/types";
import { layoutFor, type LinkItem } from "../src/components/mapLayout";
import { changesArrows, sameShape, sourcesOf, withAnswer } from "../src/lib/answers";
import { mapSummary } from "../src/lib/claude/prompts";
import { describeEdge } from "../src/lib/claude/system";
import { answersOf } from "../src/lib/store";
import { buildFixture, readFixture } from "./analyzer.helpers";

const AT = "2026-10-01T00:00:00.000Z";
const toBackend: Assertion[] = [{ setting: "VITE_API_URL", service: "svc-backend", answeredAt: AT }];
const APP = "file:web/src/App.tsx";
const API = "file:web/src/lib/api.ts";
const BACKEND = "route:backend/src/index.js#";

/** What a map draws: node ids, and each edge's id, confidence, note and evidence. */
function drawn(map: CodeMap) {
  return {
    nodes: map.nodes.map((n) => n.id).sort(),
    edges: map.edges.map((e) => JSON.stringify([e.id, e.confidence, e.note ?? null, e.evidence])).sort(),
    links: map.system.links.map((l) => `${l.id} ${l.confidence} ${l.count}`).sort(),
  };
}

describe("detection: settings with no value", () => {
  it("compose-shop: every base URL has a value in docker-compose.yml, so nothing is listed", async () => {
    const { map } = await buildFixture("compose-shop");
    assert.equal(map.unresolvedBases, undefined);
    assert.ok(!JSON.stringify(map).includes('"role":"user"'));
  });

  it("compose-shop without docker-compose.yml: USERS_URL, ORDERS_URL and PAYMENTS_URL, with who reads them and the guess their names make", async () => {
    const sources = (await readFixture("compose-shop")).filter((s) => s.path !== "docker-compose.yml");
    const { map } = await buildMap(sources, { name: "compose-shop" });
    const by = (s: string) => map.unresolvedBases?.find((b) => b.setting === s);
    assert.deepEqual(map.unresolvedBases?.map((b) => b.setting).sort(), ["ORDERS_URL", "PAYMENTS_URL", "USERS_URL"]);
    const users = by("USERS_URL")!;
    assert.deepEqual([...users.services].sort(), ["svc-orders", "svc-web"]);
    assert.equal(users.calls, 2);
    assert.equal(users.guess, "svc-users");
    assert.ok(users.reads.some((r) => r.file === "web/src/lib/api.ts" && r.line === 11));
    assert.ok(users.reads.some((r) => r.file === "services/orders/app/main.py"));
    assert.equal(by("ORDERS_URL")!.guess, "svc-orders");
    assert.equal(by("PAYMENTS_URL")!.guess, undefined);
    assert.deepEqual(by("PAYMENTS_URL")!.services, ["svc-orders"]);
  });

  it("vite-api: VITE_API_URL read in the URL, in a base function and through a fetch helper", async () => {
    const { map } = await buildFixture("vite-api");
    assert.equal(map.system.kind, "services");
    assert.equal(map.unresolvedBases?.length, 1);
    const b = map.unresolvedBases![0];
    assert.equal(b.setting, "VITE_API_URL");
    assert.deepEqual(b.services, ["svc-web"]);
    // App.tsx:9 reads it in the URL; apiFetch("/notes"), apiFetch(`/notes/${id}`) and `${apiBase()}/health`
    // reach it through api.ts, and so does apiFetch's own `${apiBase()}${path}`.
    assert.equal(b.calls, 5);
    assert.deepEqual(
      b.reads.map((r) => `${r.file}:${r.line}`),
      ["web/src/App.tsx:9", "web/src/lib/api.ts:3"],
    );
    assert.equal(b.links, 3);
    assert.equal(b.guess, undefined);
    assert.equal(b.answer, undefined);
  });

  it("never asks about another company's settings or a secret", async () => {
    const sources: SourceFile[] = [
      { path: "package.json", content: '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}' },
      { path: "app/api/items/route.ts", content: "export async function GET() {\n  return Response.json([]);\n}\n" },
      {
        path: "lib/calls.ts",
        content: "export async function a() {\n  return fetch(`${process.env.STRIPE_API_BASE}/v1/items`);\n}\nexport async function b() {\n  return fetch(`${process.env.ITEMS_TOKEN}/api/items`);\n}\n",
      },
    ];
    const { map } = await buildMap(sources, { name: "shop" });
    assert.equal(map.unresolvedBases, undefined);
  });
});

describe("resolution with and without an answer (vite-api)", () => {
  let none: CodeMap;
  let told: CodeMap;
  const edge = (map: CodeMap, id: string) => map.edges.find((e) => e.id === id);
  before(async () => {
    none = (await buildFixture("vite-api")).map;
    told = (await buildFixture("vite-api", { assertions: toBackend })).map;
  });

  it("without an answer the requests are guesses by path, and nothing says 'you told WalkMyCode'", () => {
    const calls = none.edges.filter((e) => e.kind === "calls-route");
    assert.ok(calls.length > 0);
    assert.ok(calls.every((e) => e.confidence === "likely"));
    assert.ok(none.edges.every((e) => e.evidence.every((v) => v.role !== "user")));
    assert.deepEqual(none.system.links.map((l) => `${l.id} ${l.confidence}`), ["calls-route:svc-web->svc-backend likely"]);
  });

  it("the URL built on the setting: certain, with its code line and the answer", () => {
    const e = edge(told, `calls-route:${APP}->${BACKEND}GET /notes`);
    assert.equal(e?.confidence, "certain");
    assert.equal(e?.note, undefined);
    assert.deepEqual(
      e?.evidence.map((v) => [v.file, v.line, v.role, v.setting]),
      [
        ["web/src/App.tsx", 9, undefined, undefined],
        ["web/src/App.tsx", 9, "user", "VITE_API_URL"],
      ],
    );
    assert.equal(e?.evidence[1].text, "you told WalkMyCode: VITE_API_URL → backend");
  });

  it("through a fetch helper and a base function: certain, the answer cited where api.ts reads the setting", () => {
    for (const id of [`calls-route:${APP}->${BACKEND}POST /notes`, `calls-route:${APP}->${BACKEND}GET /notes/:id`, `calls-route:${API}->${BACKEND}GET /health`]) {
      const e = edge(told, id);
      assert.equal(e?.confidence, "certain", id);
      assert.ok(e!.evidence.some((v) => !v.role));
      assert.ok(e!.evidence.some((v) => v.role === "user" && v.file === "web/src/lib/api.ts" && v.line === 3));
    }
  });

  it("the guesses by path are gone: the answer narrows each request to the service named", () => {
    assert.equal(edge(told, `calls-route:${API}->${BACKEND}GET /notes/:id`), undefined);
    assert.ok(told.edges.filter((e) => e.kind === "calls-route").every((e) => e.to.startsWith(BACKEND) && e.confidence === "certain"));
    assert.deepEqual(told.system.links.map((l) => `${l.id} ${l.confidence}`), ["calls-route:svc-web->svc-backend certain"]);
    assert.deepEqual(told.warnings, []);
  });

  it("the evidence rule holds: every arrow resting on an answer also cites its line of code", () => {
    for (const e of told.edges) if (e.evidence.some((v) => v.role === "user")) assert.ok(e.evidence.some((v) => !v.role), e.id);
  });

  it("the answer is recorded on the map, and naming the service works as well as its id", async () => {
    assert.deepEqual(told.unresolvedBases?.[0].answer, toBackend[0]);
    assert.equal(told.unresolvedBases?.[0].links, 4);
    const byName = (await buildFixture("vite-api", { assertions: [{ setting: "VITE_API_URL", service: "backend", answeredAt: AT }] })).map;
    assert.deepEqual(drawn(byName), drawn(told));
    assert.equal(byName.unresolvedBases?.[0].answer?.service, "svc-backend");
  });

  it("'an outside service / not sure', or a service not on the map, draws exactly what no answer draws", async () => {
    for (const service of [null, "svc-nowhere"]) {
      const m = (await buildFixture("vite-api", { assertions: [{ setting: "VITE_API_URL", service, answeredAt: AT }] })).map;
      assert.deepEqual(drawn(m), drawn(none));
    }
  });

  it("an answer comes after a value from config: with one, the answer is not used", async () => {
    const sources = (await readFixture("vite-api")).map((s) =>
      s.path === "docker-compose.yml" ? { ...s, content: s.content.replace('      - "5173:5173"\n', '      - "5173:5173"\n    environment:\n      VITE_API_URL: http://admin:8100\n') } : s,
    );
    const m = (await buildMap(sources, { name: "vite-api", assertions: toBackend })).map;
    assert.equal(m.unresolvedBases, undefined);
    const e = m.edges.find((x) => x.id === `calls-route:${APP}->route:admin/src/index.js#GET /notes`);
    assert.equal(e?.confidence, "certain");
    assert.ok(e!.evidence.some((v) => v.role === "config"));
    assert.ok(m.edges.every((x) => x.evidence.every((v) => v.role !== "user")));
  });

  it("the system view's pill and its hover text say 'you told WalkMyCode'", () => {
    const link = layoutFor(told, { kind: "system" }).edges.find((x): x is LinkItem => x.type === "link" && x.source === "svc-web" && x.target === "svc-backend");
    assert.match(link!.label, /4 you told WalkMyCode/);
    assert.match(link!.told!, /4 arrows here rest on what you told WalkMyCode \(VITE_API_URL → backend\), not on anything the code proves/);
    const plain = layoutFor(none, { kind: "system" }).edges.find((x): x is LinkItem => x.type === "link" && x.source === "svc-web");
    assert.doesNotMatch(plain!.label, /told/);
    assert.equal(plain!.told, undefined);
  });

  it("the AI's map summary and its link words say 'YOU TOLD WALKMYCODE', never proven by code", () => {
    const s = mapSummary(told);
    assert.match(s, /## Settings with no value in the repo/);
    assert.match(s, /VITE_API_URL \(read at web\/src\/App\.tsx:9; 5 requests from web\): YOU TOLD WALKMYCODE it points at backend: 4 arrows rest on that answer, not on code/);
    assert.match(s, /web → backend: calls-route ×4, 4 resting on what YOU TOLD WALKMYCODE \(not proven by code\)/);
    const e = told.edges.find((x) => x.id === `calls-route:${APP}->${BACKEND}GET /notes`)!;
    assert.match(describeEdge(told, e, true), /— web\/src\/App\.tsx:9 .*\[YOU TOLD WALKMYCODE: VITE_API_URL → backend — the user's answer, not proven by the code\]$/);
    assert.match(mapSummary(none), /VITE_API_URL .*: not answered; requests built on it are matched by their path only/);
  });
});

describe("one app: an answer for a setting with no value", () => {
  const sources: SourceFile[] = [
    { path: "package.json", content: '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}' },
    { path: "app/api/items/route.ts", content: "export async function GET() {\n  return Response.json([]);\n}\n" },
    {
      path: "app/page.tsx",
      content: '"use client";\nexport default function Page() {\n  async function load() {\n    await fetch(`${process.env.NEXT_PUBLIC_API}/api/items`);\n  }\n  return <button onClick={load}>Load</button>;\n}\n',
    },
  ];
  const ID = "calls-route:file:app/page.tsx->route:app/api/items/route.ts#GET /api/items";

  it("is listed, the arrow stays v1's guess without an answer, and is certain with one", async () => {
    const none = (await buildMap(sources, { name: "shop" })).map;
    assert.equal(none.system.kind, "monolith");
    assert.equal(none.unresolvedBases?.[0].setting, "NEXT_PUBLIC_API");
    const plain = none.edges.find((e) => e.id === ID);
    assert.equal(plain?.confidence, "likely");
    assert.equal(plain?.note, "The URL starts with a variable, so this is matched by the path only.");
    const told = (await buildMap(sources, { name: "shop", assertions: [{ setting: "NEXT_PUBLIC_API", service: "svc-shop", answeredAt: AT }] })).map;
    const e = told.edges.find((x) => x.id === ID);
    assert.equal(e?.confidence, "certain");
    assert.deepEqual(e?.evidence.map((v) => v.role), [undefined, "user"]);
    // The summary for one app gains the answer, and only once there is one.
    assert.doesNotMatch(mapSummary(none), /Settings with no value/);
    assert.match(mapSummary(told), /NEXT_PUBLIC_API .*YOU TOLD WALKMYCODE it points at shop/);
  });
});

describe("an answer survives upgradeMap and a re-index", () => {
  it("upgradeMap keeps the list, the answer and the 'you told WalkMyCode' evidence", async () => {
    const { map } = await buildFixture("vite-api", { assertions: toBackend });
    const back = upgradeMap(JSON.parse(JSON.stringify(map)), "cli");
    assert.deepEqual(back.unresolvedBases, map.unresolvedBases);
    assert.deepEqual(drawn(back), drawn(map));
    assert.deepEqual(answersOf(back), toBackend);
    // A map from before this feature upgrades with no list at all.
    const old = upgradeMap({ ...JSON.parse(JSON.stringify(map)), unresolvedBases: undefined });
    assert.equal(old.unresolvedBases, undefined);
  });

  it("built again from the files the workspace holds, with the answers the map carries, it draws the same map", async () => {
    const sources = await readFixture("vite-api");
    const first = (await buildMap(sources, { name: "vite-api", assertions: toBackend })).map;
    const files = Object.fromEntries(sources.map((s) => [s.path, s.content]));
    const again = (await buildMap(sourcesOf({ files, map: first }), { name: first.name, repos: first.repos, assertions: answersOf(first) })).map;
    assert.deepEqual(drawn(again), drawn(first));
    assert.deepEqual(again.unresolvedBases, first.unresolvedBases);
  });

  it("a workspace that kept too few files to draw the map again is caught, not drawn wrong", async () => {
    const sources: SourceFile[] = [
      { path: "web/package.json", content: '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}' },
      { path: "web/app/page.tsx", content: 'export default async function Page() {\n  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/items`);\n  return <main />;\n}\n' },
      { path: "api/requirements.txt", content: "fastapi\n" },
      { path: "api/main.py", content: 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/items")\ndef items():\n    return []\n' },
    ];
    const full = (await buildMap(sources, { name: "shop" })).map;
    const again = (await buildMap(sources, { name: "shop", assertions: [{ setting: "NEXT_PUBLIC_API_URL", service: "svc-api", answeredAt: AT }] })).map;
    assert.equal(full.system.kind, "services");
    assert.equal(sameShape(full, again), true);
    // Without its manifests (package.json, requirements.txt) the areas and the apps come out different.
    const bare = (await buildMap(sources.filter((s) => !/(^|\/)(package\.json|requirements\.txt)$/.test(s.path)), { name: "shop" })).map;
    assert.equal(sameShape(full, bare), false);
  });

  it("an answer is changed and taken back by setting, and only one naming a service redraws the arrows", () => {
    const one = withAnswer([], "VITE_API_URL", "svc-backend", AT);
    assert.deepEqual(one, toBackend);
    const moved = withAnswer(one, "VITE_API_URL", "svc-admin", AT);
    assert.deepEqual(moved, [{ setting: "VITE_API_URL", service: "svc-admin", answeredAt: AT }]);
    assert.deepEqual(withAnswer(moved, "VITE_API_URL", undefined), []);
    assert.equal(changesArrows([], one), true);
    assert.equal(changesArrows(one, moved), true);
    assert.equal(changesArrows([], withAnswer([], "VITE_API_URL", null, AT)), false);
    assert.equal(changesArrows(one, withAnswer(one, "VITE_API_URL", "svc-backend", "later")), false);
  });
});

describe("a request no route here answers goes to a stand-in for where its base points", () => {
  let none: CodeMap;
  const STAND_IN = "svc-int:svc-payments-url";
  const BILLING = "file:services/orders/app/billing.py";
  before(async () => {
    const sources = (await readFixture("compose-shop")).filter((s) => s.path !== "docker-compose.yml");
    none = (await buildMap(sources, { name: "compose-shop" })).map;
  });

  it("PAYMENTS_URL has no value and no route answers billing.py: one dashed arrow to 'wherever PAYMENTS_URL points'", () => {
    const e = none.edges.find((x) => x.id === `uses-service:${BILLING}->${STAND_IN}`);
    assert.equal(e?.confidence, "likely");
    assert.match(e!.note!, /Nothing in the repo gives PAYMENTS_URL a value and no route here answers it, so it goes to a backend whose code isn't here: add that backend's folder to the workspace, or say where PAYMENTS_URL points\./);
    assert.ok(e!.evidence.some((v) => v.file === "services/orders/app/billing.py" && !v.role));
    const s = none.services.find((x) => x.id === "svc-payments-url");
    assert.equal(s?.kind, "placeholder");
    assert.equal(s?.setting, "PAYMENTS_URL");
    assert.equal(none.nodes.find((n) => n.id === STAND_IN)?.internal, true);
    assert.equal(none.unresolvedBases?.find((b) => b.setting === "PAYMENTS_URL")?.placeholder, "svc-payments-url");
    assert.ok(!none.warnings.some((w) => /matched no route/.test(w)), none.warnings.join("\n"));
  });

  it("'a separate backend I don't have here' makes that arrow solid, marked 'you told WalkMyCode'", async () => {
    const sources = (await readFixture("compose-shop")).filter((s) => s.path !== "docker-compose.yml");
    const told = (await buildMap(sources, { name: "compose-shop", assertions: [{ setting: "PAYMENTS_URL", service: "svc-payments-url", answeredAt: AT }] })).map;
    const e = told.edges.find((x) => x.id === `uses-service:${BILLING}->${STAND_IN}`);
    assert.equal(e?.confidence, "certain");
    assert.equal(e?.evidence.find((v) => v.role === "user")?.text, "you told WalkMyCode: PAYMENTS_URL → a separate backend whose code isn't here");
    assert.equal(told.unresolvedBases?.find((b) => b.setting === "PAYMENTS_URL")?.answer?.service, "svc-payments-url");
  });

  it("told about VITE_API_URL that way, every request on it goes to the stand-in instead of a guessed route", async () => {
    const told = (await buildFixture("vite-api", { assertions: [{ setting: "VITE_API_URL", service: "svc-vite-api-url", answeredAt: AT }] })).map;
    assert.ok(!told.edges.some((e) => e.kind === "calls-route" && e.from.startsWith("file:web/")));
    const toStandIn = told.edges.filter((e) => e.to === "svc-int:svc-vite-api-url");
    assert.deepEqual(toStandIn.map((e) => `${e.from} ${e.confidence}`).sort(), [`${APP} certain`, `${API} certain`]);
    assert.ok(toStandIn.every((e) => e.evidence.some((v) => !v.role) && e.evidence.some((v) => v.role === "user")));
  });
});

describe("files the app serves itself, and doors a service doesn't have", () => {
  const next = (files: Record<string, string>) => buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "shop" });

  it("a request for a file in public/ is not an API call: no route, no warning, no stand-in", async () => {
    const { map } = await next({
      "package.json": '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}',
      "public/locales/ak.json": "",
      "public/locales/en.json": "",
      "app/page.tsx": 'export default async function Page({ lang }: { lang: string }) {\n  await fetch("/locales/ak.json");\n  await fetch(`/locales/${lang}.json`);\n  await fetch("/locales/zz.json");\n  return <main />;\n}\n',
    });
    assert.equal(map.stats.assets, 2);
    assert.equal(map.edges.filter((e) => e.kind !== "imports").length, 0);
    // The one file that isn't there is still a request that matched nothing.
    assert.deepEqual(map.warnings.filter((w) => /matched no route/.test(w)).length, 1);
    assert.match(map.warnings.join("\n"), /1 HTTP calls matched no route \(first few: app\/page\.tsx:4 GET \/locales\/zz\.json\)/);
    assert.equal(map.files.some((f) => f.path.startsWith("public/")), false, "asset paths are listed for this check only, never as files of the map");
  });

  it("the folder readers list a public/ or static/ file by its path only, and never a key or a config file", () => {
    for (const p of ["public/locales/ak.json", "web/public/favicon.ico", "static/robots.txt", "app/public/fonts/a.woff2"]) assert.equal(isAssetPath(p), true, p);
    for (const p of ["public/cert.pem", "public/.env", "src/locales/ak.json", "public/sw.js", "public/docker-compose.yml"]) assert.equal(isAssetPath(p), false, p);
  });

  it("a known service with no such door: listed under 'Called but not found', certain, apart from the generic warning", async () => {
    const compose = 'services:\n  web:\n    build: ./web\n  users:\n    build: ./users\n';
    const { map } = await next({
      "docker-compose.yml": compose,
      "web/requirements.txt": "requests\n",
      "web/main.py": 'import requests\n\ndef go():\n    return requests.post("http://users:8080/nope")\n',
      "users/requirements.txt": "fastapi\n",
      "users/main.py": 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/users")\ndef users():\n    return []\n',
    });
    assert.deepEqual(map.missingRoutes, [{ service: "svc-users", method: "POST", path: "/nope", calls: [{ file: "web/main.py", line: 4, text: 'return requests.post("http://users:8080/nope")' }], confidence: "certain" }]);
    assert.ok(!map.warnings.some((w) => /matched no route/.test(w)));
  });

  it("a request on a base whose other requests all land in one service: a door that service doesn't have, as a guess", async () => {
    // Two services with routes, so "only one service has routes" can't settle it.
    const { map } = await next({
      "docker-compose.yml": "services:\n  web:\n    build: ./web\n  api:\n    build: ./api\n  admin:\n    build: ./admin\n",
      "admin/package.json": '{"dependencies":{"express":"5.0.0"}}',
      "admin/index.js": 'const express = require("express");\nconst app = express();\napp.get("/admin/stats", (req, res) => res.json({}));\napp.listen(3100);\n',
      "web/package.json": '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}',
      "web/lib/api.ts": 'const API = process.env.API_URL || "https://api.example.com";\nexport function apiFetch(path: string) {\n  return fetch(`${API}${path}`);\n}\n',
      "web/app/page.tsx": 'import { apiFetch } from "../lib/api";\nexport default async function Page() {\n  await apiFetch("/items");\n  await apiFetch("/reports/weekly");\n  return <main />;\n}\n',
      "api/package.json": '{"dependencies":{"express":"5.0.0"}}',
      "api/index.js": 'const express = require("express");\nconst app = express();\napp.get("/items", (req, res) => res.json([]));\napp.listen(3000);\n',
    });
    assert.ok(map.edges.some((e) => e.kind === "calls-route" && e.to === "route:api/index.js#GET /items"));
    assert.equal(map.missingRoutes?.length, 1);
    const m = map.missingRoutes![0];
    assert.deepEqual([m.service, m.method, m.path, m.confidence], ["svc-api", undefined, "/reports/weekly", "likely"]);
    assert.equal(m.note, "The other requests built on API_URL land in the api service.");
    assert.deepEqual(m.calls.map((c) => `${c.file}:${c.line}`), ["web/app/page.tsx:4"]);
    assert.match(map.warnings.join("\n"), /1 request asks the api service for doors I can't find there \(first few: \? \/reports\/weekly \(web\/app\/page\.tsx:4\)\)/);
    assert.ok(!map.warnings.some((w) => /matched no route/.test(w)));
    // It survives upgradeMap, and the AI is told.
    assert.deepEqual(upgradeMap(JSON.parse(JSON.stringify(map))).missingRoutes, map.missingRoutes);
    assert.match(mapSummary(map), /## Called but not found .*\n- api: \/reports\/weekly \(web\/app\/page\.tsx:4\) \[GUESS: The other requests built on API_URL land in the api service\.\]/);
  });

  it("with no backend in the folders, a helper's requests go where its setting's value says", async () => {
    const { map } = await next({
      "package.json": '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}',
      "lib/api.ts": 'const API = process.env.API_URL || "https://api.example.com";\nexport function apiFetch(path: string) {\n  return fetch(`${API}${path}`);\n}\n',
      "app/page.tsx": 'import { apiFetch } from "../lib/api";\nexport default async function Page() {\n  await apiFetch("/items");\n  return <main />;\n}\n',
    });
    const e = map.edges.find((x) => x.id === "uses-service:file:app/page.tsx->svc:api-example-com");
    assert.equal(e?.confidence, "likely");
    assert.equal(e?.note, "It goes through apiFetch, which puts API_URL in front; the address in API_URL is https://api.example.com (lib/api.ts:1).");
    assert.equal(map.unresolvedBases, undefined, "a default in the code is a value");
  });
});

describe("no answers, no change", () => {
  for (const name of ["monolith", "compose-shop", "vite-api"]) {
    it(`${name}: an empty list, or an answer about a setting nothing reads, draws exactly the same map`, async () => {
      const plain = (await buildFixture(name)).map;
      const empty = (await buildFixture(name, { assertions: [] })).map;
      const elsewhere = (await buildFixture(name, { assertions: [{ setting: "NOT_READ_ANYWHERE_URL", service: "svc-web", answeredAt: AT }] })).map;
      assert.deepEqual(drawn(empty), drawn(plain));
      assert.deepEqual(drawn(elsewhere), drawn(plain));
      assert.deepEqual(empty.unresolvedBases, plain.unresolvedBases);
    });
  }
});
