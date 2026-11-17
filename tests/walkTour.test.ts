// Shared tours (src/lib/walkTour.ts): the `.walktour` file a teammate opens on the same code.
// What goes in (and what never does), reading it back with its checks, each step against the
// open project (same, moved, changed, missing, another project), and the Markdown export.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Tour } from "../src/lib/claude/tools";
import {
  buildWalkTour,
  checkStep,
  excerptOf,
  findExcerpt,
  hashExcerpt,
  hiddenFromTours,
  MAX_CLIP_BYTES,
  MAX_EXCERPT_LINES,
  otherProjectNote,
  readWalkTour,
  replayTour,
  stepTitle,
  tourFileName,
  walkTourMarkdown,
  walkTourText,
  WALKTOUR_VERSION,
  type WalkTour,
} from "../src/lib/walkTour";

const ROUTE = ["import { createTask } from '@/lib/tasks';", "", "export async function POST(req: Request) {", "  const body = await req.json();", "  const task = await createTask(body);", "  return Response.json(task);", "}"].join("\n");
const TASKS = ["export async function createTask(input) {", "  return db.task.create({ data: input });", "}"].join("\n");
const FILES: Record<string, string> = { "app/api/tasks/route.ts": ROUTE, "lib/tasks.ts": TASKS, "docker-compose.yml": "services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: hunter2\n" };

const TOUR: Tour = {
  title: "How a task gets created",
  steps: [
    { say: "The route takes the request. It reads the body first.", file: "app/api/tasks/route.ts", start_line: 3, end_line: 6, node_ids: ["route:POST /api/tasks"] },
    { say: "createTask saves it.", file: "lib/tasks.ts", start_line: 1, end_line: 3, node_ids: [] },
  ],
};

const save = (over: Partial<Parameters<typeof buildWalkTour>[2]> = {}) => buildWalkTour(TOUR, FILES, { name: "How a task gets created", created: "2026-11-17T10:00:00.000Z", project: "team-tasks", lines: true, ...over });
const b64 = (n: number) => Buffer.alloc(n, 7).toString("base64");

describe("hiddenFromTours", () => {
  it("keeps code, config and the CI folder", () => {
    for (const p of ["app/page.tsx", "lib/tasks.ts", "docker-compose.yml", ".env.example", ".github/workflows/deploy.yml", ".vscode/settings.json"]) assert.equal(hiddenFromTours(p), false, p);
  });
  it("never carries a real .env, keys or credentials", () => {
    for (const p of [".env", ".env.local", "api/.env.production", "certs/server.key", "id_rsa", "config/secrets.json", ".npmrc", "credentials.json"]) assert.equal(hiddenFromTours(p), true, p);
  });
  it("never carries a file inside a hidden folder WalkMyCode never reads", () => {
    for (const p of [".git/config", ".ssh/known_hosts", ".next/server/app.js", "a/.aws/config"]) assert.equal(hiddenFromTours(p), true, p);
  });
  it("refuses paths that climb out of the project or are absolute", () => {
    for (const p of ["../outside.ts", "a/../../b.ts", "/etc/passwd", "C:/Windows/win.ini", "a\\b.ts", "a//b.ts", ""]) assert.equal(hiddenFromTours(p), true, p);
  });
});

describe("excerptOf and hashExcerpt", () => {
  it("takes the step's lines only, 1-based and inclusive", () => {
    assert.equal(excerptOf("app/api/tasks/route.ts", ROUTE, 3, 4), "export async function POST(req: Request) {\n  const body = await req.json();");
    assert.equal(excerptOf("x.ts", "a\nb", 5, 6), "");
  });
  it("caps a long step at MAX_EXCERPT_LINES", () => {
    const long = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
    const ex = excerptOf("x.ts", long, 10, 299);
    assert.equal(ex.split("\n").length, MAX_EXCERPT_LINES);
    assert.ok(ex.startsWith("line 10\n"));
  });
  it("hides secret values in config lines, as the Code panel does", () => {
    const ex = excerptOf("docker-compose.yml", FILES["docker-compose.yml"], 1, 4);
    assert.ok(!ex.includes("hunter2"));
    assert.ok(ex.includes("POSTGRES_PASSWORD"));
  });
  it("hashes the same through line endings and trailing spaces, and differently for other code", () => {
    assert.match(hashExcerpt("a\nb"), /^fnv1a32:[0-9a-f]{8}$/);
    assert.equal(hashExcerpt("a  \r\nb"), hashExcerpt("a\nb"));
    assert.notEqual(hashExcerpt("a\nb"), hashExcerpt("a\nc"));
  });
});

describe("buildWalkTour", () => {
  it("holds the name, the date, and each step's file, lines, text, excerpt and hash", () => {
    const { tour, left } = save();
    assert.deepEqual(left, []);
    assert.equal(tour.format, "walktour");
    assert.equal(tour.version, WALKTOUR_VERSION);
    assert.equal(tour.name, "How a task gets created");
    assert.equal(tour.created, "2026-11-17T10:00:00.000Z");
    assert.equal(tour.project, "team-tasks");
    assert.deepEqual(tour.steps[0].lines, [3, 6]);
    assert.equal(tour.steps[0].text, TOUR.steps[0].say);
    assert.equal(tour.steps[0].excerpt, excerptOf("app/api/tasks/route.ts", ROUTE, 3, 6));
    assert.equal(tour.steps[0].hash, hashExcerpt(tour.steps[0].excerpt!));
  });
  it("never holds a whole file: only the step's lines", () => {
    const text = walkTourText(save().tour);
    assert.ok(!text.includes("import { createTask }"), "the route's first line is not a step's line");
  });
  it("without the lines keeps only their hash, so a change is still noticed", () => {
    const { tour } = save({ lines: false });
    assert.equal(tour.steps[0].excerpt, undefined);
    assert.match(tour.steps[0].hash, /^fnv1a32:/);
  });
  it("adds the map's cards only when asked", () => {
    assert.equal(save().tour.steps[0].cards, undefined);
    const { tour } = save({ cards: (s) => s.node_ids.map((id) => ({ id, name: "POST /api/tasks" })) });
    assert.deepEqual(tour.steps[0].cards, [{ id: "route:POST /api/tasks", name: "POST /api/tasks" }]);
    assert.equal(tour.steps[1].cards, undefined);
  });
  it("leaves out steps in files WalkMyCode hides", () => {
    const t: Tour = { title: "t", steps: [...TOUR.steps, { say: "The key.", file: ".env", start_line: 1, end_line: 1, node_ids: [] }] };
    const { tour, left } = buildWalkTour(t, { ...FILES, ".env": "SECRET=1" }, { name: "t", created: "2026-11-17", lines: true });
    assert.equal(tour.steps.length, 2);
    assert.deepEqual(left, [".env"]);
    assert.ok(!walkTourText(tour).includes("SECRET"));
  });
  it("keeps recordings under the caps, one per step, and drops a clip that is too big", () => {
    const { tour, clipsLeft } = save({ clips: [{ type: "audio/webm;codecs=opus", base64: b64(1000) }, { type: "audio/webm", base64: b64(MAX_CLIP_BYTES + 3) }] });
    assert.equal(tour.steps[0].audio?.type, "audio/webm;codecs=opus");
    assert.equal(tour.steps[1].audio, undefined);
    assert.equal(clipsLeft, 1);
  });
  it("falls back to the tour's title for a blank name", () => {
    assert.equal(save({ name: "  " }).tour.name, "How a task gets created");
  });
});

describe("readWalkTour", () => {
  const good = () => save().tour;
  it("reads back what was saved", () => {
    const r = readWalkTour(walkTourText(good()));
    assert.ok(r.ok);
    assert.deepEqual(r.tour, good());
  });
  it("says plainly when the file isn't a tour", () => {
    for (const t of ["not json", "{}", '{"format":"other"}', "[]"]) {
      const r = readWalkTour(t);
      assert.ok(!r.ok);
      assert.match(r.why, /isn't a tour file/);
    }
  });
  it("asks for an update when a newer WalkMyCode made it", () => {
    const r = readWalkTour(JSON.stringify({ ...good(), version: WALKTOUR_VERSION + 1 }));
    assert.ok(!r.ok);
    assert.match(r.why, /newer WalkMyCode/);
  });
  it("refuses a damaged file", () => {
    const broken = [{ ...good(), steps: [] }, { ...good(), name: "" }, { ...good(), steps: [{ ...good().steps[0], lines: [5, 2] }] }, { ...good(), steps: [{ ...good().steps[0], hash: "nope" }] }, { ...good(), steps: [{ ...good().steps[0], audio: { type: "text/html", base64: "AA==" } }] }];
    for (const b of broken) {
      const r = readWalkTour(JSON.stringify(b));
      assert.ok(!r.ok, JSON.stringify(b).slice(0, 80));
      assert.match(r.why, /damaged or incomplete/);
    }
  });
  it("drops a hand-added step in a hidden file, and refuses a tour made only of those", () => {
    const t = good();
    const sneaky = { ...t, steps: [...t.steps, { ...t.steps[0], file: ".env.local" }, { ...t.steps[0], file: "../../etc/passwd" }] };
    const r = readWalkTour(JSON.stringify(sneaky));
    assert.ok(r.ok);
    assert.equal(r.tour.steps.length, 2);
    assert.deepEqual(r.left, [".env.local", "../../etc/passwd"]);
    const only = readWalkTour(JSON.stringify({ ...t, steps: [{ ...t.steps[0], file: ".ssh/id_rsa" }] }));
    assert.ok(!only.ok);
    assert.match(only.why, /hidden/);
  });
  it("drops a recording over the cap, and the step is read aloud instead", () => {
    const t = good();
    const r = readWalkTour(JSON.stringify({ ...t, steps: [{ ...t.steps[0], audio: { type: "audio/webm", base64: b64(MAX_CLIP_BYTES + 3) } }] }));
    assert.ok(r.ok);
    assert.equal(r.tour.steps[0].audio, undefined);
    assert.equal(r.clipsLeft, 1);
  });
  it("takes a file saved with a byte-order mark", () => {
    assert.ok(readWalkTour(`\uFEFF${walkTourText(good())}`).ok);
  });
});

describe("checking a tour against the open project", () => {
  const wt = () => save().tour;
  it("finds every step as it was on the same code", () => {
    const r = replayTour(wt(), FILES);
    assert.deepEqual(
      r.states.map((s) => s.kind),
      ["same", "same"],
    );
    assert.equal(r.otherProject, false);
    assert.equal(r.tour.title, "How a task gets created");
    assert.equal(r.tour.steps[0].note, undefined);
    assert.deepEqual(r.tour.steps[0].node_ids, []);
  });
  it("finds lines that moved, and says so", () => {
    const moved = { ...FILES, "app/api/tasks/route.ts": `// a comment\n// and another\n${ROUTE}` };
    const r = replayTour(wt(), moved);
    assert.deepEqual(r.states[0], { kind: "moved", start: 5, end: 8 });
    assert.equal(r.tour.steps[0].start_line, 5);
    assert.equal(r.tour.steps[0].end_line, 8);
    assert.match(r.tour.steps[0].note!, /changed since this tour was made.*were at lines 3–6, and are now at lines 5–8/);
    assert.equal(r.changed, 1);
  });
  it("says plainly when the lines themselves changed", () => {
    const edited = { ...FILES, "app/api/tasks/route.ts": ROUTE.replace("const body", "const input") };
    const r = replayTour(wt(), edited);
    assert.equal(r.states[0].kind, "changed");
    assert.match(r.tour.steps[0].note!, /changed since this tour was made: lines 3–6 are no longer/);
    assert.equal(r.tour.steps[0].start_line, 3);
  });
  it("without excerpts notices a change but can't follow a move", () => {
    const r = replayTour(save({ lines: false }).tour, { ...FILES, "app/api/tasks/route.ts": `\n\n${ROUTE}` });
    assert.equal(r.states[0].kind, "changed");
  });
  it("names a file that is missing, and calls a tour with most files missing another project's", () => {
    const one = replayTour(wt(), { ...FILES, "lib/tasks.ts": undefined as unknown as string });
    assert.equal(one.states[1].kind, "missing");
    assert.match(one.tour.steps[1].note!, /lib\/tasks\.ts isn't in the open project/);
    assert.equal(one.otherProject, false, "one of two files is not most");
    const none = replayTour(wt(), { "README.md": "# hi" });
    assert.equal(none.otherProject, true);
    assert.match(otherProjectNote(wt(), "shop"), /made on “team-tasks”, not shop/);
  });
  it("keeps cards' ids for the map and the recording for the player", () => {
    const t = save({ cards: () => [{ id: "route:x", name: "x" }], clips: [{ type: "audio/webm", base64: "AAAA" }] }).tour;
    const r = replayTour(t, FILES);
    assert.deepEqual(r.tour.steps[0].node_ids, ["route:x"]);
    assert.deepEqual(r.tour.steps[0].clip, { type: "audio/webm", base64: "AAAA" });
    assert.equal(r.tour.steps[1].clip, undefined);
  });
  it("checkStep reads redacted config the same on both sides", () => {
    const t = buildWalkTour({ title: "c", steps: [{ say: "db", file: "docker-compose.yml", start_line: 1, end_line: 4, node_ids: [] }] }, FILES, { name: "c", created: "2026-11-17", lines: true }).tour;
    assert.equal(checkStep(t.steps[0], FILES).kind, "same");
  });
});

describe("findExcerpt", () => {
  it("finds an exact block, the one nearest where it was", () => {
    const text = ["x", "a", "b", "y", "a", "b"].join("\n");
    assert.equal(findExcerpt(text, "a\nb", 1), 2);
    assert.equal(findExcerpt(text, "a\nb", 6), 5);
  });
  it("ignores trailing spaces and line endings, and counts leading blank lines", () => {
    assert.equal(findExcerpt("q\r\n\r\na  \r\nb", "\na\nb", 1), 2);
  });
  it("finds nothing for blank or absent lines", () => {
    assert.equal(findExcerpt("a\nb", "  \n", 1), null);
    assert.equal(findExcerpt("a\nb", "c", 1), null);
  });
});

describe("walkTourMarkdown", () => {
  it("has a heading per step, the file:line, the lines in fenced code and the narration", () => {
    const md = walkTourMarkdown(save().tour);
    assert.match(md, /^# How a task gets created\n\nA tour of \*\*team-tasks\*\* in 2 steps, made on 2026-11-17 with WalkMyCode\.\n/);
    assert.match(md, /## 1\. The route takes the request\n\n`app\/api\/tasks\/route\.ts:3–6`\n\n```ts\nexport async function POST/);
    assert.match(md, /```\n\nThe route takes the request\. It reads the body first\.\n/);
    assert.match(md, /## 2\. createTask saves it\n/);
    assert.ok(md.endsWith("createTask saves it.\n"));
  });
  it("uses a longer fence when the code holds backticks, and no fence without lines", () => {
    const t = buildWalkTour({ title: "t", steps: [{ say: "Templates.", file: "a.js", start_line: 1, end_line: 1, node_ids: [] }] }, { "a.js": "const s = ```x```;" }, { name: "t", created: "2026-11-17", lines: true }).tour;
    assert.match(walkTourMarkdown(t), /````js\nconst s = ```x```;\n````/);
    assert.ok(!walkTourMarkdown(save({ lines: false }).tour).includes("```"));
  });
});

describe("names", () => {
  it("stepTitle takes the first sentence, kept short", () => {
    assert.equal(stepTitle("The form. Then more.", "a.ts"), "The form");
    assert.equal(stepTitle("", "app/page.tsx"), "page.tsx");
    const long = stepTitle("This sentence keeps on going far past the point where a heading should have stopped talking", "a.ts");
    assert.ok(long.length <= 65 && long.endsWith("…"));
  });
  it("tourFileName makes a tidy file name", () => {
    assert.equal(tourFileName("How a task gets created!", "tour"), "how-a-task-gets-created.walktour");
    assert.equal(tourFileName("  ", "markdown"), "tour.md");
  });
});

// A WalkTour literal type-checks as the file's shape (the zod schema's).
const _shape: WalkTour = { format: "walktour", version: 1, name: "n", created: "2026-11-17", steps: [{ file: "a.ts", lines: [1, 1], text: "", hash: hashExcerpt("") }] };
void _shape;
