// Extractor fixes with no new inputs (SERVICES.md §9 task 2): template
// literals that start with an env read, module constants, every env read,
// SQL inside named Express handlers, and the file node for facts that sit
// outside every route. Nothing here resolves a service yet: a URL that starts
// with a variable still goes through the global search as a guess.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { buildFixture, factsOf } from "./analyzer.helpers";

describe("urlText: template literals", () => {
  it("env template literal is fromVariable + varName", async () => {
    const f = await factsOf("api.ts", 'export async function getUser(id: string) {\n  return fetch(`${process.env.USERS_URL}/users/${id}`);\n}\n');
    assert.equal(f.http.length, 1);
    const h = f.http[0];
    assert.equal(h.url, "*/users/*");
    assert.equal(h.fromVariable, true);
    assert.equal(h.varName, "USERS_URL");
    assert.equal(h.literalBase, undefined);
    assert.equal(h.method, "GET");
  });

  it("a substitution that is not first does not make the URL a guess", async () => {
    const f = await factsOf("page.tsx", "async function show(id: number) {\n  await fetch(`/api/users/${id}`);\n}\n");
    assert.equal(f.http[0].url, "/api/users/*");
    assert.equal(f.http[0].fromVariable, false);
    assert.equal(f.http[0].varName, undefined);
  });

  it("a module constant bound to an env read (with a literal default) is followed one hop", async () => {
    const src = 'const BASE = process.env.ORDERS_URL ?? "http://orders:8000";\nconst USERS = "http://users:8080";\nexport async function go() {\n  await fetch(`${BASE}/orders`, { method: "POST" });\n  await fetch(`${USERS}/users`);\n}\n';
    const f = await factsOf("api.ts", src);
    assert.deepEqual(f.consts.BASE, { envVar: "ORDERS_URL", literal: "http://orders:8000", line: 1 });
    assert.deepEqual(f.consts.USERS, { envVar: undefined, literal: "http://users:8080", line: 2 });
    assert.equal(f.http[0].url, "*/orders");
    assert.equal(f.http[0].method, "POST");
    assert.equal(f.http[0].varName, "ORDERS_URL");
    assert.equal(f.http[0].literalBase, "http://orders:8000");
    assert.equal(f.http[1].varName, undefined);
    assert.equal(f.http[1].literalBase, "http://users:8080");
  });

  it("import.meta.env, env.X and destructured process.env all name the variable", async () => {
    const f = await factsOf("a.ts", 'const { API_URL } = process.env;\nexport const a = () => fetch(`${import.meta.env.VITE_API}/a`);\nexport const b = () => fetch(`${API_URL}/b`);\nexport const c = (env: any) => fetch(`${env.USERS_URL}/c`);\n');
    assert.deepEqual(
      f.http.map((h) => h.varName),
      ["VITE_API", "API_URL", "USERS_URL"],
    );
  });
});

describe("urlText: binary concat", () => {
  it("binary concat unchanged", async () => {
    const f = await factsOf("a.ts", 'export function get(id: string) {\n  return fetch("/api/items/" + id);\n}\n');
    assert.equal(f.http[0].url, "/api/items/*");
    assert.equal(f.http[0].fromVariable, false);
    assert.equal(f.http[0].varName, undefined);
  });

  it("a leading constant or env read in a concat names the variable", async () => {
    const f = await factsOf("a.js", 'const BASE = process.env.ORDERS_URL;\nfunction go() {\n  return fetch(BASE + "/orders");\n}\nfunction go2() {\n  return fetch(process.env.USERS_URL + "/users");\n}\n');
    assert.equal(f.http[0].url, "*/orders");
    assert.equal(f.http[0].fromVariable, true);
    assert.equal(f.http[0].varName, "ORDERS_URL");
    assert.equal(f.http[1].varName, "USERS_URL");
  });
});

describe("python: varName and consts", () => {
  it("an f-string that starts with os.environ[...] names the variable", async () => {
    const f = await factsOf("main.py", "import os\nimport requests\n\ndef get(uid):\n    return requests.get(f\"{os.environ['USERS_URL']}/users/{uid}\")\n");
    assert.equal(f.http[0].url, "*/users/*");
    assert.equal(f.http[0].fromVariable, true);
    assert.equal(f.http[0].varName, "USERS_URL");
  });

  it("os.getenv(...) + '/path' names the variable", async () => {
    const f = await factsOf("billing.py", 'import os\nimport requests\n\ndef charge():\n    return requests.post(os.getenv("PAYMENTS_URL") + "/charge")\n');
    assert.equal(f.http[0].url, "*/charge");
    assert.equal(f.http[0].varName, "PAYMENTS_URL");
    assert.equal(f.http[0].method, "POST");
  });

  it("a module constant with a default is followed one hop", async () => {
    const f = await factsOf("client.py", 'import os\nimport requests\n\nBASE = os.getenv("USERS_URL", "http://users:8080")\nNAME = "orders"\n\ndef users():\n    return requests.get(f"{BASE}/users")\n');
    assert.deepEqual(f.consts.BASE, { envVar: "USERS_URL", literal: "http://users:8080", line: 4 });
    assert.equal(f.consts.NAME, undefined, "plain names are not base URLs");
    assert.equal(f.http[0].varName, "USERS_URL");
    assert.equal(f.http[0].literalBase, "http://users:8080");
  });
});

describe("envReads", () => {
  it("records every env read in JS, not only the third-party hints", async () => {
    const f = await factsOf("a.ts", 'const { A, B: bee } = process.env;\nconst k = process.env.STRIPE_SECRET_KEY;\nconst d = Deno.env.get("DENO_X");\nconst s = process.env["SUB"];\n');
    assert.deepEqual(
      f.envReads.map((e) => e.name).sort(),
      ["A", "B", "DENO_X", "STRIPE_SECRET_KEY", "SUB"],
    );
    assert.deepEqual(
      f.services.map((s) => s.service),
      ["Stripe"],
    );
  });

  it("records every env read in Python", async () => {
    const f = await factsOf("a.py", 'import os\nfrom os import getenv\nu = os.environ["DATABASE_URL"]\nk = os.getenv("OPENAI_API_KEY")\ng = os.environ.get("G", "x")\nh = getenv("H")\n');
    assert.deepEqual(
      f.envReads.map((e) => e.name).sort(),
      ["DATABASE_URL", "G", "H", "OPENAI_API_KEY"],
    );
    assert.deepEqual(
      f.services.map((s) => s.service),
      ["OpenAI"],
    );
  });
});

describe("containers", () => {
  it("named handler keeps its SQL", async () => {
    const { map } = await buildFixture("compose-shop");
    const byId = new Map(map.edges.map((e) => [e.id, e]));
    const read = byId.get("reads:route:services/users/src/index.js#GET /users/:id->table:svc-postgres/shop/users");
    assert.ok(read, "GET /users/:id reads users");
    assert.equal(read.confidence, "certain");
    assert.deepEqual(read.fromFns, ["getUser"]);
    assert.ok(byId.get("reads:route:services/users/src/index.js#GET /users->table:svc-postgres/shop/users"), "GET /users reads users");
    assert.ok(byId.get("writes:route:services/users/src/index.js#POST /users->table:svc-postgres/shop/users"), "POST /users writes users");
    // The route nodes still point at the registration line, as in v1.
    const route = map.nodes.find((n) => n.id === "route:services/users/src/index.js#GET /users/:id");
    assert.equal(route?.line, 9);
    assert.equal(route?.endLine, 9);
    // Nothing in that file sits outside a route, so it still has no module node.
    assert.ok(!map.nodes.some((n) => n.id === "file:services/users/src/index.js"));
  });

  it("adds the file node when a request or SQL fact sits outside every route", async () => {
    const src = 'const express = require("express");\nconst app = express();\napp.get("/ping", (req, res) => res.send("pong"));\nasync function warm() {\n  await fetch("http://localhost:3000/ping");\n}\napp.listen(3000);\n';
    const { map } = await buildMap([{ path: "src/index.js", content: src }], { name: "tiny" });
    assert.ok(map.nodes.some((n) => n.id === "file:src/index.js"), "file node added");
    const e = map.edges.find((x) => x.id === "calls-route:file:src/index.js->route:src/index.js#GET /ping");
    assert.ok(e, "the request outside the route has a home");
    assert.equal(e.evidence[0].line, 5);
    assert.ok(!map.warnings.some((w) => w.includes("matched no route")));
  });

  it("without a value for the setting the env-var call is still a guess with today's note", async () => {
    const { map } = await buildMap(
      [
        { path: "package.json", content: '{"name":"shop","dependencies":{"next":"16.0.0","react":"19.0.0"}}' },
        { path: "lib/api.ts", content: "export async function item(id: string) {\n  return fetch(`${process.env.API_URL}/api/items/${id}`);\n}\n" },
        { path: "app/api/items/[id]/route.ts", content: "export async function GET() {\n  return Response.json({});\n}\n" },
      ],
      { name: "shop" },
    );
    const e = map.edges.find((x) => x.id === "calls-route:file:lib/api.ts->route:app/api/items/[id]/route.ts#GET /api/items/[id]");
    assert.ok(e);
    assert.equal(e.confidence, "likely");
    assert.equal(e.note, "The URL starts with a variable, so this is matched by the path only.");
  });
});
