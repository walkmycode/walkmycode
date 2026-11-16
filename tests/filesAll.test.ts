// Every file in Files, and searching them (owner, 13 Nov; mockup docs/design/files-all.html): what the readers
// list beside the code (src/analyzer/config/files.ts), how the tree shows it (src/lib/fileTree.ts) and the fuzzy
// search (src/lib/fileSearch.ts).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { listsHiddenDir, otherFileMode } from "../src/analyzer/config/files";
import { buildTree, fileKind, flatten } from "../src/lib/fileTree";
import { fuzzy, searchFiles } from "../src/lib/fileSearch";
import { readDir } from "../scripts/readDir";
import { readFolderAt } from "../src/lib/serverFolder";

const PATHS = [
  "Cargo.toml",
  "README.md",
  "src/main.rs",
  "src/routes/payments.rs",
  "src/routes/params.rs",
  "01_foundations/06_ownership/README.md",
  "01_foundations/06_ownership/examples/borrowing_rules.rs",
  "01_foundations/06_ownership/examples/move_semantics.rs",
  "docs/images/flow.png",
  "assets/screenshot.png",
];

describe("searching every file", () => {
  it("finds a file by a few of its letters, the file's own name first", () => {
    assert.equal(searchFiles(PATHS, "bor").hits[0].path, "01_foundations/06_ownership/examples/borrowing_rules.rs");
    assert.equal(searchFiles(PATHS, "main").hits[0].path, "src/main.rs");
    // Word starts beat letters in the middle: R(EAD)ME, the shorter path first.
    assert.deepEqual(searchFiles(PATHS, "rme").hits.slice(0, 2).map((h) => h.path), ["README.md", "01_foundations/06_ownership/README.md"]);
  });

  it("needs the letters in order, ignores case and spaces, and lights the letters it matched", () => {
    assert.equal(fuzzy("src/main.rs", "nm"), null);
    assert.equal(fuzzy("src/main.rs", ""), null);
    const h = fuzzy("src/main.rs", "MA in")!;
    assert.deepEqual(h.at.map((i) => "src/main.rs"[i]).join(""), "main");
  });

  it("matches across folders, and counts every match while drawing at most the limit", () => {
    assert.equal(searchFiles(PATHS, "routespay").hits[0].path, "src/routes/payments.rs");
    const many = Array.from({ length: 500 }, (_, i) => `src/file${i}.ts`);
    const r = searchFiles(many, "file", 200);
    assert.equal(r.hits.length, 200);
    assert.equal(r.total, 500);
    // Loose matches count too (borrowing_rules: p…n…g), but the images come first.
    assert.deepEqual(searchFiles(PATHS, "png").hits.slice(0, 2).map((h) => h.path).sort(), ["assets/screenshot.png", "docs/images/flow.png"]);
  });
});

describe("the tree lists every file", () => {
  const map = { files: [{ path: "src/main.rs", lang: "rs", lines: 3, area: "app" }, { path: "Cargo.toml", lang: "config", lines: 9, area: "app" }] } as never;

  it("the map's files, then the rest of the folder, quieter, each with its kind", () => {
    const root = buildTree(map, ["src/main.rs", "Cargo.toml", "README.md", "docs/images/flow.png", "LICENSE"]);
    const rows = flatten(root, new Set(["src", "docs", "docs/images"]));
    const by = new Map(rows.map((r) => [r.path, r]));
    assert.equal(by.get("src/main.rs")?.unmapped, undefined);
    assert.equal(by.get("src/main.rs")?.fileKind, "code");
    assert.equal(by.get("Cargo.toml")?.fileKind, "config");
    assert.equal(by.get("README.md")?.unmapped, true);
    assert.equal(by.get("README.md")?.fileKind, "doc");
    assert.equal(by.get("LICENSE")?.fileKind, "doc");
    assert.equal(by.get("docs/images/flow.png")?.fileKind, "image");
    // Nothing twice: the map's own file is not listed again.
    assert.equal(rows.filter((r) => r.path === "src/main.rs").length, 1);
  });

  it("knows a file's kind by its name", () => {
    assert.equal(fileKind("app/page.tsx"), "code");
    assert.equal(fileKind("notes.txt"), "doc");
    assert.equal(fileKind("Cargo.lock"), "config");
    assert.equal(fileKind(".gitignore"), "config");
    assert.equal(fileKind("public/logo.svg"), "image");
    assert.equal(fileKind("assets/Inter.woff2"), "other");
  });
});

describe("what the readers list beside the code", () => {
  it("reads small documents, lists the rest by path, and never a secret, not even its name", () => {
    assert.equal(otherFileMode("README.md"), "doc");
    assert.equal(otherFileMode("LICENSE"), "doc");
    assert.equal(otherFileMode(".gitignore"), "doc");
    assert.equal(otherFileMode("docs/flow.png"), "path");
    assert.equal(otherFileMode("Cargo.lock"), "path");
    for (const secret of [".env", ".env.local", "config/.env.production", "id_rsa", "certs/server.key", ".npmrc", "secrets.json", "credentials.json"]) assert.equal(otherFileMode(secret), null, secret);
  });

  it("lists hidden folders' files, but never .git, caches or editors' private state", () => {
    for (const d of [".vscode", ".husky", ".cargo", ".devcontainer", ".github"]) assert.equal(listsHiddenDir(d), true, d);
    for (const d of [".git", ".next", ".cache", ".venv", ".idea", ".ssh", ".walkmycode"]) assert.equal(listsHiddenDir(d), false, d);
    assert.equal(listsHiddenDir("src"), false);
  });

  it("a real folder: README and LICENSE with their text, an image and a big document by path, no .env, no node_modules or .git", async () => {
    const root = await mkdtemp(join(tmpdir(), "walkmycode-all-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "docs"), { recursive: true });
      await mkdir(join(root, "node_modules", "x"), { recursive: true });
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(join(root, ".husky"), { recursive: true });
      await writeFile(join(root, "src", "main.ts"), "export const a = 1;\n");
      await writeFile(join(root, "README.md"), "# Hello\n");
      await writeFile(join(root, "LICENSE"), "MIT\n");
      await writeFile(join(root, "docs", "flow.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
      await writeFile(join(root, "docs", "big.md"), "x".repeat(600_000));
      await writeFile(join(root, ".env"), "KEY=1\n");
      await writeFile(join(root, ".husky", "pre-commit"), "npm test\n");
      await writeFile(join(root, "node_modules", "x", "index.js"), "1\n");
      await writeFile(join(root, ".git", "HEAD"), "ref\n");
      // The CLI's and Claude's reader, and the desktop app's (by path): the same files, the same way.
      const desktop = await readFolderAt(root);
      assert.ok("files" in desktop);
      const fromDesktop = new Map(desktop.files.map((s) => [s.path, s.content]));
      const got = new Map((await readDir(root)).map((s) => [s.path, s.content]));
      assert.deepEqual([...fromDesktop.entries()].sort(), [...got.entries()].sort());
      assert.equal(got.get("src/main.ts"), "export const a = 1;\n");
      assert.equal(got.get("README.md"), "# Hello\n");
      assert.equal(got.get("LICENSE"), "MIT\n");
      assert.equal(got.get("docs/flow.png"), "");
      assert.equal(got.get("docs/big.md"), "", "over 512 KB: listed, not read");
      assert.equal(got.get(".husky/pre-commit"), "");
      for (const never of [".env", "node_modules/x/index.js", ".git/HEAD"]) assert.equal(got.has(never), false, never);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
