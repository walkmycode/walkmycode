// Code in languages the map doesn't draw yet (src/analyzer/config/files.ts readableLanguage): read, listed and
// counted for the guide, never drawn. Before this, a Go project was empty: no file to read or search. Rust is
// drawn since 11 Nov 2026 (tests/rust.test.ts); its build output (target/) is still never read.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readDir } from "../scripts/readDir";
import { buildMap } from "../src/analyzer/build";
import { isReadablePath, readableLanguage } from "../src/analyzer/config/files";
import "./analyzer.helpers"; // loads the grammars from node_modules

const dir = mkdtempSync(join(tmpdir(), "wmc-other-"));
const rust = mkdtempSync(join(tmpdir(), "wmc-rust-"));
after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(rust, { recursive: true, force: true });
});
mkdirSync(join(dir, "cmd", "api"), { recursive: true });
mkdirSync(join(dir, "vendor", "lib"), { recursive: true });
writeFileSync(join(dir, "go.mod"), "module example.com/demo\n");
writeFileSync(join(dir, "cmd", "api", "main.go"), "package main\n\nfunc main() {}\n");
writeFileSync(join(dir, "cmd", "api", "pay.go"), "package main\n\nfunc run() {}\n");
writeFileSync(join(dir, "vendor", "lib", "lib.go"), "package lib\n");
mkdirSync(join(rust, "src"), { recursive: true });
mkdirSync(join(rust, "target", "debug"), { recursive: true });
writeFileSync(join(rust, "Cargo.toml"), '[package]\nname = "demo"\n');
writeFileSync(join(rust, "src", "main.rs"), "mod pay;\nfn main() { pay::run(); }\n");
writeFileSync(join(rust, "src", "pay.rs"), "pub fn run() {}\n");
writeFileSync(join(rust, "target", "debug", "build.rs"), "// generated\n");

describe("code in languages the map doesn't draw yet", () => {
  it("names the language from the extension", () => {
    assert.equal(readableLanguage("src/main.rs"), null, "Rust is drawn now");
    assert.equal(readableLanguage("cmd/api/main.go"), "Go");
    assert.equal(readableLanguage("App.Kt"), "Kotlin");
    assert.equal(readableLanguage("app/page.tsx"), null, "the map's own languages are not 'other'");
    assert.equal(isReadablePath("notes.txt"), false);
  });

  it("a Go project is read (not its vendor/), counted and listed for the guide, with nothing drawn", async () => {
    const sources = await readDir(dir);
    assert.deepEqual(sources.map((s) => s.path).sort(), ["cmd/api/main.go", "cmd/api/pay.go", "go.mod"]);
    const { map } = await buildMap(sources, { name: "demo" });
    assert.deepEqual(map.stats.otherCode, { Go: 2 });
    assert.equal(map.nodes.length, 0);
    assert.deepEqual(
      map.files.map((f) => [f.path, f.skipped]),
      [
        ["cmd/api/main.go", "Go isn't drawn on the map yet"],
        ["cmd/api/pay.go", "Go isn't drawn on the map yet"],
      ],
    );
  });

  it("a Rust project is drawn, and its target/ is never read", async () => {
    const sources = await readDir(rust);
    assert.deepEqual(sources.map((s) => s.path).sort(), ["Cargo.toml", "src/main.rs", "src/pay.rs"]);
    const { map } = await buildMap(sources, { name: "demo" });
    assert.equal(map.stats.otherCode, undefined);
    assert.ok(map.edges.some((e) => e.kind === "imports" && e.from === "file:src/main.rs" && e.to === "file:src/pay.rs"));
  });
});
