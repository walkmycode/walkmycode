// Resolving a request across services (SERVICES.md §5, §9 task 5): an env
// base URL through docker-compose.yml, a literal internal host, a rewrite in
// next.config.js, placeholders for services whose code is not here, and the
// guesses that say why they are guesses. Internal hosts never become outside
// services.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import type { CodeMap } from "../src/analyzer/types";
import { kindWord } from "../src/components/Inspector";
import { buildFixture, readFixture } from "./analyzer.helpers";

describe("compose-shop: requests between services", () => {
  let map: CodeMap;
  const edge = (id: string) => map.edges.find((e) => e.id === id);
  before(async () => {
    map = (await buildFixture("compose-shop")).map;
  });

  it("A: an env base URL resolves through docker-compose.yml to the users service, certain", () => {
    const e = edge("calls-route:file:web/src/lib/api.ts->route:services/users/src/index.js#GET /users/:id");
    assert.ok(e);
    assert.equal(e.confidence, "certain");
    assert.equal(e.note, undefined);
    assert.deepEqual(
      e.evidence.map((x) => [x.file, x.line, x.role]),
      [
        ["web/src/lib/api.ts", 11, undefined],
        ["docker-compose.yml", 8, "config"],
      ],
    );
    assert.deepEqual(e.fromFns, ["getUser"]);
    assert.deepEqual(e.toFns, ["getUser"]);
    // Only the users service answers: no fan-out.
    assert.equal(map.edges.filter((x) => x.from === "file:web/src/lib/api.ts" && x.kind === "calls-route" && x.to.includes("/users")).length, 1);
  });

  it("A: a module constant bound to an env read resolves the same way", () => {
    const e = edge("calls-route:file:web/src/lib/api.ts->route:services/orders/app/main.py#POST /orders");
    assert.equal(e?.confidence, "certain");
    assert.ok(e?.evidence.some((x) => x.file === "docker-compose.yml" && x.line === 9 && x.role === "config"));
  });

  it("B: a literal internal host is certain, cites the compose line that names it, and has no variable note", () => {
    const list = edge("calls-route:route:services/orders/app/main.py#POST /orders->route:services/users/src/index.js#GET /users");
    assert.equal(list?.confidence, "certain");
    assert.deepEqual(
      list?.evidence.map((x) => [x.file, x.line, x.role]),
      [
        ["services/orders/app/main.py", 17, undefined],
        ["docker-compose.yml", 10, "config"],
      ],
    );
    const one = edge("calls-route:route:services/orders/app/main.py#POST /orders->route:services/users/src/index.js#GET /users/:id");
    assert.equal(one?.confidence, "certain");
    assert.ok(one?.evidence.some((x) => x.file === "docker-compose.yml" && x.line === 24));
    for (const x of [list, one]) assert.ok(!/starts with a variable/.test(x?.note ?? ""));
  });

  it("C: a path through the next.config.js rewrite reaches users GET /users/:id, certain, with its trigger", () => {
    const e = edge("calls-route:file:web/app/page.tsx->route:services/users/src/index.js#GET /users/:id");
    assert.ok(e);
    assert.equal(e.confidence, "certain");
    assert.equal(e.note, "Goes through the /api rewrite in web/next.config.js:4.");
    assert.equal(e.evidence[0].trigger?.label, "Show me");
    assert.ok(e.evidence.some((x) => x.file === "web/next.config.js" && x.line === 4 && x.role === "config"));
    assert.deepEqual(
      map.gateways.map((g) => [g.kind, g.source, g.strip, g.toService, g.ownerService]),
      [["next-rewrite", ["api", "**"], 1, "svc-users", "svc-web"]],
    );
  });

  it("/health from web: no rewrite covers it, so the search by path is a guess that says why", () => {
    const hits = map.edges.filter((e) => e.from === "file:web/app/page.tsx" && e.to.endsWith("#GET /health"));
    assert.equal(hits.length, 2);
    for (const e of hits) {
      assert.equal(e.confidence, "likely");
      assert.equal(e.note, "More than one service has this path; a base-URL setting or a rewrite would let me tell them apart.");
    }
  });

  it("an internal host with no code here is a placeholder, never an outside service", () => {
    const e = edge("uses-service:file:services/orders/app/billing.py->svc-int:svc-payments");
    assert.ok(e);
    assert.equal(e.confidence, "certain");
    assert.ok(e.evidence.some((x) => x.file === "docker-compose.yml" && x.line === 27 && x.role === "config"));
    const node = map.nodes.find((n) => n.id === "svc-int:svc-payments");
    assert.ok(node);
    assert.equal(node.internal, true);
    assert.equal(node.layer, "external");
    assert.equal(node.service, "svc-payments");
    const ph = map.services.find((s) => s.id === "svc-payments");
    assert.equal(ph?.kind, "placeholder");
    assert.ok(ph && ph.evidence.length >= 1);
    assert.ok(map.warnings.some((w) => w.includes("services/orders/app/billing.py:8")));
    assert.deepEqual(
      map.nodes.filter((n) => n.kind === "service" && n.layer === "external" && !n.internal),
      [],
    );
    assert.ok(!map.nodes.some((n) => n.kind === "service" && ["users:8080", "users", "payments:9000"].includes(n.name)));
    assert.ok(!kindWord(node, map).includes("another company"));
    assert.equal(kindWord(node, map), "one of this app's own services — its code isn't in this workspace");
  });

  it("every edge cites a file in the map, and no request is left unmatched", () => {
    const files = new Set(map.files.map((f) => f.path));
    for (const e of map.edges) {
      assert.ok(e.evidence.length >= 1, e.id);
      for (const x of e.evidence) assert.ok(files.has(x.file), `${e.id}: ${x.file}`);
    }
    assert.ok(!map.warnings.some((w) => w.includes("matched no route")), map.warnings.join("\n"));
    assert.equal(map.stats.likely, map.edges.filter((e) => e.confidence === "likely").length);
  });
});

describe("compose-shop without docker-compose.yml (the removal test)", () => {
  let map: CodeMap;
  before(async () => {
    const sources = (await readFixture("compose-shop")).filter((s) => s.path !== "docker-compose.yml");
    map = (await buildMap(sources, { name: "compose-shop" })).map;
  });

  it("users:8080 is still the users service, as a guess by its folder name; never an outside service", () => {
    const e = map.edges.find((x) => x.id === "calls-route:route:services/orders/app/main.py#POST /orders->route:services/users/src/index.js#GET /users");
    assert.equal(e?.confidence, "likely");
    assert.match(e?.note ?? "", /by its folder name/);
    assert.deepEqual(
      map.nodes.filter((n) => n.kind === "service" && !n.internal),
      [],
    );
  });

  it("an env setting with no value falls to the name heuristic, as a guess that says so", () => {
    const e = map.edges.find((x) => x.id === "calls-route:file:web/src/lib/api.ts->route:services/users/src/index.js#GET /users/:id");
    assert.equal(e?.confidence, "likely");
    assert.match(e?.note ?? "", /matched by the setting's name USERS_URL \(I found no value for it in your config\)/i);
    assert.ok(!e?.evidence.some((x) => x.role === "config"), "no config line to cite");
  });
});

describe("small repos", () => {
  const compose = 'services:\n  web:\n    build: ./web\n  users:\n    build: ./users\n    ports:\n      - "8000:8080"\n';
  const users = 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/users")\ndef users():\n    return []\n';
  const build = async (files: Record<string, string>) => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "shop" })).map;
  const pyWeb = (call: string) => `import requests\nfrom fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/")\ndef home():\n    return requests.get("${call}").json()\n`;

  it("localhost:<published port> is the service that publishes it, as a guess", async () => {
    const map = await build({ "docker-compose.yml": compose, "web/requirements.txt": "requests\n", "web/main.py": pyWeb("http://localhost:8000/users"), "users/requirements.txt": "fastapi\n", "users/main.py": users });
    const e = map.edges.find((x) => x.to === "route:users/main.py#GET /users");
    assert.equal(e?.confidence, "likely");
    assert.match(e?.note ?? "", /localhost:8000 is where the users service is published \(docker-compose\.yml:4\)/);
  });

  it("a known host with no such route gets a warning and no arrow", async () => {
    const map = await build({ "docker-compose.yml": compose, "web/requirements.txt": "requests\n", "web/main.py": pyWeb("http://users:8080/nope"), "users/requirements.txt": "fastapi\n", "users/main.py": users });
    assert.ok(!map.edges.some((x) => x.kind === "calls-route" && x.to.startsWith("route:users/")));
    assert.ok(
      map.warnings.some((w) => w.includes("the users service has no GET /nope") && w.includes("web/main.py:7")),
      map.warnings.join("\n"),
    );
  });

  it("cluster-internal names become placeholders; dotted public hosts stay outside services", async () => {
    const map = await build({
      "docker-compose.yml": compose,
      "web/package.json": '{"name":"web","scripts":{"start":"node index.js"},"dependencies":{"express":"4"}}',
      "web/index.js": 'const express = require("express");\nconst app = express();\napp.get("/", async (req, res) => {\n  await fetch("http://billing.default.svc.cluster.local/charge");\n  await fetch("https://api.example.org/v1/things");\n  res.send("ok");\n});\n',
      "users/requirements.txt": "fastapi\n",
      "users/main.py": users,
    });
    const ph = map.nodes.find((n) => n.internal);
    assert.equal(ph?.name, "billing.default.svc.cluster.local");
    assert.ok(map.nodes.some((n) => n.id === "svc:api-example-org" && !n.internal));
  });

  it("with no host, the only service that has routes answers, as a guess", async () => {
    const map = await build({
      "docker-compose.yml": compose,
      "web/package.json": '{"name":"web","dependencies":{"next":"16.0.0","react":"19.0.0"}}',
      "web/app/page.tsx": 'export default function Page() {\n  return <button onClick={() => fetch("/users")}>Go</button>;\n}\n',
      "users/requirements.txt": "fastapi\n",
      "users/main.py": users,
    });
    const e = map.edges.find((x) => x.to === "route:users/main.py#GET /users");
    assert.equal(e?.confidence, "likely");
    assert.match(e?.note ?? "", /only the users service has routes that could answer this/i);
  });

  it("an Ingress no service owns applies to code that belongs to no service too", async () => {
    const map = await build({
      "docker-compose.yml": compose,
      "k8s/ingress.yaml": "apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: shop\nspec:\n  rules:\n    - http:\n        paths:\n          - path: /api\n            pathType: Prefix\n            backend:\n              service:\n                name: users\n                port:\n                  number: 8080\n",
      "web/requirements.txt": "fastapi\n",
      "web/main.py": 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/")\ndef home():\n    return 1\n',
      "users/requirements.txt": "fastapi\n",
      "users/main.py": `${users}\n@app.get("/api/users")\ndef api_users():\n    return []\n`,
      "tools/package.json": '{"name":"tools"}',
      "tools/ping.js": 'export async function ping() {\n  return fetch("/api/users");\n}\n',
    });
    const e = map.edges.find((x) => x.id === "calls-route:file:tools/ping.js->route:users/main.py#GET /api/users");
    assert.equal(e?.confidence, "certain");
    assert.match(e?.note ?? "", /\/api Ingress rule in k8s\/ingress\.yaml:9/);
  });

  it("a request to a gateway container follows its nginx rules to the service behind it", async () => {
    const map = await build({
      "docker-compose.yml": `${compose}  nginx:\n    build: ./nginx\n`,
      "nginx/Dockerfile": "FROM nginx:1.27\nCOPY nginx.conf /etc/nginx/nginx.conf\n",
      "nginx/nginx.conf": "upstream users_up { server users:8080; }\nserver {\n  location /api/ {\n    proxy_pass http://users_up/;\n  }\n}\n",
      "web/requirements.txt": "requests\n",
      "web/main.py": pyWeb("http://nginx/api/users"),
      "users/requirements.txt": "fastapi\n",
      "users/main.py": users,
    });
    const e = map.edges.find((x) => x.to === "route:users/main.py#GET /users");
    assert.equal(e?.confidence, "certain");
    assert.match(e?.note ?? "", /\/api nginx proxy in nginx\/nginx\.conf:4/);
    assert.ok(map.system.links.some((l) => l.id === "proxies:svc-nginx->svc-users"));
  });
});
