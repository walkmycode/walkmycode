// "If you change it" (src/lib/impact.ts): what uses a card, step by step, what its code
// reads, writes and talks to, and the tests that import it. Checked on the example app
// (Team Tasks, mapped by the real analyzer) and on small hand-made maps for the cases it
// doesn't have: queues, helpers called inside a file, guesses and test files.
import assert from "node:assert/strict";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import type { CodeMap, EdgeKind, FileEntry, MapEdge, MapNode } from "../src/analyzer/types";
import { countWords, fnAt, impactContext, impactLit, impactName, impactOf, impactTour, importSpecs, resolveSpec, usersWithin } from "../src/lib/impact";
import { readDir } from "../scripts/readDir";
import "./analyzer.helpers";

const AUTH = "file:lib/auth.ts";
const route = (m: string, p: string) => `route:app${p}/route.ts#${m} ${p}`;

let tt: CodeMap;
let ttFiles: Record<string, string>;
before(async () => {
  const src = await readDir(join(process.cwd(), "examples", "team-tasks"));
  tt = (await buildMap(src, { name: "team-tasks" })).map;
  ttFiles = Object.fromEntries(src.map((s) => [s.path, s.content]));
});

describe("impact on Team Tasks", () => {
  it("currentUser() alone: the six handlers that call it, not sign-in or sign-out", () => {
    const imp = impactOf(tt, AUTH, { fn: "currentUser" });
    const direct = usersWithin(imp, 1).map((u) => u.id).sort();
    assert.deepEqual(direct, [
      route("GET", "/api/me"),
      route("POST", "/api/projects"),
      route("POST", "/api/projects/[id]/tasks"),
      route("POST", "/api/tasks/[id]/comments"),
      route("DELETE", "/api/tasks/[id]"),
      route("PATCH", "/api/tasks/[id]"),
    ].sort());
    // Five route files hold them (PATCH and DELETE share one).
    assert.equal(new Set(usersWithin(imp, 1).map((u) => u.via.evidence[0].file)).size, 5);
    assert.equal(countWords(tt, direct), "6 API routes");
    assert.equal(impactName(tt, imp), "currentUser()");
    // Its own code reads the Session table; the map records no other table for it.
    assert.deepEqual(imp.tables.map((t) => [t.id, t.reads.length > 0, t.writes.length > 0]), [["table:session", true, false]]);
    assert.deepEqual(imp.services, []);
  });

  it("the whole of auth.ts: every route that calls any of it, and both tables", () => {
    const imp = impactOf(tt, AUTH);
    const direct = usersWithin(imp, 1).map((u) => u.id);
    assert.equal(direct.length, 8);
    assert.ok(direct.includes(route("POST", "/api/login")) && direct.includes(route("POST", "/api/logout")));
    const tables = Object.fromEntries(imp.tables.map((t) => [t.id, `${t.reads.length ? "r" : ""}${t.writes.length ? "w" : ""}`]));
    assert.deepEqual(tables, { "table:user": "r", "table:session": "rw" });
    assert.equal(impactName(tt, imp), "auth");
  });

  it("two steps reach the components that send those requests; all goes on to the pages", () => {
    const imp = impactOf(tt, AUTH, { fn: "currentUser" });
    const two = usersWithin(imp, 2).filter((u) => u.step === 2);
    assert.deepEqual(two.map((u) => u.id).sort(), ["file:components/CommentBox.tsx", "file:components/Header.tsx", "file:components/NewTaskForm.tsx", "file:components/TaskCard.tsx"]);
    for (const u of two) assert.equal(u.via.kind, "calls-route");
    const all = usersWithin(imp, "all").map((u) => u.id);
    for (const id of ["file:app/layout.tsx", "file:app/projects/[id]/page.tsx", "file:app/tasks/[id]/page.tsx", "file:components/TaskList.tsx"]) assert.ok(all.includes(id), id);
    // The dashboard only asks GET /api/projects, which never calls currentUser.
    assert.ok(!all.includes("file:app/page.tsx"));
    // Nearest first, and every step-n user depends on a step n-1 one.
    const steps = new Map([[AUTH, 0], ...imp.users.map((u) => [u.id, u.step] as [string, number])]);
    for (const u of imp.users) assert.equal(steps.get(u.on), u.step - 1, u.id);
    assert.deepEqual(imp.users.map((u) => u.step), [...imp.users.map((u) => u.step)].sort((a, b) => a - b));
  });

  it("a table: the code that reads or writes it, then what calls that code; never the schema", () => {
    const imp = impactOf(tt, "table:task");
    const direct = usersWithin(imp, 1).map((u) => u.id).sort();
    assert.deepEqual(direct, ["file:lib/tasks.ts", "file:prisma/seed.ts"]);
    assert.ok(!imp.users.some((u) => u.id === "file:prisma/schema.prisma"));
    assert.ok(usersWithin(imp, 2).some((u) => u.id === route("POST", "/api/projects/[id]/tasks")));
  });

  it("forwards through the code it calls: a route reaches the tables and the email service behind it", () => {
    const imp = impactOf(tt, route("POST", "/api/projects/[id]/tasks"));
    const tables = imp.tables.map((t) => t.id).sort();
    assert.ok(tables.includes("table:task") && tables.includes("table:session"));
    assert.deepEqual(imp.services.map((s) => s.id), ["svc:resend-email-"]);
    // The cards between: the route, lib/tasks.ts and lib/email.ts lead there.
    for (const id of ["file:lib/tasks.ts", "file:lib/email.ts", "svc:resend-email-"]) assert.ok(imp.path.nodes.has(id), id);
  });

  it("lights the changed card, the users within reach with their arrows, and its tables", () => {
    const imp = impactOf(tt, AUTH, { fn: "currentUser" });
    const one = impactLit(tt, imp, 1);
    assert.equal(one.origin, AUTH);
    assert.ok(one.nodes.has(AUTH) && one.nodes.has("table:session") && one.nodes.has(route("GET", "/api/me")));
    assert.ok(!one.nodes.has("file:components/Header.tsx"));
    assert.ok(!one.nodes.has(route("POST", "/api/login")));
    assert.ok(one.edges.has(`calls:${route("GET", "/api/me")}->${AUTH}`));
    const two = impactLit(tt, imp, 2);
    assert.ok(two.nodes.has("file:components/Header.tsx"));
    // Every lit arrow joins two lit cards.
    const byId = new Map(tt.edges.map((e) => [e.id, e]));
    for (const id of two.edges) {
      const e = byId.get(id)!;
      assert.ok(two.nodes.has(e.from) && two.nodes.has(e.to), id);
    }
  });

  it("a tour from the function's own lines through each user, on the line that links it", () => {
    const imp = impactOf(tt, AUTH, { fn: "currentUser", files: ttFiles });
    const tour = impactTour(tt, imp, 1, ttFiles)!;
    assert.equal(tour.title, "What changing currentUser() reaches");
    assert.deepEqual([tour.steps[0].file, tour.steps[0].start_line, tour.steps[0].end_line], ["lib/auth.ts", 27, 33]);
    assert.match(tour.steps[0].say, /6 API routes use it directly/);
    assert.match(tour.steps[0].say, /No test file imports it/);
    assert.equal(tour.steps.length, 1 + 6 + 1);
    const ids = new Set(tt.nodes.map((n) => n.id));
    for (const s of tour.steps) {
      assert.ok(ttFiles[s.file] !== undefined, s.file);
      assert.ok(s.start_line >= 1 && s.end_line >= s.start_line);
      for (const id of s.node_ids) assert.ok(ids.has(id), id);
    }
    // Each user's step is on the line where it calls currentUser().
    for (const s of tour.steps.slice(1, 7)) assert.match(ttFiles[s.file].split("\n")[s.start_line - 1], /currentUser/);
    assert.equal(tour.steps[7].say, "Its code reads the session table here.");
  });

  it("a long tour stops at its limit and says how many more there are", () => {
    const imp = impactOf(tt, AUTH);
    const tour = impactTour(tt, imp, "all", undefined, 6)!;
    assert.equal(tour.steps.length, 6);
    assert.match(tour.steps[5].say, /And \d+ more, listed in Details\./);
  });

  it("tells the guide every item with its line, and says plainly when no test imports it", () => {
    const imp = impactOf(tt, AUTH, { fn: "currentUser", files: ttFiles });
    const ctx = impactContext(tt, imp, 1);
    assert.match(ctx, /about to change currentUser\(\) in auth \[file:lib\/auth\.ts\], at lib\/auth\.ts:27-33/);
    for (const u of usersWithin(imp, 1)) assert.ok(ctx.includes(`(${u.via.evidence[0].file}:${u.via.evidence[0].line})`), u.id);
    assert.match(ctx, /reads the session table \(lib\/auth\.ts:30\)/);
    assert.match(ctx, /the project has no test files WalkMyCode could read/);
  });

  it("finds the function at a line", () => {
    assert.equal(fnAt(tt, "lib/auth.ts", 30), "currentUser");
    assert.equal(fnAt(tt, "lib/auth.ts", 9), "signIn");
    assert.equal(fnAt(tt, "lib/auth.ts", 5), undefined);
    assert.equal(fnAt(tt, "nope.ts", 1), undefined);
  });

  it("ignores a function the file doesn't have", () => {
    const imp = impactOf(tt, AUTH, { fn: "noSuchThing" });
    assert.equal(imp.fn, undefined);
    assert.equal(usersWithin(imp, 1).length, 8);
  });
});

// ── small maps ──

function node(id: string, extra: Partial<MapNode> = {}): MapNode {
  return { id, layer: "logic", kind: "module", name: id.replace(/^file:/, ""), area: "", ...extra };
}
function edge(kind: EdgeKind, from: string, to: string, extra: Partial<MapEdge> = {}): MapEdge {
  return { id: `${kind}:${from}->${to}`, from, to, kind, confidence: "certain", evidence: [{ file: from.replace(/^\w+:/, ""), line: 3, text: "" }], ...extra };
}
function mapOf(nodes: MapNode[], edges: MapEdge[], files: FileEntry[] = []): CodeMap {
  return {
    version: 2, name: "t", generatedAt: "", repos: [], system: { kind: "monolith", links: [] }, services: [], gateways: [], areas: [],
    files, nodes, edges, warnings: [],
    stats: { files: 0, parsed: 0, routes: 0, tables: 0, edges: 0, likely: 0, ms: 0, services: 0, links: 0, crossService: 0 },
  };
}

describe("impact on small maps", () => {
  it("a helper changes what the functions that call it do", () => {
    const m = mapOf(
      [node("file:a.ts", { file: "a.ts" }), node("file:b.ts", { file: "b.ts" }), node("file:c.ts", { file: "c.ts" })],
      [edge("calls", "file:b.ts", "file:a.ts", { toFns: ["outer"] }), edge("calls", "file:c.ts", "file:a.ts", { toFns: ["other"] })],
      [{ path: "a.ts", lang: "ts", lines: 30, area: "", fns: { helper: [1, 5, []], outer: [6, 12, ["helper"]], other: [13, 20, ["this.nothing"]] } }],
    );
    assert.deepEqual(usersWithin(impactOf(m, "file:a.ts", { fn: "helper" }), 1).map((u) => u.id), ["file:b.ts"]);
    assert.deepEqual(usersWithin(impactOf(m, "file:a.ts", { fn: "other" }), 1).map((u) => u.id), ["file:c.ts"]);
  });

  it("a step two card is only reached through the functions the step one card uses", () => {
    // c calls b.useA (which uses a); d calls b.alone (which doesn't).
    const m = mapOf(
      [node("file:a.ts", { file: "a.ts" }), node("file:b.ts", { file: "b.ts" }), node("file:c.ts"), node("file:d.ts")],
      [edge("imports", "file:b.ts", "file:a.ts", { fromFns: ["useA"] }), edge("calls", "file:c.ts", "file:b.ts", { toFns: ["useA"] }), edge("calls", "file:d.ts", "file:b.ts", { toFns: ["alone"] })],
      [{ path: "b.ts", lang: "ts", lines: 20, area: "", fns: { useA: [1, 5, []], alone: [6, 9, []] } }],
    );
    const imp = impactOf(m, "file:a.ts");
    assert.deepEqual(imp.users.map((u) => [u.id, u.step]), [["file:b.ts", 1], ["file:c.ts", 2]]);
  });

  it("a queue: what is published reaches the code that picks it up", () => {
    const m = mapOf(
      [node("file:pub.ts"), node("chan:orders", { kind: "channel", name: "orders" }), node("file:sub.ts"), node("file:api.ts")],
      [edge("publishes", "file:pub.ts", "chan:orders"), edge("consumes", "file:sub.ts", "chan:orders"), edge("calls", "file:api.ts", "file:pub.ts")],
    );
    const imp = impactOf(m, "file:pub.ts");
    assert.deepEqual(imp.users.map((u) => [u.id, u.step]).sort(), [["chan:orders", 1], ["file:api.ts", 1], ["file:sub.ts", 2]]);
    assert.equal(countWords(m, usersWithin(imp, 1).map((u) => u.id)), "1 module and 1 queue");
    const say = (id: string) => impactTour(m, imp, 2)!.steps.find((s) => s.node_ids[0] === id)!.say;
    assert.match(say("chan:orders"), /orders gets its messages from it here, so a change to pub\.ts reaches it directly/);
    assert.match(say("file:sub.ts"), /sub\.ts picks up messages from orders, which uses it: 2 steps away/);
  });

  it("marks what was reached through a guess, and never walks start-up order or proxies", () => {
    const m = mapOf(
      [node("file:a.ts"), node("file:b.ts", { layer: "ui", kind: "component" }), node("file:c.ts"), node("file:d.ts")],
      [edge("calls-route", "file:b.ts", "file:a.ts", { confidence: "likely" }), edge("depends-on", "file:c.ts", "file:a.ts"), edge("proxies", "file:d.ts", "file:a.ts")],
    );
    const imp = impactOf(m, "file:a.ts");
    assert.deepEqual(imp.users.map((u) => [u.id, u.guess]), [["file:b.ts", true]]);
    assert.equal(countWords(m, ["file:b.ts"]), "1 component");
    assert.equal(countWords(m, []), "nothing");
    assert.match(impactContext(m, imp, 1), /GUESS/);
  });

  it("a cycle ends", () => {
    const m = mapOf([node("file:a.ts"), node("file:b.ts")], [edge("imports", "file:a.ts", "file:b.ts"), edge("imports", "file:b.ts", "file:a.ts")]);
    const imp = impactOf(m, "file:a.ts");
    assert.deepEqual(imp.users.map((u) => u.id), ["file:b.ts"]);
  });

  it("finds the test files that import it, or import code that uses it", () => {
    const files: FileEntry[] = [
      { path: "src/lib/auth.ts", lang: "ts", lines: 10, area: "" },
      { path: "src/app/api/me/route.ts", lang: "ts", lines: 10, area: "" },
      { path: "src/other.ts", lang: "ts", lines: 10, area: "" },
      { path: "tests/auth.test.ts", lang: "ts", lines: 10, area: "", skipped: "test" },
      { path: "tests/me.test.ts", lang: "ts", lines: 10, area: "", skipped: "test" },
      { path: "tests/other.test.ts", lang: "ts", lines: 10, area: "", skipped: "test" },
      { path: "src/lib/auth.stories.tsx", lang: "tsx", lines: 10, area: "", skipped: "test" },
      { path: "tests/fixtures/x.ts", lang: "ts", lines: 10, area: "", skipped: "test" },
    ];
    const m = mapOf(
      [node("file:src/lib/auth.ts", { file: "src/lib/auth.ts" }), node("route:me", { kind: "route", layer: "api", file: "src/app/api/me/route.ts" })],
      [edge("calls", "route:me", "file:src/lib/auth.ts")],
      files,
    );
    const contents = {
      "tests/auth.test.ts": `import assert from "node:assert";\nimport { currentUser } from "../src/lib/auth";\n`,
      "tests/me.test.ts": `// the route\n\nconst { GET } = await import("@/app/api/me/route");\n`,
      "tests/other.test.ts": `import { x } from "../src/other.js";\n`,
      "src/lib/auth.stories.tsx": `import "./auth";\n`,
      "tests/fixtures/x.ts": `import "../../src/lib/auth";\n`,
    };
    const imp = impactOf(m, "file:src/lib/auth.ts", { files: contents });
    assert.deepEqual(imp.tests, [
      { path: "tests/auth.test.ts", line: 2, imports: "src/lib/auth.ts", direct: true },
      { path: "tests/me.test.ts", line: 3, imports: "src/app/api/me/route.ts", direct: false },
    ]);
    assert.equal(imp.testFiles, 3);
    assert.match(impactContext(m, impactOf(m, "route:me", { files: contents }), 1), /test tests\/me\.test\.ts:3 imports src\/app\/api\/me\/route\.ts/);
    // Without the files' contents nothing is claimed.
    assert.deepEqual(impactOf(m, "file:src/lib/auth.ts").tests, []);
    assert.match(impactContext(m, impactOf(m, "file:src/other.ts", { files: contents }), 1), /none of the 3 test files imports it/);
  });
});

describe("reading imports", () => {
  const known = new Set(["src/lib/auth.ts", "lib/db/index.ts", "app/users/service.py", "app/__init__.py", "app/models/__init__.py", "web/src/api.ts"]);
  it("resolves relative paths, aliases and Python modules to project files", () => {
    assert.equal(resolveSpec("tests/a.test.ts", "../src/lib/auth", known), "src/lib/auth.ts");
    assert.equal(resolveSpec("tests/a.test.ts", "../src/lib/auth.js", known), "src/lib/auth.ts");
    assert.equal(resolveSpec("tests/a.test.ts", "../lib/db", known), "lib/db/index.ts");
    assert.equal(resolveSpec("tests/a.test.ts", "@/lib/auth", known), "src/lib/auth.ts");
    assert.equal(resolveSpec("web/tests/a.test.ts", "@/api", known), "web/src/api.ts");
    assert.equal(resolveSpec("tests/a.test.ts", "react", known), null);
    assert.equal(resolveSpec("tests/test_users.py", "py:app.users.service", known), "app/users/service.py");
    assert.equal(resolveSpec("app/tests/test_models.py", "py:..models", known), "app/models/__init__.py");
    assert.equal(resolveSpec("tests/test_x.py", "py:pytest", known), null);
  });
  it("reads import, require, dynamic import and mocks, with their lines", () => {
    const js = `import a from "./a";\nconst b = require('./b');\nvi.mock("./c");\nexport * from "./d";\nawait import("./e");\nimport "./f";`;
    assert.deepEqual(importSpecs("x.test.ts", js), [
      { spec: "./a", line: 1 }, { spec: "./b", line: 2 }, { spec: "./c", line: 3 }, { spec: "./d", line: 4 }, { spec: "./e", line: 5 }, { spec: "./f", line: 6 },
    ]);
    const py = `import os\nfrom app.users import service\n  from .models import User\n`;
    assert.deepEqual(importSpecs("test_x.py", py), [{ spec: "py:os", line: 1 }, { spec: "py:app.users", line: 2 }, { spec: "py:.models", line: 3 }]);
  });
});
