// Narration audio, kept so a tour plays without gaps and replays for free: a
// step heard once costs nothing the second time. Keyed by a hash of narrator +
// voice + speed + text, in memory and in IndexedDB. Every entry belongs to one
// map (its name and generatedAt), so mapping the folder again, which gives the
// map a new generatedAt, drops that map's old audio.
import type { SpokenWord } from "./speech";

export interface CachedAudio {
  bytes: Uint8Array;
  /** Word timings, when the narrator gave them (ElevenLabs). */
  words: SpokenWord[];
  type: string;
}

/** Which map a narration belongs to. */
export interface Scope {
  map: string;
  generatedAt: string;
}

/** Where cached audio outlives the page. IndexedDB in the browser; a Map in tests. */
export interface AudioStore {
  get(id: string): Promise<CachedAudio | null>;
  put(id: string, scope: Scope, v: CachedAudio): Promise<void>;
  /** Drop every entry of this map made from another generatedAt. */
  prune(scope: Scope): Promise<void>;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** FNV-1a, twice with different seeds: for pages without crypto.subtle (plain http on a LAN address). */
function fnv(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 0x2c) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0") + text.length.toString(16);
}

/** The cache key for one narration: SHA-256 of its parts (narrator, voice, speed, text). */
export async function audioKey(parts: readonly (string | number | null | undefined)[]): Promise<string> {
  const text = parts.map((p) => String(p ?? "")).join("\u0000");
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      return hex(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
    } catch {
      // Not a secure context after all: fall through.
    }
  }
  return fnv(text);
}

const scopeId = (s: Scope) => `${encodeURIComponent(s.map)}@${s.generatedAt}`;

export class AudioCache {
  private mem = new Map<string, CachedAudio>();
  private pruned = new Set<string>();

  constructor(
    private store: AudioStore | null,
    /** Narrations kept in memory, least recently used dropped first. */
    private max = 40,
  ) {}

  private id(scope: Scope, key: string) {
    return `${scopeId(scope)}|${key}`;
  }

  async get(scope: Scope, key: string): Promise<CachedAudio | null> {
    await this.prune(scope);
    const id = this.id(scope, key);
    const hit = this.mem.get(id);
    if (hit) {
      this.mem.delete(id);
      this.mem.set(id, hit);
      return hit;
    }
    const stored = this.store ? await this.store.get(id).catch(() => null) : null;
    if (stored) this.remember(id, stored);
    return stored;
  }

  async put(scope: Scope, key: string, v: CachedAudio): Promise<void> {
    await this.prune(scope);
    const id = this.id(scope, key);
    this.remember(id, v);
    await this.store?.put(id, scope, v).catch(() => {});
  }

  private remember(id: string, v: CachedAudio) {
    this.mem.delete(id);
    this.mem.set(id, v);
    while (this.mem.size > this.max) this.mem.delete(this.mem.keys().next().value as string);
  }

  /** Once per map version: forget this map's audio from any other generatedAt. */
  private async prune(scope: Scope) {
    const sid = scopeId(scope);
    if (this.pruned.has(sid)) return;
    this.pruned.add(sid);
    const mapPrefix = `${encodeURIComponent(scope.map)}@`;
    for (const id of [...this.mem.keys()]) if (id.startsWith(mapPrefix) && !id.startsWith(`${sid}|`)) this.mem.delete(id);
    await this.store?.prune(scope).catch(() => {});
  }
}

/** The IndexedDB store ("walkmycode-voice", object store "audio"), or null where there is no IndexedDB. */
export function idbAudioStore(name = "walkmycode-voice"): AudioStore | null {
  if (typeof indexedDB === "undefined") return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore("audio", { keyPath: "id" });
        s.createIndex("map", "map");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        db = null;
        reject(req.error);
      };
    }));
  const done = (t: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    async get(id) {
      const d = await open();
      return new Promise<CachedAudio | null>((resolve) => {
        const r = d.transaction("audio").objectStore("audio").get(id);
        r.onsuccess = () => {
          const v = r.result as { bytes: ArrayBuffer; words: CachedAudio["words"]; type: string } | undefined;
          resolve(v ? { bytes: new Uint8Array(v.bytes), words: v.words ?? [], type: v.type || "audio/mpeg" } : null);
        };
        r.onerror = () => resolve(null);
      });
    },
    async put(id, scope, v) {
      const d = await open();
      const t = d.transaction("audio", "readwrite");
      const bytes = v.bytes.buffer.slice(v.bytes.byteOffset, v.bytes.byteOffset + v.bytes.byteLength);
      t.objectStore("audio").put({ id, map: scope.map, generatedAt: scope.generatedAt, bytes, words: v.words, type: v.type, at: Date.now() });
      await done(t);
    },
    async prune(scope) {
      const d = await open();
      const t = d.transaction("audio", "readwrite");
      const req = t.objectStore("audio").index("map").openCursor(IDBKeyRange.only(scope.map));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if ((c.value as { generatedAt?: string }).generatedAt !== scope.generatedAt) c.delete();
        c.continue();
      };
      await done(t);
    },
  };
}
