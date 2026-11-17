// A repo's own clean/smudge filters (docs/GIT.md, "What git is never asked to run"): .git/config can
// define `filter.<name>.clean`, `.smudge` or `.process` as a command, and an attribute selects it; git
// runs it whenever it reads a changed file from the working tree. WalkMyCode's read-only git
// (src/lib/localrun/git.ts, readOnlyExec) switches every driver off by name. Here a real repo sets up
// filters that would write a marker file, selected each of the ways an attribute can come (the
// working tree's .gitattributes, $GIT_DIR/info/attributes, a core.attributesFile the repo's config
// names), and blame, file log, a line's log, Hotspots and the change tour read its changed files: the
// marker never appears.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { RangeChange } from "../src/lib/diffParse";
import { createGit, FILTER_REFUSED, filterDrivers, readOnlyExec } from "../src/lib/localrun/git";
import { gitReadHandler, type GitRead } from "../src/lib/localrun/gitRead";

describe("filterDrivers", () => {
  it("names each driver once, as written, from git config --null --get-regexp", () => {
    const out = "filter.lfs.clean\ngit-lfs clean -- %f\0filter.lfs.required\ntrue\0filter.My.Odd.Name.process\nx\0filter.a=b.clean\ny\0filter.bare\0";
    assert.deepEqual(filterDrivers(out), ["lfs", "My.Odd.Name", "a=b"]);
    assert.deepEqual(filterDrivers(""), []);
  });
});

describe("read-only git never runs a repo's own filter programs", () => {
  let base = "";
  let root = "";
  let mark = "";
  const env = () => ({ ...process.env, GIT_CONFIG_GLOBAL: join(base, "gitconfig-none"), GIT_CONFIG_NOSYSTEM: "1" });
  const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe", env: env() }).toString();
  const git = createGit(readOnlyExec());
  const select = (how: "worktree" | "info" | "attributesFile", line: string) => {
    for (const p of [join(root, ".gitattributes"), join(root, ".git", "info", "attributes"), join(base, "attrs")]) if (existsSync(p)) unlinkSync(p);
    spawnSync("git", ["config", "--unset", "core.attributesFile"], { cwd: root, env: env() });
    if (how === "worktree") writeFileSync(join(root, ".gitattributes"), line);
    else if (how === "info") writeFileSync(join(root, ".git", "info", "attributes"), line);
    else {
      writeFileSync(join(base, "attrs"), line);
      run("config", "core.attributesFile", join(base, "attrs").replace(/\\/g, "/"));
    }
  };
  const ask = (body: unknown) =>
    gitReadHandler({ env: { WALKMYCODE_DESKTOP: "1" } })(new Request("http://localhost/api/git/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  before(() => {
    base = mkdtempSync(join(tmpdir(), "wmc-filter-"));
    writeFileSync(join(base, "gitconfig-none"), "");
    root = join(base, "app");
    execFileSync("git", ["init", "-q", "-b", "main", root], { env: env() });
    run("config", "user.email", "ama@example.com");
    run("config", "user.name", "Ama Owusu");
    run("config", "core.autocrlf", "false");
    writeFileSync(join(root, "tasks.ts"), "export const a = 1;\nexport const b = 2;\n");
    writeFileSync(join(root, "README.md"), "# App\n\nIt lists tasks.\n");
    run("add", "-A");
    run("commit", "-q", "-m", "Start");
    // Changed and new, not committed: what makes git read the working tree.
    writeFileSync(join(root, "tasks.ts"), "export const a = 1;\nexport const b = 3;\n");
    writeFileSync(join(root, "README.md"), "# App\n\nIt lists tasks, with due dates.\n");
    writeFileSync(join(root, "due.ts"), "export const late = true;\n");
    // The filters: each would leave its name in the marker file.
    mark = join(base, "ran").replace(/\\/g, "/");
    run("config", "filter.evil.clean", `sh -c 'echo clean >> "${mark}"; cat'`);
    run("config", "filter.evil.smudge", `sh -c 'echo smudge >> "${mark}"; cat'`);
    run("config", "filter.evil.required", "true");
    run("config", "filter.Proc.process", `sh -c 'echo process >> "${mark}"; exit 1'`);
    run("config", "filter.Proc.required", "true");
  });

  beforeEach(() => existsSync(mark) && unlinkSync(mark));
  after(() => rmSync(base, { recursive: true, force: true }));

  for (const how of ["worktree", "info", "attributesFile"] as const) {
    const where = { worktree: "the working tree's .gitattributes", info: "$GIT_DIR/info/attributes", attributesFile: "a core.attributesFile the repo's config names" }[how];

    it(`the rig is live: plain git runs the filter selected by ${where}`, () => {
      select(how, "*.ts filter=evil\n*.md filter=Proc\n");
      spawnSync("git", ["-c", "core.fsmonitor=false", "diff", "HEAD", "--", "tasks.ts"], { cwd: root, env: env() });
      assert.equal(existsSync(mark), true, "git ran the repo's filter");
    });

    it(`blame, file log, a line's log, Hotspots and the change tour run no filter selected by ${where}`, async () => {
      select(how, "*.ts filter=evil\n*.md filter=Proc\n");
      for (const f of ["tasks.ts", "README.md"]) {
        const b = await git.blame(root, f);
        assert.ok(b.ok, `blame ${f}: ${"output" in b ? b.output : ""}`);
        // The changed line is the working tree's own, not yet committed.
        assert.ok(b.hunks.some((h) => h.hash === ""), `blame ${f} sees the change`);
        assert.equal((await git.fileLog(root, f)).length, 1);
        // A line's history: from the commit that last changed line 1 (git diff HEAD reads the file on disk).
        const at = b.hunks.find((h) => h.start === 1)!.hash;
        // lineLog guards its own git too, so it is safe even from a createGit given plain git.
        for (const g of [git, createGit()]) {
          const l = await g.lineLog(root, f, { from: 1, to: 1, at });
          assert.ok(l.ok, `line log ${f}: ${"output" in l ? l.output : ""}`);
        }
      }
      const churn = await git.churn(root, "all");
      assert.ok(churn.ok);
      for (const against of [null, "main"]) {
        const c = (await git.change(root, against)) as RangeChange;
        assert.ok(!("error" in c), `change against ${against}`);
        // (.gitattributes, when it is the working tree's, is a new file of the change too.)
        assert.deepEqual(c.files.map((f) => f.path).filter((p) => p !== ".gitattributes").sort(), ["README.md", "due.ts", "tasks.ts"]);
        assert.ok(c.diff.includes("+export const b = 3;"));
      }
      assert.equal(existsSync(mark), false, existsSync(mark) ? readFileSync(mark, "utf8") : "");
    });

    it(`the desktop app's read-only route runs no filter selected by ${where}`, async () => {
      select(how, "*.ts filter=evil\n*.md filter=Proc\n");
      for (const body of [{ op: "blame" }, { op: "file-log" }, { op: "line-log", from: 2 }]) {
        const r = (await (await ask({ ...body, folder: root, path: "tasks.ts" })).json()) as GitRead;
        // A line's history without blame's commit is refused while the file has changes, which is fine: git read it to know.
        assert.equal(r.ok || body.op === "line-log", true, `${body.op}: ${r.output ?? ""}`);
      }
      const c = (await (await ask({ op: "change", folder: root, base: null })).json()) as GitRead & { change?: RangeChange };
      assert.ok(c.change?.diff.includes("+export const b = 3;"));
      assert.equal(existsSync(mark), false, existsSync(mark) ? readFileSync(mark, "utf8") : "");
    });
  }

  it("refuses to read a changed file when a filter's name can't be switched off", async () => {
    run("config", "filter.a=b.clean", `sh -c 'echo clean >> "${mark}"; cat'`);
    try {
      select("info", "*.ts filter=a=b\n");
      const b = await git.blame(root, "tasks.ts");
      assert.deepEqual(b, { ok: false, output: FILTER_REFUSED });
      const c = await git.change(root, null);
      assert.ok("error" in c && c.error === FILTER_REFUSED);
      assert.equal(existsSync(mark), false);
    } finally {
      run("config", "--remove-section", "filter.a=b");
    }
  });
});
