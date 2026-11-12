// What a new user met in WalkMyCode Lite, and the rules that fix it: the map's camera on a
// restored map (item 2), a map back without its code (3), where a fresh page opens (4),
// the guide's narration (6), one code tab per tour (8) and the example app (9).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { afterResize, askFit, newCamera, placed } from "../src/components/mapCamera";
import { startHref } from "../src/lib/adapters/rooms";
import { SYSTEM } from "../src/lib/claude/prompts";
import { addLooked, lookedLabel, lookedLine, stripToolTalk } from "../src/lib/claude/looked";
import { trace } from "../src/lib/store";
import { attachFolder } from "../src/lib/workspace";
import { claimTab, tourMayShowGuide, tourTabStep } from "../src/shell/tourTabs";
import { buildMap } from "../src/analyzer/build";
import { readDir } from "../scripts/readDir";
import "./analyzer.helpers";

describe("the map's camera on a restored map (item 2)", () => {
  it("waits for a size before fitting, then fits once the box has one", () => {
    const c = newCamera();
    assert.equal(askFit(c, false), false, "no size yet: nothing is fitted at 0 × 0");
    assert.equal(c.pending, true);
    assert.deepEqual(afterResize(c, 0, 0, false), { kind: "none" });
    assert.deepEqual(afterResize(c, 800, 600, false), { kind: "fit" }, "the waiting fit is made with the real size");
    assert.equal(askFit(c, true), true);
    assert.equal(c.pending, false);
  });

  it("fits again while nobody has moved it; once placed, a resize keeps the middle instead of zooming out", () => {
    const c = newCamera();
    afterResize(c, 800, 600, false);
    askFit(c, true);
    assert.deepEqual(afterResize(c, 700, 600, false), { kind: "fit" });
    placed(c); // a click on a card
    assert.deepEqual(afterResize(c, 500, 586, false), { kind: "shift", dx: -100, dy: -7 }, "the code opening beside it: same zoom, same middle");
    assert.deepEqual(afterResize(c, 500, 586, false), { kind: "none" });
    assert.deepEqual(afterResize(c, 900, 700, true), { kind: "none" }, "a glide or fly-through frames the map itself");
  });
});

const map = {
  version: 2,
  name: "team-tasks",
  generatedAt: "2026-10-01",
  areas: ["app"],
  repos: [{ label: "team-tasks", prefix: "", kind: "local" }],
  files: [{ path: "lib/tasks.ts" }, { path: "lib/api.ts" }, { path: "app/page.tsx" }, { path: ".env" , skipped: "secret" }, { path: "docker-compose.yml" }],
  nodes: [
    { id: "file:lib/tasks.ts", kind: "module", layer: "logic", name: "lib/tasks", file: "lib/tasks.ts" },
    { id: "route:app/api/tasks/route.ts#POST /api/tasks", kind: "route", layer: "api", name: "POST /api/tasks", file: "app/api/tasks/route.ts" },
  ],
  edges: [],
  services: [{ id: "svc-users", name: "users" }],
  stats: { files: 5, parsed: 3, routes: 1, tables: 0, edges: 0, likely: 0, ms: 1 },
} as unknown as CodeMap;

describe("a map back without its code (item 3)", () => {
  const w = { id: "w", name: "team-tasks", repos: [{ label: "team-tasks" }], map, files: {} as Record<string, string>, codeElsewhere: true };
  const redact = (p: string, t: string) => (p.endsWith(".yml") ? t.replace(/secret\S*/g, "***") : t);

  it("takes the folder's code back into the open map, secrets left out and config redacted", () => {
    const r = attachFolder(w, { name: "team-tasks", files: [{ path: "lib/tasks.ts", content: "a" }, { path: "lib/api.ts", content: "b" }, { path: ".env", content: "KEY=1" }, { path: "docker-compose.yml", content: "pw: secret123" }] }, redact);
    assert.ok(r.ok);
    assert.deepEqual(r.workspace.files, { "lib/tasks.ts": "a", "lib/api.ts": "b", "docker-compose.yml": "pw: ***" });
    assert.equal(r.workspace.codeElsewhere, undefined, "nothing left to add");
    assert.equal(r.workspace.map, map, "the map is kept: the room stays where it was");
    assert.deepEqual(r.missing, []);
  });

  it("turns away a folder that is not the one the map was made from", () => {
    const r = attachFolder(w, { name: "other", files: [{ path: "src/x.ts", content: "x" }] }, redact);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.why, /doesn’t look like team-tasks/);
  });

  it("fills a workspace of several folders one folder at a time", () => {
    const two = {
      ...w,
      repos: [{ label: "web" }, { label: "api" }],
      map: { ...map, repos: [{ label: "web", prefix: "web/" }, { label: "api", prefix: "api/" }], files: [{ path: "web/app/page.tsx" }, { path: "api/main.py" }] } as unknown as CodeMap,
    };
    const r = attachFolder(two, { name: "api", files: [{ path: "main.py", content: "print(1)" }] }, redact);
    assert.ok(r.ok);
    assert.deepEqual(r.workspace.files, { "api/main.py": "print(1)" });
    assert.deepEqual(r.missing, ["web"]);
    assert.equal(r.workspace.codeElsewhere, true, "the banner stays until every folder is back");
  });
});

describe("where a fresh page opens (item 4)", () => {
  it("on the home page, unless a deep link names a card or a file", () => {
    assert.equal(startHref(""), null);
    assert.equal(startHref("?artifact=1#x"), null, "the host's own parameters are not a deep link");
    assert.equal(startHref("?teach=react"), null);
    assert.equal(startHref("?focus=lib/tasks.ts:21&artifact=1"), "/map?focus=lib%2Ftasks.ts%3A21");
    assert.equal(startHref("?node=file:lib/tasks.ts"), "/map?node=file%3Alib%2Ftasks.ts");
    assert.equal(startHref("?focus="), null, "an empty one is not a link");
  });
});

describe("the guide's narration (item 6)", () => {
  it("names what it looked at in plain words, never as calls", () => {
    assert.equal(lookedLabel(map, "read_file", { path: "lib/tasks.ts" }), "tasks");
    assert.equal(lookedLabel(map, "query_map", { query: "route:app/api/tasks/route.ts#POST /api/tasks" }), "POST /api/tasks");
    assert.equal(lookedLabel(map, "query_map", { query: "svc-users" }), "the users service");
    assert.equal(lookedLabel(map, "query_map", { query: "system" }), "how the services connect");
    assert.equal(lookedLabel(map, "query_map", { query: "table:shop/orders" }), "orders");
    assert.equal(lookedLabel(map, "search", { query: "signIn" }), "“signIn” in the code");
    assert.equal(lookedLabel(map, "list_files", {}), "the list of files");
    assert.equal(lookedLabel(map, "finish_tour", { title: "t" }), null, "handing in a tour is not looking");
    assert.equal(lookedLabel(map, "read_file"), null, "a call still being written");
    const list = ["tasks", "POST /api/tasks", "tasks"].reduce(addLooked, [] as string[]);
    assert.deepEqual(list, ["tasks", "POST /api/tasks"]);
    assert.equal(lookedLine(list), "Looked at: tasks, POST /api/tasks");
    assert.equal(lookedLine(["a", "b", "c"], 2), "Looked at: a, b and 1 more");
  });

  it("takes calls the model wrote out of the answer, and leaves the rest as it was", () => {
    const text = 'Let me check.\nquery_map("tasks")\n`read_file(lib/tasks.ts)`\n\nThe task is saved in `lib/tasks.ts:21` by `createTask`.\n  - indented item';
    assert.equal(stripToolTalk(text), "Let me check.\n\nThe task is saved in `lib/tasks.ts:21` by `createTask`.\n  - indented item");
    assert.equal(stripToolTalk('I used query_map("x") to find it.'), "I used to find it.");
  });

  it("tells the model not to name its tools, Lite or GUESS, and how to say it is unsure", () => {
    assert.match(SYSTEM, /never name your tools/);
    assert.match(SYSTEM, /"Lite view"/);
    assert.match(SYSTEM, /I'm not sure about this link/);
    assert.match(SYSTEM, /never the word GUESS/);
  });
});

describe("one code tab per tour (item 8)", () => {
  it("closes the step before's tab when the tour opened it, and never one the user had open", () => {
    let owned: string[] = [];
    let s = tourTabStep({ prev: null, next: "a.ts", open: ["mine.ts"], owned });
    assert.deepEqual(s, { owned: ["a.ts"], close: null });
    owned = s.owned;
    s = tourTabStep({ prev: "a.ts", next: "b.ts", open: ["mine.ts", "a.ts"], owned });
    assert.deepEqual(s, { owned: ["b.ts"], close: "a.ts" }, "a.ts made way for b.ts");
    owned = s.owned;
    s = tourTabStep({ prev: "b.ts", next: "mine.ts", open: ["mine.ts", "b.ts"], owned });
    assert.deepEqual(s, { owned: [], close: "b.ts" });
    s = tourTabStep({ prev: "mine.ts", next: "c.ts", open: ["mine.ts"], owned: s.owned });
    assert.deepEqual(s, { owned: ["c.ts"], close: null }, "the user's own file stays open");
    s = tourTabStep({ prev: "c.ts", next: "c.ts", open: ["mine.ts", "c.ts"], owned: s.owned });
    assert.equal(s.close, null, "the same file for two steps: one tab, its lines move");
  });

  it("brings the Guide forward on each step, except over an open Settings", () => {
    assert.equal(tourMayShowGuide("settings"), false, "the user is changing something: the tour plays without the Guide");
    assert.equal(tourMayShowGuide("details"), true);
    assert.equal(tourMayShowGuide("guide"), true);
    assert.equal(tourMayShowGuide(undefined), true, "no Guide on screen: it comes back");
  });

  it("leaves a tab the user took over (opened it themselves) open", () => {
    const owned = claimTab(["a.ts"], "a.ts");
    assert.deepEqual(tourTabStep({ prev: "a.ts", next: "b.ts", open: ["a.ts"], owned }), { owned: ["b.ts"], close: null });
  });
});

describe("the example app (item 9)", () => {
  it("packs into one small JSON file, with a starter tour whose lines are in its files", () => {
    execFileSync(process.execPath, ["scripts/pack-example.mjs"], { stdio: "pipe" });
    const raw = readFileSync(join("public", "examples", "team-tasks.json"), "utf8");
    const ex = JSON.parse(raw) as { files: { path: string; content: string }[]; tour: { steps: { file: string; start_line: number; end_line: number; say: string }[] } };
    assert.ok(ex.files.length >= 20 && ex.files.length <= 40, `${ex.files.length} files`);
    assert.ok(raw.length < 100_000, "a few dozen KB");
    assert.ok(!ex.files.some((f) => f.path === ".env"), "no real settings, only .env.example");
    assert.ok(ex.tour.steps.length >= 4);
    for (const s of ex.tour.steps) {
      const f = ex.files.find((x) => x.path === s.file);
      assert.ok(f, s.file);
      const n = f.content.split("\n").length;
      assert.ok(s.start_line >= 1 && s.end_line >= s.start_line && s.end_line <= n, `${s.file}:${s.start_line}-${s.end_line}`);
      assert.ok(s.say.length > 20);
    }
  });

  it("maps as a realistic web app: a page's button reaches a route, the logic and a table", async () => {
    const sources = await readDir(join("examples", "team-tasks"));
    const { map: m } = await buildMap(sources, { name: "team-tasks" });
    assert.ok(m.stats.routes >= 10, `${m.stats.routes} routes`);
    assert.ok(m.stats.tables >= 4, `${m.stats.tables} tables`);
    const form = m.nodes.find((n) => n.file === "components/NewTaskForm.tsx");
    assert.ok(form, "the form is on the map");
    const t = trace(m, form.id);
    const kinds = new Set(t.nodes.map((id) => m.nodes.find((n) => n.id === id)?.layer));
    for (const layer of ["ui", "api", "logic", "data"]) assert.ok(kinds.has(layer as never), `the trace from the form reaches ${layer}`);
  });
});
