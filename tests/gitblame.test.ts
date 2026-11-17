// Who changed each line of a file and when (git blame), and the file's own commits
// (src/lib/localrun/git.ts), against a real repo made here: two authors, fixed dates,
// a change not committed yet, and a rename the history follows.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createGit, parseBlame, parseFileLog, parseLog } from "../src/lib/localrun/git";

const git = createGit();
let root = "";

const run = (args: string[], who?: { name: string; email: string; date: string }) =>
  execFileSync("git", args, {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, "..", "gitconfig-none"),
      GIT_CONFIG_NOSYSTEM: "1",
      ...(who ? { GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_AUTHOR_DATE: who.date, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email, GIT_COMMITTER_DATE: who.date } : {}),
    },
  }).toString();

const ama = { name: "Ama Owusu", email: "ama@example.com", date: "2026-11-02T09:14:00+00:00" };
const kofi = { name: "Kofi Mensah", email: "kofi@example.com", date: "2026-11-05T16:02:00+00:00" };

before(() => {
  const base = mkdtempSync(join(tmpdir(), "wmc-blame-"));
  writeFileSync(join(base, "gitconfig-none"), "");
  root = join(base, "app");
  mkdirSync(join(root, "src"), { recursive: true });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "kofi@example.com"]);
  run(["config", "user.name", "Kofi Mensah"]);
  run(["config", "core.autocrlf", "false"]);
  writeFileSync(join(root, "src", "old.rs"), "mod a;\nmod b;\n\nfn main() {}\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "First commit"], ama);
  renameSync(join(root, "src", "old.rs"), join(root, "src", "main.rs"));
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "Rename to main.rs"], ama);
  writeFileSync(join(root, "src", "main.rs"), "mod a;\nmod b;\n\nfn main() {\n    run();\n}\n");
  run(["commit", "-q", "-am", "Run on start"], kofi);
  // Changed and not committed: line 6.
  writeFileSync(join(root, "src", "main.rs"), "mod a;\nmod b;\n\nfn main() {\n    run();\n    stop();\n}\n");
  writeFileSync(join(root, "src", "new.rs"), "fn x() {}\n");
});

after(() => rmSync(join(root, ".."), { recursive: true, force: true }));

describe("git blame: who changed each line, and when", () => {
  it("finds a map file in the project's folder, and never outside it", async () => {
    assert.deepEqual(await git.locate([root], "src/main.rs"), { top: await git.topOf([root]), rel: "src/main.rs" });
    // A workspace of several folders starts each path with the folder's label.
    assert.equal((await git.locate([root], "app/src/main.rs"))?.rel, "src/main.rs");
    assert.equal(await git.locate([root], "../etc/passwd"), null);
    assert.equal(await git.locate([root], "src/../../x"), null);
    assert.equal(await git.locate([root], "src/missing.rs"), null);
  });

  it("gives blocks of lines with author, exact time and message; uncommitted lines have none", async () => {
    const at = (await git.locate([root], "src/main.rs"))!;
    const b = await git.blame(at.top, at.rel);
    assert.ok(b.ok);
    if (!b.ok) return;
    assert.equal(b.me, "kofi@example.com");
    const view = b.hunks.map((h) => `${h.start}+${h.lines} ${h.author || "(not committed)"} ${h.time ? new Date(h.time * 1000).toISOString() : ""} ${h.summary}`.trim());
    // "fn main() {}" became "fn main() {" … "}": git gives lines 4, 5 and 7 to the commit that changed them.
    assert.deepEqual(view, [
      "1+3 Ama Owusu 2026-11-02T09:14:00.000Z First commit",
      "4+2 Kofi Mensah 2026-11-05T16:02:00.000Z Run on start",
      "6+1 (not committed)",
      "7+1 Kofi Mensah 2026-11-05T16:02:00.000Z Run on start",
    ]);
    assert.ok(b.hunks.every((h) => h.hash === "" || /^[0-9a-f]{7}$/.test(h.hash)));
  });

  it("says plainly when a file isn't committed yet", async () => {
    const at = (await git.locate([root], "src/new.rs"))!;
    const b = await git.blame(at.top, at.rel);
    assert.equal(b.ok, false);
    if (!b.ok) assert.match(b.output, /isn't in git yet/);
  });

  it("lists the file's own commits, newest first, through its rename, with exact dates", async () => {
    const h = await git.fileLog((await git.topOf([root]))!, "src/main.rs");
    // Dates in ISO 8601 (git writes UTC as "Z").
    assert.deepEqual(
      h.map((c) => `${c.subject} | ${c.author} | ${c.email} | ${new Date(c.date).toISOString()}`),
      ["Run on start | Kofi Mensah | kofi@example.com | 2026-11-05T16:02:00.000Z", "Rename to main.rs | Ama Owusu | ama@example.com | 2026-11-02T09:14:00.000Z", "First commit | Ama Owusu | ama@example.com | 2026-11-02T09:14:00.000Z"],
    );
  });

  it("gives the repo's log its exact dates too", async () => {
    const log = await git.log((await git.topOf([root]))!);
    assert.equal(new Date(log[0].date!).toISOString(), "2026-11-05T16:02:00.000Z");
  });
});

describe("git blame: a folder git spells differently", () => {
  // GitHub's Windows runner hands out its temp folder as C:\Users\RUNNER~1\..., and git names the same folder
  // C:/Users/runneradmin/...: the path between the two came out as "../../../../RUNNER~1/.../src/main.rs".
  it("takes the file's place in the repo from git, not from comparing the two spellings", async () => {
    const asked: string[][] = [];
    const stub = createGit(async (args) => {
      asked.push(args);
      return { code: 0, stdout: "C:/Users/someone-with-a-long-name/app\nsrc/\n", stderr: "" };
    });
    assert.deepEqual(await stub.locate([root], "src/main.rs"), { top: "C:/Users/someone-with-a-long-name/app", rel: "src/main.rs" });
    assert.deepEqual(asked[0], ["rev-parse", "--show-toplevel", "--show-prefix"]);
  });

  it("something at the repo's top has an empty prefix", async () => {
    const stub = createGit(async () => ({ code: 0, stdout: "/somewhere/else/app\n\n", stderr: "" }));
    assert.deepEqual(await stub.locate([root], "src"), { top: "/somewhere/else/app", rel: "src" });
  });
});

describe("git blame: the parsers", () => {
  it("reads porcelain output where a commit's details come only once", () => {
    const h = "a".repeat(40);
    const out = [`${h} 1 1 2`, "author Ama", "author-mail <ama@x>", "author-time 1700000000", "summary Hi", "filename f", "\tone", `${h} 2 2`, "\ttwo", `${"0".repeat(40)} 3 3 1`, "author Not Committed Yet", "author-time 1800000000", "summary Version of f from f", "filename f", "\tthree"].join("\n");
    assert.deepEqual(parseBlame(out), [
      { start: 1, lines: 2, hash: "aaaaaaa", author: "Ama", email: "ama@x", time: 1700000000, summary: "Hi", sha: h, orig: [1, 2] },
      { start: 3, lines: 1, hash: "", author: "", email: "", time: 0, summary: "" },
    ]);
  });

  it("reads file logs and keeps the old log shape when no date is given", () => {
    assert.deepEqual(parseFileLog("abc1234\x1fFix\x1fAma\x1fama@x\x1f2026-11-02T09:14:00+00:00\x1e"), [{ hash: "abc1234", subject: "Fix", author: "Ama", email: "ama@x", date: "2026-11-02T09:14:00+00:00" }]);
    assert.deepEqual(parseLog("abc1234\x1fFix\x1fAma\x1f2 hours ago\x1f\x1e"), [{ hash: "abc1234", subject: "Fix", author: "Ama", when: "2 hours ago", refs: "" }]);
  });
});
