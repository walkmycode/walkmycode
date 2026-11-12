// The Learn room's saved work on this computer (src/lib/learnStore.ts): one
// JSON file per lesson, course and extra (conversation, notebook, cards) in
// .walkmycode/learn/, behind the same guard as the settings routes. Runs in a
// temp WALKMYCODE_HOME.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { guarded } from "../src/lib/providers/guard";
import { deleteDoc, learnDir, learnStoreHandlers, listDocs, parseDoc, readAll, readDoc, writeDoc } from "../src/lib/learnStore";

let home: string;
let dir: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-learnstore-"));
  process.env.WALKMYCODE_HOME = home;
  dir = learnDir();
});
beforeEach(() => rmSync(dir, { recursive: true, force: true }));
after(() => {
  delete process.env.WALKMYCODE_HOME;
  rmSync(home, { recursive: true, force: true });
});

const lesson = (id: string) => ({ id, course: "Rust", number: 1, title: "Ownership", boards: [] });

describe("the Learn store: documents", () => {
  it("lives in .walkmycode/learn under WALKMYCODE_HOME", () => {
    assert.equal(dir, join(home, ".walkmycode", "learn"));
  });

  it("accepts only its own documents, and no path that could leave the folder", () => {
    assert.deepEqual(parseDoc("profile"), { collection: null, id: "profile" });
    assert.deepEqual(parseDoc("lessons/abc123"), { collection: "lessons", id: "abc123" });
    assert.deepEqual(parseDoc("extras/chat-abc_1"), { collection: "extras", id: "chat-abc_1" });
    for (const bad of ["", "lessons", "lessons/", "keys/abc", "lessons/../config", "lessons/a/b", "lessons/a.json", "lessons/.hidden", "../keys.env", "lessons/a b", `lessons/${"x".repeat(81)}`, null, 7]) {
      assert.equal(parseDoc(bad), null, String(bad));
    }
  });

  it("writes one file per document and reads it back", () => {
    writeDoc(dir, parseDoc("lessons/a1")!, lesson("a1"));
    writeDoc(dir, parseDoc("profile")!, { name: "Ama", about: "curious" });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "lessons", "a1.json"), "utf8")), lesson("a1"));
    assert.deepEqual(readDoc(dir, parseDoc("lessons/a1")!), lesson("a1"));
    assert.deepEqual(readDoc(dir, parseDoc("profile")!), { name: "Ama", about: "curious" });
    assert.equal(readDoc(dir, parseDoc("lessons/missing")!), null);
  });

  it("replaces a document whole and leaves no temp file behind", () => {
    const ref = parseDoc("extras/chat-a1")!;
    writeDoc(dir, ref, { msgs: [1] });
    writeDoc(dir, ref, { msgs: [1, 2] });
    assert.deepEqual(readDoc(dir, ref), { msgs: [1, 2] });
    assert.deepEqual(readdirSync(join(dir, "extras")), ["chat-a1.json"]);
  });

  it("lists a collection, skipping a file damaged by hand", () => {
    writeDoc(dir, parseDoc("lessons/b")!, lesson("b"));
    writeDoc(dir, parseDoc("lessons/a")!, lesson("a"));
    writeFileSync(join(dir, "lessons", "broken.json"), "{ not json");
    assert.deepEqual(listDocs(dir, "lessons"), [lesson("a"), lesson("b")]);
    assert.deepEqual(listDocs(dir, "courses"), []);
  });

  it("opens with everything in one read", () => {
    assert.deepEqual(readAll(dir), { lessons: [], courses: [], profile: null });
    writeDoc(dir, parseDoc("lessons/a")!, lesson("a"));
    writeDoc(dir, parseDoc("courses/c")!, { id: "c", name: "Rust" });
    assert.deepEqual(readAll(dir), { lessons: [lesson("a")], courses: [{ id: "c", name: "Rust" }], profile: null });
  });

  it("deleting a lesson takes its conversation with it, and nothing else", () => {
    writeDoc(dir, parseDoc("lessons/a")!, lesson("a"));
    writeDoc(dir, parseDoc("extras/chat-a")!, { msgs: [] });
    writeDoc(dir, parseDoc("extras/chat-b")!, { msgs: [] });
    writeDoc(dir, parseDoc("extras/notebook")!, { notes: [] });
    deleteDoc(dir, parseDoc("lessons/a")!);
    assert.equal(existsSync(join(dir, "lessons", "a.json")), false);
    assert.deepEqual(readdirSync(join(dir, "extras")).sort(), ["chat-b.json", "notebook.json"]);
  });
});

describe("/api/learn/store", () => {
  const handlers = learnStoreHandlers();
  const url = (q = "") => `http://localhost:3000/api/learn/store${q}`;
  const get = (q = "", headers: Record<string, string> = {}) => guarded(handlers.GET)(new Request(url(q), { headers: { host: "localhost:3000", ...headers } }));
  const put = (body: unknown, headers: Record<string, string> = {}) =>
    guarded(handlers.PUT)(new Request(url(), { method: "PUT", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const del = (q: string) => guarded(handlers.DELETE)(new Request(url(q), { method: "DELETE", headers: { host: "localhost:3000", "content-type": "application/json" } }));

  it("saves a conversation and gives it back after a restart (a fresh read of the folder)", async () => {
    const chat = { lessonId: "a1", msgs: [{ id: "m1", role: "you", text: "Why can't I use s1 after the move?", at: 1, board: 2 }], draft: "and then", updatedAt: 1 };
    assert.equal((await put({ doc: "extras/chat-a1", data: chat })).status, 200);
    // Nothing is held in memory: another set of handlers reads the same files.
    const again = learnStoreHandlers();
    const res = await guarded(again.GET)(new Request(url("?doc=extras/chat-a1"), { headers: { host: "localhost:3000" } }));
    assert.deepEqual(await res.json(), { data: chat });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("opens with lessons, courses and the profile, and says where they are kept", async () => {
    await put({ doc: "lessons/a1", data: lesson("a1") });
    await put({ doc: "profile", data: { name: "Ama" } });
    const all = (await (await get()).json()) as { lessons: unknown[]; courses: unknown[]; profile: unknown; where: string };
    assert.deepEqual(all.lessons, [lesson("a1")]);
    assert.deepEqual(all.profile, { name: "Ama" });
    assert.equal(all.where, dir);
  });

  it("answers null for a document never saved", async () => {
    assert.deepEqual(await (await get("?doc=extras/notebook")).json(), { data: null });
  });

  it("refuses a document outside the store, and data that is not an object", async () => {
    assert.equal((await put({ doc: "lessons/../../keys", data: {} })).status, 400);
    assert.equal((await put({ doc: "config", data: {} })).status, 400);
    assert.equal((await put({ doc: "lessons/a1", data: "text" })).status, 400);
    assert.equal((await put({ doc: "lessons/a1" })).status, 400);
    assert.equal((await get("?doc=..%2Fkeys.env")).status, 400);
    assert.equal(existsSync(dir), false, "nothing was written");
  });

  it("refuses a document too large to be a lesson", async () => {
    const res = await put({ doc: "lessons/big", data: { text: "x".repeat(4 * 1024 * 1024) } });
    assert.equal(res.status, 413);
  });

  it("deletes a lesson", async () => {
    await put({ doc: "lessons/a1", data: lesson("a1") });
    assert.equal((await del("?doc=lessons/a1")).status, 200);
    assert.deepEqual(((await (await get()).json()) as { lessons: unknown[] }).lessons, []);
  });

  it("keeps nothing on a hosted server, which has no accounts", async () => {
    process.env.WALKMYCODE_MODE = "hosted";
    try {
      assert.equal((await get()).status, 403);
      assert.equal((await put({ doc: "profile", data: { name: "Ama" } })).status, 403);
      assert.equal((await del("?doc=lessons/a1")).status, 403);
      assert.equal(existsSync(dir), false, "nothing was written");
    } finally {
      delete process.env.WALKMYCODE_MODE;
    }
  });

  it("is loopback and same-origin only", async () => {
    assert.equal((await get("", { host: "192.168.1.20:3000" })).status, 403);
    assert.equal((await get("", { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await put({ doc: "profile", data: {} }, { origin: "https://evil.example" })).status, 403);
  });
});
