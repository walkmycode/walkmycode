// Tables per database and the links between services (SERVICES.md §5 Tables,
// §9 task 7): one node per table per database, `db` and `usedBy` on it,
// `defines` matched within the same database, and the system links derived
// from node edges (requests, reads/writes into a named database, depends_on).
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { systemLinks } from "../src/analyzer/services";
import type { CodeMap, MapEdge, MapNode, ServiceDef } from "../src/analyzer/types";
import { buildFixture } from "./analyzer.helpers";

const build = async (files: Record<string, string>) => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "shop" })).map;

describe("compose-shop: one shared database", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildFixture("compose-shop")).map;
  });

  it("scopes each table by the database compose names, one node for both services", () => {
    const tables = map.nodes.filter((n) => n.kind === "table");
    assert.deepEqual(tables.map((n) => n.id).sort(), ["table:svc-postgres/shop/orders", "table:svc-postgres/shop/users"]);
    const users = tables.find((n) => n.name === "users")!;
    assert.equal(users.db, "svc-postgres/shop");
    assert.deepEqual([...(users.usedBy ?? [])].sort(), ["svc-orders", "svc-users"]);
    assert.equal(users.service, "svc-users", "the service whose migration creates it");
    assert.equal(users.area, "services/users");
    assert.equal(users.note, undefined);
  });

  it("orders' INSERT INTO users writes the same table, certain (same DATABASE_URL)", () => {
    const e = map.edges.find((x) => x.id === "writes:route:services/orders/app/main.py#POST /orders->table:svc-postgres/shop/users");
    assert.equal(e?.confidence, "certain");
    assert.ok(map.edges.some((x) => x.id === "defines:file:services/users/migrations/001.sql->table:svc-postgres/shop/users"));
  });

  it("derives the system links from node edges, declarations kept apart", () => {
    const ids = map.system.links.map((l) => l.id);
    for (const id of ["calls-route:svc-web->svc-users", "calls-route:svc-web->svc-orders", "calls-route:svc-orders->svc-users", "uses-service:svc-orders->svc-payments", "writes:svc-orders->svc-postgres", "reads:svc-users->svc-postgres", "depends-on:svc-users->svc-postgres"]) assert.ok(ids.includes(id), id);
    assert.ok(!map.system.links.some((l) => l.kind === "calls-route" && (l.to === "svc-postgres" || l.from === "svc-postgres")), "no requests to a database");
    const dep = map.system.links.find((l) => l.id === "depends-on:svc-users->svc-postgres")!;
    assert.deepEqual(dep.edgeIds, []);
    assert.equal(dep.note, "declared in docker-compose.yml, not seen in code");
    const web = map.system.links.find((l) => l.id === "calls-route:svc-web->svc-users")!;
    assert.equal(web.confidence, "certain");
    assert.equal(web.count, web.edgeIds.length);
    for (const l of map.system.links) for (const id of l.edgeIds) assert.ok(map.edges.some((e) => e.id === id), `${l.id}: ${id}`);
    assert.equal(map.stats.links, map.system.links.length);
  });
});

describe("tables in services with their own databases", () => {
  const compose = "services:\n  a:\n    build: ./a\n  b:\n    build: ./b\n";
  const route = (sql: string) => `from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/x")\ndef x(cur):\n    cur.execute("${sql}")\n`;

  it("the same table name in two unnamed databases is two nodes, each with a note, and no arrow between them", async () => {
    const map = await build({ "docker-compose.yml": compose, "a/requirements.txt": "fastapi\n", "a/main.py": route("SELECT * FROM users"), "b/requirements.txt": "fastapi\n", "b/main.py": route("SELECT * FROM users") });
    const users = map.nodes.filter((n) => n.kind === "table");
    assert.deepEqual(users.map((n) => n.id).sort(), ["table:own:svc-a/users", "table:own:svc-b/users"]);
    assert.equal(users.find((n) => n.db === "own:svc-a")?.note, "The b service also has a users table; I can't tell if it's the same database.");
    assert.ok(!map.edges.some((e) => e.from.startsWith("table:") || (e.from === "route:a/main.py#GET /x" && e.to === "table:own:svc-b/users")));
    assert.ok(!map.system.links.some((l) => l.kind === "reads"), "a service's own database is not a link");
  });

  it("a table only one service's database has keeps the plain id", async () => {
    const map = await build({ "docker-compose.yml": compose, "a/requirements.txt": "fastapi\n", "a/main.py": route("SELECT * FROM users"), "b/requirements.txt": "fastapi\n", "b/main.py": route("SELECT * FROM orders") });
    assert.deepEqual(map.nodes.filter((n) => n.kind === "table").map((n) => [n.id, n.db]).sort(), [
      ["table:orders", "own:svc-b"],
      ["table:users", "own:svc-a"],
    ]);
  });

  it("a schema in a library two services import defines the table in each one's database", async () => {
    const withDbs = "services:\n  a:\n    build: ./a\n    environment:\n      DATABASE_URL: postgres://pg1:5432/app\n  b:\n    build: ./b\n    environment:\n      DATABASE_URL: postgres://pg2:5432/app\n  pg1:\n    image: postgres:16\n  pg2:\n    image: postgres:16\n";
    const app = 'const express = require("express");\nconst { db } = require("../shared/db");\nconst app = express();\napp.get("/x", (req, res) => res.json(db));\napp.listen(3000);\n';
    const map = await build({
      "docker-compose.yml": withDbs,
      "a/package.json": '{"name":"a","scripts":{"start":"node index.js"},"dependencies":{"express":"4"}}',
      "a/index.js": app,
      "b/package.json": '{"name":"b","scripts":{"start":"node index.js"},"dependencies":{"express":"4"}}',
      "b/index.js": app,
      "shared/package.json": '{"name":"shared"}',
      "shared/db.js": "export const db = {};\n",
      "shared/schema.sql": "CREATE TABLE accounts (id INTEGER);\n",
    });
    const ids = map.edges.filter((e) => e.kind === "defines").map((e) => e.to).sort();
    assert.deepEqual(ids, ["table:svc-pg1/app/accounts", "table:svc-pg2/app/accounts"]);
  });
});

describe("the monolith keeps v1 tables", () => {
  it("no db or usedBy on a one-app map", async () => {
    const { map } = await buildFixture("monolith");
    for (const n of map.nodes.filter((x) => x.kind === "table")) {
      assert.equal(n.db, undefined);
      assert.equal(n.usedBy, undefined);
    }
  });
});

describe("systemLinks()", () => {
  const def = (id: string, kind: ServiceDef["kind"] = "app"): ServiceDef => ({ id, name: id.slice(4), kind, areas: [], hostnames: [], devHosts: [], ports: [], env: {}, dependsOn: [], evidence: [], confidence: "certain", counts: { ui: 0, api: 0, logic: 0, data: 0 } });
  const node = (id: string, service?: string): MapNode => ({ id, service, layer: "api", kind: "route", name: id, area: "" });
  const edge = (from: string, to: string, kind: MapEdge["kind"], confidence: MapEdge["confidence"] = "certain"): MapEdge => ({ id: `${kind}:${from}->${to}`, from, to, kind, confidence, evidence: [{ file: "x", line: 1, text: "" }] });

  it("joins one producer to one consumer through a channel, as a guess", () => {
    const services = [def("svc-a"), def("svc-b"), def("svc-c")];
    const nodes = [node("a", "svc-a"), node("b", "svc-b"), node("c", "svc-c"), { id: "chan:kafka/t", layer: "external", kind: "channel", name: "t", area: "" } as MapNode, { id: "chan:kafka/u", layer: "external", kind: "channel", name: "u", area: "" } as MapNode];
    const edges = [edge("a", "chan:kafka/t", "publishes"), edge("b", "chan:kafka/t", "consumes"), edge("a", "chan:kafka/u", "publishes"), edge("b", "chan:kafka/u", "consumes"), edge("c", "chan:kafka/u", "consumes"), edge("a", "b", "calls-route", "likely"), edge("a", "c", "calls-route", "likely")];
    const links = systemLinks(services, nodes, edges);
    const pub = links.find((l) => l.via === "chan:kafka/t")!;
    assert.equal(pub.id, "publishes:svc-a->svc-b@chan:kafka/t");
    assert.equal(pub.confidence, "likely");
    assert.equal(pub.count, 2);
    assert.ok(!links.some((l) => l.via === "chan:kafka/u"), "two consumers: the channel stays a box");
    const call = links.find((l) => l.id === "calls-route:svc-a->svc-b")!;
    assert.equal(call.confidence, "likely");
    assert.match(call.note ?? "", /guess/);
  });
});

describe("a table's columns, from the code that creates it", () => {
  it("CREATE TABLE in a .sql file: each column with its type, keys and constraints left out", async () => {
    const sql = ["-- the todos", "CREATE TABLE IF NOT EXISTS todos (", "  id SERIAL PRIMARY KEY,", '  "title" VARCHAR(255) NOT NULL,', "  price NUMERIC(10, 2),", "  at TIMESTAMP WITH TIME ZONE DEFAULT now(),", "  PRIMARY KEY (id),", "  CONSTRAINT t_unique UNIQUE (title)", ");"].join("\n");
    const map = await build({ "db/schema.sql": sql });
    const t = map.nodes.find((n) => n.id === "table:todos");
    assert.deepEqual(t?.columns, [
      { name: "id", type: "SERIAL" },
      { name: "title", type: "VARCHAR(255)" },
      { name: "price", type: "NUMERIC(10, 2)" },
      { name: "at", type: "TIMESTAMP WITH TIME ZONE" },
    ]);
    assert.deepEqual(t?.columnsAt, { file: "db/schema.sql", line: 2 });
  });

  it("CREATE TABLE in a migration of one service, on the table scoped by its database", async () => {
    const map = (await buildFixture("compose-shop")).map;
    assert.deepEqual(map.nodes.find((n) => n.id === "table:svc-postgres/shop/users")?.columns, [
      { name: "id", type: "SERIAL" },
      { name: "name", type: "TEXT" },
    ]);
  });

  it("a Prisma model: its fields, but not its relations to other models", async () => {
    const map = (await buildFixture("monolith")).map;
    assert.deepEqual(map.nodes.find((n) => n.id === "table:session")?.columns, [
      { name: "id", type: "String" },
      { name: "token", type: "String" },
      { name: "userId", type: "String" },
    ]);
    assert.deepEqual(map.nodes.find((n) => n.id === "table:user")?.columnsAt, { file: "prisma/schema.prisma", line: 10 });
  });

  it("a SQLAlchemy class: Column() and mapped_column(), named or typed by the hint", async () => {
    const py = [
      "from sqlalchemy import Column, Integer, String, ForeignKey",
      "class Todo(Base):",
      '    __tablename__ = "todos"',
      "    id = Column(Integer, primary_key=True)",
      '    title = Column("name", String(50))',
      '    owner_id = Column(ForeignKey("users.id"))',
      "    done: Mapped[bool] = mapped_column(default=False)",
      '    owner = relationship("User")',
    ].join("\n");
    const map = await build({ "app/models.py": py });
    assert.deepEqual(map.nodes.find((n) => n.id === "table:todos")?.columns, [{ name: "id", type: "Integer" }, { name: "name", type: "String(50)" }, { name: "owner_id" }, { name: "done", type: "bool" }]);
  });
});
