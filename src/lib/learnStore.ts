// Where the Learn room keeps a student's work in the full app: JSON files in
// .walkmycode/learn/ beside the settings (config.json, keys.env), so lessons,
// courses, conversations, the notebook and recall cards survive a reload, a
// restart and a change of browser. One document per file:
//
//   .walkmycode/learn/profile.json
//   .walkmycode/learn/lessons/<id>.json
//   .walkmycode/learn/courses/<id>.json
//   .walkmycode/learn/extras/<key>.json     chat-<lessonId>, notebook, cards
//
// A write goes to a temp file first and is then renamed over the old one, so a
// crash mid-write never leaves half a lesson. The browser side is
// src/learn/lib/store.ts; the route is src/app/api/learn/store/route.ts.
import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirIn, envVar, homeBase } from "./dataDir";
import { HttpError } from "./providers/guard";

export const COLLECTIONS = ["lessons", "courses", "extras"] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** The largest document kept (a long lesson with its code is a few hundred KB). */
export const DOC_MAX = 4 * 1024 * 1024;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function learnDir(): string {
  return join(dataDirIn(homeBase(process.cwd())), "learn");
}

export type DocRef = { collection: Collection; id: string } | { collection: null; id: "profile" };

/** "lessons/abc" or "profile" as a checked reference; null for anything else (no path can escape the folder). */
export function parseDoc(doc: unknown): DocRef | null {
  if (doc === "profile") return { collection: null, id: "profile" };
  if (typeof doc !== "string") return null;
  const [collection, id, more] = doc.split("/");
  if (more !== undefined || !COLLECTIONS.includes(collection as Collection) || !ID.test(id ?? "")) return null;
  return { collection: collection as Collection, id };
}

const fileOf = (dir: string, ref: DocRef) => (ref.collection ? join(dir, ref.collection, `${ref.id}.json`) : join(dir, "profile.json"));

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // missing, or a file damaged by hand: treated as not there
  }
}

export function readDoc(dir: string, ref: DocRef): unknown {
  return readJson(fileOf(dir, ref));
}

export function writeDoc(dir: string, ref: DocRef, data: unknown): void {
  const text = JSON.stringify(data);
  if (text === undefined || text.length > DOC_MAX) throw new HttpError(413, "That is too large to save.");
  const file = fileOf(dir, ref);
  mkdirSync(ref.collection ? join(dir, ref.collection) : dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function deleteDoc(dir: string, ref: DocRef): void {
  rmSync(fileOf(dir, ref), { force: true });
  // A lesson's conversation goes with it.
  if (ref.collection === "lessons") rmSync(fileOf(dir, { collection: "extras", id: `chat-${ref.id}` }), { force: true });
}

export function listDocs(dir: string, collection: Collection): unknown[] {
  const folder = join(dir, collection);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson(join(folder, f)))
    .filter((d) => d !== null);
}

/** Everything the Learn room needs to open: one read. */
export function readAll(dir: string): { lessons: unknown[]; courses: unknown[]; profile: unknown } {
  return { lessons: listDocs(dir, "lessons"), courses: listDocs(dir, "courses"), profile: readDoc(dir, { collection: null, id: "profile" }) };
}

/**
 * A hosted WalkMyCode (WALKMYCODE_MODE=hosted) is one server for many people,
 * with no accounts: it keeps nobody's lessons and reads nobody's folders. The
 * page then keeps the work in the browser, as it always did.
 */
export function refuseHosted(): void {
  if (envVar("MODE")?.trim().toLowerCase() === "hosted") throw new HttpError(403, "Lessons are kept on your own computer: this is not part of hosted WalkMyCode.");
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The route's handlers, minus the guard (the route wraps each in `guarded`). `dir` is given by tests. */
export function learnStoreHandlers(dir: () => string = learnDir) {
  const need = (doc: unknown): DocRef => {
    const ref = parseDoc(doc);
    if (!ref) throw new HttpError(400, "doc: not a document the Learn room keeps.");
    return ref;
  };
  return {
    async GET(req: Request): Promise<Response> {
      refuseHosted();
      const doc = new URL(req.url).searchParams.get("doc");
      if (doc === null) return json({ ...readAll(dir()), where: dir() });
      return json({ data: readDoc(dir(), need(doc)) });
    },
    async PUT(req: Request): Promise<Response> {
      refuseHosted();
      const body = (await req.json().catch(() => null)) as { doc?: unknown; data?: unknown } | null;
      if (!body || body.data === undefined || body.data === null || typeof body.data !== "object") throw new HttpError(400, "data: an object to save.");
      writeDoc(dir(), need(body.doc), body.data);
      return json({ ok: true });
    },
    async DELETE(req: Request): Promise<Response> {
      refuseHosted();
      deleteDoc(dir(), need(new URL(req.url).searchParams.get("doc")));
      return json({ ok: true });
    },
  };
}
