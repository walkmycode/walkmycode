// The desktop app's read-only git (src/lib/localrun/gitRead.ts, POST /api/git/read): blame, the
// file's commits, one line's history, Hotspots' churn, and "Tour a change" (the bases a change can be
// measured against, and the change) without "run code on this computer", from the folder the app
// opened. Only in the desktop app, only those ops, only inside the folder, line numbers only inside the
// file, churn only over a fixed span and a limited number of commits, and git never told to start a
// program because of the repo's own settings. The change itself, on a real repo, is in
// tests/diffTour.test.ts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CHURN_MAX_COMMITS } from "../src/lib/hotspots";
import { createGit, runGit, type Exec } from "../src/lib/localrun/git";
import { DESKTOP_ONLY, gitReadHandler, readOnlyExec, type GitRead } from "../src/lib/localrun/gitRead";

let base = "";
let root = "";
const DESKTOP = { WALKMYCODE_DESKTOP: "0.1.12" };

const run = (args: string[], date?: string) =>
  execFileSync("git", args, {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(base, "gitconfig-none"),
      GIT_CONFIG_NOSYSTEM: "1",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  }).toString();

const ask = (body: unknown, env: Record<string, string | undefined> = DESKTOP, exec?: Exec) =>
  gitReadHandler({ env, ...(exec ? { exec } : {}) })(new Request("http://localhost/api/git/read", { method: "POST", body: JSON.stringify(body) }));

before(() => {
  base = mkdtempSync(join(tmpdir(), "wmc-gitread-"));
  writeFileSync(join(base, "gitconfig-none"), "");
  root = join(base, "app");
  mkdirSync(join(root, "src"), { recursive: true });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "ama@example.com"]);
  run(["config", "user.name", "Ama Owusu"]);
  run(["config", "core.autocrlf", "false"]);
  writeFileSync(join(root, "src", "main.rs"), "fn main() {}\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "Start"], "2026-11-02T09:14:00+00:00");
  writeFileSync(join(base, "outside.txt"), "not in the folder\n");
  // Hotspots: a second person's file, later renamed by the first.
  writeFileSync(join(root, "src", "lib.rs"), "pub fn add() {}\n");
  run(["add", "-A"]);
  run(["-c", "user.name=Kofi Mensah", "-c", "user.email=kofi@example.com", "commit", "-q", "-m", "Add lib"], "2026-11-03T09:14:00+00:00");
  run(["mv", "src/lib.rs", "src/core.rs"]);
  run(["commit", "-q", "-m", "Rename lib to core"], "2026-11-04T09:14:00+00:00");
  // A folder outside any repo, for "not a git repo".
  mkdirSync(join(base, "plain"));
  // A line with a past: made, fixed in a PR, then left alone while the line below it changed.
  writeFileSync(join(root, "src", "tasks.ts"), "export function createTask(id) {\n  notify(id);\n  return id;\n}\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "Notify people when they get a task"], "2026-03-04T14:30:00+00:00");
  writeFileSync(join(root, "src", "tasks.ts"), "export function createTask(id) {\n  notify(lookUp(id).email);\n  return id;\n}\n");
  run(["commit", "-q", "-am", "Send the address, not the id (#12)"], "2026-06-12T09:00:00+00:00");
  writeFileSync(join(root, "src", "tasks.ts"), "export function createTask(id) {\n  notify(lookUp(id).email);\n  return { id };\n}\n");
  run(["commit", "-q", "-am", "Return the task"], "2026-08-20T10:00:00+00:00");
  run(["remote", "add", "origin", "https://github.com/acme/tasks.git"]);
  writeFileSync(join(root, "src", "new.ts"), "not committed\n");
});

after(() => rmSync(base, { recursive: true, force: true }));

describe("read-only line history in the desktop app", () => {
  it("gives blame and the file's commits for a file in the opened folder", async () => {
    const b = (await (await ask({ op: "blame", folder: root, path: "src/main.rs" })).json()) as GitRead;
    assert.equal(b.ok, true);
    assert.equal(b.located, true);
    assert.equal(b.me, "ama@example.com");
    assert.equal(b.blame?.[0]?.author, "Ama Owusu");
    const h = (await (await ask({ op: "file-log", folder: root, path: "src/main.rs" })).json()) as GitRead;
    assert.equal(h.ok, true);
    assert.deepEqual(h.history?.map((c) => c.subject), ["Start"]);
  });

  it("is refused outside the desktop app, and in hosted mode", async () => {
    const r = await ask({ op: "blame", folder: root, path: "src/main.rs" }, {});
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { error: string }).error, DESKTOP_ONLY);
    assert.equal((await ask({ op: "blame", folder: root, path: "src/main.rs" }, { ...DESKTOP, WALKMYCODE_MODE: "hosted" })).status, 403);
    assert.equal((await ask({ op: "change", folder: root, base: null }, {})).status, 403);
    assert.equal((await ask({ op: "bases", folder: root }, { ...DESKTOP, WALKMYCODE_MODE: "hosted" })).status, 403);
  });

  it("tours a change: the bases, and the change against one, read-only", async () => {
    const b = (await (await ask({ op: "bases", folder: root })).json()) as GitRead;
    // One branch, several commits: only "the commit before" to measure against.
    assert.deepEqual(b.bases, { current: "main", bases: ["HEAD~1"] });
    writeFileSync(join(root, "src", "main.rs"), 'fn main() {\n    println!("hi");\n}\n');
    const c = (await (await ask({ op: "change", folder: root, base: null })).json()) as GitRead;
    // The new file a line's history test leaves uncommitted (above) is part of the change too.
    assert.deepEqual(c.change?.files, [{ path: "src/main.rs", added: 3, removed: 1 }, { path: "src/new.ts", added: 1, removed: 0 }]);
    run(["checkout", "--", "src/main.rs"]);
    // A base must look like a branch and be a commit git knows: never an option.
    for (const base of ["--output=x", "-p", "main..HEAD", "nope"]) {
      const r = (await (await ask({ op: "change", folder: root, base })).json()) as GitRead;
      assert.equal(r.ok, false, base);
    }
    // Not a git folder: said plainly.
    const none = (await (await ask({ op: "bases", folder: base })).json()) as GitRead;
    assert.deepEqual([none.ok, none.located], [false, false]);
  });

  it("does only blame, file-log, bases and change: never status, commit, push or anything else", async () => {
    for (const op of ["status", "commit", "push", "pull", "discard", "diff"]) {
      assert.equal((await ask({ op, folder: root, path: "src/main.rs" })).status, 400, op);
    }
    assert.equal((await ask({ op: "blame", folder: root, path: "src/main.rs", extra: 1 })).status, 400);
    assert.equal((await ask({ op: "change", folder: root, base: null, path: "src/main.rs" })).status, 400);
    assert.equal((await ask({ op: "change", folder: root, base: "x".repeat(201) })).status, 400);
  });

  it("never reads outside the folder, and needs a real folder", async () => {
    for (const path of ["../outside.txt", "src/../../outside.txt", "..\\outside.txt"]) {
      const r = (await (await ask({ op: "blame", folder: root, path })).json()) as GitRead;
      assert.equal(r.located, false, path);
      assert.equal(r.blame, undefined, path);
    }
    assert.equal((await ask({ op: "blame", folder: "src", path: "main.rs" })).status, 400);
    assert.equal((await ask({ op: "blame", folder: join(base, "missing"), path: "a.rs" })).status, 400);
  });

  it("gives a line's history: its commits, newest first, with the PR and what each changed", async () => {
    const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 2, to: 2 })).json()) as GitRead;
    assert.equal(r.ok, true, r.output);
    assert.equal(r.located, true);
    assert.deepEqual(r.story?.changes.map((c) => c.subject), ["Send the address, not the id (#12)", "Notify people when they get a task"]);
    assert.equal(r.story?.changes[0].pr, "12");
    assert.deepEqual(r.story?.changes[0].removed, ["  notify(id);"]);
    assert.deepEqual(r.story?.changes[0].added, ["  notify(lookUp(id).email);"]);
    assert.equal(r.story?.web, "https://github.com/acme/tasks");
    assert.equal(r.story?.cut, false);
    // The whole function, by name: all three commits touched it.
    const f = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", func: "createTask" })).json()) as GitRead;
    assert.equal(f.ok, true, f.output);
    assert.equal(f.story?.changes.length, 3);
    // A file not committed yet: a plain message, not an error.
    const n = (await (await ask({ op: "line-log", folder: root, path: "src/new.ts", from: 1 })).json()) as GitRead;
    assert.equal(n.ok, false);
    assert.match(n.output ?? "", /isn't in git yet/);
  });

  it("takes only whole line numbers inside the file, or a plain function name", async () => {
    for (const bad of [{ from: 0 }, { from: -1 }, { from: 1.5 }, { from: "2" }, { from: 2, to: "3" }, {}, { to: 2 }, { from: 2, func: "createTask" }, { func: "" }, { func: 3 }]) {
      assert.equal((await ask({ op: "line-log", folder: root, path: "src/tasks.ts", ...bad })).status, 400, JSON.stringify(bad));
    }
    // Past the end of the file, or backwards: git is never asked.
    for (const range of [{ from: 5 }, { from: 99, to: 99 }, { from: 3, to: 2 }]) {
      const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", ...range })).json()) as GitRead;
      assert.equal(r.ok, false, JSON.stringify(range));
      assert.equal(r.story, undefined);
    }
    // A name git would read as more than a name.
    for (const func of ["create.*", "a:b", "-x", "x y", "^createTask", "../x"]) {
      const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", func })).json()) as GitRead;
      assert.equal(r.ok, false, func);
    }
    // Line numbers and names belong to line-log only.
    assert.equal((await ask({ op: "blame", folder: root, path: "src/tasks.ts", from: 2 })).status, 400);
  });

  it("never reads a line's history outside the folder, and only in the desktop app", async () => {
    for (const path of ["../outside.txt", "src/../../outside.txt", "..\\outside.txt"]) {
      const r = (await (await ask({ op: "line-log", folder: root, path, from: 1 })).json()) as GitRead;
      assert.equal(r.located, false, path);
      assert.equal(r.story, undefined, path);
    }
    assert.equal((await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 1 }, {})).status, 403);
    assert.equal((await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 1 }, { ...DESKTOP, WALKMYCODE_MODE: "hosted" })).status, 403);
  });

  it("runs a line's log with no file-system monitor, no text conversion, a limit and a time limit", async () => {
    const seen: { args: string[]; ms: number }[] = [];
    const fake: Exec = async (args, _cwd, ms) => {
      seen.push({ args, ms });
      if (args.includes("rev-parse")) return { code: 0, stdout: `${root}\nsrc/\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 2 }, DESKTOP, fake)).json()) as GitRead;
    assert.equal(r.ok, true);
    const log = seen.find((s) => s.args.includes("log"))!;
    assert.deepEqual(log.args.slice(0, 2), ["-c", "core.fsmonitor=false"]);
    assert.ok(log.args.includes("--no-textconv"));
    assert.ok(log.args.some((a) => /^-n\d+$/.test(a)));
    assert.deepEqual(log.args.slice(-2), ["-L", "2,2:src/tasks.ts"]);
    assert.ok(log.ms > 0 && log.ms <= 60_000);
    // Every git it runs, not only the log, has no file-system monitor.
    assert.ok(seen.every((s) => s.args[0] === "-c" && s.args[1] === "core.fsmonitor=false"));
  });

  it("follows a line pushed down by uncommitted lines above it: its own history, from blame's commit and line", async () => {
    const file = join(root, "src", "tasks.ts");
    const committed = readFileSync(file, "utf8");
    // Three new lines at the top, not committed: "  notify(lookUp(id).email);" is now line 5, not 2.
    writeFileSync(file, `// one\n// two\n// three\n${committed}`);
    try {
      const b = (await (await ask({ op: "blame", folder: root, path: "src/tasks.ts" })).json()) as GitRead;
      const h = b.blame!.find((x) => x.start <= 5 && 5 < x.start + x.lines)!;
      assert.ok(h.sha && h.orig, "blame keeps the commit and the line's number in it");
      const orig = h.orig![5 - h.start];
      assert.equal(orig, 2);
      const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: orig, at: h.sha })).json()) as GitRead;
      assert.equal(r.ok, true, r.output);
      assert.deepEqual(r.story?.changes.map((c) => c.subject), ["Send the address, not the id (#12)", "Notify people when they get a task"]);
      assert.equal(r.story?.changes[0].added[0], "  notify(lookUp(id).email);");
      assert.equal(r.story?.changed, true);
      // Line 5 as the file on disk numbers it is another line of the last commit: refused, not followed.
      const drift = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 5 })).json()) as GitRead;
      assert.equal(drift.ok, false);
      assert.match(drift.output ?? "", /not committed/);
      assert.equal(drift.story, undefined);
      // The lines are checked against the file as that commit has it (4 lines), not the one on disk (7).
      const past = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 6, at: h.sha })).json()) as GitRead;
      assert.equal(past.ok, false);
      assert.match(past.output ?? "", /only 4 lines in that commit/);
      // A function by name doesn't depend on line numbers: still followed.
      const f = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", func: "createTask" })).json()) as GitRead;
      assert.equal(f.ok, true, f.output);
    } finally {
      writeFileSync(file, committed);
    }
  });

  it("takes a commit only as a real commit's hash: never an option, a ref expression or a branch", async () => {
    for (const at of ["-x", "--all", "HEAD~1", "HEAD", "main", "c31d7c", "abc1234^{tree}", 7]) {
      assert.equal((await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 2, at })).status, 400, String(at));
    }
    // A commit without a line, or with another op: refused.
    assert.equal((await ask({ op: "line-log", folder: root, path: "src/tasks.ts", func: "createTask", at: "abc1234" })).status, 400);
    assert.equal((await ask({ op: "blame", folder: root, path: "src/tasks.ts", at: "abc1234" })).status, 400);
    // Hex that is no commit in this repo: git says so, and nothing is logged.
    for (const at of ["deadbee", "0".repeat(40)]) {
      const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 2, at })).json()) as GitRead;
      assert.equal(r.ok, false, at);
      assert.match(r.output ?? "", /isn't in this repo/, at);
    }
    // The same checks hold where there is no route to check first (the local-run socket calls git.lineLog).
    const seen: string[][] = [];
    const git = createGit(async (args, cwd, ms) => {
      seen.push(args);
      return runGit(args, cwd, ms);
    });
    for (const at of ["-x", "HEAD~1", "main"]) {
      const r = await git.lineLog(root, "src/tasks.ts", { from: 2, to: 2, at });
      assert.deepEqual(r, { ok: false, output: "That isn't a commit." }, at);
    }
    assert.ok(!seen.some((a) => a.some((x) => /^(-x|HEAD~1|main)/.test(x))), "never handed to git");
  });

  it("starts a line's log at the commit, after --end-of-options, and reads the file from that commit", async () => {
    const seen: string[][] = [];
    const rec: Exec = async (args, cwd, ms) => {
      seen.push(args);
      return runGit(args, cwd, ms);
    };
    const sha = run(["rev-parse", "HEAD~1"]).trim();
    const r = (await (await ask({ op: "line-log", folder: root, path: "src/tasks.ts", from: 2, at: sha.slice(0, 7) }, DESKTOP, rec)).json()) as GitRead;
    assert.equal(r.ok, true, r.output);
    assert.deepEqual(r.story?.changes.map((c) => c.hash), [sha.slice(0, 7), run(["rev-parse", "--short=7", "HEAD~2"]).trim()]);
    const verify = seen.find((a) => a.includes("rev-parse") && a.includes("--verify"))!;
    assert.deepEqual(verify.slice(-3), ["--quiet", "--end-of-options", `${sha.slice(0, 7)}^{commit}`]);
    assert.ok(seen.some((a) => a.includes("cat-file") && a.includes(`${sha}:src/tasks.ts`)), "the file as that commit has it");
    const log = seen.find((a) => a.includes("log"))!;
    assert.deepEqual(log.slice(-4), ["-L", "2,2:src/tasks.ts", "--end-of-options", sha]);
    assert.ok(log.includes("--no-textconv"));
    assert.ok(seen.every((a) => a[0] === "-c" && a[1] === "core.fsmonitor=false"));
  });

  it("follows a real line of this repo (line 1 of src/lib/store.ts), when the tests run in a clone", async (t) => {
    // As the page does it: blame says which commit last changed line 1, and its number there.
    const b = (await (await ask({ op: "blame", folder: process.cwd(), path: "src/lib/store.ts" })).json()) as GitRead;
    if (!b.located || !b.blame?.[0]?.sha) return t.skip("not a git clone");
    const r = (await (await ask({ op: "line-log", folder: process.cwd(), path: "src/lib/store.ts", from: b.blame[0].orig![0], at: b.blame[0].sha })).json()) as GitRead;
    assert.equal(r.ok, true, r.output);
    assert.ok((r.story?.changes.length ?? 0) >= 1);
    assert.ok(r.story?.changes.some((c) => c.added.includes('"use client";')));
  });

  it("runs git with no file-system monitor, blame with no text conversion, diff with neither nor an external program", async () => {
    const seen: string[][] = [];
    const exec = readOnlyExec(async (args) => {
      seen.push(args);
      // No filter driver set up: git config --get-regexp finds nothing.
      return { code: args.includes("--get-regexp") ? 1 : 0, stdout: "", stderr: "" };
    });
    await exec(["blame", "--porcelain", "--", "a.rs"], ".", 1000);
    await exec(["log", "-n1", "--", "a.rs"], ".", 1000);
    await exec(["diff", "--numstat", "abc", "--"], ".", 1000);
    const filters = ["-c", "core.fsmonitor=false", "config", "--null", "--get-regexp", "^filter\\."];
    assert.deepEqual(seen, [
      filters,
      ["-c", "core.fsmonitor=false", "blame", "--no-textconv", "--porcelain", "--", "a.rs"],
      ["-c", "core.fsmonitor=false", "log", "-n1", "--", "a.rs"],
      filters,
      ["-c", "core.fsmonitor=false", "diff", "--no-textconv", "--no-ext-diff", "--numstat", "abc", "--"],
    ]);
  });

  it("switches off each filter driver the repo's config names before a read of the working tree", async () => {
    const seen: string[][] = [];
    const exec = readOnlyExec(async (args) => {
      seen.push(args);
      return args.includes("--get-regexp") ? { code: 0, stdout: "filter.lfs.clean\ngit-lfs clean -- %f\0filter.Evil.process\nsh -c x\0", stderr: "" } : { code: 0, stdout: "", stderr: "" };
    });
    await exec(["diff", "HEAD", "--"], ".", 1000);
    const off = (n: string) => ["-c", `filter.${n}.clean=`, "-c", `filter.${n}.smudge=`, "-c", `filter.${n}.process=`, "-c", `filter.${n}.required=false`];
    assert.deepEqual(seen[1], ["-c", "core.fsmonitor=false", ...off("lfs"), ...off("Evil"), "diff", "--no-textconv", "--no-ext-diff", "HEAD", "--"]);
    // Guarding a guarded exec again changes nothing.
    assert.equal(readOnlyExec(exec), exec);
  });
});

describe("Hotspots' churn, read-only", () => {
  it("counts each file's changes and people over all of the history, following a rename", async () => {
    const r = (await (await ask({ op: "churn", folder: root, span: "all" })).json()) as GitRead;
    assert.equal(r.ok, true);
    // Three commits for Hotspots, and the three of a line's history (src/tasks.ts) above.
    assert.equal(r.churn?.commits, 6);
    assert.deepEqual(r.churn?.files["src/main.rs"], { changes: 1, authors: 1 });
    assert.deepEqual(r.churn?.files["src/tasks.ts"], { changes: 3, authors: 1 });
    assert.deepEqual(r.churn?.files["src/core.rs"], { changes: 2, authors: 2 });
    assert.equal(r.churn?.files["src/lib.rs"], undefined);
  });

  it("gives paths from the folder opened, and only that folder's files", async () => {
    const r = (await (await ask({ op: "churn", folder: join(root, "src"), span: "all" })).json()) as GitRead;
    assert.deepEqual(Object.keys(r.churn?.files ?? {}).sort(), ["core.rs", "main.rs", "tasks.ts"]);
  });

  it("only over the fixed spans: never a date, a range or anything git would read as an option", async () => {
    for (const span of ["7", "2026-01-01", "--all", "90 days", "", 90, null]) {
      assert.equal((await ask({ op: "churn", folder: root, span })).status, 400, String(span));
    }
    assert.equal((await ask({ op: "churn", folder: root, span: "90", path: "src/main.rs" })).status, 400);
    assert.equal((await ask({ op: "churn", folder: root })).status, 400);
  });

  it("is refused outside the desktop app and in hosted mode, and needs a real folder", async () => {
    assert.equal((await ask({ op: "churn", folder: root, span: "90" }, {})).status, 403);
    assert.equal((await ask({ op: "churn", folder: root, span: "90" }, { ...DESKTOP, WALKMYCODE_MODE: "hosted" })).status, 403);
    assert.equal((await ask({ op: "churn", folder: "src", span: "90" })).status, 400);
    assert.equal((await ask({ op: "churn", folder: join(base, "missing"), span: "90" })).status, 400);
  });

  it("says plainly when the folder isn't a git repo", async () => {
    const r = (await (await ask({ op: "churn", folder: join(base, "plain"), span: "all" })).json()) as GitRead;
    assert.equal(r.ok, false);
    assert.equal(r.located, false);
    assert.match(r.output ?? "", /isn't a git repo/);
  });

  it("runs git with no file-system monitor, text conversion, outside diff or signature check, a commit limit, a time limit and the span's date", async () => {
    const seen: { args: string[]; ms: number }[] = [];
    const exec: Exec = async (args, _cwd, ms) => {
      seen.push({ args, ms });
      return { code: 0, stdout: args.includes("rev-parse") ? "/repo\n" : "", stderr: "" };
    };
    const before = Date.now();
    await (await ask({ op: "churn", folder: root, span: "90" }, DESKTOP, exec)).json();
    const log = seen.find((s) => s.args.includes("log"))!;
    assert.deepEqual(log.args.slice(0, 2), ["-c", "core.fsmonitor=false"]);
    for (const flag of ["--no-textconv", "--no-ext-diff", "--no-show-signature", "--no-merges", "--relative", `-n${CHURN_MAX_COMMITS + 1}`]) assert.ok(log.args.includes(flag), flag);
    assert.ok(log.ms <= 30_000);
    const since = log.args.find((a) => a.startsWith("--since="))!;
    const days = (before - Date.parse(since.slice(8))) / 86_400_000;
    assert.ok(days > 89.9 && days < 90.1, since);
    assert.deepEqual(log.args.slice(-2), ["--", "."]);
    // All of the history: no date at all.
    seen.length = 0;
    await (await ask({ op: "churn", folder: root, span: "all" }, DESKTOP, exec)).json();
    assert.ok(!seen.find((s) => s.args.includes("log"))!.args.some((a) => a.startsWith("--since")));
  });

  it("turns the monitor off on the local-run socket's path too, and refuses a span that isn't on the list", async () => {
    const seen: string[][] = [];
    const git = createGit(async (args) => {
      seen.push(args);
      return { code: 0, stdout: "/repo\n", stderr: "" };
    });
    await git.churn(root, "30");
    assert.ok(seen.length > 0 && seen.every((a) => a[0] === "-c" && a[1] === "core.fsmonitor=false"));
    seen.length = 0;
    const bad = await git.churn(root, "7" as "30");
    assert.equal(bad.ok, false);
    assert.equal(seen.length, 0);
  });
});
