// WalkMyCode desktop (docs/DESKTOP.md): the title bar's drag regions appear only in the
// desktop app; a folder picked with the system's picker is read on the server with the
// browser reader's rules; the server finds its own scripts through WALKMYCODE_APP_DIR;
// the update feed is written from signed installers only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { appDir } from "../src/lib/dataDir";
import { dragRegion, isDesktop } from "../src/lib/desktop";
import { DESKTOP_BOOT } from "../src/lib/desktopBoot";
import { keep, skipDir } from "../src/lib/folderRules";
import { readFolderAt } from "../src/lib/serverFolder";

describe("desktop: the title bar", () => {
  it("drags the window only in the desktop app", () => {
    assert.deepEqual(dragRegion(false), {});
    assert.deepEqual(dragRegion(true), { "data-tauri-drag-region": "" });
  });

  it("is not the desktop app outside Tauri (here: no window at all)", () => {
    assert.equal(isDesktop(), false);
  });

  it("marks <html> only where Tauri's IPC is", () => {
    const run = (win: Record<string, unknown>) => {
      const html = { dataset: {} as Record<string, string> };
      new Function("window", "document", DESKTOP_BOOT)(win, { documentElement: html });
      return html.dataset;
    };
    assert.deepEqual(run({}), {});
    assert.deepEqual(run({ __TAURI_INTERNALS__: {} }), { desktop: "" });
  });
});

describe("desktop: a folder read by its path", () => {
  const root = mkdtempSync(join(tmpdir(), "wmc-desktop-"));
  const put = (path: string, text = "x") => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put("package.json", '{"name":"app"}');
  put("src/index.ts", "export const a = 1;");
  put("node_modules/dep/index.js", "module.exports = 1;");
  put(".git/config", "[core]");
  put(".github/workflows/deploy.yml", "on: push");
  put(".env", "SECRET=1");
  put("public/logo.png", "png");
  put("bin.ts", "a\0b");
  put("pubspec.yaml", "name: app");
  put("android/Main.kt", "class Main");

  it("keeps code and config, skips dependencies, hidden folders, binaries and .env", async () => {
    const r = await readFolderAt(root);
    assert.ok(!("error" in r));
    const paths = r.files.map((f) => f.path).sort();
    assert.ok(paths.includes("package.json"));
    assert.ok(paths.includes("src/index.ts"));
    assert.ok(paths.includes(".github/workflows/deploy.yml"));
    assert.ok(!paths.some((p) => p.startsWith("node_modules/") || p.startsWith(".git/") || p.startsWith("android/")), paths.join(", "));
    assert.ok(!paths.includes(".env"));
    assert.ok(!paths.includes("bin.ts"), "a file with a NUL byte is not text");
    assert.equal(r.capped, false);
    assert.equal(r.path, root);
  });

  it("asks for a full path to an existing folder", async () => {
    assert.ok("error" in (await readFolderAt("relative/path")));
    assert.ok("error" in (await readFolderAt(join(root, "missing"))));
    assert.ok("error" in (await readFolderAt(join(root, "package.json"))));
  });

  it("uses the browser reader's rules", () => {
    assert.equal(skipDir("node_modules", "node_modules", { flutter: false, composer: false }), true);
    assert.equal(skipDir(".github", ".github", { flutter: false, composer: false }), false);
    assert.equal(skipDir("android", "android", { flutter: true, composer: false }), true);
    assert.equal(skipDir("android", "android", { flutter: false, composer: false }), false);
    assert.equal(skipDir("storage", "storage", { flutter: false, composer: true }), true);
    assert.equal(keep("src/a.ts"), true);
    assert.equal(keep(".env"), false);
  });

  it("cleans up", () => rmSync(root, { recursive: true, force: true }));
});

describe("desktop: the server's own files", () => {
  it("are in WALKMYCODE_APP_DIR when set, else where the server runs", () => {
    assert.equal(appDir({ WALKMYCODE_APP_DIR: "/opt/walkmycode/server" }), "/opt/walkmycode/server");
    assert.equal(appDir({}), process.cwd());
  });
});

describe("desktop: the update feed", { skip: !existsSync("scripts/desktop/latest-json.mjs") }, () => {
  it("lists each platform's signed installer", () => {
    const dir = mkdtempSync(join(tmpdir(), "wmc-feed-"));
    for (const f of ["WalkMyCode_0.2.0_x64-setup.exe", "WalkMyCode_0.2.0_amd64.AppImage", "WalkMyCode_0.2.0_amd64.deb"]) {
      writeFileSync(join(dir, f), "bin");
      writeFileSync(join(dir, `${f}.sig`), `sig-of-${f}\n`);
    }
    execFileSync(process.execPath, ["scripts/desktop/latest-json.mjs", "--dir", dir, "--tag", "v0.2.0", "--base", "https://example.com/dl/v0.2.0"]);
    const feed = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    assert.equal(feed.version, "0.2.0");
    assert.equal(feed.platforms["windows-x86_64"].url, "https://example.com/dl/v0.2.0/WalkMyCode_0.2.0_x64-setup.exe");
    assert.equal(feed.platforms["windows-x86_64"].signature, "sig-of-WalkMyCode_0.2.0_x64-setup.exe");
    assert.ok(feed.platforms["linux-x86_64"].url.endsWith(".AppImage"));
    assert.ok(feed.platforms["linux-x86_64-deb"].url.endsWith(".deb"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an installer without its signature", () => {
    const dir = mkdtempSync(join(tmpdir(), "wmc-feed-"));
    writeFileSync(join(dir, "WalkMyCode_0.2.0_x64-setup.exe"), "bin");
    assert.throws(() => execFileSync(process.execPath, ["scripts/desktop/latest-json.mjs", "--dir", dir, "--tag", "v0.2.0", "--base", "https://x"], { stdio: "pipe" }));
    rmSync(dir, { recursive: true, force: true });
  });
});
