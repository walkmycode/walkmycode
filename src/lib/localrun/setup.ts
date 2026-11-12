// "Set up this project" (src/ide/localrun/setup/): what each service of a
// workspace on this computer needs before it runs, and the exact commands that
// do it. A service is a folder with a package manifest (package.json,
// requirements.txt / pyproject.toml, pubspec.yaml, go.mod, Cargo.toml,
// composer.json, *.csproj, Gemfile), found up to three folders deep. For each:
// its stack, whether its tool is on this computer, whether its packages are
// installed and current with the lockfile, and whether a .env.example has no
// .env beside it. The steps are only ever planned here, from the files on disk;
// the page names a step by its id and the server runs this plan, never a
// command the page sent. System tools (Python, Node, Flutter) are never
// installed: the user gets the command and a link.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { dataDirIn, homeBase } from "../dataDir";
import { killTree, spawnTracked } from "./processes";
import { writeStarter } from "./starters";
import { findOnPath, type Env } from "./toolchains";

import type { ProgressKind, SetupCheck, SetupService, SetupStep } from "./setupTypes";
export type { ProgressKind, SetupCheck, SetupService, SetupState, SetupStep } from "./setupTypes";

/** A step as the server runs it: the program, its arguments, where. */
export interface PlannedStep extends SetupStep {
  cwd: string;
  /** null for a built-in step (`builtin` says which). */
  file: string | null;
  args: string[];
  /** "copy-env": copy args[0] to .env; "touch": make the empty file args[0] (Laravel's SQLite database). Never over an existing file. */
  builtin?: "copy-env" | "touch" | "composer" | "starter" | "php-ini";
}

export interface PlannedService extends SetupService {
  planned: PlannedStep[];
}

export interface SetupEnv {
  env: Env;
  platform: NodeJS.Platform;
  exists?: (p: string) => boolean;
}

const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "env", ".env", "dist", "build", "out", "target", ".next", ".dart_tool", "vendor", "__pycache__", ".turbo", ".cache", "coverage", ".idea", ".vscode", "Pods", ".gradle", "bin", "obj", ".walkmycode", ".lantern"]);
const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "pubspec.yaml", "go.mod", "Cargo.toml", "composer.json", "Gemfile"];
const MAX_DEPTH = 3;
const MAX_SERVICES = 24;

const read = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const mtime = (p: string): number | null => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The folders that hold a manifest, shallowest first; a JS workspace's packages stay part of their root. */
export function findServiceDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_SERVICES) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    const here = names.some((n) => MANIFESTS.includes(n) || n.endsWith(".csproj"));
    if (here) out.push(dir);
    // A JS monorepo (workspaces) installs once at the root: its packages are not services of their own.
    if (here && names.includes("package.json") && /"workspaces"\s*:/.test(read(join(dir, "package.json")) ?? "")) return;
    if (depth >= MAX_DEPTH) return;
    for (const n of names.sort()) {
      if (SKIP.has(n) || n.startsWith(".")) continue;
      const p = join(dir, n);
      if (isDir(p)) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

const deps = (pkg: Record<string, unknown>) => ({ ...(pkg.dependencies as object), ...(pkg.devDependencies as object) }) as Record<string, string>;

/** The JS framework a package.json names, most specific first. */
export function jsFramework(pkg: Record<string, unknown>): string {
  const d = deps(pkg);
  const pairs: [string, string][] = [
    ["next", "Next.js"],
    ["nuxt", "Nuxt"],
    ["@sveltejs/kit", "SvelteKit"],
    ["@remix-run/react", "Remix"],
    ["astro", "Astro"],
    ["@angular/core", "Angular"],
    ["@tauri-apps/api", "Tauri"],
    ["electron", "Electron"],
    ["expo", "Expo"],
    ["react-native", "React Native"],
    ["@nestjs/core", "NestJS"],
    ["vite", "Vite"],
    ["react-scripts", "Create React App"],
    ["express", "Express"],
    ["fastify", "Fastify"],
    ["hono", "Hono"],
    ["wrangler", "Workers"],
  ];
  return pairs.find(([k]) => k in d)?.[1] ?? "Node";
}

/** The Python framework the requirements or pyproject name. */
export function pyFramework(text: string): string {
  const t = text.toLowerCase();
  const pairs: [RegExp, string][] = [
    [/\bdjango\b/, "Django"],
    [/\bfastapi\b/, "FastAPI"],
    [/\bflask\b/, "Flask"],
    [/\bstreamlit\b/, "Streamlit"],
  ];
  return pairs.find(([r]) => r.test(t))?.[1] ?? "Python";
}

/** Package names in a requirements.txt (comments, options and -r includes left out). */
export function requirementNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l && !l.startsWith("-"))
    .map((l) => l.split(/[<>=!~;\[\s@]/)[0].toLowerCase().replace(/[-_.]+/g, "-"))
    .filter(Boolean);
}

/** The distributions installed in a virtual environment's site-packages, normalised as pip compares them. */
function installedIn(venv: string): Set<string> {
  const out = new Set<string>();
  const libs = [join(venv, "Lib", "site-packages")];
  try {
    for (const v of readdirSync(join(venv, "lib"))) libs.push(join(venv, "lib", v, "site-packages"));
  } catch {
    // Windows layout only
  }
  for (const lib of libs) {
    let names: string[] = [];
    try {
      names = readdirSync(lib);
    } catch {
      continue;
    }
    for (const n of names) {
      const m = /^(.+?)-[^-]+\.(dist-info|egg-info)$/.exec(n);
      if (m) out.add(m[1].toLowerCase().replace(/[-_.]+/g, "-"));
    }
  }
  return out;
}

const venvPython = (venv: string, platform: NodeJS.Platform) => (platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python"));

interface Ctx extends SetupEnv {
  /** A program on PATH, or null. */
  find: (cmd: string) => string | null;
  python: string | null;
}

interface ToolDef {
  tool: string;
  url: string;
  /** winget id (Windows), Homebrew formula (macOS), or an npm package installed globally. */
  winget?: string;
  brew?: string;
  npm?: string;
  /** Composer: WalkMyCode downloads composer.phar itself and checks its published SHA-256. */
  builtin?: "composer";
  /** The command for a person, where nothing above applies. */
  manual: { win: string; mac: string };
}

export type ToolKey = keyof typeof TOOLS;

const TOOLS = {
  node: { tool: "Node.js", url: "https://nodejs.org/", winget: "OpenJS.NodeJS.LTS", brew: "node", manual: { win: "winget install OpenJS.NodeJS.LTS", mac: "brew install node" } },
  python: { tool: "Python", url: "https://www.python.org/downloads/", winget: "Python.Python.3.12", brew: "python", manual: { win: "winget install Python.Python.3.12", mac: "brew install python" } },
  flutter: { tool: "Flutter", url: "https://docs.flutter.dev/get-started/install", manual: { win: "git clone https://github.com/flutter/flutter.git -b stable", mac: "brew install --cask flutter" } },
  dart: { tool: "Dart", url: "https://dart.dev/get-dart", brew: "dart-lang/dart/dart", manual: { win: "choco install dart-sdk", mac: "brew install dart-lang/dart/dart" } },
  go: { tool: "Go", url: "https://go.dev/dl/", winget: "GoLang.Go", brew: "go", manual: { win: "winget install GoLang.Go", mac: "brew install go" } },
  rust: { tool: "Rust", url: "https://rustup.rs/", winget: "Rustlang.Rustup", brew: "rustup", manual: { win: "winget install Rustlang.Rustup", mac: "curl https://sh.rustup.rs -sSf | sh" } },
  phpcore: { tool: "PHP", url: "https://windows.php.net/download/", winget: "PHP.PHP.8.4", brew: "php", manual: { win: "winget install PHP.PHP.8.4", mac: "brew install php" } },
  php: { tool: "Composer", url: "https://getcomposer.org/download/", builtin: "composer", manual: { win: "scoop install composer", mac: "brew install composer" } },
  dotnet: { tool: ".NET SDK", url: "https://dotnet.microsoft.com/download", winget: "Microsoft.DotNet.SDK.8", manual: { win: "winget install Microsoft.DotNet.SDK.8", mac: "brew install --cask dotnet-sdk" } },
  ruby: { tool: "Ruby and Bundler", url: "https://www.ruby-lang.org/en/downloads/", winget: "RubyInstallerTeam.Ruby.3.3", brew: "ruby", manual: { win: "winget install RubyInstallerTeam.Ruby.3.3", mac: "brew install ruby" } },
  pnpm: { tool: "pnpm", url: "https://pnpm.io/installation", npm: "pnpm", manual: { win: "npm install -g pnpm", mac: "npm install -g pnpm" } },
  yarn: { tool: "Yarn", url: "https://yarnpkg.com/getting-started/install", npm: "yarn", manual: { win: "npm install -g yarn", mac: "npm install -g yarn" } },
  bun: { tool: "Bun", url: "https://bun.sh/", winget: "Oven-sh.Bun", brew: "oven-sh/bun/bun", manual: { win: "winget install Oven-sh.Bun", mac: "brew install oven-sh/bun/bun" } },
} satisfies Record<string, ToolDef>;

/** What Composer and Laravel need from PHP: TLS to download, zip to unpack, the rest for the framework and SQLite. */
const PHP_EXTENSIONS = ["openssl", "mbstring", "fileinfo", "curl", "zip", "pdo_sqlite", "sqlite3"];

/**
 * PHP on Windows comes as a zip with no php.ini, so every extension is off
 * (winget's PHP among them). When some that Composer or Laravel need are off
 * and their DLLs are there, a step that writes php.ini from PHP's own
 * php.ini-development and turns them on. Null when nothing's missing (or on
 * macOS/Linux, where Homebrew's and the distros' PHP have them).
 */
export function phpConfigStep(c: Pick<Ctx, "find" | "platform">, cwd: string): PlannedStep | null {
  if (c.platform !== "win32") return null;
  const found = c.find("php");
  if (!found) return null;
  let php: string;
  try {
    php = realpathSync(found);
  } catch {
    php = found;
  }
  const dir = dirname(php);
  let modules: string[];
  try {
    modules = execFileSync(php, ["-m"], { encoding: "utf8", windowsHide: true, timeout: 8000 }).toLowerCase().split(/\r?\n/).map((l) => l.trim());
  } catch {
    return null;
  }
  const off = PHP_EXTENSIONS.filter((e) => !modules.includes(e) && existsSync(join(dir, "ext", `php_${e}.dll`)));
  if (!off.length) return null;
  return { id: "tool", label: "Turn on PHP's extensions", shown: `php.ini: extension=${off.join(", ")}`, progress: "copy", cwd, file: null, args: [php, ...off], builtin: "php-ini" };
}

/** Write php.ini beside php.exe (from php.ini-development when there's none) with extension_dir and these extensions on. */
export function enablePhpExtensions(php: string, extensions: string[], say: (t: string) => void): void {
  const dir = dirname(php);
  const ini = join(dir, "php.ini");
  let text = existsSync(ini) ? readFileSync(ini, "utf8") : (read(join(dir, "php.ini-development")) ?? read(join(dir, "php.ini-production")) ?? "");
  if (!existsSync(ini)) say(`Made php.ini from ${existsSync(join(dir, "php.ini-development")) ? "php.ini-development" : "PHP's template"}\n`);
  // Extensions are looked for in ext/ beside php.exe.
  if (/^\s*;\s*extension_dir\s*=\s*"ext"/m.test(text)) text = text.replace(/^\s*;\s*(extension_dir\s*=\s*"ext")/m, "$1");
  else if (!/^\s*extension_dir\s*=/m.test(text)) text += `\nextension_dir = "ext"\n`;
  for (const e of extensions) {
    const commented = new RegExp(`^\\s*;\\s*(extension\\s*=\\s*${e})\\s*$`, "m");
    if (commented.test(text)) text = text.replace(commented, "$1");
    else if (!new RegExp(`^\\s*extension\\s*=\\s*(php_)?${e}(\\.dll)?\\s*$`, "m").test(text)) text += `extension=${e}\n`;
    say(`+ extension=${e}\n`);
  }
  writeFileSync(ini, text);
  const now = execFileSync(php, ["-m"], { encoding: "utf8", windowsHide: true, timeout: 8000 }).toLowerCase();
  const still = extensions.filter((e) => !now.split(/\r?\n/).map((l) => l.trim()).includes(e));
  if (still.length) throw new Error(`PHP still doesn't load ${still.join(", ")}.`);
  say(`PHP loads ${extensions.join(", ")} now.\n`);
}

/**
 * winget is an app execution alias in %LOCALAPPDATA%\Microsoft\WindowsApps: a
 * reparse point existsSync can't see, though lstat (and starting it) works.
 */
function wingetAlias(env: Env): string | null {
  const local = env.LOCALAPPDATA ?? process.env.LOCALAPPDATA;
  if (!local) return null;
  const p = join(local, "Microsoft", "WindowsApps", "winget.exe");
  try {
    lstatSync(p);
    return p;
  } catch {
    return null;
  }
}

/** Where WalkMyCode keeps tools it fetched itself (composer.phar): ~/.walkmycode/tools. */
export function toolsDir(): string {
  return join(dataDirIn(homeBase(homedir())), "tools");
}
export const composerPhar = () => join(toolsDir(), "composer.phar");

/** A tool's name, how a person installs it here, and where to read about it. */
export function toolInfo(key: ToolKey, platform: NodeJS.Platform): { tool: string; command: string; url: string } {
  const t: ToolDef = TOOLS[key];
  return { tool: t.tool, url: t.url, command: platform === "win32" ? t.manual.win : t.manual.mac };
}

function missing(c: Ctx, key: ToolKey): SetupService["install"] {
  const t: ToolDef = TOOLS[key];
  const auto = installStep(c, key, "");
  return { tool: t.tool, url: t.url, command: auto?.shown ?? (c.platform === "win32" ? t.manual.win : t.manual.mac), auto: !!auto, key };
}

/**
 * The step that installs a missing tool, when this computer has a way to do it
 * that needs no password typed into a terminal: winget on Windows, Homebrew on
 * macOS, npm for npm's own tools, WalkMyCode's own download for Composer. Null
 * when the user has to do it (Linux package managers ask for sudo; Flutter is a
 * git clone).
 */
export function installStep(c: Ctx, key: ToolKey, cwd: string): PlannedStep | null {
  const t: ToolDef = TOOLS[key];
  const base = { id: "tool", label: `Install ${t.tool}`, cwd };
  if (t.builtin === "composer") {
    if (!c.find("php")) return null;
    return { ...base, shown: "download composer.phar (checked against getcomposer.org's SHA-256)", progress: "download", file: null, args: [composerPhar()], builtin: "composer" };
  }
  if (t.npm) {
    const npm = c.find("npm");
    return npm ? { ...base, shown: `npm install -g ${t.npm}`, progress: "npm", file: npm, args: ["install", "-g", t.npm] } : null;
  }
  if (c.platform === "win32" && t.winget) {
    const onPath = c.find("winget");
    const alias = onPath ? null : wingetAlias(c.env);
    if (!onPath && !alias) return null;
    const args = ["install", "--id", t.winget, "--exact", "--source", "winget", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"];
    // The alias can't be started directly (libuv can't see it), so it goes through cmd.exe, which can.
    return { ...base, shown: `winget install ${t.winget}`, progress: "winget", file: onPath ?? (c.env.ComSpec ?? process.env.ComSpec ?? "cmd.exe"), args: onPath ? args : ["/d", "/s", "/c", "winget", ...args] };
  }
  if (c.platform === "darwin" && t.brew) {
    const brew = c.find("brew");
    return brew ? { ...base, shown: `brew install ${t.brew}`, progress: "brew", file: brew, args: ["install", t.brew] } : null;
  }
  return null;
}

/** .env.example (or .env.sample) with no .env: copy it, so the user has a file to fill in. */
function envCheck(dir: string, steps: PlannedStep[], checks: SetupCheck[]) {
  const example = [".env.example", ".env.sample", ".env.template"].find((n) => existsSync(join(dir, n)));
  if (!example || existsSync(join(dir, ".env"))) return;
  const settings = (read(join(dir, example)) ?? "").split(/\r?\n/).filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)).length;
  checks.push({ ok: null, text: `No .env yet: ${example} lists ${settings} setting${settings === 1 ? "" : "s"} to fill in` });
  steps.push({ id: "env", label: "Make the .env file", shown: `copy ${example} .env`, progress: "copy", cwd: dir, file: null, args: [example], builtin: "copy-env" });
}

/** A setting in a .env-style file ("" when it is there but empty, null when it isn't). */
function envValue(text: string | null, key: string): string | null {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m").exec(text ?? "");
  return m ? m[1].trim().replace(/^["'](.*)["']$/, "$1") : null;
}

/**
 * PHP with Composer, and a Laravel app's own first run: PHP and Composer on
 * this computer, `composer install`, the .env, an APP_KEY, and (with SQLite,
 * Laravel's default) the database file and its migrations.
 */
function phpService(dir: string, c: Ctx): Omit<PlannedService, "id" | "name"> {
  const json = JSON.parse(read(join(dir, "composer.json")) ?? "{}") as { require?: Record<string, string> };
  const laravel = existsSync(join(dir, "artisan")) || "laravel/framework" in (json.require ?? {});
  const stack = laravel ? "Laravel · PHP" : "PHP · Composer";
  const checks: SetupCheck[] = [];
  const steps: PlannedStep[] = [];
  const php = c.find("php");
  // Composer on PATH, else the composer.phar WalkMyCode fetched (run with PHP).
  const phar = existsSync(composerPhar()) ? composerPhar() : null;
  const composer = c.find("composer") ?? phar;
  if (!php || !composer) {
    checks.push({ ok: !!php, text: php ? "PHP on this computer" : "PHP isn't on this computer" });
    if (!composer) checks.push({ ok: false, text: "Composer isn't on this computer" });
    return { stack, state: "needs-tool", checks, steps, planned: steps, install: missing(c, php ? "php" : "phpcore") };
  }
  checks.push({ ok: true, text: "PHP and Composer on this computer" });
  // PHP with its extensions off (Windows' zip has no php.ini): that comes before anything Composer does.
  const ini = phpConfigStep(c, dir);
  if (ini) {
    checks.push({ ok: false, text: `PHP's ${ini.args.slice(1).join(", ")} extension${ini.args.length > 2 ? "s are" : " is"} off` });
    return { stack, state: "needs-tool", checks, steps: [ini], planned: [ini], install: { tool: "PHP's extensions", url: "https://www.php.net/manual/en/install.windows.manual.php", command: ini.shown, auto: true } };
  }
  const count = Object.keys(json.require ?? {}).filter((k) => k !== "php" && !k.startsWith("ext-")).length;
  const autoload = join(dir, "vendor", "autoload.php");
  const lockAt = mtime(join(dir, "composer.lock"));
  if (!existsSync(autoload)) checks.push({ ok: false, text: `Packages not installed (${count} in composer.json)` });
  else if (lockAt && (mtime(autoload) ?? 0) + 1000 < lockAt) checks.push({ ok: false, text: "vendor is older than composer.lock" });
  else checks.push({ ok: true, text: "Packages installed" });
  const viaPhar = composer === phar && !c.find("composer");
  if (checks.some((x) => x.ok === false)) steps.push({ id: "install", label: "Install the packages", shown: "composer install", progress: "composer", expect: count || undefined, cwd: dir, file: viaPhar ? php : composer, args: [...(viaPhar ? [phar!] : []), "install", "--no-interaction", "--no-audit"] });
  envCheck(dir, steps, checks);
  if (laravel && existsSync(join(dir, "artisan"))) {
    const env = read(join(dir, ".env"));
    const example = read(join(dir, ".env.example"));
    if (!envValue(env, "APP_KEY")) {
      checks.push({ ok: false, text: "No APP_KEY yet: Laravel won't start without one" });
      steps.push({ id: "key", label: "Make the app key", shown: "php artisan key:generate", progress: "artisan", cwd: dir, file: php, args: ["artisan", "key:generate", "--no-interaction"] });
    }
    // SQLite is Laravel's default: the database is a file the first migration needs.
    const conn = envValue(env, "DB_CONNECTION") ?? envValue(example, "DB_CONNECTION") ?? "sqlite";
    const db = join(dir, "database", "database.sqlite");
    if (conn === "sqlite" && !existsSync(db) && existsSync(join(dir, "database"))) {
      checks.push({ ok: false, text: "No database yet (SQLite)" });
      steps.push({ id: "db", label: "Make the SQLite database", shown: c.platform === "win32" ? "type nul > database\\database.sqlite" : "touch database/database.sqlite", progress: "copy", cwd: dir, file: null, args: [join("database", "database.sqlite")], builtin: "touch" });
      let migrations = 0;
      try {
        migrations = readdirSync(join(dir, "database", "migrations")).filter((n) => n.endsWith(".php")).length;
      } catch {
        // no migrations folder
      }
      if (migrations) steps.push({ id: "migrate", label: "Make the tables", shown: "php artisan migrate", progress: "artisan", expect: migrations, cwd: dir, file: php, args: ["artisan", "migrate", "--force", "--no-interaction"] });
    }
    // Its Vite front end (resources/css, resources/js): npm's packages, when Node is here.
    const npm = c.find("npm");
    if (existsSync(join(dir, "package.json")) && !existsSync(join(dir, "node_modules")) && npm) {
      const lock = existsSync(join(dir, "package-lock.json"));
      checks.push({ ok: false, text: "The front end's npm packages aren't installed" });
      steps.push({ id: "npm", label: "Install the front end's packages", shown: lock ? "npm ci" : "npm install", progress: "npm", cwd: dir, file: npm, args: [lock ? "ci" : "install"] });
    }
  }
  return { stack, state: steps.length ? "needs-setup" : "ready", checks, steps, planned: steps };
}

function nodeService(dir: string, c: Ctx): Omit<PlannedService, "id" | "name"> {
  const pkg = JSON.parse(read(join(dir, "package.json")) ?? "{}") as Record<string, unknown>;
  const lock = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ].find(([f]) => existsSync(join(dir, f))) as [string, "pnpm" | "yarn" | "bun" | "npm"] | undefined;
  const pm = lock?.[1] ?? (String(pkg.packageManager ?? "").split("@")[0] as "pnpm" | "yarn" | "bun" | "npm" | "") ?? "npm";
  const manager = pm || "npm";
  const stack = `${jsFramework(pkg)} · ${manager}`;
  const checks: SetupCheck[] = [];
  const steps: PlannedStep[] = [];
  const node = c.find("node");
  const bin = c.find(manager);
  if (!node || !bin) {
    checks.push({ ok: false, text: `${!node ? "Node.js" : TOOLS[manager === "npm" ? "node" : manager].tool} isn't on this computer` });
    return { stack, state: "needs-tool", checks, steps, planned: steps, install: missing(c, !node || manager === "npm" ? "node" : manager) };
  }
  checks.push({ ok: true, text: `Node.js and ${manager} on this computer` });
  const count = Object.keys(deps(pkg)).length;
  const nm = join(dir, "node_modules");
  const lockAt = lock ? mtime(join(dir, lock[0])) : null;
  const stamp = mtime(join(nm, ".package-lock.json")) ?? mtime(join(nm, ".modules.yaml")) ?? mtime(join(nm, ".yarn-integrity")) ?? mtime(nm);
  if (!existsSync(nm)) checks.push({ ok: false, text: `Packages not installed (${count} in package.json)` });
  else if (lockAt && stamp && stamp + 1000 < lockAt) checks.push({ ok: false, text: `node_modules is older than ${lock![0]}` });
  else checks.push({ ok: true, text: "Packages installed" });
  const needs = checks.some((x) => x.ok === false);
  if (needs) {
    const args = manager === "npm" ? (lock ? ["ci"] : ["install"]) : manager === "pnpm" ? ["install", ...(lock ? ["--frozen-lockfile"] : [])] : manager === "yarn" ? ["install", ...(lock ? ["--frozen-lockfile"] : [])] : ["install"];
    steps.push({ id: "install", label: "Install the packages", shown: `${manager} ${args.join(" ")}`, progress: manager, expect: count || undefined, cwd: dir, file: bin, args });
  }
  envCheck(dir, steps, checks);
  return { stack, state: steps.length ? "needs-setup" : "ready", checks, steps, planned: steps };
}

function pythonService(dir: string, c: Ctx): Omit<PlannedService, "id" | "name"> {
  const req = read(join(dir, "requirements.txt"));
  const proj = read(join(dir, "pyproject.toml"));
  const fw = pyFramework(`${req ?? ""}\n${proj ?? ""}`);
  const stack = fw === "Python" ? "Python" : `${fw} · Python`;
  const checks: SetupCheck[] = [];
  const steps: PlannedStep[] = [];
  if (!c.python) {
    checks.push({ ok: false, text: "Python isn't on this computer" });
    return { stack, state: "needs-tool", checks, steps, planned: steps, install: missing(c, "python") };
  }
  checks.push({ ok: true, text: "Python on this computer" });
  const existing = [".venv", "venv"].map((n) => join(dir, n)).find((v) => existsSync(venvPython(v, c.platform)));
  const venv = existing ?? join(dir, ".venv");
  const names = req ? requirementNames(req) : [];
  if (!existing) {
    checks.push({ ok: false, text: "No virtual environment" });
    steps.push({ id: "venv", label: "Make a virtual environment", shown: `python -m venv ${basename(venv)}`, progress: "venv", cwd: dir, file: c.python, args: ["-m", "venv", basename(venv)] });
  }
  const have = existing ? installedIn(venv) : new Set<string>();
  const gone = names.filter((n) => !have.has(n));
  const py = venvPython(venv, c.platform);
  const rel = (p: string) => relative(dir, p);
  if (req) {
    if (!existing || gone.length) {
      checks.push({ ok: false, text: existing ? `${gone.length} of ${names.length} packages missing (${gone.slice(0, 3).join(", ")}${gone.length > 3 ? "…" : ""})` : `Packages not installed (${names.length} in requirements.txt)` });
      steps.push({ id: "install", label: "Install the packages", shown: `${rel(py)} -m pip install -r requirements.txt`, progress: "pip", expect: names.length || undefined, cwd: dir, file: py, args: ["-m", "pip", "install", "-r", "requirements.txt"] });
    } else checks.push({ ok: true, text: `${names.length} packages installed` });
  } else if (proj && /\[project\]|\[tool\.poetry\]/.test(proj)) {
    if (!existing || have.size < 3) {
      checks.push({ ok: false, text: "The project's packages aren't installed" });
      steps.push({ id: "install", label: "Install the project", shown: `${rel(py)} -m pip install -e .`, progress: "pip", cwd: dir, file: py, args: ["-m", "pip", "install", "-e", "."] });
    } else checks.push({ ok: true, text: "Packages installed" });
  }
  envCheck(dir, steps, checks);
  return { stack, state: steps.length ? "needs-setup" : "ready", checks, steps, planned: steps };
}

function simpleService(dir: string, c: Ctx, o: { stack: string; tool: keyof typeof TOOLS; cmd: string; args: string[]; progress: ProgressKind; done: string[]; lock?: string; label?: string }): Omit<PlannedService, "id" | "name"> {
  const checks: SetupCheck[] = [];
  const steps: PlannedStep[] = [];
  const bin = c.find(o.cmd);
  if (!bin) {
    checks.push({ ok: false, text: `${TOOLS[o.tool].tool} isn't on this computer` });
    return { stack: o.stack, state: "needs-tool", checks, steps, planned: steps, install: missing(c, o.tool) };
  }
  checks.push({ ok: true, text: `${TOOLS[o.tool].tool} on this computer` });
  const marker = o.done.map((d) => join(dir, d)).find((p) => existsSync(p));
  const lockAt = o.lock ? mtime(join(dir, o.lock)) : null;
  const fresh = marker && (!lockAt || (mtime(marker) ?? 0) + 1000 >= lockAt);
  if (!fresh) {
    checks.push({ ok: false, text: marker ? `Packages are older than ${o.lock}` : "Packages not fetched yet" });
    steps.push({ id: "install", label: o.label ?? "Get the packages", shown: `${o.cmd} ${o.args.join(" ")}`, progress: o.progress, cwd: dir, file: bin, args: o.args });
  } else checks.push({ ok: true, text: "Packages ready" });
  envCheck(dir, steps, checks);
  return { stack: o.stack, state: steps.length ? "needs-setup" : "ready", checks, steps, planned: steps };
}

function toolOnly(dir: string, c: Ctx, stack: string, tool: keyof typeof TOOLS, cmd: string, note: string): Omit<PlannedService, "id" | "name"> {
  const steps: PlannedStep[] = [];
  if (!c.find(cmd)) return { stack, state: "needs-tool", checks: [{ ok: false, text: `${TOOLS[tool].tool} isn't on this computer` }], steps, planned: steps, install: missing(c, tool) };
  const checks: SetupCheck[] = [{ ok: true, text: `${TOOLS[tool].tool} on this computer` }, { ok: true, text: note }];
  envCheck(dir, steps, checks);
  return { stack, state: steps.length ? "needs-setup" : "ready", checks, steps, planned: steps };
}

function plan(dir: string, c: Ctx): Omit<PlannedService, "id" | "name"> | null {
  const has = (f: string) => existsSync(join(dir, f));
  // A Laravel app ships a package.json for its Vite front end: it is still a Laravel app (its npm install is one of its steps).
  if (has("composer.json") && has("artisan")) return phpService(dir, c);
  if (has("package.json")) return nodeService(dir, c);
  if (has("requirements.txt") || has("pyproject.toml")) return pythonService(dir, c);
  if (has("pubspec.yaml")) {
    const flutter = /\bsdk:\s*flutter\b/.test(read(join(dir, "pubspec.yaml")) ?? "");
    return simpleService(dir, c, flutter ? { stack: "Flutter · Dart", tool: "flutter", cmd: "flutter", args: ["pub", "get"], progress: "pub", done: [".dart_tool/package_config.json"], lock: "pubspec.lock" } : { stack: "Dart", tool: "dart", cmd: "dart", args: ["pub", "get"], progress: "pub", done: [".dart_tool/package_config.json"], lock: "pubspec.lock" });
  }
  // Go and Cargo fetch what they need on the first build: only the tool is checked.
  if (has("go.mod")) return toolOnly(dir, c, "Go", "go", "go", "Modules download on the first build");
  if (has("Cargo.toml")) return toolOnly(dir, c, "Rust · Cargo", "rust", "cargo", "Crates download on the first build");
  if (has("composer.json")) return phpService(dir, c);
  if (has("Gemfile")) return simpleService(dir, c, { stack: "Ruby · Bundler", tool: "ruby", cmd: "bundle", args: ["install"], progress: "bundle", done: [".bundle", "vendor/bundle"], lock: "Gemfile.lock" });
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    // unreadable
  }
  const proj = names.find((n) => n.endsWith(".csproj"));
  if (proj) return simpleService(dir, c, { stack: ".NET", tool: "dotnet", cmd: "dotnet", args: ["restore"], progress: "dotnet", done: ["obj/project.assets.json"], label: "Restore the packages" });
  return null;
}

/**
 * Every service in the workspace's folders, with its checks and the steps it
 * needs. `python` is the program the toolchain detection found (null when
 * none works), so a Store stand-in is never used.
 */
export function planSetup(roots: string[], o: SetupEnv & { python: string | null }): PlannedService[] {
  const exists = o.exists ?? existsSync;
  const c: Ctx = { ...o, find: (cmd) => findOnPath(cmd, { env: o.env, platform: o.platform, exists }), python: o.python };
  const out: PlannedService[] = [];
  const several = roots.length > 1;
  for (const root of roots) {
    for (const dir of findServiceDirs(root)) {
      const p = plan(dir, c);
      if (!p) continue;
      // A tool WalkMyCode can install itself becomes this service's one step; once it's there, a fresh look plans the rest.
      if (p.state === "needs-tool" && p.install?.auto && p.install.key) {
        const st = installStep(c, p.install.key as ToolKey, dir);
        if (st) p.planned = p.steps = [st];
      }
      const rel = relative(root, dir).replace(/\\/g, "/");
      const id = several ? [basename(root), rel].filter(Boolean).join("/") : rel;
      out.push({ ...p, id: id || ".", name: rel ? basename(dir) : basename(root) });
    }
  }
  return out;
}

/** What the page is shown: the plan without the server's paths and programs. */
export function publicPlan(services: PlannedService[]): SetupService[] {
  return services.map(({ planned, ...s }) => (void planned, { ...s, steps: s.steps.map(({ id, label, shown, progress, expect }) => ({ id, label, shown, progress, ...(expect ? { expect } : {}) })) }));
}

// ── tools WalkMyCode fetches or installs ──

const COMPOSER_URL = "https://getcomposer.org/download/latest-stable/composer.phar";

/** Download composer.phar, check it against the SHA-256 getcomposer.org publishes, and save it. Progress lines go to `say`. */
export async function fetchComposer(to: string, signal: AbortSignal, say: (text: string) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  say(`Downloading ${COMPOSER_URL}\n`);
  const [res, sumRes] = await Promise.all([fetchImpl(COMPOSER_URL, { signal }), fetchImpl(`${COMPOSER_URL}.sha256sum`, { signal })]);
  if (!res.ok || !res.body) throw new Error(`getcomposer.org answered ${res.status}.`);
  if (!sumRes.ok) throw new Error(`getcomposer.org's checksum answered ${sumRes.status}.`);
  const want = (await sumRes.text()).trim().split(/\s+/)[0].toLowerCase();
  const total = Number(res.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let got = 0;
  let shown = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    // A line per ~256 KB: "1.2 MB / 3.0 MB", which the progress reader turns into the bar.
    if (got - shown > 256 * 1024 || got === total) {
      shown = got;
      say(`${(got / 1048576).toFixed(1)} MB / ${total ? (total / 1048576).toFixed(1) : "?"} MB\n`);
    }
  }
  const body = Buffer.concat(chunks);
  const have = createHash("sha256").update(body).digest("hex");
  if (!want || have !== want) throw new Error(`The download's SHA-256 (${have.slice(0, 12)}…) doesn't match getcomposer.org's (${want.slice(0, 12)}…): not saved.`);
  say("Checksum matches getcomposer.org's.\n");
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(`${to}.tmp`, body);
  renameSync(`${to}.tmp`, to);
  say(`Saved Composer to ${to}\n`);
}

/**
 * After installing a tool: PATH as Windows now has it (machine + user, from the
 * registry), merged into this process's, so the new program is found without
 * restarting WalkMyCode. Elsewhere installers put tools on the PATH already seen.
 */
export function refreshPath(env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "win32") return;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "Path";
    const seen = new Set<string>();
    const merged = [...(env[key] ?? "").split(";"), ...out.trim().split(";")].filter((p) => {
      const k = p.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    env[key] = merged.join(";");
  } catch {
    // PATH stays as it was; a restart of WalkMyCode picks the tool up.
  }
}

/**
 * How much winget has downloaded so far: the size of its folder for this
 * package in %TEMP%\WinGet (one per "<id>.<version>"), said as "Downloaded
 * 12.3 MB" whenever it grows. Returns the stop.
 */
function watchWingetDownload(args: string[], say: (text: string) => void): () => void {
  const id = args[args.indexOf("--id") + 1];
  if (!id) return () => {};
  const root = join(process.env.TEMP ?? process.env.TMP ?? homedir(), "WinGet");
  const sizeOf = (dir: string): number => {
    let total = 0;
    try {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        const st = statSync(p);
        total += st.isDirectory() ? sizeOf(p) : st.size;
      }
    } catch {
      // gone or busy: counted next time
    }
    return total;
  };
  let shown = 0;
  const t = setInterval(() => {
    let bytes = 0;
    try {
      for (const n of readdirSync(root)) if (n.toLowerCase().startsWith(`${id.toLowerCase()}.`)) bytes += sizeOf(join(root, n));
    } catch {
      return;
    }
    if (bytes > shown + 64 * 1024) {
      shown = bytes;
      say(`Downloaded ${(bytes / 1048576).toFixed(1)} MB\n`);
    }
  }, 400);
  return () => clearInterval(t);
}

// ── running one planned step ──

/** A setup step may take a while (a big install): stopped after this long. */
export const SETUP_TIMEOUT_S = 20 * 60;
const OUTPUT_CAP = 4 * 1024 * 1024;

export interface StepEvents {
  start(info: { shown: string; cwd: string; version: string | null; program: string; temp: boolean }): void;
  out(stream: "out" | "err", text: string): void;
  exit(info: { code: number | null; signal: string | null; timedOut: boolean; stopped: boolean; ms: number; cut: boolean }): void;
}

/** Run one step the server planned; output and the end go to `ev`. Returns how to stop it. */
export function runSetupStep(step: PlannedStep, ev: StepEvents): { stop(): void } {
  const t0 = Date.now();
  ev.start({ shown: step.shown, cwd: step.cwd, version: null, program: step.file ?? "copy", temp: false });
  if (step.file === null && step.builtin === "composer") {
    const ac = new AbortController();
    let stopped = false;
    void fetchComposer(step.args[0], ac.signal, (text) => ev.out("out", text)).then(
      () => ev.exit({ code: 0, signal: null, timedOut: false, stopped: false, ms: Date.now() - t0, cut: false }),
      (e: unknown) => {
        if (!stopped) ev.out("err", `${(e as Error).message}\n`);
        ev.exit({ code: 1, signal: null, timedOut: false, stopped, ms: Date.now() - t0, cut: false });
      },
    );
    return {
      stop() {
        stopped = true;
        ac.abort();
      },
    };
  }
  if (step.file === null && step.builtin === "php-ini") {
    let code = 0;
    try {
      enablePhpExtensions(step.args[0], step.args.slice(1), (t) => ev.out("out", t));
    } catch (e) {
      code = 1;
      ev.out("err", `${(e as Error).message}\n`);
    }
    ev.exit({ code, signal: null, timedOut: false, stopped: false, ms: Date.now() - t0, cut: false });
    return { stop() {} };
  }
  if (step.file === null && step.builtin === "starter") {
    // FastAPI and Express: a few files WalkMyCode writes itself (./starters.ts), never over a folder that's there.
    let code = 0;
    try {
      writeStarter(step.cwd, step.args[0], step.args[1], (t) => ev.out("out", t));
    } catch (e) {
      code = 1;
      ev.out("err", `Could not write the project: ${(e as Error).message}\n`);
    }
    ev.exit({ code, signal: null, timedOut: false, stopped: false, ms: Date.now() - t0, cut: false });
    return { stop() {} };
  }
  if (step.file === null && step.builtin === "touch") {
    // An empty file (Laravel's SQLite database): never over one that's there.
    const to = join(step.cwd, step.args[0]);
    let code = 0;
    try {
      if (existsSync(to)) ev.out("out", `${step.args[0]} is there already: left as it is.\n`);
      else {
        writeFileSync(to, "", { flag: "wx" });
        ev.out("out", `Made ${step.args[0]}.\n`);
      }
    } catch (e) {
      code = 1;
      ev.out("err", `Could not make ${step.args[0]}: ${(e as Error).message}\n`);
    }
    ev.exit({ code, signal: null, timedOut: false, stopped: false, ms: Date.now() - t0, cut: false });
    return { stop() {} };
  }
  if (step.file === null) {
    // The built-in .env copy: never over an existing .env.
    const from = join(step.cwd, step.args[0]);
    const to = join(step.cwd, ".env");
    let code = 0;
    try {
      if (existsSync(to)) ev.out("out", ".env is there already: left as it is.\n");
      else {
        copyFileSync(from, to);
        ev.out("out", `Copied ${step.args[0]} to .env. Fill in your own values before you run it.\n`);
      }
    } catch (e) {
      code = 1;
      ev.out("err", `Could not copy ${step.args[0]}: ${(e as Error).message}\n`);
    }
    ev.exit({ code, signal: null, timedOut: false, stopped: false, ms: Date.now() - t0, cut: false });
    return { stop() {} };
  }
  let ended = false;
  let stopped = false;
  let timedOut = false;
  let cut = false;
  let size = 0;
  // Plain output (no colours, no spinners), so the page can read the progress lines.
  // Composer's and npm's end-of-install audit calls a web API that can hang for minutes on some networks: skipped here (run `composer audit` / `npm audit` any time).
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", PIP_PROGRESS_BAR: "off", PIP_DISABLE_PIP_VERSION_CHECK: "1", npm_config_progress: "false", npm_config_fund: "false", npm_config_audit: "false", COMPOSER_NO_AUDIT: "1", COMPOSER_NO_INTERACTION: "1" };
  let child: ReturnType<typeof spawnTracked> | null = null;
  const kill = () => killTree(child?.pid);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, SETUP_TIMEOUT_S * 1000);
  const finish = (code: number | null, signal: string | null) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    clearInterval(quiet);
    ev.exit({ code, signal, timedOut, stopped, ms: Date.now() - t0, cut });
  };
  // A step that goes quiet (a download, a network call) says so every 30 s, so it never looks frozen.
  let lastOut = Date.now();
  const quiet = setInterval(() => {
    const s = Math.round((Date.now() - lastOut) / 1000);
    if (s >= 30) ev.out("out", `… quiet for ${s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}, still running`+"\n");
  }, 30_000);
  const forward = (stream: "out" | "err") => (b: Buffer) => {
    lastOut = Date.now();
    if (cut) return;
    size += b.length;
    if (size > OUTPUT_CAP) {
      cut = true;
      ev.out("err", "\n… output cut after 4 MB.\n");
      return;
    }
    ev.out(stream, b.toString("utf8"));
  };
  try {
    child = spawnTracked(step.file, step.args, { cwd: step.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    ev.out("err", `Could not start ${basename(step.file)}: ${(e as Error).message}\n`);
    finish(null, null);
    return { stop() {} };
  }
  child.stdout?.on("data", forward("out"));
  child.stderr?.on("data", forward("err"));
  // winget prints no progress without a terminal: measure its download folder instead, so the page sees megabytes arrive.
  const watch = step.progress === "winget" ? watchWingetDownload(step.args, (text) => ev.out("out", text)) : null;
  child.once("close", () => watch?.());
  child.once("error", (e) => {
    ev.out("err", `Could not start ${basename(step.file!)}: ${e.message}\n`);
    finish(null, null);
  });
  child.once("close", (code, signal) => finish(code, signal));
  return {
    stop() {
      if (ended) return;
      stopped = true;
      kill();
    },
  };
}
