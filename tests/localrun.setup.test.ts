// "Set up this project" (src/lib/localrun/setup.ts): each service's stack,
// what's missing, and the exact steps, read from real folders on disk.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { findServiceDirs, planSetup, publicPlan, requirementNames, runSetupStep } from "../src/lib/localrun/setup";

const base = mkdtempSync(join(tmpdir(), "wmc-setup-"));
// Its own ~/.walkmycode, so a composer.phar WalkMyCode fetched on this computer doesn't change the plans.
const savedHome = process.env.WALKMYCODE_HOME;
process.env.WALKMYCODE_HOME = base;
after(() => {
  if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
  else process.env.WALKMYCODE_HOME = savedHome;
  rmSync(base, { recursive: true, force: true });
});

/** A folder of files; `bin` names programs put on the fake PATH. */
function project(name: string, files: Record<string, string>): string {
  const dir = join(base, name);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}
const bin = join(base, "bin");
mkdirSync(bin, { recursive: true });
for (const p of ["node", "npm", "pnpm"]) writeFileSync(join(bin, p), "");
const opts = { env: { PATH: bin }, platform: "linux" as const, python: "/usr/bin/python3" };

describe("set up this project: what each service needs", () => {
  it("a Vite app with no node_modules: npm ci, and its .env made from .env.example", () => {
    const dir = project("web", { "package.json": JSON.stringify({ dependencies: { react: "1" }, devDependencies: { vite: "5" } }), "package-lock.json": "{}", ".env.example": "API_URL=\nKEY=\n# note\n" });
    const [s] = planSetup([dir], opts);
    assert.equal(s.stack, "Vite · npm");
    assert.equal(s.state, "needs-setup");
    assert.deepEqual(
      s.steps.map((x) => [x.id, x.shown]),
      [
        ["install", "npm ci"],
        ["env", "copy .env.example .env"],
      ],
    );
    assert.equal(s.steps[0].expect, 2);
    assert.match(s.checks.find((c) => c.ok === null)!.text, /2 settings/);
  });

  it("installed and newer than the lockfile is ready; older needs installing again", () => {
    const dir = project("ready", { "package.json": JSON.stringify({ dependencies: { next: "16" } }), "pnpm-lock.yaml": "", "node_modules/.modules.yaml": "" });
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, "pnpm-lock.yaml"), old, old);
    assert.equal(planSetup([dir], opts)[0].state, "ready");
    assert.equal(planSetup([dir], opts)[0].stack, "Next.js · pnpm");
    utimesSync(join(dir, "node_modules", ".modules.yaml"), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    const s = planSetup([dir], opts)[0];
    assert.equal(s.state, "needs-setup");
    assert.equal(s.steps[0].shown, "pnpm install --frozen-lockfile");
  });

  it("Python with requirements and no virtual environment: make one, then install into it", () => {
    const dir = project("api", { "requirements.txt": "fastapi==0.110\nuvicorn[standard]>=0.29  # server\n-r dev.txt\n\nSQLAlchemy~=2.0\n" });
    const s = planSetup([dir], opts)[0];
    assert.equal(s.stack, "FastAPI · Python");
    assert.deepEqual(
      s.steps.map((x) => x.id),
      ["venv", "install"],
    );
    assert.equal(s.steps[1].expect, 3);
    assert.match(s.steps[1].shown, /-m pip install -r requirements.txt$/);
  });

  it("a tool that isn't installed: no steps, the install command and a link instead", () => {
    const dir = project("mobile", { "pubspec.yaml": "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n" });
    const s = planSetup([dir], opts)[0];
    assert.equal(s.state, "needs-tool");
    assert.deepEqual(s.steps, []);
    assert.equal(s.install?.tool, "Flutter");
    assert.match(s.install!.url, /flutter\.dev/);
  });

  it("a JS workspace installs once at its root; build folders and node_modules are never services", () => {
    const dir = project("mono", { "package.json": JSON.stringify({ workspaces: ["packages/*"] }), "packages/a/package.json": "{}", "node_modules/x/package.json": "{}", "dist/package.json": "{}" });
    assert.deepEqual(findServiceDirs(dir), [dir]);
  });

  it("several folders: ids start with each folder's name; the page never sees paths or programs", () => {
    const a = project("multi-a", { "package.json": "{}" });
    const b = project("multi-b", { "server/requirements.txt": "flask\n" });
    const plan = planSetup([a, b], opts);
    assert.deepEqual(
      plan.map((s) => s.id),
      ["multi-a", "multi-b/server"],
    );
    const shown = JSON.stringify(publicPlan(plan));
    assert.ok(!shown.includes(base.replace(/\\/g, "\\\\")) && !shown.includes("cwd") && !shown.includes('"file"'));
  });

  it("PHP missing comes first; then Composer", () => {
    const dir = project("php-none", { "composer.json": JSON.stringify({ require: { php: "^8.2", "laravel/framework": "^11" } }), artisan: "" });
    const s = planSetup([dir], opts)[0];
    assert.equal(s.stack, "Laravel · PHP");
    assert.equal(s.state, "needs-tool");
    assert.equal(s.install?.tool, "PHP");
  });

  it("a fresh Laravel app: composer install, .env, app key, the SQLite file, then the migrations", () => {
    const phpBin = join(base, "phpbin");
    mkdirSync(phpBin, { recursive: true });
    for (const p of ["php", "composer"]) writeFileSync(join(phpBin, p), "");
    const dir = project("laravel", {
      "composer.json": JSON.stringify({ require: { php: "^8.2", "laravel/framework": "^11.0", "laravel/tinker": "^2.9" } }),
      artisan: "",
      ".env.example": "APP_NAME=Todo\nAPP_KEY=\nDB_CONNECTION=sqlite\n",
      "database/migrations/0001_01_01_000000_create_users_table.php": "",
      "database/migrations/2026_10_02_000000_create_todos_table.php": "",
    });
    const s = planSetup([dir], { ...opts, env: { PATH: phpBin } })[0];
    assert.equal(s.state, "needs-setup");
    assert.deepEqual(
      s.steps.map((x) => x.id),
      ["install", "env", "key", "db", "migrate"],
    );
    assert.equal(s.steps[0].expect, 2);
    assert.equal(s.steps.find((x) => x.id === "migrate")!.expect, 2);
    // Once there's a key and a database, nothing more for Laravel.
    writeFileSync(join(dir, ".env"), "APP_KEY=base64:abc\nDB_CONNECTION=sqlite\n");
    writeFileSync(join(dir, "database", "database.sqlite"), "");
    mkdirSync(join(dir, "vendor"), { recursive: true });
    writeFileSync(join(dir, "vendor", "autoload.php"), "");
    assert.equal(planSetup([dir], { ...opts, env: { PATH: phpBin } })[0].state, "ready");
  });

  it("requirement names leave out versions, extras, markers and options", () => {
    assert.deepEqual(requirementNames("Django>=4\nrequests[socks]==2 ; python_version>'3'\n--index-url x\npython_dateutil\n"), ["django", "requests", "python-dateutil"]);
  });

  it("the .env copy never overwrites an existing .env", async () => {
    const dir = project("envcopy", { ".env.example": "A=1\n", "package.json": "{}" });
    const step = planSetup([dir], opts)[0].planned.find((s) => s.id === "env")!;
    writeFileSync(join(dir, ".env"), "A=mine\n");
    const out: string[] = [];
    const code = await new Promise<number | null>((done) => runSetupStep(step, { start() {}, out: (_s, t) => out.push(t), exit: (i) => done(i.code) }));
    assert.equal(code, 0);
    assert.match(out.join(""), /left as it is/);
  });
});

describe("new project: one round at a time", () => {
  it("Laravel with nothing installed: PHP first (winget), then Composer (WalkMyCode's own download), then create-project", async () => {
    const { planNew } = await import("../src/lib/localrun/starters");
    const parent = join(base, "newprojects");
    mkdirSync(parent, { recursive: true });
    const tools = join(base, "newbin");
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(tools, "winget.exe"), "");
    // Windows, played on any machine: the lookup builds Windows paths (\tmp\…\winget.exe on Linux CI), so the
    // file check reads them back with forward slashes, which every OS's fs takes.
    const win = { env: { PATH: tools, PATHEXT: ".EXE;.CMD" }, platform: "win32" as const, exists: (f: string) => existsSync(f.replace(/\\/g, "/")) };
    let p = planNew("laravel", "todo-app", parent, win);
    assert.ok(!("error" in p));
    assert.equal(p.steps[0].id, "tool");
    assert.equal(p.steps[0].shown, "winget install PHP.PHP.8.4");
    assert.deepEqual(p.steps[0].args.slice(0, 3), ["install", "--id", "PHP.PHP.8.4"]);
    writeFileSync(join(tools, "php.exe"), "");
    p = planNew("laravel", "todo-app", parent, win);
    assert.ok(!("error" in p));
    assert.equal(p.steps[0].builtin, "composer");
    writeFileSync(join(tools, "composer.cmd"), "");
    p = planNew("laravel", "todo-app", parent, win);
    assert.ok(!("error" in p));
    assert.equal(p.steps[0].id, "create");
    assert.equal(p.steps[0].shown, "composer create-project laravel/laravel todo-app");
    assert.equal(p.root, join(parent, "todo-app"));
  });

  it("refuses a bad name, a relative folder, and a folder that's already there (unless this server made it)", async () => {
    const { planNew } = await import("../src/lib/localrun/starters");
    const parent = join(base, "newprojects2");
    mkdirSync(join(parent, "taken"), { recursive: true });
    assert.ok("error" in planNew("express", "my app", parent, opts));
    assert.ok("error" in planNew("express", "ok", "relative/dir", opts));
    assert.ok("error" in planNew("express", "taken", parent, opts));
    const again = planNew("express", "taken", parent, opts, () => true);
    assert.ok(!("error" in again) && again.steps.length === 0);
  });

  it("Express and FastAPI are written by WalkMyCode itself, never over a folder that's there", async () => {
    const { planNew, writeStarter } = await import("../src/lib/localrun/starters");
    const parent = join(base, "newprojects3");
    mkdirSync(parent, { recursive: true });
    writeFileSync(join(bin, "python"), "");
    const p = planNew("fastapi", "api", parent, opts);
    assert.ok(!("error" in p) && p.steps[0].builtin === "starter");
    const said: string[] = [];
    writeStarter(parent, "api", "fastapi", (t) => said.push(t));
    assert.equal(planSetup([join(parent, "api")], opts)[0].stack, "FastAPI · Python");
    assert.throws(() => writeStarter(parent, "api", "fastapi", () => {}));
  });
});
