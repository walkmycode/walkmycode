// Taking a few named files out of a tar stream, and nothing else
// (docs/VOICE.md §4d): the speech model's archive is unpacked by this reader,
// never by a `tar` program. It refuses the whole archive when any entry has
// an absolute path, a `..` segment, or is a symbolic or hard link; it writes
// only regular files whose path is exactly <top folder>/<wanted name>, under
// that plain name, into a folder the caller made; and it never follows what
// an archive says about owners, modes or times.
import { createWriteStream } from "node:fs";
import { join } from "node:path";

export class TarRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarRefused";
  }
}

const BLOCK = 512;

function text(b: Uint8Array, from: number, len: number): string {
  let end = from;
  while (end < from + len && b[end] !== 0) end++;
  return Buffer.from(b.buffer, b.byteOffset + from, end - from).toString("utf8");
}

/** A header's number: octal text, or GNU's base-256 for sizes past 8 GB. */
function num(b: Uint8Array, from: number, len: number): number {
  if (b[from] & 0x80) {
    let n = 0;
    for (let i = from + 1; i < from + len; i++) n = n * 256 + b[i];
    return n;
  }
  const s = text(b, from, len).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new TarRefused("The archive is damaged (a size is not a number).");
  return parseInt(s, 8);
}

function checksumOk(h: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return sum === num(h, 148, 8);
}

/** Why a path inside an archive is not allowed, or null. */
export function unsafePath(name: string): string | null {
  if (!name) return "an entry has no name";
  if (name.includes("\0")) return "an entry's name holds a NUL";
  if (/^[/\\]/.test(name) || /^[A-Za-z]:/.test(name)) return `an absolute path (${name.slice(0, 80)})`;
  if (name.split(/[/\\]/).some((part) => part === "..")) return `a path that climbs out with .. (${name.slice(0, 80)})`;
  return null;
}

/** The `path=` of a pax header's records, if it has one. */
function paxPath(body: Uint8Array): string | null {
  const s = Buffer.from(body).toString("utf8");
  let at = 0;
  let path: string | null = null;
  while (at < s.length) {
    const sp = s.indexOf(" ", at);
    if (sp === -1) break;
    const len = Number(s.slice(at, sp));
    if (!Number.isInteger(len) || len <= 0) break;
    // Lengths are in bytes; the model's names are ASCII, where they agree.
    const rec = s.slice(sp + 1, at + len - 1);
    const eq = rec.indexOf("=");
    if (eq !== -1 && rec.slice(0, eq) === "path") path = rec.slice(eq + 1);
    at += len;
  }
  return path;
}

/** Resolves when a stream can take more, or has closed (an error closes it): never left waiting, no listener left behind. */
function drained(s: NodeJS.WritableStream): Promise<void> {
  return new Promise((ok) => {
    const done = () => {
      s.off("drain", done);
      s.off("close", done);
      ok();
    };
    s.on("drain", done);
    s.on("close", done);
  });
}

export interface ExtractOptions {
  /** The folder the wanted files are written into (it exists and is empty). */
  dest: string;
  /** The plain names wanted, e.g. tokens.txt. */
  want: readonly string[];
  /** The one top folder they must sit in inside the archive. */
  top: string;
  /** The most bytes one wanted file may hold. */
  maxFileBytes?: number;
  signal?: AbortSignal;
}

/**
 * Read a tar stream to its end, writing the wanted files into `dest`.
 * Returns the names written. Throws TarRefused for anything unsafe, damaged,
 * or missing; the caller removes `dest`.
 */
export async function extractWanted(source: AsyncIterable<Uint8Array>, o: ExtractOptions): Promise<string[]> {
  const maxFile = o.maxFileBytes ?? 2 * 1024 * 1024 * 1024;
  const wanted = new Set(o.want);
  const written = new Set<string>();
  let buf: Buffer = Buffer.alloc(0);
  const it = source[Symbol.asyncIterator]();
  let ended = false;

  /** Make `n` bytes available in buf; false when the stream ends first. */
  const fill = async (n: number): Promise<boolean> => {
    while (buf.length < n && !ended) {
      if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const r = await it.next();
      if (r.done) ended = true;
      else buf = buf.length ? Buffer.concat([buf, r.value]) : Buffer.from(r.value.buffer, r.value.byteOffset, r.value.byteLength);
    }
    return buf.length >= n;
  };
  /** Pass `n` bytes of an entry's body to `sink` (or drop them), then its padding. */
  const body = async (n: number, sink?: (chunk: Buffer) => Promise<void>): Promise<void> => {
    let left = n;
    while (left > 0) {
      if (!buf.length && !(await fill(1))) throw new TarRefused("The archive ends in the middle of a file.");
      const take = buf.subarray(0, Math.min(left, buf.length));
      buf = buf.subarray(take.length);
      left -= take.length;
      if (sink) await sink(take);
    }
    const pad = (BLOCK - (n % BLOCK)) % BLOCK;
    if (pad) {
      if (!(await fill(pad))) throw new TarRefused("The archive ends in the middle of a file.");
      buf = buf.subarray(pad);
    }
  };

  let longName: string | null = null;
  for (;;) {
    if (!(await fill(BLOCK))) {
      if (buf.length) throw new TarRefused("The archive ends in the middle of a header.");
      break;
    }
    const h = buf.subarray(0, BLOCK);
    buf = buf.subarray(BLOCK);
    if (h.every((x) => x === 0)) continue; // the end-of-archive blocks
    if (!checksumOk(h)) throw new TarRefused("The archive is damaged (a header's checksum is wrong).");
    const type = String.fromCharCode(h[156] || 48);
    const size = num(h, 124, 12);
    if (type === "L" || type === "x" || type === "g") {
      // A long name for the next entry (GNU "L", pax "x"); a global pax header ("g") is read and ignored.
      if (size > 64 * 1024) throw new TarRefused("The archive is damaged (a name is too long).");
      const chunks: Buffer[] = [];
      await body(size, async (c) => void chunks.push(Buffer.from(c)));
      const all = Buffer.concat(chunks);
      if (type === "L") longName = text(all, 0, all.length);
      else if (type === "x") longName = paxPath(all) ?? longName;
      continue;
    }
    const prefix = text(h, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
    longName = null;
    const bad = unsafePath(name);
    if (bad) throw new TarRefused(`The archive was refused: it holds ${bad}.`);
    if (type === "1" || type === "2") throw new TarRefused(`The archive was refused: it holds a ${type === "2" ? "symbolic" : "hard"} link (${name.slice(0, 80)}).`);
    const parts = name.split(/[/\\]/).filter((p) => p && p !== ".");
    const isFile = type === "0" || type === "7";
    const pick = isFile && parts.length === 2 && parts[0] === o.top && wanted.has(parts[1]) ? parts[1] : null;
    if (!pick) {
      // Folders, the test recordings, anything else: read past, never written.
      await body(isFile ? size : type === "5" ? 0 : size);
      continue;
    }
    if (written.has(pick)) throw new TarRefused(`The archive was refused: it holds ${pick} twice.`);
    if (size > maxFile) throw new TarRefused(`The archive was refused: ${pick} is larger than expected.`);
    const out = createWriteStream(join(o.dest, pick), { flags: "wx", mode: 0o644 });
    let failed: Error | null = null;
    out.on("error", (e) => (failed = e));
    try {
      await body(size, async (c) => {
        if (failed) throw failed;
        if (!out.write(c)) await drained(out);
      });
      await new Promise<void>((ok, no) => out.end((e?: Error | null) => (e || failed ? no(e ?? failed) : ok())));
    } catch (e) {
      // Closed before the caller removes the folder.
      await new Promise<void>((ok) => (out.closed ? ok() : (out.once("close", () => ok()), out.destroy())));
      throw e;
    }
    written.add(pick);
  }
  const missing = o.want.filter((w) => !written.has(w));
  if (missing.length) throw new TarRefused(`The archive doesn't hold ${missing.join(", ")}.`);
  return [...written];
}
