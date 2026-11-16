// A saved map keeps what the analyzer could draw when it was made. ferrisworks, a Rust project mapped before
// Rust was on the map (PR #47), still opened empty, saying "The map doesn't draw Rust yet".
// Now the map says it was made before WalkMyCode could draw Rust and maps the folder again in one click
// (src/analyzer/migrate.ts drawnSince, src/lib/remap.ts, src/components/MapAgain.tsx).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { keepsCode, readDir } from "../scripts/readDir";
import { buildMap } from "../src/analyzer/build";
import { DRAWN, drawnLang, drawsLanguage, READABLE, readableLanguage, redactSource } from "../src/analyzer/config/files";
import { drawnSince, upgradeMap } from "../src/analyzer/migrate";
import type { CodeMap } from "../src/analyzer/types";
import { keep } from "../src/lib/folderRules";
import { listOf, mapAgain, mapAgainHow, mapAgainWords, type Build } from "../src/lib/remap";
import type { Workspace } from "../src/lib/store";
import "./analyzer.helpers"; // loads the grammars from node_modules

const dir = mkdtempSync(join(tmpdir(), "wmc-again-"));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, "src"), { recursive: true });
writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "ferrisworks"\n');
writeFileSync(join(dir, "src", "main.rs"), "mod pay;\nfn main() { pay::run(); }\n");
writeFileSync(join(dir, "src", "pay.rs"), "pub fn run() {}\n");

/** ferrisworks as it was saved: no cards, its Rust counted as code the map didn't draw. */
function oldRustMap(otherCode: Record<string, number> = { Rust: 2 }): CodeMap {
  return upgradeMap({ version: 2, name: "ferrisworks", nodes: [], edges: [], files: [], stats: { files: 3, parsed: 0, otherCode } }, "local");
}
function workspaceOf(map: CodeMap, repo: Partial<Workspace["repos"][number]> = {}): Workspace {
  return { id: "old", name: "ferrisworks", map, files: {}, repos: [{ label: "ferrisworks", kind: "local", fileCount: 3, addedAt: "2026-11-01T00:00:00.000Z", ...repo }] };
}
const build: Build = async ({ sources, name, repos, assertions }) => {
  const { map } = await buildMap(sources, { name, repos, assertions });
  return { map, contents: Object.fromEntries(sources.map((s) => [s.path, redactSource(s.path, s.content)])) };
};

describe("what the analyzer draws: one list", () => {
  it("no extension is both drawn and only readable, and no language is both", () => {
    for (const ext of Object.keys(DRAWN)) assert.equal(Object.hasOwn(READABLE, ext), false, ext);
    const drawn = new Set(Object.values(DRAWN).map((d) => d.name));
    for (const name of Object.values(READABLE)) assert.equal(drawn.has(name), false, name);
  });

  it("the analyzer, both folder readers and the check read the same list", () => {
    assert.equal(drawnLang("src/main.rs"), "rust");
    assert.equal(drawnLang("App.TSX"), "tsx");
    assert.equal(drawnLang("lib/x.cts"), "ts");
    assert.equal(drawnLang("main.go"), null);
    assert.equal(drawnLang("weird.constructor"), null, "an extension is never a property of every object");
    assert.equal(readableLanguage("weird.toString"), null);
    for (const p of ["src/main.rs", "app/page.tsx", "lib/db.py", "lib/main.dart", "src/Kernel.php"]) {
      assert.equal(keep(p), true, `browser/desktop reader: ${p}`);
      assert.equal(keepsCode(p), true, `CLI reader: ${p}`);
    }
    assert.equal(keepsCode("main.go"), false, "Go is kept as readable code, not as code the map draws");
    assert.equal(drawsLanguage("Rust"), true);
    assert.equal(drawsLanguage("Go"), false);
  });
});

describe("a map made before WalkMyCode could draw its language", () => {
  it("names the languages drawn since, most files first, and nothing for a map that is up to date", () => {
    assert.deepEqual(drawnSince(oldRustMap({ Rust: 7 })), [{ name: "Rust", files: 7 }]);
    assert.deepEqual(drawnSince(oldRustMap({ Go: 4, Rust: 7 })), [{ name: "Rust", files: 7 }], "Go isn't drawn yet");
    assert.deepEqual(drawnSince(oldRustMap({ Go: 4 })), []);
    assert.deepEqual(drawnSince({ stats: { ...oldRustMap().stats, otherCode: undefined } }), []);
    assert.deepEqual(drawnSince(oldRustMap({ Rust: 2, Python: 5 })), [{ name: "Python", files: 5 }, { name: "Rust", files: 2 }]);
  });

  it("a map made today has nothing drawn since", async () => {
    const { map } = await buildMap(await readDir(dir), { name: "ferrisworks" });
    assert.ok(map.nodes.length > 0);
    assert.deepEqual(drawnSince(map), []);
  });

  it("offers Refresh where a handle or a desktop path was kept, the folder picker otherwise", () => {
    const map = oldRustMap();
    assert.equal(mapAgainHow(workspaceOf(map, { path: "C:\\code\\ferrisworks" }), "full"), "refresh");
    assert.equal(mapAgainHow(workspaceOf(map, { handle: {} as FileSystemDirectoryHandle }), "full"), "refresh");
    assert.equal(mapAgainHow(workspaceOf(map), "full"), "choose");
    assert.equal(mapAgainHow(workspaceOf(map), "lite"), "choose");
    const two = { ...workspaceOf(map), repos: [workspaceOf(map, { path: "C:\\a" }).repos[0], { ...workspaceOf(map).repos[0], label: "web" }] };
    assert.equal(mapAgainHow(two, "full"), "folders", "several folders, one of them not readable again");
  });

  it("an indexed map (npm run index, /api/demo) says to index it again; WalkMyCode for Claude asks Claude", () => {
    const indexed = { ...oldRustMap(), repos: [{ label: "ferrisworks", prefix: "", kind: "cli" as const }] };
    const opened: Workspace = { ...workspaceOf(indexed), repos: [{ ...workspaceOf(indexed).repos[0], kind: "demo" }] };
    assert.equal(mapAgainHow(opened, "full"), "index");
    assert.equal(mapAgainHow(workspaceOf(indexed), "mcp"), "claude");
    const w = mapAgainWords([{ name: "Rust", files: 7 }], "index");
    assert.equal(w.title, "This map was indexed before WalkMyCode could draw Rust.");
    assert.match(w.body, /npm run index/);
    assert.equal(w.action, undefined, "the page can't run the indexer");
  });

  it("says it plainly, with one action", () => {
    assert.deepEqual(mapAgainWords([{ name: "Rust", files: 7 }], "refresh"), {
      title: "This map was made before WalkMyCode could draw Rust.",
      body: "Map the folder again to draw its 7 Rust files.",
      action: "Map again",
    });
    assert.equal(mapAgainWords([{ name: "Rust", files: 1 }], "choose").body, "Choose the folder again to draw its 1 Rust file.");
    assert.equal(mapAgainWords([{ name: "Rust", files: 1 }], "choose").action, "Choose the folder");
    assert.equal(mapAgainWords([{ name: "Rust", files: 3 }], "refresh", 2).body, "Map the folders again to draw its 3 Rust files.");
    assert.equal(listOf(["Rust", "Go", "Java"]), "Rust, Go and Java");
  });

  it("one click: the folder read again is mapped, Rust and all, under the same name and answers", async () => {
    const answer = { setting: "API_URL", service: null, at: "2026-11-01T00:00:00.000Z" } as unknown as NonNullable<Workspace["assertions"]>[number];
    const old: Workspace = { ...workspaceOf(oldRustMap(), { path: dir }), assertions: [answer] };
    assert.equal(old.map.nodes.length, 0);
    const files = await readDir(dir);
    const next = await mapAgain(old, [{ name: "ferrisworks", files, path: dir }], build, "new");
    assert.equal(next.id, "new", "a new id: the room starts afresh on the new map");
    assert.equal(next.name, "ferrisworks");
    assert.equal(next.repos[0].path, dir, "Refresh still works next time");
    assert.deepEqual(next.assertions, old.assertions);
    assert.ok(next.map.nodes.some((n) => n.file === "src/main.rs"), "Rust is on the map");
    assert.ok(next.map.edges.some((e) => e.kind === "imports"), "mod pay; is an arrow");
    assert.deepEqual(drawnSince(next.map), []);
    assert.equal(next.files["src/pay.rs"], "pub fn run() {}\n");
  });

  it("a folder chosen again is named after itself, as when it was first mapped", async () => {
    const next = await mapAgain(workspaceOf(oldRustMap()), [{ name: "ferrisworks-2", files: await readDir(dir) }], build, "n");
    assert.equal(next.name, "ferrisworks-2");
    assert.equal(next.repos[0].label, "ferrisworks-2");
  });
});
