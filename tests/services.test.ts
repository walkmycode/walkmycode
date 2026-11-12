// Service boundaries and the monolith rule (SERVICES.md §9 task 4, §4 steps
// 1-7): compose-shop is three apps plus postgres and kafka; the monolith
// fixture is one app; libraries belong to the app that imports them.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap, type BuildResult } from "../src/analyzer/build";
import { normalisedName, orderServices } from "../src/analyzer/services";
import type { CodeMap, MapEdge, MapNode, ServiceDef, SourceFile } from "../src/analyzer/types";
import { buildFixture } from "./analyzer.helpers";

describe("compose-shop: services from docker-compose.yml", () => {
  let built: BuildResult;
  let map: CodeMap;
  const svc = (id: string) => map.services.find((s) => s.id === id)!;
  before(async () => {
    built = await buildFixture("compose-shop");
    map = built.map;
  });

  it("is a system of services: 3 apps, then postgres (db) and kafka (broker), then payments (placeholder)", () => {
    assert.equal(map.system.kind, "services");
    // Flow order (§4 step 7): web calls both; orders calls users (main.py), so users comes after orders.
    assert.deepEqual(
      map.services.map((s) => [s.id, s.kind]),
      [
        ["svc-web", "app"],
        ["svc-orders", "app"],
        ["svc-users", "app"],
        ["svc-postgres", "db"],
        ["svc-kafka", "broker"],
        ["svc-payments", "placeholder"],
      ],
    );
    assert.equal(map.stats.services, 6);
  });

  it("binds each app to its build folder, with hostnames, ports and dev hosts", () => {
    const users = svc("svc-users");
    assert.deepEqual(users.areas, ["services/users"]);
    assert.deepEqual(svc("svc-orders").areas, ["services/orders"]);
    assert.deepEqual(svc("svc-web").areas, ["web"]);
    for (const h of ["users", "users:8080"]) assert.ok(users.hostnames.includes(h), h);
    assert.ok(users.devHosts.includes("localhost:8000"));
    assert.deepEqual(users.ports, [{ host: 8000, container: 8080 }], "Dockerfile EXPOSE 8080 is the same port, not a second one");
    assert.deepEqual(users.dependsOn, ["svc-postgres", "svc-kafka"]);
    assert.equal(users.confidence, "certain");
  });

  it("starts each app from its Dockerfile CMD, or its package.json start script", () => {
    assert.match(svc("svc-users").entry?.text ?? "", /node src\/index\.js/);
    assert.equal(svc("svc-users").entry?.file, "services/users/Dockerfile");
    assert.equal(svc("svc-users").entry?.role, "config");
    assert.match(svc("svc-orders").entry?.text ?? "", /^uvicorn app\.main:app/);
    assert.equal(svc("svc-web").entry?.file, "web/package.json");
    assert.equal(svc("svc-web").framework, "Next.js");
    assert.equal(svc("svc-users").framework, "Express");
    assert.equal(svc("svc-orders").framework, "FastAPI");
  });

  it("keeps each service's env table with file:line, passwords hidden", () => {
    const users = svc("svc-users");
    assert.deepEqual(users.env.DATABASE_URL, { value: "postgres://app:•••@postgres:5432/shop", file: "docker-compose.yml", line: 15 });
    assert.deepEqual(svc("svc-web").env.USERS_URL, { value: "http://users:8080", file: "docker-compose.yml", line: 8 });
    assert.equal(svc("svc-orders").env.PAYMENTS_URL.value, "http://payments:9000");
  });

  it("gives every service at least one evidence line, config lines marked as config", () => {
    for (const s of map.services) {
      assert.ok(s.evidence.length >= 1, s.id);
      for (const e of s.evidence) assert.ok(map.files.some((f) => f.path === e.file), `${s.id}: ${e.file} is in the map`);
    }
    assert.deepEqual(svc("svc-users").evidence[0], { file: "docker-compose.yml", line: 10, text: "users:", role: "config" });
    assert.ok(svc("svc-users").evidence.some((e) => e.file === "services/users/Dockerfile" && e.role === "config"));
    assert.deepEqual(svc("svc-postgres").evidence, [{ file: "docker-compose.yml", line: 31, text: "postgres:", role: "config" }]);
    assert.deepEqual(svc("svc-postgres").areas, []);
    assert.equal(svc("svc-postgres").image, "postgres:16");
  });

  it("puts every node in the service of its folder, and counts them", () => {
    for (const n of map.nodes) {
      if (n.layer === "external") {
        // Only a card for one of the system's own services belongs to one, and a channel to its broker.
        assert.equal(n.service, n.internal ? n.id.slice("svc-int:".length) : n.kind === "channel" ? "svc-kafka" : undefined, n.id);
        continue;
      }
      // A table belongs to the service whose schema creates it, and sits in that folder.
      const want = n.area === "web" ? "svc-web" : n.area === "services/users" ? "svc-users" : "svc-orders";
      assert.equal(n.service, want, n.id);
    }
    const users = svc("svc-users");
    const own = map.nodes.filter((n) => n.service === "svc-users");
    assert.equal(users.counts.api + users.counts.ui + users.counts.logic + users.counts.data, own.length);
    assert.equal(users.counts.api, 4);
  });

  it("counts edges that cross a service boundary", () => {
    const svcOf = new Map(map.nodes.map((n) => [n.id, n.service]));
    const crossing = map.edges.filter((e) => svcOf.get(e.from) && svcOf.get(e.to) && svcOf.get(e.from) !== svcOf.get(e.to));
    assert.equal(map.stats.crossService, crossing.length);
    assert.ok(crossing.length > 0);
  });

  it("finds the database each app uses through the hostname table (§4 step 5)", () => {
    assert.equal(built.dbOf["svc-users"], "svc-postgres/shop");
    assert.equal(built.dbOf["svc-orders"], "svc-postgres/shop");
    assert.equal(built.dbOf["svc-web"], "own:svc-web");
  });

  it("scopes table ids by the database compose names (§5 Tables)", () => {
    assert.deepEqual(map.nodes.filter((n) => n.kind === "table").map((n) => n.id).sort(), ["table:svc-postgres/shop/orders", "table:svc-postgres/shop/users"]);
  });
});

describe("monolith fixture: the monolith rule", () => {
  let built: BuildResult;
  before(async () => {
    built = await buildFixture("monolith");
  });

  it("is one app named after the repo, with every node in it", () => {
    const { map } = built;
    assert.equal(map.system.kind, "monolith");
    assert.equal(map.services.length, 1);
    const [app] = map.services;
    assert.equal(app.id, "svc-monolith");
    assert.equal(app.kind, "app");
    assert.deepEqual(app.areas, map.areas);
    for (const n of map.nodes) if (n.layer !== "external") assert.equal(n.service, app.id, n.id);
    assert.equal(map.stats.crossService, 0);
  });

  it("has no database it can name: DATABASE_URL points at localhost", () => {
    assert.equal(built.dbOf["svc-monolith"], "own:svc-monolith");
  });
});

// ── small in-memory repos for the other shapes ──
async function build(files: Record<string, string>, name = "repo") {
  const sources: SourceFile[] = Object.entries(files).map(([path, content]) => ({ path, content }));
  return (await buildMap(sources, { name })).map;
}

describe("app vs library (§4 step 3)", () => {
  it("one app (an apps/* folder) plus a shared package is a monorepo with one service", async () => {
    const map = await build(
      {
        "apps/web/package.json": '{"name":"web","dependencies":{"next":"16.0.0","react":"19.0.0"}}',
        "apps/web/app/page.tsx": 'import { Button } from "../../../packages/ui/button";\nexport default function Page() {\n  return <Button />;\n}\n',
        "packages/ui/package.json": '{"name":"ui","dependencies":{"react":"19.0.0"}}',
        "packages/ui/button.tsx": "export function Button() {\n  return <button>Go</button>;\n}\n",
      },
      "shop",
    );
    assert.equal(map.system.kind, "monorepo");
    assert.equal(map.services.length, 1);
    assert.equal(map.services[0].id, "svc-web");
    assert.equal(map.services[0].confidence, "likely", "going by the folder name");
    for (const n of map.nodes) if (n.layer !== "external") assert.equal(n.service, "svc-web", n.id);
  });

  it("two apps found by their code are services; a library goes to the app that imports it most", async () => {
    const map = await build({
      "api/package.json": '{\n  "name": "api",\n  "scripts": {\n    "start": "node index.js"\n  },\n  "dependencies": { "express": "4" }\n}\n',
      "api/index.js": 'const express = require("express");\nconst { fmt } = require("../shared/fmt");\nconst { slug } = require("../shared/slug");\nconst app = express();\napp.get("/items", (req, res) => res.json(fmt([])));\napp.listen(4000);\n',
      "web/package.json": '{"name":"web","dependencies":{"next":"16.0.0","react":"19.0.0"}}',
      "web/app/page.tsx": 'import { fmt } from "../../shared/fmt";\nexport default function Page() {\n  return <p>{fmt([])}</p>;\n}\n',
      "shared/package.json": '{"name":"shared"}',
      "shared/fmt.js": "export function fmt(x) {\n  return x;\n}\n",
      "shared/slug.js": "export function slug(x) {\n  return x;\n}\n",
    });
    assert.equal(map.system.kind, "services");
    const ids = map.services.map((s) => s.id);
    assert.deepEqual(ids, ["svc-web", "svc-api"], "UI first when nothing orders them");
    const api = map.services.find((s) => s.id === "svc-api")!;
    assert.equal(api.confidence, "likely", "no config proves the boundary");
    assert.deepEqual(api.hostnames, ["api"]);
    assert.deepEqual(api.devHosts, ["localhost:4000", "127.0.0.1:4000"]);
    assert.ok(api.evidence.some((e) => e.file === "api/index.js" && e.line === 6), "the listen line is evidence");
    assert.equal(api.entry?.file, "api/package.json");
    // api imports shared twice (fmt, slug), web once.
    assert.equal(map.nodes.find((n) => n.id === "file:shared/fmt.js")?.service, "svc-api");
    assert.ok(!map.services.some((s) => s.areas.includes("shared")), "a library is never a service");
  });

  it("apps/* and services/* folders are services by name only when no config names any", async () => {
    const map = await build({
      "services/a/package.json": '{"name":"a"}',
      "services/a/lib.js": "export const a = 1;\n",
      "services/b/package.json": '{"name":"b"}',
      "services/b/lib.js": "export const b = 2;\n",
    });
    assert.equal(map.system.kind, "services");
    assert.deepEqual(
      map.services.map((s) => [s.id, s.confidence]),
      [
        ["svc-a", "likely"],
        ["svc-b", "likely"],
      ],
    );
  });

  it("loose scripts outside every package are not a service", async () => {
    const map = await build({
      "api/requirements.txt": "fastapi\n",
      "api/main.py": 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/x")\ndef x():\n    return 1\n',
      "web/package.json": '{"name":"web","dependencies":{"vite":"5","react":"19.0.0"}}',
      "web/src/App.tsx": "export default function App() {\n  return <p>hi</p>;\n}\n",
      "scripts/release.py": 'def main():\n    pass\n\nif __name__ == "__main__":\n    main()\n',
    });
    assert.deepEqual(map.services.map((s) => s.id).sort(), ["svc-api", "svc-web"]);
    assert.equal(map.nodes.find((n) => n.id === "file:scripts/release.py")?.service, undefined);
  });
});

describe("compose edge cases", () => {
  it("an image-only app is a placeholder; a build folder with no code is infra by its name", async () => {
    const map = await build({
      "docker-compose.yml": "services:\n  web:\n    build: ./web\n  users:\n    image: acme/users:1\n  nginx:\n    build: ./nginx\n",
      "web/package.json": '{"name":"web","dependencies":{"next":"16.0.0","react":"19.0.0"}}',
      "web/app/page.tsx": "export default function Page() {\n  return <p>hi</p>;\n}\n",
      "nginx/Dockerfile": "FROM nginx:1.27\nCOPY nginx.conf /etc/nginx/nginx.conf\n",
    });
    const by = (id: string) => map.services.find((s) => s.id === id)!;
    assert.equal(by("svc-users").kind, "placeholder");
    assert.equal(by("svc-users").confidence, "likely");
    assert.equal(by("svc-nginx").kind, "gateway");
    assert.equal(map.system.kind, "monolith", "one app, whatever else compose starts");
    assert.deepEqual(
      map.services.map((s) => s.id),
      ["svc-web", "svc-nginx", "svc-users"],
      "apps, then infrastructure, then placeholders",
    );
  });

  it("a compose file that starts only infrastructure keeps the repo's one app", async () => {
    const map = await build(
      {
        "docker-compose.yml": "services:\n  postgres:\n    image: postgres:16\n",
        "requirements.txt": "psycopg\n",
        "etl/load.py": "def load(cur):\n    cur.execute(\"SELECT * FROM rows\")\n",
      },
      "etl",
    );
    assert.equal(map.system.kind, "monolith");
    assert.deepEqual(
      map.services.map((s) => [s.id, s.kind]),
      [
        ["svc-etl", "app"],
        ["svc-postgres", "db"],
      ],
    );
    for (const n of map.nodes) if (n.layer !== "external") assert.equal(n.service, "svc-etl", n.id);
    for (const s of map.services) assert.ok(s.evidence.length >= 1, s.id);
  });

  it("a compose build folder with no manifest becomes its own area", async () => {
    const map = await build({
      "docker-compose.yml": "services:\n  worker:\n    build: ./worker\n  api:\n    build: ./api\n",
      "worker/run.py": 'import requests\n\nif __name__ == "__main__":\n    requests.get("http://api:8000/jobs")\n',
      "api/main.py": 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/jobs")\ndef jobs():\n    return []\n',
    });
    assert.deepEqual(map.areas, ["api", "worker"]);
    assert.equal(map.system.kind, "services");
    assert.equal(map.nodes.find((n) => n.file === "worker/run.py")?.service, "svc-worker");
  });
});

describe("normalisedName and flow order", () => {
  it("matches names across sources", () => {
    assert.equal(normalisedName("Users-Service"), "users");
    assert.equal(normalisedName("orders_api"), "orders");
    assert.equal(normalisedName("web.app"), "web");
    assert.equal(normalisedName("ireliabee-web"), "ireliabee-web");
  });

  it("orders apps callers-first, UI first on ties, breaks cycles by name, infra after", () => {
    const def = (id: string, kind: ServiceDef["kind"] = "app"): ServiceDef => ({ id, name: id.slice(4), kind, areas: [], hostnames: [], devHosts: [], ports: [], env: {}, dependsOn: [], evidence: [], confidence: "certain", counts: { ui: 0, api: 0, logic: 0, data: 0 } });
    const node = (id: string, service: string, layer: MapNode["layer"] = "api"): MapNode => ({ id, service, layer, kind: layer === "ui" ? "component" : "route", name: id, area: "" });
    const edge = (from: string, to: string, kind: MapEdge["kind"] = "calls-route"): MapEdge => ({ id: `${kind}:${from}->${to}`, from, to, kind, confidence: "certain", evidence: [] });
    const services = [def("svc-db", "db"), def("svc-zeta"), def("svc-alpha"), def("svc-beta"), def("svc-gone", "placeholder"), def("svc-shop")];
    const nodes = [node("ui", "svc-shop", "ui"), node("z", "svc-zeta"), node("a", "svc-alpha"), node("b", "svc-beta"), { id: "chan:kafka/t", layer: "external", kind: "channel", name: "t", area: "" } as MapNode];
    const edges = [
      edge("ui", "z"), // shop → zeta
      edge("a", "b"), // alpha ⇄ beta: a cycle
      edge("b", "a"),
      edge("z", "chan:kafka/t", "publishes"), // zeta → (t) → alpha
      edge("a", "chan:kafka/t", "consumes"),
    ];
    const ordered = orderServices(services, nodes, edges).map((s) => s.id);
    assert.deepEqual(ordered, ["svc-shop", "svc-zeta", "svc-alpha", "svc-beta", "svc-db", "svc-gone"]);
    assert.equal(services.find((s) => s.id === "svc-shop")!.counts.ui, 1);
  });
});
