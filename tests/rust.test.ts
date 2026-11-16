// Rust on the map (src/analyzer/extract/rust.ts, resolveRust in build.ts):
// modules and `use` paths as arrows, functions and impl methods, axum routers
// with their prefixes, actix-web/Rocket route attributes, sqlx SQL, reqwest
// calls; the axum-shop fixture end to end.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import type { CodeMap } from "../src/analyzer/types";
import { buildFixture, factsOf } from "./analyzer.helpers";

const mapOf = async (files: Record<string, string>): Promise<CodeMap> => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "t" })).map;
const imports = (m: CodeMap) => m.edges.filter((e) => e.kind === "imports").map((e) => `${e.from.slice(5)} -> ${e.to.slice(5)}${e.toFns?.length ? ` [${e.toFns.join(",")}]` : ""}`).sort();

describe("Rust facts", () => {
  it("reads every leaf of a use tree, aliases and `self` included, and `mod x;` as a module import", async () => {
    const f = await factsOf("src/main.rs", "mod gateway;\nmod tests { use super::*; }\nuse crate::db::{self, Db, User as U};\nuse axum::{extract::{Path, State}, routing::get};\nuse super::super::payments;\n");
    assert.deepEqual(
      f.imports.map((i) => `${i.spec} ${i.names.map((n) => `${n.local}=${n.imported}`).join(",")}`),
      ["self::gateway gateway=*", "crate::db db=db", "crate::db::Db Db=Db", "crate::db::User U=User", "axum::extract::Path Path=Path", "axum::extract::State State=State", "axum::routing::get get=get", "super::super::payments payments=payments"],
    );
  });

  it("lists functions and impl methods, and what a file makes public", async () => {
    const f = await factsOf("src/money.rs", "pub struct Money(i64);\nimpl Money {\n    pub fn new(v: i64) -> Self { Money(v) }\n    fn raw(&self) -> i64 { self.0 }\n}\npub fn parse(s: &str) -> Money { Money::new(s.parse().unwrap()) }\nenum Hidden {}\n");
    assert.deepEqual(f.fns.map((x) => `${x.name}:${x.start}-${x.end}${x.exported ? " pub" : ""}`), ["Money::new:3-3 pub", "Money::raw:4-4", "parse:6-6 pub"]);
    assert.deepEqual(f.exports.sort(), ["Money", "parse"]);
    assert.deepEqual(f.fns[2].calls, ["Money.new"]);
  });

  it("counts a call through a module path, not a method on a value that shares a module's name", async () => {
    const f = await factsOf("src/main.rs", "mod ledger;\nfn main() { let ledger = ledger::Ledger::new(); ledger.entries(); card::luhn(\"4242\"); }\n");
    assert.deepEqual(f.fns[0].calls.sort(), ["card.luhn", "ledger.Ledger.new"]);
  });

  it("reads axum routes, chained method routers, nest and merge, owned by the function that builds them", async () => {
    const f = await factsOf(
      "src/routes.rs",
      `pub fn router() -> Router {
    Router::new()
        .route("/users", get(list).post(create))
        .route("/users/{id}", routing::delete(handlers::remove))
        .nest("/admin", admin::router())
        .merge(health_routes())
}`,
    );
    assert.deepEqual(
      f.routes.map((r) => `${r.method} ${r.path} ${r.handler} @${r.owner}`),
      ["GET /users list @router", "POST /users create @router", "DELETE /users/{id} handlers.remove @router"],
    );
    assert.deepEqual(f.includes.map((i) => `${i.prefix || "(merge)"} ${i.target}`), ["/admin admin.router", "(merge) health_routes"]);
  });

  it("reads actix-web and Rocket route attributes on the handler", async () => {
    const f = await factsOf("src/api.rs", '#[get("/orders/{id}")]\nasync fn order(id: web::Path<i64>) -> String { String::new() }\n\n#[post("/orders")]\nasync fn place() {}\n\n#[route("/ping", method = "PUT")]\nasync fn ping() {}\n');
    assert.deepEqual(f.routes.map((r) => `${r.method} ${r.path} ${r.handler} ${r.line}-${r.endLine}`), ["GET /orders/{id} order 1-2", "POST /orders place 4-5", "PUT /ping ping 7-8"]);
  });

  it("finds reqwest calls, their URL through format! and a constant, env reads and SQL in strings", async () => {
    const f = await factsOf(
      "src/pay.rs",
      `const API: &str = "https://api.stripe.com/v1";
pub async fn charge(c: &reqwest::Client) {
    let key = std::env::var("STRIPE_SECRET_KEY").unwrap();
    c.post(format!("{}/charges", API)).send().await.unwrap();
    reqwest::get("https://example.com/health").await.unwrap();
    sqlx::query(r#"INSERT INTO charges (amount) VALUES ($1)"#);
    let _ = env!("BUILD_TAG");
}`,
    );
    assert.deepEqual(
      f.http.map((h) => `${h.method} ${h.url} ${h.fromVariable ? `base=${h.literalBase}` : "literal"}`),
      ["POST */charges base=https://api.stripe.com/v1", "GET https://example.com/health literal"],
    );
    assert.deepEqual(f.envReads.map((e) => e.name), ["STRIPE_SECRET_KEY", "BUILD_TAG"]);
    assert.deepEqual(f.sql.map((q) => `${q.op} ${q.table}`), ["write charges"]);
  });
});

describe("Rust modules on the map", () => {
  it("follows mod and use through main.rs, mod.rs folders, super and crate paths", async () => {
    const m = await mapOf({
      "Cargo.toml": '[package]\nname = "shop"\nversion = "0.1.0"\n',
      "src/main.rs": "mod billing;\nmod money;\nuse money::Money;\nfn main() { billing::run(Money::zero()); }\n",
      "src/money.rs": "pub struct Money;\nimpl Money { pub fn zero() -> Self { Money } }\n",
      "src/billing/mod.rs": "pub mod invoice;\npub fn run(_m: crate::money::Money) { invoice::send(); }\n",
      "src/billing/invoice.rs": "use super::super::money::Money;\nuse crate::money;\npub fn send() { let _ = money::Money::zero(); }\n",
    });
    assert.deepEqual(imports(m), [
      "src/billing/invoice.rs -> src/money.rs [Money]",
      "src/billing/mod.rs -> src/billing/invoice.rs [send]",
      "src/main.rs -> src/billing/mod.rs [run]",
      "src/main.rs -> src/money.rs [Money]",
    ]);
  });

  it("gives a crate's root its card even when nothing imports it, and leaves Rust out of 'not drawn'", async () => {
    const m = await mapOf({ "src/main.rs": "fn main() { println!(\"hi\"); }\n" });
    assert.ok(m.nodes.some((n) => n.id === "file:src/main.rs"));
    assert.equal(m.stats.otherCode?.Rust, undefined);
  });

  it("reaches another crate of the workspace by its name", async () => {
    const m = await mapOf({
      "Cargo.toml": '[workspace]\nmembers = ["core", "cli"]\n',
      "core/Cargo.toml": '[package]\nname = "pay-core"\n',
      "core/src/lib.rs": "pub mod ledger;\n",
      "core/src/ledger.rs": "pub fn post() {}\n",
      "cli/Cargo.toml": '[package]\nname = "pay-cli"\n',
      "cli/src/main.rs": "use pay_core::ledger;\nfn main() { ledger::post(); }\n",
    });
    assert.ok(imports(m).includes("cli/src/main.rs -> core/src/ledger.rs [post]"), imports(m).join("\n"));
  });
});

describe("an axum app end to end (fixtures/axum-shop)", () => {
  it("draws every route with the prefix it is mounted under, each calling the module that does the work", async () => {
    const { map } = await buildFixture("axum-shop");
    const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.name} -> ${n.handler}`).sort();
    assert.deepEqual(routes, ["DELETE /api/users/{id} -> delete_user", "GET /api/users -> list_users", "GET /api/users/{id} -> get_user", "GET /health -> health", "POST /api/orders -> create_order", "POST /api/users -> create_user"]);
    const calls = map.edges.filter((e) => e.kind === "calls").map((e) => `${e.from.split("#")[1]} -> ${e.to} [${e.toFns?.join(",")}]`).sort();
    assert.ok(calls.includes("GET /api/users -> file:src/db.rs [all_users]"), calls.join("\n"));
    assert.ok(calls.includes("POST /api/orders -> file:src/payments.rs [charge]"), calls.join("\n"));
  });

  it("links the queries to the migration's tables and the payment module to Stripe", async () => {
    const { map } = await buildFixture("axum-shop");
    const kinds = (k: string) => map.edges.filter((e) => e.kind === k).map((e) => `${e.from.replace(/#.*/, "")} -> ${e.to}`);
    assert.ok(kinds("reads").includes("file:src/db.rs -> table:users"));
    assert.ok(kinds("writes").includes("route:src/routes/orders.rs -> table:orders"));
    assert.ok(kinds("uses-service").includes("file:src/payments.rs -> svc:stripe"));
    assert.ok(imports(map).includes("src/main.rs -> src/routes/mod.rs [api]"));
  });
});
