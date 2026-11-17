// "Tour a change" (docs/GIT.md): git's diff read into files and hunks (src/lib/diffParse.ts), laid over
// the map (src/lib/diffTour.ts), and the read-only git that fetches it (src/lib/localrun/git.ts:
// changeBases, change; the desktop app's POST /api/git/read). The git half runs on a real repo made
// from the example app, with a branch that gives tasks a due date, a new file not committed yet, a
// .env that must never show, and a repo that tries to make git start a program while it reads.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { buildMap } from "../src/analyzer/build";
import { readDir } from "../scripts/readDir";
import "./analyzer.helpers";
import { countLabel, cutDiff, dropSecrets, isRefName, isSecretPath, parseDiff, parseNumstat, type RangeChange } from "../src/lib/diffParse";
import { changeLit, editorMarks, marksFit, mergeStory, storyAsk, tourChange } from "../src/lib/diffTour";
import { createGit, readOnlyExec, type Exec } from "../src/lib/localrun/git";
import { gitReadHandler, type GitRead } from "../src/lib/localrun/gitRead";

const SAMPLE = `diff --git a/lib/tasks.ts b/lib/tasks.ts
index 1111111..2222222 100644
--- a/lib/tasks.ts
+++ b/lib/tasks.ts
@@ -20,5 +20,6 @@ export async function getTask(id: string) {
 /** A new task in a project. */
-export async function createTask(projectId: string, title: string) {
+export async function createTask(projectId: string, title: string, dueDate?: Date) {
   const task = await prisma.task.create({
-    data: { projectId, title },
+    data: { projectId, title, dueDate },
+    include: { assignee: true },
   });
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const a = 1;
-export const b = 2;
diff --git "a/odd name.ts" "b/odd name.ts"
new file mode 100644
--- /dev/null
+++ "b/odd name.ts"
@@ -0,0 +1 @@
+export const odd = true;
\\ No newline at end of file
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
diff --git a/.env b/.env
--- a/.env
+++ b/.env
@@ -1 +1 @@
-KEY=old-secret
+KEY=new-secret
`;

describe("reading a diff", () => {
  it("reads files, hunks and each line's number before and after", () => {
    const files = parseDiff(SAMPLE);
    assert.deepEqual(
      files.map((f) => [f.path, f.status, f.added, f.removed]),
      [
        ["lib/tasks.ts", "modified", 3, 2],
        ["old.ts", "deleted", 0, 2],
        ["odd name.ts", "added", 1, 0],
        ["logo.png", "binary", 0, 0],
      ],
    );
    const h = files[0].hunks[0];
    assert.deepEqual([h.oldStart, h.oldLines, h.newStart, h.newLines], [20, 5, 20, 6]);
    assert.deepEqual(
      h.lines.filter((l) => l.kind !== "ctx").map((l) => [l.kind, l.old ?? l.new]),
      [["del", 21], ["add", 21], ["del", 23], ["add", 23], ["add", 24]],
    );
    // The line about a missing newline is not a line of the file.
    assert.equal(files[2].hunks[0].lines.length, 1);
  });

  it("never lets a .env (or a key) through, but keeps .env.example", () => {
    assert.ok(!JSON.stringify(parseDiff(SAMPLE)).includes("secret"));
    assert.ok(!dropSecrets(SAMPLE).includes("secret"));
    assert.ok(dropSecrets(SAMPLE).includes("createTask"));
    for (const p of [".env", "app/.env.local", "certs/server.key", "config/secrets.yaml", "id_rsa"]) assert.ok(isSecretPath(p), p);
    for (const p of [".env.example", "lib/env.ts", "keys.ts"]) assert.ok(!isSecretPath(p), p);
    assert.deepEqual(parseNumstat("3\t1\tlib/a.ts\x00-\t-\tlogo.png\x002\t2\t.env\x00"), [
      { path: "lib/a.ts", added: 3, removed: 1 },
      { path: "logo.png", added: 0, removed: 0, binary: true },
    ]);
  });

  it("cuts a big diff where a file starts, and says so", () => {
    const big = `${SAMPLE}${SAMPLE}`;
    const c = cutDiff(big, SAMPLE.length + 10);
    assert.equal(c.cut, true);
    assert.ok(c.text.endsWith("\n") && big.startsWith(c.text));
    assert.equal(cutDiff(SAMPLE).cut, false);
  });

  it("only takes names that look like a branch: never an option, a range or a reflog", () => {
    for (const ok of ["main", "origin/main", "feat/due-dates", "release-1.2", "HEAD~1"]) assert.ok(isRefName(ok), ok);
    for (const bad of ["-x", "--output=/tmp/x", "main..feat", "a//b", "HEAD@{1}", "main~", "x.lock", "a b", "", "$(rm)", "feat/"]) assert.ok(!isRefName(bad), bad);
    assert.equal(countLabel(9, 4), "+9 −4");
    assert.equal(countLabel(3, 0), "+3");
    assert.equal(countLabel(0, 2), "−2");
  });
});

// ── on a real repo ──

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

describe("a change in the example app, from git", { skip: !hasGit && "git isn't installed" }, () => {
  let base = "";
  let root = "";
  let mark = "";
  let map: CodeMap;
  let files: Record<string, string> = {};
  const run = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: join(base, "gitconfig-none"), GIT_CONFIG_NOSYSTEM: "1" } }).toString();
  const edit = (path: string, from: string, to: string) => {
    const p = join(root, path);
    const s = readFileSync(p, "utf8");
    assert.ok(s.includes(from), `${path} has ${from}`);
    writeFileSync(p, s.replace(from, to));
  };
  const git = createGit(readOnlyExec());

  before(async () => {
    base = mkdtempSync(join(tmpdir(), "wmc-diff-"));
    writeFileSync(join(base, "gitconfig-none"), "");
    root = join(base, "team-tasks");
    cpSync(join(process.cwd(), "examples", "team-tasks"), root, { recursive: true });
    run("init", "-q", "-b", "main");
    run("config", "user.email", "ama@example.com");
    run("config", "user.name", "Ama Owusu");
    run("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".env.production"), "STRIPE_KEY=sk_live_old\n");
    run("add", "-A");
    run("commit", "-q", "-m", "Start");
    run("branch", "aaa-old");
    run("update-ref", "refs/remotes/origin/main", "HEAD");
    run("switch", "-q", "-c", "feat/due-dates");
    edit("prisma/schema.prisma", "  assigneeId String?\n", "  assigneeId String?\n  dueDate    DateTime?\n");
    edit("lib/tasks.ts", "export async function createTask(projectId: string, title: string, assigneeId?: string) {", "export async function createTask(projectId: string, title: string, assigneeId?: string, dueDate?: Date) {");
    edit("lib/tasks.ts", "    data: { projectId, title, assigneeId },\n", "    data: { projectId, title, assigneeId, dueDate },\n");
    edit("components/TaskCard.tsx", "  async function remove() {", "  const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null;\n\n  async function remove() {");
    writeFileSync(join(root, ".env.production"), "STRIPE_KEY=sk_live_new\n");
    run("commit", "-q", "-am", "Tasks get a due date");
    // Not committed yet: a new file, and a .env that must never show.
    writeFileSync(join(root, "lib", "due.ts"), "/** Whether a task is late. */\nexport const late = (d: Date) => d < new Date();\n");
    writeFileSync(join(root, ".env"), "SECRET=hunter2\n");
    // A repo that tries to make git start a program while it only reads.
    mark = join(base, "ran").replace(/\\/g, "/");
    writeFileSync(join(root, ".git", "info", "attributes"), "*.ts diff=evil\n*.prisma diff=evil\n");
    run("config", "diff.evil.textconv", `sh -c 'echo textconv > "${mark}"; cat "$1"' -`);
    run("config", "diff.external", `sh -c 'echo external > "${mark}"'`);
    run("config", "core.fsmonitor", `sh -c 'echo fsmonitor > "${mark}"'`);
    const sources = await readDir(root);
    files = Object.fromEntries(sources.map((s) => [s.path, s.content]));
    map = (await buildMap(sources, { name: "team-tasks" })).map;
  });

  after(() => rmSync(base, { recursive: true, force: true }));

  it("lists what a change can be toured against: the branch it is on, the others, the last commit", async () => {
    const b = await git.changeBases(root);
    assert.ok(!("error" in b));
    assert.equal(b.current, "feat/due-dates");
    // The usual base first, then its remote, then the other branches; the last commit at the end.
    assert.deepEqual(b.bases, ["main", "origin/main", "aaa-old", "HEAD~1"]);
  });

  it("reads the branch against main, new files included, with no secret in it", async () => {
    const c = (await git.change(root, "main")) as RangeChange;
    assert.ok(!("error" in c));
    assert.equal(c.head, "feat/due-dates");
    assert.deepEqual(c.files.map((f) => [f.path, f.added, f.removed]).sort(), [
      ["components/TaskCard.tsx", 2, 0],
      ["lib/due.ts", 2, 0],
      ["lib/tasks.ts", 2, 2],
      ["prisma/schema.prisma", 1, 0],
    ]);
    assert.ok(!/sk_live|hunter2|STRIPE|SECRET/.test(c.diff), "no secret in the diff");
    assert.ok(c.diff.includes("+  dueDate    DateTime?"), "the real text, not a converted one");
    assert.equal(existsSync(mark), false, "git started no program of the repo's");
  });

  it("reads only what isn't committed when there's no base", async () => {
    const c = (await git.change(root, null)) as RangeChange;
    assert.deepEqual(c.files.map((f) => f.path), ["lib/due.ts"]);
    assert.equal(c.base, null);
  });

  it("refuses a base that is an option, a range or no commit, and never runs it", async () => {
    for (const bad of ["--output=" + join(base, "out.txt"), "-p", "main..HEAD", "HEAD@{0}", "nope"]) {
      const r = await git.change(root, bad);
      assert.ok("error" in r, bad);
    }
    assert.equal(existsSync(join(base, "out.txt")), false);
  });

  it("runs every read with no file-system monitor, and diff with no text conversion or external program", async () => {
    const seen: string[][] = [];
    const sha = "a".repeat(40);
    const spy = createGit(readOnlyExec(async (args) => (seen.push(args), { code: 0, stdout: args.includes("rev-parse") || args.includes("merge-base") ? sha : args.includes("ls-files") ? "lib/new.ts\0" : "", stderr: "" })));
    await spy.change(root, "main");
    assert.ok(seen.length > 0);
    for (const a of seen) assert.deepEqual(a.slice(0, 2), ["-c", "core.fsmonitor=false"], a.join(" "));
    // Each diff reads the working tree: the repo's filter drivers are looked up first (tests/gitFilters.test.ts).
    for (const [i, a] of seen.entries()) if (a[2] === "diff") assert.deepEqual(seen[i - 1].slice(2), ["config", "--null", "--get-regexp", "^filter\\."]);
    const diffs = seen.filter((a) => a[2] === "diff");
    assert.ok(diffs.length > 0);
    for (const a of diffs) assert.deepEqual(a.slice(3, 5), ["--no-textconv", "--no-ext-diff"], a.join(" "));
  });

  it("marks the changed cards, finds what uses them, and walks from the table up to the screen", async () => {
    const raw = (await git.change(root, "main")) as RangeChange;
    const t = tourChange(map, files, raw);
    assert.equal(t.label, "feat/due-dates → main");
    assert.deepEqual(t.totals, { files: 4, added: 7, removed: 2 });
    // Data, then logic, then the screen.
    assert.deepEqual(t.plan.steps.map((s) => s.file), ["prisma/schema.prisma", "lib/due.ts", "lib/tasks.ts", "components/TaskCard.tsx"]);
    assert.ok(t.plan.changed.has("table:task"), "the Task table changed");
    assert.ok(!t.plan.changed.has("table:user"), "the User table did not");
    assert.equal(t.plan.steps[0].title, "task table");
    const tasks = t.plan.steps.find((s) => s.file === "lib/tasks.ts")!;
    assert.deepEqual(tasks.fns, ["createTask"]);
    assert.deepEqual([tasks.start, tasks.end], [21, 23]);
    assert.match(tasks.say, /lib\/tasks\.ts: 2 lines added and 2 lines taken out, in createTask \(lines 21 to 23\)\. On the map: /);
    // Not changed, but uses what changed: the task routes call lib/tasks.ts; lib/tasks.ts writes the Task table.
    const affected = t.plan.affected.map((a) => a.id);
    assert.ok(affected.some((id) => id.startsWith("route:app/api/projects/[id]/tasks/route.ts")), affected.join(", "));
    assert.ok(!affected.some((id) => t.plan.changed.has(id)));
    // The tour the player plays: one step per file, its lines and cards.
    assert.equal(t.tour.change, t.label);
    assert.deepEqual(t.tour.steps.map((s) => [s.file, s.start_line]), t.plan.steps.map((s) => [s.file, s.start]));
    // The map: changed cards with their count, the affected ones, the step's own.
    const lit = changeLit(map, t.plan, t.tour.steps[2].node_ids);
    assert.equal(lit.change?.changed.get("file:lib/tasks.ts"), "+2 −2");
    assert.ok(lit.change?.affected.has(t.plan.affected[0].id));
    assert.ok(lit.nodes.has("file:lib/tasks.ts") && lit.change?.now.has("file:lib/tasks.ts"));
    assert.ok(lit.edges.has(t.plan.affected[0].via.id));
  });

  it("marks the editor's lines, and only when the file is the one the diff was made from", async () => {
    const raw = (await git.change(root, "main")) as RangeChange;
    const t = tourChange(map, files, raw);
    const f = t.files.find((x) => x.path === "lib/tasks.ts")!;
    const m = editorMarks(f);
    assert.deepEqual(m.added, [21, 23]);
    assert.deepEqual(m.removed, [
      { at: 21, lines: ["export async function createTask(projectId: string, title: string, assigneeId?: string) {"] },
      { at: 23, lines: ["    data: { projectId, title, assigneeId },"] },
    ]);
    assert.equal(marksFit(f, files["lib/tasks.ts"]), true);
    assert.equal(marksFit(f, files["lib/tasks.ts"].replace("dueDate?: Date", "due?: Date")), false);
  });

  it("asks the guide for a story grounded in the diff, and lays its words onto the steps", async () => {
    const raw = (await git.change(root, "main")) as RangeChange;
    const t = tourChange(map, files, raw);
    const q = storyAsk(t, map);
    assert.match(q, /exactly 4 steps/);
    assert.match(q, /\+21\| export async function createTask/);
    assert.match(q, /cite each as path:line/);
    assert.ok(!/sk_live|hunter2/.test(q));
    const told = mergeStory(t.tour, {
      title: "x",
      steps: [
        { say: "createTask now takes a due date.", file: "lib/tasks.ts", start_line: 1, end_line: 2, node_ids: [] },
        { say: "The table gets a column.", file: "prisma/schema.prisma", start_line: 1, end_line: 2, node_ids: [] },
      ],
    });
    assert.equal(told.told, true);
    assert.equal(told.steps[0].say, "The table gets a column.");
    assert.equal(told.steps[0].start_line, t.tour.steps[0].start_line, "the lines stay the change's own");
    assert.equal(told.steps[2].say, "createTask now takes a due date.");
    assert.equal(told.steps[1].say, t.tour.steps[1].say, "a step the guide skipped keeps its facts");
  });

  it("is in the desktop app's read-only route: bases and change, nothing else, and only there", async () => {
    const DESKTOP = { WALKMYCODE_DESKTOP: "0.1.14" };
    const ask = (body: unknown, env: Record<string, string | undefined> = DESKTOP, exec?: Exec) =>
      gitReadHandler({ env, ...(exec ? { exec } : {}) })(new Request("http://localhost/api/git/read", { method: "POST", body: JSON.stringify(body) }));
    const b = (await (await ask({ op: "bases", folder: root })).json()) as GitRead;
    assert.equal(b.bases?.current, "feat/due-dates");
    const c = (await (await ask({ op: "change", folder: root, base: "main" })).json()) as GitRead;
    assert.equal(c.change?.files.length, 4);
    const bad = (await (await ask({ op: "change", folder: root, base: "--output=x" })).json()) as GitRead;
    assert.equal(bad.ok, false);
    assert.equal(bad.change, undefined);
    assert.equal((await ask({ op: "change", folder: root, base: "main" }, {})).status, 403);
    assert.equal((await ask({ op: "change", folder: root, base: "main", path: "x" })).status, 400);
    assert.equal((await ask({ op: "change", folder: root })).status, 400);
    assert.equal((await ask({ op: "bases", folder: "relative/path" })).status, 400);
    assert.equal(existsSync(mark), false);
  });
});
