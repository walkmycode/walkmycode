// Unpacking a debugger's download (a .vsix or .zip) with Node's own zlib: the central directory names each
// entry, its compressed size and where its data starts; stored entries are copied, deflated ones inflated.
// No zip64 (a debugger's archive is well under 4 GB). Every path is checked to stay inside the target folder.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  /** Where the entry's local header starts. */
  at: number;
  /** Unix permission bits, when the archive was made on Unix (0 otherwise). */
  mode: number;
}

/** The archive's entries, from its central directory. */
export function zipEntries(zip: Buffer): ZipEntry[] {
  // The end-of-central-directory record: in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That download is not a zip archive.");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("The archive's directory is damaged.");
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const at = zip.readUInt32LE(p + 42);
    const made = zip.readUInt8(p + 5);
    const mode = made === 3 ? (zip.readUInt32LE(p + 38) >>> 16) & 0o777 : 0;
    out.push({ name: zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"), method, compressed, size, at, mode });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's bytes. */
export function zipRead(zip: Buffer, e: ZipEntry): Buffer {
  if (zip.readUInt32LE(e.at) !== 0x04034b50) throw new Error(`The archive's entry ${e.name} is damaged.`);
  const start = e.at + 30 + zip.readUInt16LE(e.at + 26) + zip.readUInt16LE(e.at + 28);
  const data = zip.subarray(start, start + e.compressed);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`The archive's entry ${e.name} is packed in a way WalkMyCode can't unpack (method ${e.method}).`);
}

/**
 * Unpack the entries under `prefix` (e.g. "extension/") into `dir`, the prefix dropped. Returns how many
 * files were written. A path that would land outside `dir` stops it.
 */
export function unzipTo(zip: Buffer, dir: string, prefix = "", skip?: (name: string) => boolean): number {
  let n = 0;
  for (const e of zipEntries(zip)) {
    if (!e.name.startsWith(prefix) || e.name.endsWith("/")) continue;
    const rel = e.name.slice(prefix.length);
    if (!rel || skip?.(rel)) continue;
    const target = normalize(join(dir, rel));
    const back = relative(dir, target);
    if (!back || back.startsWith("..") || isAbsolute(back) || back.split(sep).includes("..")) throw new Error(`The archive tried to write outside its folder (${e.name}).`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zipRead(zip, e));
    // A program keeps its execute bit (codelldb, lldb-server on Linux).
    if (process.platform !== "win32" && e.mode & 0o111) chmodSync(target, e.mode | 0o600);
    n++;
  }
  return n;
}
