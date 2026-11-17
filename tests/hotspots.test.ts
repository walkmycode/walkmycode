// Hotspots (src/lib/hotspots.ts, docs/GIT.md, "Hotspots"): git's log read into changes and people per file,
// renames followed; each file put on its map cards; cards scored changes × lines and sorted into five
// heat levels by rank; the hottest files; the note on a hot card; the tour; what "Why is it hot?" sends.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap, FileEntry, MapEdge, MapNode } from "../src/analyzer/types";
import { changesLabel, heatOf, hotNote, hotTour, levelsOf, parseChurn, sinceOf, testsImporting, whyHotContext, type Churn } from "../src/lib/hotspots";

/** What `git log --name-status -M` with CHURN_FORMAT prints: one record per commit, newest first. */
const commit = (hash: string, email: string, lines: string[]) => `\x1e${hash}\x1f${email}\x1fSomeone\n\n${lines.join("\n")}\n`;

const file = (path: string, lines: number, skipped?: string): FileEntry => ({ path, lang: "ts", lines, area: "", ...(skipped ? { skipped } : {}) });

function map(nodes: MapNode[], files: FileEntry[], edges: MapEdge[] = [], repos: CodeMap["repos"] = [{ label: "app", prefix: "", kind: "local" }]): CodeMap {
  return {
    version: 2,
    name: "app",
    generatedAt: "2026-10-01T10:00:00.000Z",
    repos,
    system: { kind: "monolith", links: [] },
    services: [],
    gateways: [],
    areas: [],
    files,
    nodes,
    edges,
    warnings: [],
    stats: { files: files.length, parsed: files.length, routes: 0, tables: 0, edges: edges.length, likely: 0, ms: 1, services: 1, links: 0, crossService: 0 },
  };
}

const node = (id: string, file?: string, o: Partial<MapNode> = {}): MapNode => ({ id, layer: "logic", kind: "module", name: id, area: "", ...(file ? { file } : {}), ...o });

describe("reading git's log", () => {
  it("counts the commits that changed each file, and the different people who made them", () => {
    const out =
      commit("c3", "ama@x.io", ["M\tlib/tasks.ts", "M\tlib/auth.ts"]) +
      commit("c2", "Kofi@x.io", ["M\tlib/tasks.ts"]) +
      commit("c1", "ama@x.io", ["A\tlib/tasks.ts", "A\tlib/auth.ts", "A\tREADME.md"]);
    const c = parseChurn(out, "90");
    assert.equal(c.commits, 3);
    assert.equal(c.capped, false);
    assert.deepEqual(c.files["lib/tasks.ts"], { changes: 3, authors: 2 });
    assert.deepEqual(c.files["lib/auth.ts"], { changes: 2, authors: 1 });
    assert.deepEqual(c.files["README.md"], { changes: 1, authors: 1 });
  });

  it("follows a rename: the old name's changes count for the new one", () => {
    const out =
      commit("c4", "a@x", ["M\tsrc/store.ts"]) +
      commit("c3", "b@x", ["R087\tsrc/old-store.ts\tsrc/store.ts"]) +
      commit("c2", "c@x", ["M\tsrc/old-store.ts"]) +
      commit("c1", "a@x", ["A\tsrc/old-store.ts"]);
    const c = parseChurn(out, "all");
    assert.deepEqual(c.files["src/store.ts"], { changes: 4, authors: 3 });
    assert.equal(c.files["src/old-store.ts"], undefined);
  });

  it("keeps a new file that took an old name apart from the renamed one", () => {
    const out = commit("c3", "a@x", ["A\tsrc/a.ts"]) + commit("c2", "a@x", ["R100\tsrc/a.ts\tsrc/b.ts"]) + commit("c1", "a@x", ["A\tsrc/a.ts"]);
    const c = parseChurn(out, "all");
    assert.equal(c.files["src/a.ts"].changes, 1);
    assert.equal(c.files["src/b.ts"].changes, 2);
  });

  it("says when there were more commits than it reads, and counts only the newest", () => {
    const out = commit("c3", "a@x", ["M\tx.ts"]) + commit("c2", "a@x", ["M\tx.ts"]) + commit("c1", "a@x", ["M\ty.ts"]);
    const c = parseChurn(out, "all", 2);
    assert.equal(c.capped, true);
    assert.equal(c.commits, 2);
    assert.equal(c.files["y.ts"], undefined);
  });

  it("reads Windows line ends, a quoted path, and nothing at all", () => {
    const c = parseChurn(`\x1eh\x1fa@x\x1fA\r\n\r\nM\t"we ird.ts"\r\n`, "30");
    assert.deepEqual(Object.keys(c.files), ["we ird.ts"]);
    assert.deepEqual(parseChurn("", "30"), { span: "30", commits: 0, capped: false, files: {} });
  });

  it("asks git for a date the span's days before now, and none for all of the history", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    assert.equal(sinceOf("90", now), "2026-08-19T12:00:00.000Z");
    assert.equal(sinceOf("30", now), "2026-10-18T12:00:00.000Z");
    assert.equal(sinceOf("all", now), null);
  });
});

describe("heat on the map", () => {
  const files = [file("lib/tasks.ts", 40), file("lib/auth.ts", 20), file("lib/email.ts", 10), file("app/api/tasks/route.ts", 60), file("lib/big.ts", 2000), file("tests/tasks.test.ts", 30, "test")];
  const nodes = [
    node("tasks", "lib/tasks.ts"),
    node("auth", "lib/auth.ts"),
    node("email", "lib/email.ts"),
    node("big", "lib/big.ts"),
    // Two routes in one file: each is its handler's lines, not the whole file.
    node("GET", "app/api/tasks/route.ts", { kind: "route", layer: "api", line: 3, endLine: 12 }),
    node("POST", "app/api/tasks/route.ts", { kind: "route", layer: "api", line: 14, endLine: 53 }),
    // An outside service: no file of its own; the code that talks to it is its files.
    node("resend", undefined, { kind: "service", layer: "external" }),
  ];
  const edges: MapEdge[] = [{ id: "e1", from: "email", to: "resend", kind: "uses-service", confidence: "certain", evidence: [{ file: "lib/email.ts", line: 4, text: "new Resend()" }, { file: ".env.example", line: 1, text: "RESEND_KEY", role: "config" }] }];
  const m = map(nodes, files, edges);
  const churn: Churn = {
    span: "90",
    commits: 40,
    capped: false,
    files: {
      "lib/tasks.ts": { changes: 23, authors: 4 },
      "lib/auth.ts": { changes: 6, authors: 2 },
      "lib/email.ts": { changes: 4, authors: 1 },
      "app/api/tasks/route.ts": { changes: 12, authors: 3 },
      "lib/big.ts": { changes: 1, authors: 1 },
      "gone.ts": { changes: 9, authors: 1 },
    },
  };
  const heat = heatOf(m, churn);

  it("scores each card as its changes × its own lines", () => {
    assert.deepEqual(heat.cards.get("tasks"), { changes: 23, authors: 4, lines: 40, score: 920, level: 3, files: ["lib/tasks.ts"] });
    assert.equal(heat.cards.get("GET")!.lines, 10);
    assert.equal(heat.cards.get("POST")!.lines, 40);
    assert.equal(heat.cards.get("POST")!.score, 480);
  });

  it("puts a card with no file of its own on the files that link to it, never a config line", () => {
    assert.deepEqual(heat.cards.get("resend")!.files, ["lib/email.ts"]);
    assert.equal(heat.cards.get("resend")!.changes, 4);
  });

  it("puts a table on the file that creates it, not on every file that reads it, and sums a card's files one by one", () => {
    const t = map(
      [node("tasks", "lib/tasks.ts"), node("users", "lib/users.ts"), node("Task", undefined, { kind: "table", layer: "data" }), node("api", undefined, { kind: "service", layer: "external" })],
      [file("lib/tasks.ts", 40), file("lib/users.ts", 10), file("prisma/schema.prisma", 30)],
      [
        { id: "d", from: "Task", to: "Task", kind: "defines", confidence: "certain", evidence: [{ file: "prisma/schema.prisma", line: 5, text: "model Task {" }] },
        { id: "r", from: "tasks", to: "Task", kind: "reads", confidence: "certain", evidence: [{ file: "lib/tasks.ts", line: 9, text: "db.task.findMany()" }] },
        { id: "a", from: "tasks", to: "api", kind: "uses-service", confidence: "certain", evidence: [{ file: "lib/tasks.ts", line: 2, text: "fetch(API)" }] },
        { id: "b", from: "users", to: "api", kind: "uses-service", confidence: "certain", evidence: [{ file: "lib/users.ts", line: 2, text: "fetch(API)" }] },
      ],
    );
    const h = heatOf(t, { span: "90", commits: 9, capped: false, files: { "lib/tasks.ts": { changes: 5, authors: 2 }, "lib/users.ts": { changes: 2, authors: 1 }, "prisma/schema.prisma": { changes: 1, authors: 1 } } });
    assert.deepEqual(h.cards.get("Task")!.files, ["prisma/schema.prisma"]);
    assert.equal(h.cards.get("Task")!.score, 30);
    // 5 × 40 + 2 × 10, not (5 + 2) × (40 + 10).
    assert.deepEqual([h.cards.get("api")!.changes, h.cards.get("api")!.lines, h.cards.get("api")!.score], [7, 50, 220]);
  });

  it("ranks the cards so one huge file doesn't make every other card cold", () => {
    // big.ts changed once but is 2000 lines: the hottest by score; tasks.ts (23 × 40, under half of it) is only
    // one level cooler, and the small files are not all pushed down to cold.
    assert.equal(heat.cards.get("big")!.score, 2000);
    assert.equal(heat.cards.get("tasks")!.level, 3);
    assert.equal(heat.cards.get("big")!.level, 4);
    assert.ok(heat.cards.get("auth")!.level >= 1);
    assert.ok([...heat.cards.values()].every((c) => c.level <= 4));
  });

  it("gives a card nothing changed the coolest level", () => {
    const h = heatOf(m, { ...churn, files: { "lib/tasks.ts": { changes: 2, authors: 1 } } });
    assert.equal(h.cards.get("auth")!.level, 0);
    assert.equal(h.cards.get("auth")!.changes, 0);
    assert.equal(h.cards.get("tasks")!.level, 4);
  });

  it("finds a file under its folder's label when several folders make the map", () => {
    const multi = map([node("w", "web/lib/tasks.ts")], [file("web/lib/tasks.ts", 10)], [], [{ label: "web", prefix: "web/", kind: "local" }, { label: "api", prefix: "api/", kind: "local" }]);
    assert.equal(heatOf(multi, { ...churn, files: { "lib/tasks.ts": { changes: 5, authors: 1 } } }).cards.get("w")!.changes, 5);
  });

  it("finds the map's files when git read the folder above the one mapped", () => {
    // The map is of src/; Source Control was given the repo, so git's paths start with src/.
    const sub = map([node("a", "lib/a.ts"), node("b", "app.ts")], [file("lib/a.ts", 10), file("app.ts", 5)]);
    const h = heatOf(sub, { ...churn, files: { "src/lib/a.ts": { changes: 3, authors: 1 }, "src/app.ts": { changes: 1, authors: 1 }, "docs/a.md": { changes: 9, authors: 1 }, "app.ts": { changes: 50, authors: 1 } } });
    assert.equal(h.cards.get("a")!.changes, 3);
    // Only the folder's own files: a file of the same name elsewhere in the repo is not it.
    assert.equal(h.cards.get("b")!.changes, 1);
  });

  it("counts lines from the repo's text when the map has no count", () => {
    const bare = map([node("x", "x.ts")], []);
    const h = heatOf(bare, { ...churn, files: { "x.ts": { changes: 2, authors: 1 } } }, { "x.ts": "a\nb\nc" }).cards.get("x")!;
    assert.deepEqual([h.changes, h.lines, h.score], [2, 3, 6]);
  });

  it("lists the five hottest files on the map, each with the card a click selects", () => {
    assert.deepEqual(
      heat.top.map((f) => [f.path, f.changes, f.lines, f.card]),
      [
        ["lib/big.ts", 1, 2000, "big"],
        ["lib/tasks.ts", 23, 40, "tasks"],
        ["app/api/tasks/route.ts", 12, 60, "POST"],
        ["lib/auth.ts", 6, 20, "auth"],
        ["lib/email.ts", 4, 10, "email"],
      ],
    );
    assert.equal(heat.top[0].share, 1);
    assert.equal(heat.top[1].share, 920 / 2000);
    // gone.ts changed but is not on the map: never listed.
    assert.ok(!heat.top.some((f) => f.path === "gone.ts"));
  });
});

describe("levels", () => {
  it("sorts changed cards into four levels by rank, and unchanged ones into the coolest", () => {
    const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.deepEqual(levelsOf(scores), [0, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4]);
  });
  it("gives equal scores one level, and a lone changed card the hottest", () => {
    assert.deepEqual(levelsOf([5, 5, 5, 5]), [4, 4, 4, 4]);
    assert.deepEqual(levelsOf([0, 7]), [0, 4]);
  });
});

describe("words", () => {
  const m = map([node("tasks", "lib/tasks.ts")], [file("lib/tasks.ts", 39), file("tests/tasks.test.ts", 20, "test"), file("tests/auth.test.ts", 20, "test")]);
  const heat = heatOf(m, { span: "90", commits: 40, capped: false, files: { "lib/tasks.ts": { changes: 23, authors: 4 } } });
  const h = heat.cards.get("tasks")!;

  it("says how often, out of how many commits, by how many people, and how long it is", () => {
    assert.equal(hotNote(h, heat, null), "Changed in 23 of the last 40 commits, by 4 people. It is 39 lines long.");
    assert.equal(hotNote({ ...h, authors: 1 }, { ...heat, span: "all" }, null), "Changed in 23 of 40 commits, by 1 person. It is 39 lines long.");
    assert.equal(changesLabel(1), "1 change");
    assert.equal(changesLabel(12), "12 changes");
  });

  it("says whether a test file imports it, only where that can be read from the tests' text", () => {
    const none = { "tests/tasks.test.ts": 'import { x } from "../lib/other";', "tests/auth.test.ts": "" };
    const one = { "tests/tasks.test.ts": 'import { addTask } from "../lib/tasks";', "tests/auth.test.ts": "" };
    assert.equal(testsImporting(m, none, "lib/tasks.ts"), 0);
    assert.equal(testsImporting(m, one, "lib/tasks.ts"), 1);
    assert.equal(testsImporting(m, one, "lib/tasks.py"), null);
    assert.equal(testsImporting(map([], [file("lib/tasks.ts", 1)]), one, "lib/tasks.ts"), null);
    assert.match(hotNote(h, heat, 0), /No test file imports it\.$/);
    assert.match(hotNote(h, heat, 2), /2 test files import it\.$/);
  });

  it("makes a tour of the hottest files, each step on its card", () => {
    const t = hotTour(m, heat)!;
    assert.equal(t.title, "Hotspots · last 90 days");
    assert.equal(t.steps.length, 1);
    assert.deepEqual([t.steps[0].file, t.steps[0].start_line, t.steps[0].end_line, t.steps[0].node_ids], ["lib/tasks.ts", 1, 39, ["tasks"]]);
    assert.match(t.steps[0].say, /changed 23 times in the last 90 days, by 4 people/);
    assert.equal(hotTour(m, { ...heat, top: [] }), null);
  });

  it("tells the guide the commits in the span that changed the file, and only those", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    const text = whyHotContext("lib/tasks.ts", "30", [
      { hash: "abc1234", subject: "Send the email after the save", author: "Ama", date: "2026-11-10T09:00:00+00:00" },
      { hash: "def5678", subject: "Old work", author: "Kofi", date: "2026-07-01T09:00:00+00:00" },
    ], now);
    assert.match(text, /in the last 30 days, newest first \(1 in all\)/);
    assert.match(text, /2026-11-10 abc1234 Ama: Send the email after the save/);
    assert.doesNotMatch(text, /Old work/);
  });
});
