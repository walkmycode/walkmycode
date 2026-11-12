// Where a workspace is kept between visits. Always in this browser (IndexedDB,
// src/lib/store.ts). Inside Claude, when the artifact gives the viewer a private
// space (its database and their id), the map also goes there, under
// data/users/<id>/, so it follows them to another browser or device.
//
// The code goes too when it is small enough: a document holds at most 256 KiB and the
// whole database is capped and shared by every viewer of the artifact, so the map and
// the code are gzipped together and cut into documents of under 256 KiB, and the code
// is left out when that would come to more than WITH_CODE_CHARS (about 2.5 MB of
// documents: gzip takes source to about a third, so up to some 6 MB of code, a few
// hundred files; this repo's own src/, 230 files and 1.8 MB, is 0.7 MB, four documents).
// A bigger repo's code stays in IndexedDB, in the browser where its folder was added,
// and a map restored from the private space alone says so (Workspace.codeElsewhere):
// the page asks for the folder again. The map keeps the list of files it was made from
// (map.files), so the file tree is whole either way.
import type { Assertion, CodeMap } from "@/analyzer/types";
import type { Tour } from "@/lib/claude/tools";
import type { RepoSource, Workspace } from "@/lib/store";
import { claudeSpace, type Db } from "./runtime";
import { pickStorage } from "./select";

export type Space = { db: Db; userId: string };

/** What goes to the private space besides the meta document: the map, the user's answers,
 * the starter tour of an example, and the code when it fits. */
interface Saved {
  v: 1;
  map: CodeMap;
  assertions?: Assertion[];
  files?: Record<string, string>;
  tour?: Tour;
}

/** data/users/<id>/workspace: which workspace, and how its map is stored. */
interface Meta {
  v: 1;
  id: string;
  name: string;
  repos: Omit<RepoSource, "handle">[];
  needsReindex?: boolean;
  savedAt: string;
  /** Every chunk carries it, so a half-written save elsewhere is never read as whole. */
  rev: string;
  encoding: "gzip-base64" | "json";
  chunks: number;
  /** The code came along (a repo small enough); else only the map did. */
  code?: boolean;
}

/** Characters per chunk document: base64 is one byte each and never escaped; plain JSON
 * (no compression in this browser) can take three bytes a character, escaped. */
const CHUNK_CHARS = { "gzip-base64": 180_000, json: 60_000 } as const;
const MAX_CHUNKS = 400;
/** The most a workspace with its code may take in the space, in characters of chunks. */
export const WITH_CODE_CHARS = 2_500_000;

const metaPath = (userId: string) => `data/users/${userId}/workspace`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** `text` as the chunks to store: gzipped and base64 where the browser can, plain otherwise. */
export async function encodeChunks(text: string): Promise<{ encoding: Meta["encoding"]; parts: string[] }> {
  let encoding: Meta["encoding"] = "json";
  let body = text;
  if (typeof CompressionStream === "function") {
    const zipped = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    encoding = "gzip-base64";
    body = toBase64(zipped);
  }
  const size = CHUNK_CHARS[encoding];
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += size) parts.push(body.slice(i, i + size));
  return { encoding, parts: parts.length ? parts : [""] };
}

export async function decodeChunks(encoding: Meta["encoding"], parts: string[]): Promise<string> {
  const body = parts.join("");
  if (encoding === "json") return body;
  return new Response(new Blob([fromBase64(body)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/** What was last written (or read), so a save that changes nothing stored writes nothing. */
let last: { map: CodeMap; files: Record<string, string>; name: string; repos: string; assertions: string; needsReindex: boolean } | null = null;

const snapshot = (w: Workspace) => ({ map: w.map, files: w.files, name: w.name, repos: JSON.stringify(w.repos.map((r) => r.label)), assertions: JSON.stringify(w.assertions ?? []), needsReindex: !!w.needsReindex });
function unchanged(w: Workspace): boolean {
  const now = snapshot(w);
  return !!last && last.map === now.map && last.files === now.files && last.name === now.name && last.repos === now.repos && last.assertions === now.assertions && last.needsReindex === now.needsReindex;
}

/** The chunks for a workspace: with its code when they fit in WITH_CODE_CHARS, else the map alone. */
export async function encodeWorkspace(w: Workspace, budget = WITH_CODE_CHARS): Promise<{ encoding: Meta["encoding"]; parts: string[]; code: boolean }> {
  const base: Saved = { v: 1, map: w.map, ...(w.assertions?.length ? { assertions: w.assertions } : {}), ...(w.starterTour ? { tour: w.starterTour } : {}) };
  const hasCode = Object.keys(w.files).length > 0;
  if (hasCode) {
    const withCode = await encodeChunks(JSON.stringify({ ...base, files: w.files }));
    if (withCode.parts.reduce((n, p) => n + p.length, 0) <= budget) return { ...withCode, code: true };
  }
  return { ...(await encodeChunks(JSON.stringify(base))), code: false };
}

/** Write the workspace's map to the space: the chunks first, then the meta document that names them. */
export async function saveWorkspace(space: Space, w: Workspace | null, o: { budget?: number } = {}): Promise<void> {
  const ref = space.db.doc(metaPath(space.userId));
  const chunks = ref.collection("chunks");
  const before = await ref.get();
  const had = before.exists ? Number((before.data() as Partial<Meta> | undefined)?.chunks) || 0 : 0;
  if (!w) {
    last = null;
    await ref.delete();
    for (let i = 0; i < had; i++) await chunks.doc(String(i)).delete();
    return;
  }
  const { encoding, parts, code } = await encodeWorkspace(w, o.budget);
  if (parts.length > MAX_CHUNKS) throw new Error(`the map is too big for the private space (${parts.length} documents)`);
  const rev = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // One write at a time: each chunk is its own document, then the meta document that names them.
  for (let i = 0; i < parts.length; i++) await chunks.doc(String(i)).set({ rev, i, data: parts[i] });
  const meta: Meta = {
    v: 1,
    id: w.id,
    name: w.name,
    repos: w.repos.map(({ label, kind, fileCount, addedAt }) => ({ label, kind, fileCount, addedAt })),
    ...(w.needsReindex ? { needsReindex: true } : {}),
    savedAt: new Date().toISOString(),
    rev,
    encoding,
    chunks: parts.length,
    ...(code ? { code: true } : {}),
  };
  await ref.set(meta as unknown as Record<string, unknown>);
  for (let i = parts.length; i < had; i++) await chunks.doc(String(i)).delete();
  last = snapshot(w);
}

/** The workspace kept in the space (with its code when it was small enough to go along);
 * null when there is none, or only half of one. */
export async function loadWorkspace(space: Space): Promise<Workspace | null> {
  const ref = space.db.doc(metaPath(space.userId));
  const snap = await ref.get();
  const meta = snap.exists ? (snap.data() as Partial<Meta> | undefined) : undefined;
  if (!meta || meta.v !== 1 || !meta.id || !meta.rev || !meta.encoding || !Number.isInteger(meta.chunks) || !meta.chunks || meta.chunks > MAX_CHUNKS) return null;
  const docs = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => ref.collection("chunks").doc(String(i)).get()));
  const parts = docs.map((d) => (d.exists ? (d.data() as { rev?: string; data?: unknown } | undefined) : undefined));
  if (parts.some((p) => !p || p.rev !== meta.rev || typeof p.data !== "string")) return null;
  const saved = JSON.parse(await decodeChunks(meta.encoding, parts.map((p) => p!.data as string))) as Saved;
  if (saved.v !== 1 || !saved.map) return null;
  const files = saved.files && typeof saved.files === "object" ? saved.files : null;
  const w: Workspace = {
    id: meta.id,
    name: meta.name ?? saved.map.name,
    repos: (meta.repos ?? []).map((r) => ({ ...r })),
    map: saved.map,
    files: files ?? {},
    ...(files ? {} : { codeElsewhere: true }),
    ...(meta.needsReindex ? { needsReindex: true } : {}),
    ...(saved.assertions?.length ? { assertions: saved.assertions } : {}),
    ...(saved.tour ? { starterTour: saved.tour } : {}),
  };
  // Just read: keeping it in this browser too must not write it back.
  last = snapshot(w);
  return w;
}

// ── The page's own space ──

let space: Promise<Space | null> | null = null;
/** Set when the space refused a write for good (a view-only viewer, a full database): stop trying. */
let refused = false;
let queue: Promise<void> = Promise.resolve();

/** The viewer's private space when this page runs inside Claude and has one; else null. */
function account(): Promise<Space | null> {
  space ??= claudeSpace()
    .then((s) => (pickStorage({ db: !!s, userId: s?.userId ?? null }) === "account" ? s : null))
    .catch(() => null);
  return space;
}

/** Keep the workspace's map in the viewer's private space too (one save at a time). */
export function saveRemote(w: Workspace | null): Promise<void> {
  queue = queue.then(async () => {
    // A map restored from the space has nothing new to say there.
    if (refused || w?.codeElsewhere || (w && unchanged(w))) return;
    const s = await account();
    if (!s) return;
    try {
      await saveWorkspace(s, w);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // Not transient: the store said no to this viewer or this size.
      if (code !== "unavailable" && code !== "resource_exhausted") refused = true;
      console.info("WalkMyCode Lite: the map is kept in this browser only.", code ?? (e as Error)?.message);
    }
  });
  return queue;
}

/** The workspace kept in the viewer's private space, for a browser that has none of its own. */
export async function loadRemote(): Promise<Workspace | null> {
  const s = await account();
  if (!s) return null;
  try {
    return await loadWorkspace(s);
  } catch {
    return null;
  }
}
