// WalkMyCode Lite's workspace in the viewer's private space (src/lib/adapters/storage.ts),
// against an in-memory database that keeps the artifact db's rules (db.d.ts):
// document paths have an even number of segments of [A-Za-z0-9_-.~:@+], and a
// document holds at most 256 KiB. The map goes up gzipped in chunks, with the code when
// the two fit in WITH_CODE_CHARS; a bigger repo's code stays in the browser.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import type { CollRef, Db, DocRef } from "../src/learn/lib/claude";
import { decodeChunks, encodeChunks, encodeWorkspace, loadWorkspace, saveWorkspace, WITH_CODE_CHARS, type Space } from "../src/lib/adapters/storage";
import type { Workspace } from "../src/lib/store";

const LIMIT = 256 * 1024;

function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const sizes: number[] = [];
  const segments = (p: string) => p.split("/");
  const doc = (path: string): DocRef => {
    assert.equal(segments(path).length % 2, 0, `a document path has an even number of segments: ${path}`);
    for (const s of segments(path)) assert.match(s, /^[A-Za-z0-9_\-.~:@+]{1,200}$/, path);
    return {
      async get() {
        const d = docs.get(path);
        return { id: segments(path).pop()!, exists: !!d, data: () => (d ? structuredClone(d) : undefined) };
      },
      async set(data) {
        const n = new TextEncoder().encode(JSON.stringify(data)).length;
        if (n > LIMIT) throw { code: "invalid_argument", message: `a document over 256 KiB (${n})` };
        sizes.push(n);
        docs.set(path, structuredClone(data));
      },
      async delete() {
        docs.delete(path);
      },
      collection: (sub: string) => coll(`${path}/${sub}`),
    };
  };
  const coll = (path: string): CollRef => {
    assert.equal(segments(path).length % 2, 1, `a collection path has an odd number of segments: ${path}`);
    return { doc: (id = "auto") => doc(`${path}/${id}`), get: async () => ({ docs: [] }) };
  };
  const db: Db = { doc, collection: coll };
  return { db, docs, sizes };
}

/** A map of about `n` nodes, big enough that it cannot fit one document. */
function bigMap(n: number): CodeMap {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `route:src/api/r${i}.ts#GET /api/items/${i}`, kind: "route", layer: "api", name: `GET /api/items/${i}`, file: `src/api/r${i}.ts`, line: i % 300, note: `handler number ${i} of the items service, café ✓` }));
  const edges = nodes.slice(1).map((m, i) => ({ id: `e${i}`, from: nodes[i].id, to: m.id, kind: "calls", confidence: i % 7 ? "certain" : "likely", evidence: [{ file: m.file, line: m.line, text: `fetch("/api/items/${i}")` }] }));
  return { version: 2, name: "big", areas: ["app"], files: nodes.map((x) => ({ path: x.file, lang: "ts" })), nodes, edges, warnings: [], repos: [], services: [], stats: { files: n, parsed: n, routes: n, tables: 0, edges: edges.length, likely: 0, ms: 1 } } as unknown as CodeMap;
}

const ws = (map: CodeMap, extra: Partial<Workspace> = {}): Workspace => ({
  id: "ws-1",
  name: "big",
  repos: [{ label: "big", kind: "local", fileCount: map.files.length, addedAt: "2026-10-01T10:00:00.000Z" }],
  map,
  files: { "src/api/r0.ts": "export const secretish = 'the code never leaves the browser';" },
  ...extra,
});

describe("the map in the viewer's private space", () => {
  it("gzips and cuts text into documents that fit, and reads it back", async () => {
    const text = JSON.stringify(bigMap(4000));
    const { encoding, parts } = await encodeChunks(text);
    assert.equal(encoding, "gzip-base64");
    for (const p of parts) assert.ok(p.length <= 180_000);
    assert.equal(await decodeChunks(encoding, parts), text);
    assert.equal(await decodeChunks("json", ["{\"a\":", "1}"]), "{\"a\":1}");
  });

  it("keeps the map, its file list and the user's answers, but not code too big to go along, in documents under 256 KiB", async () => {
    const { db, docs, sizes } = fakeDb();
    const space: Space = { db, userId: "viewer-1" };
    const map = bigMap(12_000);
    assert.ok(JSON.stringify(map).length > 3 * LIMIT, "the map is bigger than a few documents");
    const assertions = [{ setting: "API_URL", target: "svc-api" }] as unknown as Workspace["assertions"];
    // A budget the code cannot fit in: only the map goes.
    await saveWorkspace(space, ws(map, { assertions, needsReindex: true }), { budget: 1 });
    assert.ok(sizes.every((n) => n <= LIMIT));
    for (const [path, body] of docs) {
      assert.ok(path.startsWith("data/users/viewer-1/workspace"), path);
      assert.ok(!JSON.stringify(body).includes("the code never leaves the browser"), "no file contents in the space");
    }
    const back = await loadWorkspace(space);
    assert.ok(back);
    assert.deepEqual(back.map, map);
    assert.deepEqual(back.files, {});
    assert.equal(back.codeElsewhere, true);
    assert.equal(back.needsReindex, true);
    assert.deepEqual(back.assertions, assertions);
    assert.deepEqual(back.repos, [{ label: "big", kind: "local", fileCount: 12_000, addedAt: "2026-10-01T10:00:00.000Z" }]);
    assert.equal(back.map.files.length, 12_000, "the file list comes back with the map");
  });

  it("takes a small repo's code along, so another browser gets the whole workspace back", async () => {
    const { db, docs, sizes } = fakeDb();
    const space: Space = { db, userId: "viewer-1" };
    const files = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`src/api/r${i}.ts`, `export function handler${i}() {\n  return fetch("/api/items/${i}");\n}\n`.repeat(20)]));
    const tour = { title: "How it works", steps: [{ say: "Here.", file: "src/api/r0.ts", start_line: 1, end_line: 2, node_ids: [] }] };
    await saveWorkspace(space, ws(bigMap(300), { files, starterTour: tour }));
    assert.ok(sizes.every((n) => n <= LIMIT));
    assert.equal((docs.get("data/users/viewer-1/workspace") as { code?: boolean }).code, true);
    const back = await loadWorkspace(space);
    assert.ok(back);
    assert.deepEqual(back.files, files);
    assert.equal(back.codeElsewhere, undefined, "nothing to add again");
    assert.deepEqual(back.starterTour, tour, "an example keeps its starter tour");
  });

  it("measures the code against the budget: with it when it fits, the map alone when not", async () => {
    const w = ws(bigMap(50), { files: { "a.ts": "x".repeat(10_000) } });
    assert.equal((await encodeWorkspace(w)).code, true);
    assert.equal((await encodeWorkspace(w, 10)).code, false);
    assert.equal((await encodeWorkspace({ ...w, files: {} })).code, false, "no code, nothing to take");
    assert.ok(WITH_CODE_CHARS >= 2_000_000 && WITH_CODE_CHARS <= 4_000_000, "a few hundred files fit, the database is shared");
  });

  it("removes the chunks a smaller save no longer needs, and forgets the workspace when it is closed", async () => {
    const { db, docs } = fakeDb();
    const space: Space = { db, userId: "viewer-1" };
    await saveWorkspace(space, ws(bigMap(12_000)));
    const many = [...docs.keys()].filter((k) => k.includes("/chunks/")).length;
    assert.ok(many > 1);
    await saveWorkspace(space, ws(bigMap(10)));
    assert.equal([...docs.keys()].filter((k) => k.includes("/chunks/")).length, 1);
    assert.equal((await loadWorkspace(space))?.map.nodes.length, 10);
    await saveWorkspace(space, null);
    assert.equal(docs.size, 0);
    assert.equal(await loadWorkspace(space), null);
  });

  it("never reads a half-written save as whole", async () => {
    const { db, docs } = fakeDb();
    const space: Space = { db, userId: "viewer-1" };
    await saveWorkspace(space, ws(bigMap(50)));
    const chunk = "data/users/viewer-1/workspace/chunks/0";
    docs.set(chunk, { ...docs.get(chunk), rev: "another-save" });
    assert.equal(await loadWorkspace(space), null);
  });
});
