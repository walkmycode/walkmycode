// Source Control (src/lib/localrun/git.ts): the porcelain parser, and the ops
// against a real repo in a temp folder (a bare one stands in for GitHub).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createGit, parseLog, parseStatus, type GitStatus } from "../src/lib/localrun/git";
import { cleanDraft, draftPrompt } from "../src/lib/localrun/gitDraft";

describe("parseStatus", () => {
  it("reads the branch, upstream, ahead/behind and each kind of change", () => {
    const out = [
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 a b src/app page.tsx",
      "1 A. N... 000000 100644 100644 0 b new.ts",
      "1 D. N... 100644 000000 000000 a 0 gone.ts",
      "2 R. N... 100644 100644 100644 a b R100 lib/new name.ts",
      "lib/old.ts",
      "u UU N... 100644 100644 100644 100644 a b c both.ts",
      "? notes.md",
      "",
    ].join("\0");
    const s = parseStatus(out, "/repo");
    assert.equal(s.branch, "main");
    assert.equal(s.upstream, "origin/main");
    assert.deepEqual([s.ahead, s.behind, s.fresh], [2, 1, false]);
    assert.deepEqual(
      s.files.map((f) => [f.path, f.change, f.staged, f.from ?? null]),
      [
        ["src/app page.tsx", "modified", false, null],
        ["new.ts", "added", true, null],
        ["gone.ts", "deleted", true, null],
        ["lib/new name.ts", "renamed", true, "lib/old.ts"],
        ["both.ts", "conflicted", false, null],
        ["notes.md", "untracked", false, null],
      ],
    );
  });

  it("knows a repo with no commits and a detached HEAD", () => {
    assert.equal(parseStatus("# branch.oid (initial)\0# branch.head main\0", "/r").fresh, true);
    assert.equal(parseStatus("# branch.oid abc\0# branch.head (detached)\0", "/r").branch, null);
  });
});

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("git ops on a real repo", { skip: !hasGit && "git isn't installed" }, () => {
  let dir = "";
  let work = "";
  const git = createGit();
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "wmc-git-"));
    work = join(dir, "work");
    const remote = join(dir, "remote.git");
    sh(dir, "init", "--bare", "-b", "main", remote);
    sh(dir, "init", "-b", "main", work);
    sh(work, "config", "user.name", "Test");
    sh(work, "config", "user.email", "test@example.com");
    sh(work, "config", "commit.gpgsign", "false");
    sh(work, "remote", "add", "origin", remote);
    writeFileSync(join(work, "a.txt"), "one\n");
    writeFileSync(join(work, "b.txt"), "two\n");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the repo's top and lists new files", async () => {
    const top = await git.topOf([join(dir, "nope"), work]);
    assert.ok(top);
    const s = (await git.status(top!)) as GitStatus;
    assert.equal(s.fresh, true);
    assert.deepEqual(s.files.map((f) => [f.path, f.change]), [["a.txt", "untracked"], ["b.txt", "untracked"]]);
  });

  it("refuses a commit without a message, or of a file with no change", async () => {
    assert.equal((await git.commit(work, ["a.txt"], "  ")).ok, false);
    const r = await git.commit(work, ["../outside.txt"], "x");
    assert.equal(r.ok, false);
    assert.match(r.output, /no change/);
  });

  it("commits only the ticked files, a message that looks like an option included", async () => {
    const r = await git.commit(work, ["a.txt"], "--amend is just words here");
    assert.equal(r.ok, true, r.output);
    assert.equal(sh(work, "log", "-1", "--format=%s").trim(), "--amend is just words here");
    const s = (await git.status(work)) as GitStatus;
    assert.deepEqual(s.files.map((f) => f.path), ["b.txt"]);
  });

  it("shows a diff, for a new file and a changed one", async () => {
    const neu = await git.diff(work, "b.txt");
    assert.equal(neu.ok, true);
    assert.match(neu.output, /\+two/);
    writeFileSync(join(work, "a.txt"), "one\nmore\n");
    const d = await git.diff(work, "a.txt");
    assert.match(d.output, /\+more/);
  });

  it("pushes a branch with no upstream to origin, then pulls up to date", async () => {
    const p = await git.push(work);
    assert.equal(p.ok, true, p.output);
    const s = (await git.status(work)) as GitStatus;
    assert.equal(s.upstream, "origin/main");
    assert.equal(s.ahead, 0);
    assert.equal((await git.pull(work)).ok, true);
  });

  it("commits a deletion", async () => {
    sh(work, "add", "b.txt");
    sh(work, "commit", "-m", "b");
    unlinkSync(join(work, "b.txt"));
    const r = await git.commit(work, ["b.txt"], "remove b");
    assert.equal(r.ok, true, r.output);
    assert.equal(sh(work, "ls-files", "b.txt").trim(), "");
  });


  it("discards a changed file back to the last commit, and deletes a new one", async () => {
    writeFileSync(join(work, "a.txt"), "scribble\n");
    writeFileSync(join(work, "junk.txt"), "x\n");
    const r = await git.discard(work, ["a.txt", "junk.txt"]);
    assert.equal(r.ok, true, r.output);
    assert.equal(lf(readFileSync(join(work, "a.txt"), "utf8")), "one\n");
    assert.equal(existsSync(join(work, "junk.txt")), false);
    assert.equal((await git.discard(work, ["../elsewhere.txt"])).ok, false);
  });

  it("lists, makes and switches branches, and refuses a bad name", async () => {
    assert.equal((await git.switchTo(work, "-x", true)).ok, false);
    assert.equal((await git.switchTo(work, "two words", true)).ok, false);
    assert.equal((await git.switchTo(work, "feature/x", true)).ok, true);
    const b = await git.branches(work);
    assert.deepEqual(b.map((x) => [x.name, x.current]).sort(), [["feature/x", true], ["main", false]]);
    assert.equal((await git.switchTo(work, "main", false)).ok, true);
  });

  it("reads the history", async () => {
    const log = await git.log(work);
    assert.equal(log[0].subject, "remove b");
    assert.ok(log.some((c) => c.subject === "--amend is just words here"));
    assert.match(log[0].hash, /^[0-9a-f]{7,}$/);
  });

  it("gives the ticked files' changes for a drafted message", async () => {
    writeFileSync(join(work, "a.txt"), "one\nmore\nand more\n");
    const d = await git.draft(work, ["a.txt"]);
    assert.equal(d.ok, true);
    assert.match(d.output, /\+and more/);
    await git.discard(work, ["a.txt"]);
  });

  it("walks a merge conflict: shown, kept from one side, finished", async () => {
    sh(work, "switch", "-c", "side");
    writeFileSync(join(work, "a.txt"), "side\n");
    sh(work, "commit", "-am", "side change");
    sh(work, "switch", "main");
    writeFileSync(join(work, "a.txt"), "main\n");
    sh(work, "commit", "-am", "main change");
    try {
      sh(work, "merge", "side");
    } catch {
      // the conflict is the point
    }
    let s = (await git.status(work)) as GitStatus;
    assert.equal(s.merging, "merge");
    assert.deepEqual(s.files.map((f) => [f.path, f.change]), [["a.txt", "conflicted"]]);
    assert.equal((await git.finishMerge(work, false)).ok, false, "not while a file is in conflict");
    assert.equal((await git.commit(work, ["a.txt"], "x")).ok, false, "no partial commit mid-merge");
    assert.equal((await git.resolve(work, "a.txt", "done")).ok, false, "markers still in the file");
    assert.equal((await git.resolve(work, "a.txt", "theirs")).ok, true);
    assert.equal(lf(readFileSync(join(work, "a.txt"), "utf8")), "side\n");
    const f = await git.finishMerge(work, false);
    assert.equal(f.ok, true, f.output);
    s = (await git.status(work)) as GitStatus;
    assert.equal(s.merging, null);
    assert.equal(s.files.length, 0);
  });

  it("aborts a merge", async () => {
    sh(work, "switch", "-c", "side2");
    writeFileSync(join(work, "a.txt"), "two\n");
    sh(work, "commit", "-am", "side2");
    sh(work, "switch", "main");
    writeFileSync(join(work, "a.txt"), "three\n");
    sh(work, "commit", "-am", "main2");
    try {
      sh(work, "merge", "side2");
    } catch {
      // conflict
    }
    assert.equal((await git.finishMerge(work, true)).ok, true);
    const s = (await git.status(work)) as GitStatus;
    assert.equal(s.merging, null);
    assert.equal(lf(readFileSync(join(work, "a.txt"), "utf8")), "three\n");
  });
});

const lf = (s: string) => s.replace(/\r/g, "");

describe("parseLog and the drafted message", () => {
  it("reads git log records", () => {
    const out = "abc1234\x1fFix it\x1fAma\x1f2 hours ago\x1fHEAD -> main, origin/main\x1e\ndef5678\x1fFirst\x1fAma\x1f3 days ago\x1f\x1e\n";
    assert.deepEqual(parseLog(out), [
      { hash: "abc1234", subject: "Fix it", author: "Ama", when: "2 hours ago", refs: "HEAD -> main, origin/main" },
      { hash: "def5678", subject: "First", author: "Ama", when: "3 days ago", refs: "" },
    ]);
  });

  it("asks for the message only, and tidies a chatty reply", () => {
    assert.match(draftPrompt("+x"), /message only/);
    assert.ok(draftPrompt("DIFF").endsWith("DIFF"));
    assert.equal(cleanDraft("```\nAdd login page\n```"), "Add login page");
    assert.equal(cleanDraft('Commit message: "Add login page"'), "Add login page");
    assert.equal(cleanDraft("Add login page\n\nSo users can sign in."), "Add login page\n\nSo users can sign in.");
  });
});
