// Code in languages the map doesn't draw yet (src/analyzer/config/files.ts readableLanguage): read, listed and
// counted for the guide, never drawn. Before this, a Rust project was empty: no file to read or search.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readDir } from "../scripts/readDir";
import { buildMap } from "../src/analyzer/build";
import { isReadablePath, readableLanguage } from "../src/analyzer/config/files";

const dir = mkdtempSync(join(tmpdir(), "wmc-other-"));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, "src"), { recursive: true });
mkdirSync(join(dir, "target", "debug"), { recursive: true });
writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "demo"\n');
writeFileSync(join(dir, "src", "main.rs"), "mod pay;\nfn main() { pay::run(); }\n");
writeFileSync(join(dir, "src", "pay.rs"), "pub fn run() {}\n");
writeFileSync(join(dir, "target", "debug", "build.rs"), "// generated\n");

describe("code in languages the map doesn't draw yet", () => {
  it("names the language from the extension", () => {
    assert.equal(readableLanguage("src/main.rs"), "Rust");
    assert.equal(readableLanguage("cmd/api/main.go"), "Go");
    assert.equal(readableLanguage("App.Kt"), "Kotlin");
    assert.equal(readableLanguage("app/page.tsx"), null, "the map's own languages are not 'other'");
    assert.equal(isReadablePath("notes.txt"), false);
  });

  it("a Rust project is read (not its target/), counted and listed for the guide, with nothing drawn", async () => {
    const sources = await readDir(dir);
    assert.deepEqual(sources.map((s) => s.path).sort(), ["Cargo.toml", "src/main.rs", "src/pay.rs"]);
    const { map } = await buildMap(sources, { name: "demo" });
    assert.deepEqual(map.stats.otherCode, { Rust: 2 });
    assert.equal(map.nodes.length, 0);
    assert.deepEqual(
      map.files.map((f) => [f.path, f.skipped]),
      [
        ["src/main.rs", "Rust isn't drawn on the map yet"],
        ["src/pay.rs", "Rust isn't drawn on the map yet"],
      ],
    );
  });
});
