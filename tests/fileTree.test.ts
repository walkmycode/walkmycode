// The Files panel's model (src/lib/fileTree.ts): folders from the map's
// files, the rows on show, the window of rows drawn, the rail down to the
// open file, and a trace's files numbered in order.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { ancestorsOf, buildTree, centreOn, flatten, railPath, rowInView, stepsInside, traceOrder, windowOf } from "../src/lib/fileTree";

const files = (...paths: string[]) => ({ files: paths.map((path) => ({ path })) }) as unknown as Pick<CodeMap, "files">;
const names = (rows: { path: string }[]) => rows.map((r) => r.path);

describe("the folder tree", () => {
  const tree = buildTree(files("lib/db.ts", "app/page.tsx", "README.md", "app/api/login/route.ts", "app/api/me/route.ts", "lib/auth.ts", ".env.example"));

  it("shows folders first, then files, each by name, and only open folders' contents", () => {
    assert.deepEqual(names(flatten(tree, new Set())), ["app", "lib", ".env.example", "README.md"]);
    assert.deepEqual(names(flatten(tree, new Set(["app", "app/api"]))), ["app", "app/api", "app/api/login", "app/api/me", "app/page.tsx", "lib", ".env.example", "README.md"]);
  });

  it("keeps a folder's contents hidden when a folder above it is closed", () => {
    assert.deepEqual(names(flatten(tree, new Set(["app/api"]))), ["app", "lib", ".env.example", "README.md"]);
  });

  it("puts repos first, in the order they were added, and marks them", () => {
    const ws = buildTree(files("web/a.ts", "api/b.ts", "zz/c.ts"));
    const rows = flatten(ws, new Set(), ["web", "api"]);
    assert.deepEqual(names(rows), ["web", "api", "zz"]);
    assert.deepEqual(rows.map((r) => !!r.repo), [true, true, false]);
  });

  it("lists a file's folders, outermost first", () => {
    assert.deepEqual(ancestorsOf("app/api/login/route.ts"), ["app", "app/api", "app/api/login"]);
    assert.deepEqual(ancestorsOf("README.md"), []);
  });
});

describe("drawing only the rows in view", () => {
  it("windows the rows to the view plus the overscan, within the list", () => {
    assert.deepEqual(windowOf(0, 200, 20, 1000, 8), { start: 0, end: 18 });
    assert.deepEqual(windowOf(2000, 200, 20, 1000, 8), { start: 92, end: 118 });
    assert.deepEqual(windowOf(19_900, 200, 20, 1000, 8), { start: 987, end: 1000 });
    assert.deepEqual(windowOf(0, 200, 20, 0), { start: 0, end: 0 });
  });

  it("scrolls only when the row is out of view, and then centres it", () => {
    assert.equal(rowInView(5, 20, 0, 400), true);
    assert.equal(rowInView(30, 20, 0, 400), false);
    assert.equal(centreOn(30, 20, 400, 1000), 30 * 20 - 200 + 10);
    assert.equal(centreOn(1, 20, 400, 1000), 0, "never above the top");
    assert.equal(centreOn(999, 20, 400, 1000), 1000 * 20 - 400, "never past the end");
  });

  it("opens a folder in a 12,000-file workspace quickly", () => {
    const paths: string[] = [];
    for (let a = 0; a < 30; a++) for (let b = 0; b < 20; b++) for (let c = 0; c < 20; c++) paths.push(`pkg${a}/mod${b}/file${c}.ts`);
    const t0 = performance.now();
    const big = buildTree(files(...paths));
    const all = new Set(paths.flatMap(ancestorsOf));
    const t1 = performance.now();
    const rows = flatten(big, all);
    const t2 = performance.now();
    assert.equal(rows.length, 12_000 + 30 + 600);
    assert.ok(t1 - t0 < 1500, `built in ${Math.round(t1 - t0)} ms`);
    assert.ok(t2 - t1 < 300, `every folder open, flattened in ${Math.round(t2 - t1)} ms`);
  });
});

describe("the rail down to the open file", () => {
  const tree = buildTree(files("app/api/login/route.ts", "app/page.tsx", "lib/db.ts"));

  it("runs down the left of each level to the file", () => {
    const rows = flatten(tree, new Set(["app", "app/api", "app/api/login"]));
    // rows: app 0, app/api 1, app/api/login 2, route.ts 3, page.tsx 4, lib 5, …
    assert.equal(railPath(rows, "app/api/login/route.ts", 20, 12, 4), "M 10 16.666666666666668 V 30 H 19 V 50 H 31 V 70 H 43");
  });

  it("draws nothing for a file at the top or one whose folder is closed", () => {
    const rows = flatten(tree, new Set(["app"]));
    assert.equal(railPath(rows, "app/api/login/route.ts", 20, 12, 4), null);
    assert.equal(railPath(flatten(buildTree(files("a.ts")), new Set()), "a.ts", 20, 12, 4), null);
  });
});

describe("a trace's files", () => {
  const map = {
    files: [],
    nodes: [
      { id: "file:web/Form.tsx", file: "web/Form.tsx" },
      { id: "route:api/login.ts#POST /login", file: "api/login.ts" },
      { id: "file:api/login.ts", file: "api/login.ts" },
      { id: "file:lib/auth.ts", file: "lib/auth.ts" },
    ],
    edges: [],
    repos: [],
  } as unknown as CodeMap;

  it("are numbered in the order the trace lights them, once each", () => {
    const n = traceOrder(map, { nodes: new Set(["file:web/Form.tsx", "route:api/login.ts#POST /login", "file:api/login.ts", "file:lib/auth.ts"]) });
    assert.deepEqual([...n], [["web/Form.tsx", 1], ["api/login.ts", 2], ["lib/auth.ts", 3]]);
  });

  it("are not numbered when the trace stays in one file, or there is none", () => {
    assert.equal(traceOrder(map, { nodes: new Set(["route:api/login.ts#POST /login", "file:api/login.ts"]) }).size, 0);
    assert.equal(traceOrder(map, null).size, 0);
  });

  it("show in the folders that hold them, so a folded folder says where the trace went", () => {
    const inside = stepsInside(new Map([["app/api/login/route.ts", 2], ["app/page.tsx", 1], ["lib/auth.ts", 3]]));
    assert.deepEqual(inside.get("app"), [1, 2]);
    assert.deepEqual(inside.get("app/api/login"), [2]);
    assert.deepEqual(inside.get("lib"), [3]);
  });
});
