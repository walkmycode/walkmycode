// What the AI is told about the map (SERVICES.md §8, §9 task 13): one app reads
// exactly as before, a monorepo adds a Packages line, a system of services gets
// the service picture, and query_map / list_files / describeEdge speak about
// services with the config lines that prove them. No API key is needed: these
// check the text the model would be given, and that every citation in it is real.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import type { CodeMap, SourceFile } from "../src/analyzer/types";
import { mapSummary, SYSTEM } from "../src/lib/claude/prompts";
import { runTool } from "../src/lib/claude/tools";
import { combineRepos } from "../src/lib/workspace";
import { buildFixture, readFixture } from "./analyzer.helpers";

const f = (path: string, content: string): SourceFile => ({ path, content });

/** The summary as it was before services (prompts.ts at 7557ae7), kept here to prove the one-app branch is unchanged. */
function v1Summary(map: CodeMap): string {
  const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.name} (${n.file})`);
  const tables = map.nodes.filter((n) => n.kind === "table").map((n) => n.name);
  const services = map.nodes.filter((n) => n.kind === "service" && !n.internal).map((n) => n.name);
  const unseen = map.nodes.filter((n) => n.kind === "service" && n.internal).map((n) => n.name);
  const ui = map.nodes.filter((n) => n.layer === "ui").map((n) => n.name);
  const logic = map.nodes.filter((n) => n.layer === "logic").map((n) => n.name);
  const cap = (xs: string[], n: number) => (xs.length > n ? [...xs.slice(0, n), `…${xs.length - n} more`] : xs);
  return [
    `# Repo: ${map.name}`,
    `Areas (packages): ${map.areas.join(", ")}`,
    `${map.stats.files} files, ${map.stats.parsed} in the map, ${map.stats.routes} routes, ${map.stats.tables} tables, ${map.stats.edges} links (${map.stats.likely} guesses).`,
    `## Pages & components (ui): ${cap(ui, 80).join(", ")}`,
    `## Routes (api): ${cap(routes, 150).join("; ")}`,
    `## Logic modules: ${cap(logic, 80).join(", ")}`,
    `## Tables: ${cap(tables, 80).join(", ")}`,
    `## Outside services: ${services.join(", ")}`,
    ...(unseen.length ? [`## Not in this workspace (this system's own services, code not here): ${unseen.join(", ")}`] : []),
    `Node ids look like file:<path>, route:<file>#<METHOD> <path>, table:<name>, svc:<slug>.`,
  ].join("\n");
}

/** Every `path:line` in a text names a file in the workspace and a line it has. */
function assertCitationsReal(text: string, files: Record<string, string>) {
  const cites = [...text.matchAll(/((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|py|sql|yml|yaml|json|conf|proto)|(?:[\w.-]+\/)*Dockerfile):(\d+)/g)];
  assert.ok(cites.length > 0, "cites something");
  for (const [, file, line] of cites) {
    assert.ok(files[file] !== undefined, `${file} is in the workspace`);
    assert.ok(Number(line) >= 1 && Number(line) <= files[file].split("\n").length, `${file}:${line} is a real line`);
  }
}

const filesOf = async (name: string) => Object.fromEntries((await readFixture(name)).map((s) => [s.path, s.content]));

describe("SYSTEM", () => {
  it("asks the guide to say which service it is in and to cross boundaries out loud", () => {
    assert.match(SYSTEM, /When the workspace has several services, say which service you are in and cross the boundary explicitly/);
    assert.match(SYSTEM, /the web app sends this to the users service/);
  });
});

describe("mapSummary for one app (the monolith fixture)", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildFixture("monolith")).map;
  });

  it("is exactly the summary it always was", () => {
    assert.equal(map.system.kind, "monolith");
    assert.equal(mapSummary(map), v1Summary(map));
  });

  it("starts with # Repo: and never mentions services that do not exist", () => {
    const s = mapSummary(map);
    assert.match(s, /^# Repo: monolith\n/);
    assert.doesNotMatch(s, /## Services|# Workspace|svc-monolith|Packages:/);
  });

  it("query_map gives no service block for the one app, only map nodes", async () => {
    const files = await filesOf("monolith");
    const out = runTool({ map, files }, "query_map", { query: "monolith" });
    assert.doesNotMatch(out, /service \[svc-monolith\]/);
    assert.doesNotMatch(runTool({ map, files }, "query_map", { query: "system" }), /# The system/);
  });

  it("describeEdge keeps the words it had, adds the config line behind an edge, and fixes 'is reads table by'", async () => {
    const files = await filesOf("monolith");
    const out = runTool({ map, files }, "query_map", { query: "table:user" });
    assert.match(out, /is read by /);
    assert.doesNotMatch(out, /is reads table by/);
    const api = runTool({ map, files }, "query_map", { query: "file:lib/api.ts" });
    assert.match(api, /sends a request to GET \/api\/users\/\[id\]/);
    assert.match(api, /resolved through \.env\.example:\d+/);
    assert.doesNotMatch(api, /service\)/, "no '(x service)' suffix in a monolith");
  });
});

describe("mapSummary for a monorepo", () => {
  it("is the one-app summary plus one Packages line", async () => {
    const sources = [
      f("apps/web/package.json", '{"name":"web","dependencies":{"next":"16.0.0","react":"19.0.0"}}'),
      f("apps/web/app/page.tsx", 'import { Button } from "../../../packages/ui/button";\nexport default function Page() {\n  return <Button />;\n}\n'),
      f("packages/ui/package.json", '{"name":"ui","dependencies":{"react":"19.0.0"}}'),
      f("packages/ui/button.tsx", "export function Button() {\n  return <button>Go</button>;\n}\n"),
    ];
    const map = (await buildMap(sources, { name: "shop" })).map;
    assert.equal(map.system.kind, "monorepo");
    const lines = mapSummary(map).split("\n");
    assert.equal(lines[0], "# Repo: shop");
    assert.equal(lines[2], "Packages: apps/web (the app), packages/ui (library)");
    assert.equal([...lines.slice(0, 2), ...lines.slice(3)].join("\n"), v1Summary(map));
  });
});

describe("mapSummary for a system of services (compose-shop)", () => {
  let map: CodeMap;
  let files: Record<string, string>;
  let s: string;
  before(async () => {
    map = (await buildFixture("compose-shop")).map;
    files = await filesOf("compose-shop");
    s = mapSummary(map);
  });

  it("opens with the workspace, its services and the file that proves them", () => {
    assert.match(s, /^# Workspace: compose-shop — 3 services \(docker-compose\.yml\), \d+ links \(\d+ guess(es)?\)\n/);
    assert.match(s, /\nLevel 1 = services, level 2 = one service's lanes\./);
  });

  it("lists the three app services in flow order, then the infrastructure, then the one it can't see", () => {
    const i = (re: RegExp) => s.search(re);
    assert.ok(i(/\n## Services \(in flow order\)\n/) > 0);
    const web = i(/\n- web \[svc-web\] — Next\.js app in web\//);
    const orders = i(/\n- orders \[svc-orders\] — FastAPI app in services\/orders\//);
    const users = i(/\n- users \[svc-users\] — Express app in services\/users\//);
    assert.ok(web > 0 && orders > web && users > orders, "web, orders, users as map.services orders them");
    assert.deepEqual(
      map.services.filter((x) => x.kind === "app").map((x) => x.id),
      ["svc-web", "svc-orders", "svc-users"],
    );
    assert.match(s, /- postgres \[svc-postgres\] — database \(docker-compose\.yml:\d+, image postgres:16\), shared by orders and users\./);
    assert.match(s, /kafka \[svc-kafka\] — message broker .*carries kafka topic orders\.created/);
    assert.match(s, /- Not in this workspace \(1 service I can't see the code for\): payments \[svc-int:svc-payments\] \(called at payments:9000 from services\/orders\/app\/billing\.py:\d+, address from docker-compose\.yml:\d+\)/);
  });

  it("says how each service is reached, started and what it talks to", () => {
    const users = s.split("\n").find((l) => l.startsWith("- users [svc-users]"))!;
    assert.match(users, /hosts users, users:8080/);
    assert.match(users, /dev localhost:8000/);
    assert.match(users, /env USERS_URL \(docker-compose\.yml:8\)/);
    assert.match(users, /start: node src\/index\.js — services\/users\/Dockerfile:\d+/);
    assert.match(users, /4 routes, 1 table in postgres\/shop\./);
    assert.match(users, /Called by: .*orders/);
    assert.match(users, /Consumes kafka topic orders\.created\./);
    const web = s.split("\n").find((l) => l.startsWith("- web [svc-web]"))!;
    assert.match(web, /Calls: users ×\d+ \(via web\/next\.config\.js:4/);
    const orders = s.split("\n").find((l) => l.startsWith("- orders [svc-orders]"))!;
    assert.match(orders, /Publishes kafka topic orders\.created\./);
    assert.match(orders, /payments ×1/);
  });

  it("lists the gateway rule with its config line", () => {
    assert.match(s, /\n## Gateways: \/api\/\*\* → users \(web\/next\.config\.js:4\)\n/);
  });

  it("cites both the code line and the docker-compose.yml line for a link between services", () => {
    const at = s.indexOf("\n## Links between services (evidence)\n");
    assert.ok(at > 0);
    const links = s.slice(at, s.indexOf("\n## Inside each service"));
    const row = links.split("\n").find((l) => l.includes("web/src/lib/api.ts:") && l.includes("docker-compose.yml:"));
    assert.ok(row, "a link row with the code line and the config line");
    assert.match(row, /lib\/api \[file:web\/src\/lib\/api\.ts\] sends a request to GET \/users\/:id .*\(users service\).* — web\/src\/lib\/api\.ts:11, resolved through docker-compose\.yml:8/);
    assert.match(links, /orders → users via kafka topic orders\.created \[chan:kafka\/orders\.created\]: publishes ×2 \[GUESS: /);
    assert.match(links, /- users → postgres: depends-on \(declared in docker-compose\.yml, not seen in code; start-up order, not a call\)/);
    assert.match(links, /via web\/next\.config\.js:4 \(rewrite\)/);
  });

  it("keeps each service's lanes, and the node id forms of a system", () => {
    assert.match(s, /\n### users \[svc-users\]\nRoutes \(api\): GET \/users\/:id \(services\/users\/src\/index\.js\)/);
    assert.match(s, /Tables: users \(shared by orders, users\)/);
    assert.match(s, /table:<db>\/<name>/);
    assert.match(s, /svc-int:<service>/);
    assert.doesNotMatch(s, /# Repo:/);
  });

  it("cites only files and lines that exist", () => {
    assertCitationsReal(s, files);
  });

  it("never prints a password from the config", () => {
    assert.doesNotMatch(s, /app:pw@/);
  });
});

// §10 expected "1 service I can't see the code for" here. The resolver (task 5,
// tests/crossservice.test.ts) binds users:8080 to the users folder as a guess;
// PAYMENTS_URL has no value and no route answers billing.py's request, so that
// request goes to a stand-in for wherever PAYMENTS_URL points (§13), and the
// summary says so. The summary says what the map says: guesses, with why.
describe("mapSummary without docker-compose.yml (the removal test)", () => {
  it("still lists three services, and every request between them is a guess that says why", async () => {
    const sources = (await readFixture("compose-shop")).filter((x) => x.path !== "docker-compose.yml");
    const map = (await buildMap(sources, { name: "compose-shop" })).map;
    const s = mapSummary(map);
    assert.match(s, /^# Workspace: compose-shop — 3 services/);
    assert.doesNotMatch(s, /docker-compose\.yml/);
    assert.match(s, /\[GUESS: I took users to be the users service by its folder name\.\]/);
    assert.match(s, /\[GUESS: Matched by the setting's name USERS_URL \(I found no value for it in your config\)/);
    assert.match(s, /in orders' own database \(no address for it in the config\)/);
    assert.equal(/I can't see the code for/.test(s), map.services.some((x) => x.kind === "placeholder"), "the 'can't see' line appears exactly when the map has a placeholder");
    assert.match(s, /Not in this workspace \(1 service I can't see the code for\): PAYMENTS_URL \[svc-int:svc-payments-url\] \(wherever PAYMENTS_URL points: nothing in the repo gives it a value; called from services\/orders\/app\/billing\.py:\d+\)/);
    assertCitationsReal(s, Object.fromEntries(sources.map((x) => [x.path, x.content])));
  });
});

describe("tools on compose-shop", () => {
  let map: CodeMap;
  let files: Record<string, string>;
  const q = (query: string) => runTool({ map, files }, "query_map", { query });
  before(async () => {
    map = (await buildFixture("compose-shop")).map;
    files = await filesOf("compose-shop");
  });

  it("query_map finds a service by name, 'the … service' or id, with its addresses, settings, start and links", () => {
    const out = q("users service");
    assert.equal(q("svc-users"), out);
    assert.equal(q("the users service"), out);
    assert.match(out, /^## users service \[svc-users\] — Express app, in services\/users\//);
    assert.match(out, /why it is a service: docker-compose\.yml:10 `users:`/);
    assert.match(out, /addresses other services use: users, users:8080/);
    assert.match(out, /published on your machine: localhost:8000/);
    assert.match(out, /start here: services\/users\/Dockerfile:\d+ `node src\/index\.js`/);
    assert.match(out, /DATABASE_URL=postgres:\/\/app:•••@postgres:5432\/shop \(docker-compose\.yml:15\)/);
    assert.match(out, /other services find it through: USERS_URL in web \(docker-compose\.yml:8\); USERS_URL in orders \(docker-compose\.yml:24\)/);
    assert.match(out, /started after \(declared in the config, not a call\): postgres, kafka/);
    assert.match(out, /doors \(4\): GET \/users\/:id \[route:services\/users\/src\/index\.js#GET \/users\/:id\]/);
    assert.match(out, /## Links of the users service/);
    assert.match(out, /lib\/api \[file:web\/src\/lib\/api\.ts\] sends a request to GET \/users\/:id .* — web\/src\/lib\/api\.ts:11, resolved through docker-compose\.yml:8/);
    assert.match(out, /POST \/orders \[route:services\/orders\/app\/main\.py#POST \/orders\] sends a request to GET \/users .* — services\/orders\/app\/main\.py:17, resolved through docker-compose\.yml:10/);
    assertCitationsReal(out, files);
  });

  it("query_map finds a service whose own name ends in -service or -app", async () => {
    const m = (
      await buildMap(
        [
          f("docker-compose.yml", "services:\n  user-service:\n    build: ./user-service\n  web-app:\n    build: ./web-app\n    environment:\n      USERS_URL: http://user-service:8080\n"),
          f("user-service/package.json", '{"name":"user-service","dependencies":{"express":"4"}}'),
          f("user-service/index.js", 'const app = require("express")();\napp.get("/users", (req, res) => res.json([]));\n'),
          f("web-app/package.json", '{"name":"web-app","dependencies":{"express":"4"}}'),
          f("web-app/index.js", "fetch(`${process.env.USERS_URL}/users`);\n"),
        ],
        { name: "t" },
      )
    ).map;
    assert.equal(m.system.kind, "services");
    const run = (query: string) => runTool({ map: m, files: {} }, "query_map", { query });
    for (const query of ["user-service", "svc-user-service", "the user-service service"]) assert.match(run(query), /^## user-service service \[svc-user-service\]/, query);
    assert.match(run("web-app"), /^## web-app service \[svc-web-app\]/);
  });

  it("query_map 'system' returns every link between services, with evidence", () => {
    const out = q("system");
    assert.match(out, /^# The system: 3 app services, 12 links between services/);
    for (const l of map.system.links) assert.ok(out.includes(`${map.services.find((s) => s.id === l.from)!.name} → ${map.services.find((s) => s.id === l.to)!.name}`), l.id);
    assert.match(out, /billing \[file:services\/orders\/app\/billing\.py\] uses payments \[svc-int:svc-payments\] \(payments service, code not in this workspace\) — services\/orders\/app\/billing\.py:\d+, resolved through docker-compose\.yml:27/);
    assertCitationsReal(out, files);
  });

  it("query_map on a database lists its tables and who uses them", () => {
    const out = q("postgres");
    assert.match(out, /^## postgres service \[svc-postgres\] — database/);
    assert.match(out, /tables \(2\): orders \[table:svc-postgres\/shop\/orders\] in postgres\/shop; users \[table:svc-postgres\/shop\/users\] in postgres\/shop/);
    assert.match(out, /used by: orders, users/);
  });

  it("describeEdge says which service the far end is in, and which rewrite a request went through", () => {
    const out = q("route:services/users/src/index.js#GET /users/:id");
    assert.match(out, /, in the users service$/m);
    assert.match(out, /is requested from lib\/api \[file:web\/src\/lib\/api\.ts\] \(web service\) → getUser — web\/src\/lib\/api\.ts:11, resolved through docker-compose\.yml:8/);
    assert.match(out, /is requested from page \[file:web\/app\/page\.tsx\] \(web service\) → getUser — web\/app\/page\.tsx:10 \(triggered by <button> "Show me" at web\/app\/page\.tsx:\d+\), via web\/next\.config\.js:4 \(rewrite\)/);
    assert.match(out, /is requested from POST \/orders .* \(orders service\)/);
    assertCitationsReal(out, files);
  });

  it("describeEdge has words for messages and for a service whose code is not here", () => {
    const chan = q("chan:kafka/orders.created");
    assert.match(chan, /gets messages from POST \/orders .* \(orders service\) — services\/orders\/app\/main\.py:\d+/);
    assert.match(chan, /has its messages picked up by consumer \[file:services\/users\/src\/consumer\.js\] \(users service\)/);
    const orders = q("route:services/orders/app/main.py#POST /orders");
    assert.match(orders, /puts messages on orders\.created \[chan:kafka\/orders\.created\] \(kafka topic on kafka\)/);
    const pay = q("svc-int:svc-payments");
    assert.match(pay, /in the payments service \(its code isn't in this workspace\)/);
    assert.doesNotMatch(pay + orders + chan, /another company/);
  });

  it("list_files marks config files", () => {
    const out = runTool({ map, files }, "list_files", {});
    assert.match(out, /^\/\n/);
    assert.match(out, /docker-compose\.yml {2}\(config: compose\)/);
    assert.match(runTool({ map, files }, "list_files", { path: "services/users" }), /Dockerfile {2}\(config: dockerfile\)/);
  });

  it("list_files also lists files read_file opens that aren't on the map (a manifest)", () => {
    const withManifest = { ...files, "package.json": '{ "name": "x" }' };
    assert.equal(map.files.some((f) => f.path === "package.json"), false);
    assert.match(runTool({ map, files: withManifest }, "list_files", {}), /package\.json {2}\(not on the map; read_file opens it\)/);
    assert.match(runTool({ map, files: withManifest }, "read_file", { path: "package.json" }), /"name": "x"/);
  });
});

describe("tools and summary with two repos", () => {
  let map: CodeMap;
  let files: Record<string, string>;
  before(async () => {
    const all = await readFixture("compose-shop");
    const web = all.filter((s) => s.path.startsWith("web/")).map((s) => f(s.path.slice("web/".length), s.content));
    const compose = all
      .find((s) => s.path === "docker-compose.yml")!
      .content.replace("build: ./web", "build: ../web")
      .replace(/build: \.\/services\//g, "build: ./");
    const services = [...all.filter((s) => s.path.startsWith("services/")).map((s) => f(s.path.slice("services/".length), s.content)), f("docker-compose.yml", compose)];
    const { sources, repos } = combineRepos([
      { label: "web", files: web },
      { label: "services", files: services },
    ]);
    files = Object.fromEntries(sources.map((s) => [s.path, s.content]));
    map = (await buildMap(sources, { name: "shop", repos })).map;
  });

  it("the summary names both repos and says paths start with the repo label", () => {
    const s = mapSummary(map);
    assert.match(s, /^# Workspace: shop \(2 repos: web, services\) — 3 services \(services\/docker-compose\.yml\)/);
    assert.match(s, /\(repo services\)/);
    assert.match(s, /Paths start with the repo label when several repos are open\./);
    assertCitationsReal(s, files);
  });

  it("list_files lists the repos at the root", () => {
    const out = runTool({ map, files }, "list_files", { path: "/" });
    assert.match(out, /^\/ — 2 repos in this workspace: web, services; every path starts with its repo's name\n/);
    assert.match(out, /\nservices\/ {2}\(repo services, \d+ files\)/);
    assert.match(out, /\nweb\/ {2}\(repo web, \d+ files\)/);
    assert.doesNotMatch(runTool({ map, files }, "list_files", { path: "web" }), /repos in this workspace/);
  });

  it("query_map cites the compose file under its repo's path", () => {
    const out = runTool({ map, files }, "query_map", { query: "users" });
    assert.match(out, /^## users service \[svc-users\]/);
    assert.match(out, /\(repo services\)/);
    assert.match(out, /resolved through services\/docker-compose\.yml:8/);
    assertCitationsReal(out, files);
  });
});
