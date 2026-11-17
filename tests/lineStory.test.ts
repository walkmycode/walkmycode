// "How did this line get here?" (src/lib/localrun/lineStory.ts): git log -L's output as changes, a
// PR number from "(#41)", the repo's GitHub page only from a real GitHub remote, and the question the
// guide is asked. Then the same parser on this repo's own history, when the tests run in a clone.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { COMMIT, githubWeb, LINE_LOG_FORMAT, parseLineLog, prOf, storyCommand, storyLabel, storyPrompt, STORY_LINES, STORY_WIDTH, withoutPr } from "../src/lib/localrun/lineStory";

const R = "\x1e";
const U = "\x1f";

// Three commits, newest first, as `git log -L 26,26:lib/tasks.ts` prints them.
const OUT = [
  `${R}e93f5aa${U}Lena Berg${U}lena@example.com${U}2026-08-20T10:00:00+02:00${U}Move the no-key check into email.ts (#41)\n`,
  "diff --git a/lib/tasks.ts b/lib/tasks.ts",
  "--- a/lib/tasks.ts",
  "+++ b/lib/tasks.ts",
  "@@ -26,1 +26,1 @@",
  "-  if (task.assignee && key) await sendAssignedEmail(task.assignee.email, task.title);",
  "+  if (task.assignee) await sendAssignedEmail(task.assignee.email, task.title);",
  `${R}7d02b18${U}Ama Owusu${U}ama@example.com${U}2026-06-12T09:00:00+00:00${U}Send the address, not the id\n`,
  "diff --git a/lib/tasks.ts b/lib/tasks.ts",
  "--- a/lib/tasks.ts",
  "+++ b/lib/tasks.ts",
  "@@ -24,1 +26,1 @@",
  "-  if (assigneeId) await sendAssignedEmail(assigneeId, title);\r",
  "+  if (task.assignee && key) await sendAssignedEmail(task.assignee.email, task.title);\r",
  `${R}a41c9e2${U}Kofi Mensah${U}kofi@example.com${U}2026-03-04T14:30:00+00:00${U}Notify people when they get a task\n`,
  "diff --git a/lib/tasks.ts b/lib/tasks.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/lib/tasks.ts",
  "@@ -0,0 +24,1 @@",
  "+  if (assigneeId) await sendAssignedEmail(assigneeId, title);",
  "",
].join("\n");

describe("a line's history from git log -L", () => {
  it("gives each change: who, when, the message, the PR, and the lines it took out and put in", () => {
    const c = parseLineLog(OUT);
    assert.deepEqual(
      c.map((x) => [x.hash, x.author, x.pr ?? null]),
      [
        ["e93f5aa", "Lena Berg", "41"],
        ["7d02b18", "Ama Owusu", null],
        ["a41c9e2", "Kofi Mensah", null],
      ],
    );
    assert.equal(c[0].email, "lena@example.com");
    assert.equal(c[0].date, "2026-08-20T10:00:00+02:00");
    assert.equal(c[0].subject, "Move the no-key check into email.ts (#41)");
    assert.deepEqual(c[0].removed, ["  if (task.assignee && key) await sendAssignedEmail(task.assignee.email, task.title);"]);
    assert.deepEqual(c[0].added, ["  if (task.assignee) await sendAssignedEmail(task.assignee.email, task.title);"]);
    // Windows line endings don't come through; a new file's first commit only puts lines in.
    assert.equal(c[1].removed[0], "  if (assigneeId) await sendAssignedEmail(assigneeId, title);");
    assert.deepEqual(c[2].removed, []);
    assert.equal(c[2].added.length, 1);
    // "--- a/…" and "+++ b/…" are the diff's header, not lines of the file.
    assert.ok(c.every((x) => [...x.removed, ...x.added].every((l) => !l.startsWith("-- ") && !l.startsWith("++ "))));
  });

  it("keeps a few lines of a big change, trimmed, and counts the rest", () => {
    const big = `${R}abc1234${U}A${U}a@x${U}2026-01-01T00:00:00Z${U}Rewrite\n\ndiff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,9 +1,9 @@\n${Array.from({ length: 9 }, (_, i) => `-old ${i}`).join("\n")}\n${Array.from({ length: 9 }, () => `+${"x".repeat(400)}`).join("\n")}\n`;
    const [c] = parseLineLog(big);
    assert.equal(c.removed.length, STORY_LINES);
    assert.equal(c.added.length, STORY_LINES);
    assert.equal(c.more, 18 - 2 * STORY_LINES);
    assert.equal(c.added[0].length, STORY_WIDTH);
    assert.ok(c.added[0].endsWith("…"));
  });

  it("gives nothing for nothing, and skips what isn't a commit", () => {
    assert.deepEqual(parseLineLog(""), []);
    assert.deepEqual(parseLineLog(`${R}not a hash${U}x\n`), []);
    assert.equal(LINE_LOG_FORMAT, "--format=%x1e%h%x1f%an%x1f%ae%x1f%aI%x1f%s");
  });

  it("takes a commit only as a hash: never a branch name, a ref expression or an option", () => {
    for (const ok of ["c31d7c9", "a".repeat(40)]) assert.ok(COMMIT.test(ok), ok);
    for (const bad of ["-x", "--all", "HEAD", "HEAD~1", "main", "c31d7c", "C31D7C9", "c31d7c9^{tree}", "c31d7c9 -x", "a".repeat(41), ""]) assert.ok(!COMMIT.test(bad), bad);
  });

  it("finds the PR only at the end of the message, in brackets", () => {
    assert.equal(prOf("Fix the email (#123)"), "123");
    assert.equal(prOf("Fix the email (#123)  "), "123");
    assert.equal(prOf("Fix #123 in the email"), undefined);
    assert.equal(prOf("(#12) at the start"), undefined);
    assert.equal(withoutPr("Fix the email (#123)"), "Fix the email");
  });

  it("links to GitHub only for a remote that is really github.com", () => {
    assert.equal(githubWeb("https://github.com/walkmycode/walkmycode.git"), "https://github.com/walkmycode/walkmycode");
    assert.equal(githubWeb("https://github.com/walkmycode/walkmycode"), "https://github.com/walkmycode/walkmycode");
    assert.equal(githubWeb("git@github.com:walkmycode/walkmycode.git\n"), "https://github.com/walkmycode/walkmycode");
    assert.equal(githubWeb("ssh://git@github.com/walkmycode/walkmycode.git"), "https://github.com/walkmycode/walkmycode");
    assert.equal(githubWeb("https://token@github.com/a/b.git"), "https://github.com/a/b");
    for (const bad of [
      "git@github.com-work:walkmycode/walkmycode.git", // an ssh alias: where it really points isn't known
      "https://github.com.evil.example/a/b",
      "https://evil.example/github.com/a/b",
      "https://gitlab.com/a/b.git",
      "https://github.com/a",
      "https://github.com/../b",
      "file:///home/me/repo",
      "",
    ])
      assert.equal(githubWeb(bad), null, bad);
  });

  it("says what was asked, and asks the guide for a story told from the commits", () => {
    assert.equal(storyLabel({ from: 26, to: 26 }), "line 26");
    assert.equal(storyLabel({ from: 20, to: 28 }), "lines 20–28");
    assert.equal(storyCommand({ from: 26, to: 26 }), "git log -L 26,26");
    assert.equal(storyCommand({ func: "createTask" }), "git log -L :createTask");
    // From the commit that last changed the line, with its number there.
    assert.equal(storyCommand({ from: 24, to: 24, at: "c31d7c9e0f" }), "git log c31d7c9 -L 24,24");
    const p = storyPrompt("lib/tasks.ts", "line 26", { changes: parseLineLog(OUT), web: null, cut: false, changed: false }, "  if (task.assignee) …");
    assert.match(p, /line 26 in lib\/tasks\.ts/);
    assert.match(p, /plain English/);
    // Oldest first, as a story is told.
    assert.ok(p.indexOf("a41c9e2") < p.indexOf("7d02b18") && p.indexOf("7d02b18") < p.indexOf("e93f5aa"));
    assert.match(p, /\(PR 41\)/);
    assert.match(p, /took out: {3}if \(assigneeId\)/);
  });
});

// This repo's own history (the clone the tests run in): line 1 of src/lib/store.ts has at least the
// commit that made the file. Skipped where the code isn't a git clone.
const inClone = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "pipe" }).toString().trim() === "true";
  } catch {
    return false;
  }
})();

describe("a real line of this repo", { skip: !inClone && "not a git clone" }, () => {
  it("parses git log -L for line 1 of src/lib/store.ts", () => {
    const out = execFileSync("git", ["-c", "core.fsmonitor=false", "log", "--no-textconv", "--no-color", "-n5", LINE_LOG_FORMAT, "-L", "1,1:src/lib/store.ts"], { stdio: "pipe" }).toString();
    const c = parseLineLog(out);
    assert.ok(c.length >= 1);
    assert.match(c[0].hash, /^[0-9a-f]{7,}$/);
    assert.ok(c[0].author && !Number.isNaN(Date.parse(c[0].date)));
    // The oldest change git gives made the line: it put in what the file's first line is now.
    assert.ok(c.some((x) => x.added.includes('"use client";')));
  });
});
