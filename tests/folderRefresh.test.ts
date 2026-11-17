// Explore keeps up with its folders. The owner made SYNTAX.md in a Rust project that was already mapped, and
// it never showed: a folder was read once and Explore only ever showed that. Now Explore lists the folder again
// (sizes and times, no text: src/lib/folderList.ts), compares it with the map, reads only what changed and
// builds the map again in place (src/lib/folderCheck.ts, src/lib/remap.ts updateInPlace), on focus, every
// minute and with "Refresh files" (src/shell/folderWatch.tsx), and a check on its own never asks for permission.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { redactSource } from "../src/analyzer/config/files";
import { canCheck, checkFolders, folderIo, type FolderIo } from "../src/lib/folderCheck";
import { changeWords, diffFolder, seenOf, type Listed } from "../src/lib/folderList";
import { listHandle } from "../src/lib/localFolder";
import { knownFiles, updateInPlace, type Build } from "../src/lib/remap";
import { listFolderAt, readFilesAt, readFolderAt } from "../src/lib/serverFolder";
import type { Workspace } from "../src/lib/store";
import "./analyzer.helpers"; // loads the grammars from node_modules

const build: Build = async ({ sources, name, repos, assertions }) => {
  const { map } = await buildMap(sources, { name, repos, assertions });
  const secret = new Set(map.files.filter((f) => f.skipped === "secret").map((f) => f.path));
  return { map, contents: Object.fromEntries(sources.filter((s) => !secret.has(s.path)).map((s) => [s.path, redactSource(s.path, s.content)])) };
};

const tmp: string[] = [];
after(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});
function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "wmc-refresh-"));
  tmp.push(root);
  for (const [p, text] of Object.entries(files)) put(root, p, text);
  return root;
}
function put(root: string, path: string, text: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A workspace mapped from `root` as the app maps a folder, read `readAt`. */
async function mapped(root: string, label = "app", readAt = "2026-11-16T05:00:00.000Z"): Promise<Workspace> {
  const r = await readFolderAt(root);
  assert.ok(!("error" in r));
  const { map, contents } = await build({ sources: r.files, name: label, repos: [{ label, prefix: "", kind: "local" }], assertions: [] });
  return { id: "ws-1", name: label, map, files: contents, repos: [{ label, kind: "local", path: root, fileCount: r.files.length, addedAt: readAt }] };
}

const L = (path: string, size: number, mtimeMs: number, mode: Listed["mode"] = "code"): Listed => ({ path, size, mtimeMs, mode });

describe("folder refresh: what changed, by path, size and time", () => {
  const before = [L("src/main.rs", 100, 1000), L("src/lib.rs", 50, 1000), L("README.md", 10, 1000, "doc"), L("Cargo.toml", 30, 1000)];
  const seen = seenOf(before);
  const paths = before.map((f) => f.path);

  it("a new file is added, a resized or rewritten one changed, a missing one removed, and the rest ignored", () => {
    const now = [L("src/main.rs", 120, 1000), L("src/lib.rs", 50, 2000), L("README.md", 10, 1000, "doc"), L("SYNTAX.md", 28_000, 3000, "doc")];
    const d = diffFolder(now, { paths, seen, readAt: 0 });
    assert.deepEqual(d.added, ["SYNTAX.md"]);
    assert.deepEqual(d.changed.sort(), ["src/lib.rs", "src/main.rs"], "by size (main.rs) and by time (lib.rs)");
    assert.deepEqual(d.removed, ["Cargo.toml"]);
  });

  it("the same folder again: nothing", () => {
    assert.deepEqual(diffFolder(before, { paths, seen, readAt: 0 }), { added: [], changed: [], removed: [] });
  });

  it("an asset or a listed file only counts by coming and going", () => {
    const listed = [L("public/logo.png", -1, 0, "asset"), L("LICENSE", -1, 0, "path")];
    assert.deepEqual(diffFolder(listed, { paths: ["public/logo.png", "LICENSE"], seen: seenOf(listed), readAt: 0 }), { added: [], changed: [], removed: [] });
  });

  it("a map read before listings were kept: files on disk but not on the map are new, and files written after it was read changed", () => {
    const now = [L("src/main.rs", 100, 500), L("src/lib.rs", 50, 5000), L("SYNTAX.md", 28_000, 6000, "doc")];
    const d = diffFolder(now, { paths: ["src/main.rs", "src/lib.rs"], readAt: 1000 });
    assert.deepEqual(d, { added: ["SYNTAX.md"], changed: ["src/lib.rs"], removed: [] });
  });

  it("says it quietly, naming one file and counting several", () => {
    const none = { added: [], changed: [], removed: [] };
    assert.equal(changeWords([{ label: "rust", changes: { ...none, added: ["notes/SYNTAX.md"] } }]), "Read 1 new file from rust: SYNTAX.md");
    assert.equal(changeWords([{ label: "rust", changes: { ...none, added: ["a.rs", "b.rs"] } }]), "Read 2 new files from rust");
    assert.equal(changeWords([{ label: "rust", changes: { ...none, changed: ["a.rs"], added: ["b.rs"], removed: ["c.rs"] } }]), "3 files changed in rust");
    assert.equal(changeWords([{ label: "rust", changes: { ...none, removed: ["old.md"] } }]), "1 file is gone from rust: old.md");
    assert.equal(changeWords([{ label: "web", changes: { ...none, changed: ["a.ts"] } }, { label: "api", changes: { ...none, changed: ["b.py"] } }]), "2 files changed");
    assert.equal(changeWords([{ label: "rust", changes: none }]), null);
  });
});

describe("folder refresh: the list by path, with the readers' rules", () => {
  const root = folder({
    "Cargo.toml": '[package]\nname = "rust"\n',
    "src/main.rs": "fn main() {}\n",
    "README.md": "# Rust\n",
    "public/logo.png": "png",
    ".env": "SECRET=1\n",
    ".env.local": "SECRET=2\n",
    "id_rsa": "KEY",
    "node_modules/dep/index.js": "module.exports = 1;\n",
    "target/debug/build.rs": "fn x() {}\n",
    ".git/HEAD": "ref\n",
    ".husky/pre-commit": "npm test\n",
  });

  it("lists no .env, no key, nothing under node_modules, target or .git", async () => {
    const l = await listFolderAt(root);
    assert.ok(!("error" in l));
    const paths = l.files.map((f) => f.path);
    for (const never of [".env", ".env.local", "id_rsa"]) assert.ok(!paths.includes(never), never);
    assert.ok(!paths.some((p) => /^(node_modules|target|\.git)\//.test(p)), paths.join(", "));
    assert.ok(paths.includes("src/main.rs") && paths.includes("README.md") && paths.includes(".husky/pre-commit"));
  });

  it("lists exactly what the folder reader reads, with sizes and times for code and documents only", async () => {
    const l = await listFolderAt(root);
    const r = await readFolderAt(root);
    assert.ok(!("error" in l) && !("error" in r));
    assert.deepEqual(l.files.map((f) => f.path).sort(), r.files.map((f) => f.path).sort());
    const main = l.files.find((f) => f.path === "src/main.rs")!;
    assert.equal(main.mode, "code");
    assert.equal(main.size, "fn main() {}\n".length);
    assert.ok(main.mtimeMs > 0);
    assert.deepEqual(
      l.files.filter((f) => f.path === "public/logo.png").map((f) => [f.mode, f.size]),
      [["asset", -1]],
    );
  });

  it("reads only listed files: never a secret, a skipped folder's file or one outside the folder", async () => {
    const got = await readFilesAt(root, ["README.md", ".env", "id_rsa", "node_modules/dep/index.js", "../outside.txt", "src/main.rs"]);
    assert.ok(!("error" in got));
    assert.deepEqual(got.read.map((f) => f.path).sort(), ["README.md", "src/main.rs"]);
    assert.equal(got.read.find((f) => f.path === "README.md")?.content, "# Rust\n");
  });

  it("asks for a full path to an existing folder", async () => {
    assert.ok("error" in (await listFolderAt("relative/path")));
    assert.ok("error" in (await listFolderAt(join(root, "missing"))));
  });
});

/** The desktop app's way, without a server: listFolderAt and readFilesAt straight. */
const diskIo: FolderIo = {
  async list(r) {
    const l = await listFolderAt(r.path!);
    return "error" in l ? null : l.files;
  },
  async read(r, files) {
    const got = await readFilesAt(
      r.path!,
      files.map((f) => f.path),
    );
    return "error" in got ? [] : got.read;
  },
};

describe("folder refresh: taken in, in place", () => {
  it("a new file comes in, every other file's analysis stays, and the workspace is the same one", async () => {
    const root = folder({
      "package.json": '{"name":"app","dependencies":{"express":"4"}}',
      "src/server.ts": 'import express from "express";\nimport { list } from "./users";\nconst app = express();\napp.get("/users", (_req, res) => res.json(list()));\n',
      "src/users.ts": "export function list() { return []; }\n",
    });
    const w = await mapped(root);
    const route = (m: Workspace["map"]) => m.nodes.filter((n) => n.file === "src/server.ts").map((n) => `${n.kind}:${n.name}`);
    assert.ok(route(w.map).length, "the server's route is on the map");
    const fileEntry = (m: Workspace["map"], p: string) => m.files.find((f) => f.path === p);

    const next = await updateInPlace(
      w,
      [{ files: [{ path: "src/orders.ts", content: "export function orders() { return []; }\n" }], removed: [], seen: {} }],
      build,
      new Date("2026-11-16T06:00:00.000Z"),
    );
    assert.equal(next.id, w.id, "the same workspace: the room keeps its open files, selection and layout");
    assert.ok(next.files["src/orders.ts"], "the new file is kept");
    assert.ok(fileEntry(next.map, "src/orders.ts"), "and on the map");
    assert.deepEqual(route(next.map), route(w.map), "the route's analysis is as it was");
    assert.deepEqual(fileEntry(next.map, "src/users.ts"), fileEntry(w.map, "src/users.ts"));
    assert.equal(next.files["src/server.ts"], w.files["src/server.ts"]);
    assert.equal(next.repos[0].readAt, "2026-11-16T06:00:00.000Z");
    assert.equal(next.repos[0].path, root, "the folder can still be read again");
  });

  it("a secret the map names stays named, by name only, when the map is built again", async () => {
    // A map made with a real .env among its files (the readers skip it now; build.ts names it, never keeps it).
    const sources = [
      { path: "src/a.ts", content: "export const a = 1;\n" },
      { path: ".env", content: "KEY=sk_live_x\n" },
    ];
    const first = await build({ sources, name: "app", repos: [{ label: "app", prefix: "", kind: "local" }], assertions: [] });
    const w: Workspace = { id: "ws", name: "app", map: first.map, files: first.contents, repos: [{ label: "app", kind: "local", path: "C:\\app", fileCount: 2, addedAt: "" }] };
    const named = (m: Workspace["map"]) => m.files.filter((f) => f.skipped === "secret").map((f) => f.path);
    assert.deepEqual(named(w.map), [".env"]);
    assert.deepEqual(knownFiles(w, 0).secrets, [".env"]);
    const next = await updateInPlace(w, [{ files: [{ path: "src/b.ts", content: "export const b = 2;\n" }], removed: [], seen: {} }], build);
    assert.deepEqual(named(next.map), [".env"]);
    assert.equal(".env" in next.files, false, "its text is never kept");
  });

  it("checks a mapped folder: SYNTAX.md made after it was read comes in, with one quiet line", async () => {
    const root = folder({ "Cargo.toml": '[package]\nname = "rust"\n', "src/main.rs": "fn main() {}\n" });
    const w = await mapped(root, "rust", new Date(Date.now() - 60_000).toISOString());
    // Files written before the folder was read.
    for (const p of ["Cargo.toml", "src/main.rs"]) utimesSync(join(root, p), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    assert.equal((await checkFolders(w, diskIo, build, { ask: false })).workspace, null, "nothing changed: nothing to do");

    put(root, "SYNTAX.md", "# Rust syntax\n".repeat(2000));
    const got = await checkFolders(w, diskIo, build, { ask: false });
    assert.equal(got.words, "Read 1 new file from rust: SYNTAX.md");
    assert.ok(got.workspace);
    assert.equal(got.workspace.id, w.id);
    assert.ok(got.workspace.files["SYNTAX.md"]?.startsWith("# Rust syntax"));
    assert.ok(got.workspace.repos[0].seen?.["SYNTAX.md"], "the listing is kept, to notice the next change by");
    assert.ok(knownFiles(got.workspace, 0).paths.includes("src/main.rs"));

    // Checked again: the same files, nothing to do.
    assert.equal((await checkFolders(got.workspace, diskIo, build, { ask: false })).workspace, null);

    // Gone from disk: removed, and its tab closes (got.removed).
    rmSync(join(root, "SYNTAX.md"));
    const gone = await checkFolders(got.workspace, diskIo, build, { ask: false });
    assert.deepEqual(gone.removed, ["SYNTAX.md"]);
    assert.equal(gone.words, "1 file is gone from rust: SYNTAX.md");
    assert.equal(gone.workspace?.files["SYNTAX.md"], undefined);
  });

  it("a file only touched, or saved here with the same text, changes nothing on the map", async () => {
    const root = folder({ "src/a.ts": "export const a = 1;\n" });
    const w = await mapped(root, "app", new Date(Date.now() - 60_000).toISOString());
    utimesSync(join(root, "src/a.ts"), new Date(), new Date());
    let built = 0;
    const counting: Build = (req) => {
      built++;
      return build(req);
    };
    const got = await checkFolders(w, diskIo, counting, { ask: false });
    assert.equal(built, 0, "the map is not built again");
    assert.equal(got.words, null);
    assert.ok(got.workspace?.repos[0].seen?.["src/a.ts"], "but the listing is kept, so it is not read again");
    assert.equal(got.workspace?.map, w.map);
  });
});

/** A folder handle the browser has not yet let the page read: it records whether it was asked. */
function handle(state: PermissionState) {
  const asked = { query: 0, request: 0 };
  const h = {
    kind: "directory",
    name: "rust",
    async queryPermission() {
      asked.query++;
      return state;
    },
    async requestPermission() {
      asked.request++;
      return "denied" as PermissionState;
    },
    async *values() {},
  };
  return { h: h as unknown as FileSystemDirectoryHandle, asked };
}

describe("folder refresh: never asks for permission by itself", () => {
  it("a check on its own reads a kept folder only where the browser already lets it, and never asks", async () => {
    const { h, asked } = handle("prompt");
    assert.equal(await listHandle(h, { ask: false }), null);
    assert.equal(asked.request, 0);
    assert.equal(asked.query, 1);
  });

  it("the timer's path through the whole check never asks either", async () => {
    const { h, asked } = handle("prompt");
    const w: Workspace = {
      id: "ws",
      name: "rust",
      files: { "src/main.rs": "fn main() {}\n" },
      map: (await build({ sources: [{ path: "src/main.rs", content: "fn main() {}\n" }], name: "rust", repos: [{ label: "rust", prefix: "", kind: "local" }], assertions: [] })).map,
      repos: [{ label: "rust", kind: "local", handle: h, fileCount: 1, addedAt: "2026-11-16T05:00:00.000Z" }],
    };
    const got = await checkFolders(w, folderIo, build, { ask: false });
    assert.equal(asked.request, 0, "no permission prompt on the timer path");
    assert.deepEqual(got.unread, ["rust"]);
    assert.equal(got.workspace, null, "the map stays as it is");
  });

  it("the user's click may ask", async () => {
    const { h, asked } = handle("prompt");
    assert.equal(await listHandle(h, { ask: true }), null);
    assert.equal(asked.request, 1);
  });

  it("a granted folder is listed by its handle with the same rules", async () => {
    const file = (name: string, text: string) => ({ kind: "file", name, getFile: async () => new File([text], name, { lastModified: 1234 }) });
    const dir = (name: string, entries: unknown[]): unknown => ({
      kind: "directory",
      name,
      queryPermission: async () => "granted",
      async *values() {
        yield* entries;
      },
    });
    const root = dir("rust", [file("Cargo.toml", "[package]\n"), file(".env", "SECRET=1"), dir("node_modules", [file("x.js", "1")]), dir("src", [file("main.rs", "fn main() {}\n")]), file("SYNTAX.md", "# s\n")]);
    const got = await listHandle(root as FileSystemDirectoryHandle, { ask: false });
    assert.deepEqual(got?.files.map((f) => `${f.path} ${f.mode} ${f.size} ${f.mtimeMs}`).sort(), ["Cargo.toml code 10 1234", "SYNTAX.md doc 4 1234", "src/main.rs code 13 1234"]);
  });

  it("WalkMyCode for Claude and indexed maps are never checked; a folder with no way back in is not either", async () => {
    const w = { repos: [{ label: "a", kind: "local" as const, path: "C:\\a", fileCount: 1, addedAt: "" }], map: { repos: [{ label: "a", prefix: "", kind: "local" as const }] } } as Workspace;
    assert.equal(canCheck(w, "full"), true);
    assert.equal(canCheck(w, "mcp"), false);
    assert.equal(canCheck({ ...w, map: { ...w.map, repos: [{ label: "a", prefix: "", kind: "cli" }] } } as Workspace, "full"), false);
    assert.equal(canCheck({ ...w, repos: [{ label: "demo", kind: "demo", fileCount: 1, addedAt: "" }] } as Workspace, "full"), false);
  });
});
