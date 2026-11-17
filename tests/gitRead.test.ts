// The desktop app's read-only line history (src/lib/localrun/gitRead.ts, POST /api/git/read): blame
// and the file's commits without "run code on this computer", from the folder the app opened. Only
// in the desktop app, only those two ops, only inside the folder, and git never told to start a
// program because of the repo's own settings.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Exec } from "../src/lib/localrun/git";
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
  });

  it("does only blame and file-log: never status, commit, push or anything else", async () => {
    for (const op of ["status", "commit", "push", "pull", "discard", "diff"]) {
      assert.equal((await ask({ op, folder: root, path: "src/main.rs" })).status, 400, op);
    }
    assert.equal((await ask({ op: "blame", folder: root, path: "src/main.rs", extra: 1 })).status, 400);
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

  it("runs git with no file-system monitor, and blame with no text conversion", async () => {
    const seen: string[][] = [];
    const exec = readOnlyExec(async (args) => {
      seen.push(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    await exec(["blame", "--porcelain", "--", "a.rs"], ".", 1000);
    await exec(["log", "-n1", "--", "a.rs"], ".", 1000);
    assert.deepEqual(seen[0], ["-c", "core.fsmonitor=false", "blame", "--no-textconv", "--porcelain", "--", "a.rs"]);
    assert.deepEqual(seen[1], ["-c", "core.fsmonitor=false", "log", "-n1", "--", "a.rs"]);
  });
});
