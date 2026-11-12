// The speech model on this computer (docs/VOICE.md §4d): NVIDIA Parakeet-TDT
// 0.6B v2 (English), the int8 sherpa-onnx conversion. Where it is, whether it
// is whole, and getting it:
//  - a copy iReliabee already downloaded (~/.local/share/ireliabee/models/…)
//    is used where it lies, and is never changed or removed by WalkMyCode;
//  - else WalkMyCode's own copy in ~/.walkmycode/models/, downloaded from the
//    sherpa-onnx release: streamed to a .part file with its size and SHA-256
//    checked, unpacked by our own reader (tar.ts: only the four files, no
//    paths that climb out, no links), and moved into place in one rename.
// Nothing here loads the model: that is engine.ts.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { once } from "node:events";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { extractWanted, TarRefused } from "./tar";

export const MODEL = {
  name: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
  label: "NVIDIA Parakeet-TDT 0.6B v2",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
  /** The archive's size and SHA-256, checked before anything is unpacked: the release as re-published
   * upstream on 7 Nov 2026 (new model files; tested to transcribe the same as the earlier ones). */
  bytes: 482_440_461,
  sha256: "6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714",
  /** The four files, unpacked: about 631 MB. */
  unpackedBytes: 661_288_526,
  files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
} as const;

/** Free space asked for before a download: the archive, the files, and room to spare. */
export const SPARE_BYTES = 150 * 1024 * 1024;
export const NEEDED_BYTES = MODEL.bytes + MODEL.unpackedBytes + SPARE_BYTES;

export type ModelSource = "ireliabee" | "walkmycode";

export interface ModelDirs {
  /** WalkMyCode's own models folder (~/.walkmycode/models, or WALKMYCODE_MODELS_DIR). */
  own: string;
  /** Where iReliabee keeps its models (or WALKMYCODE_IRELIABEE_MODELS_DIR; "" = never look). */
  ireliabee: string;
}

export function modelDirs(env: Record<string, string | undefined> = process.env): ModelDirs {
  return {
    own: env.WALKMYCODE_MODELS_DIR || join(homedir(), ".walkmycode", "models"),
    ireliabee: env.WALKMYCODE_IRELIABEE_MODELS_DIR ?? join(homedir(), ".local", "share", "ireliabee", "models"),
  };
}

/** Whether a folder holds the model: all four files, none empty. */
export function isInstalled(dir: string): boolean {
  return MODEL.files.every((f) => {
    try {
      const s = statSync(join(dir, f));
      return s.isFile() && s.size > 0;
    } catch {
      return false;
    }
  });
}

/** The model to use: iReliabee's copy when it is whole, else WalkMyCode's own, else null. */
export function findModel(dirs: ModelDirs = modelDirs()): { dir: string; source: ModelSource } | null {
  if (dirs.ireliabee) {
    const theirs = join(dirs.ireliabee, MODEL.name);
    if (isInstalled(theirs)) return { dir: theirs, source: "ireliabee" };
  }
  const ours = join(dirs.own, MODEL.name);
  return isInstalled(ours) ? { dir: ours, source: "walkmycode" } : null;
}

export type InstallPhase = "idle" | "downloading" | "verifying" | "unpacking" | "failed";

export interface InstallProgress {
  phase: InstallPhase;
  /** Bytes of the archive received so far. */
  received: number;
  total: number;
  /** Why the last try failed, in words for the user. */
  error: string | null;
}

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

const CHANGED = "The file may have been cut short, or replaced on GitHub since this version of WalkMyCode was made. Nothing was unpacked.";

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/** The free bytes on the disk holding `dir` (its nearest existing parent), or null when that cannot be read. */
export async function freeBytes(dir: string): Promise<number | null> {
  let at = resolve(dir);
  for (let i = 0; i < 64 && !existsSync(at); i++) {
    const up = resolve(at, "..");
    if (up === at) break;
    at = up;
  }
  try {
    const s = await statfs(at);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export interface InstallDeps {
  dirs?: ModelDirs;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** The archive expected (tests use a small one). */
  model?: { name: string; url: string; bytes: number; sha256: string; files: readonly string[] };
  freeBytes?: (dir: string) => Promise<number | null>;
  /** Bytes that must be free (tests). */
  needed?: number;
  /** bzip2 → tar bytes (tests may hand over a plain tar). */
  decompress?: (file: string) => AsyncIterable<Uint8Array>;
  onProgress?: (p: InstallProgress) => void;
  signal?: AbortSignal;
  /** The final move (tests stand in a Windows that refuses it for a moment). */
  rename?: (from: string, to: string) => void;
}

/** The archive file, decompressed: bzip2 in pure JavaScript (unbzip2-stream), as an async stream of tar bytes. */
export function bunzip(file: string): AsyncIterable<Uint8Array> {
  const out = new PassThrough();
  void import("unbzip2-stream")
    .then((m) => {
      const make = (m as unknown as { default?: () => NodeJS.ReadWriteStream }).default ?? (m as unknown as () => NodeJS.ReadWriteStream);
      const src = createReadStream(file);
      const bz = make();
      src.on("error", (e) => out.destroy(e));
      bz.on("error", (e: Error) => out.destroy(new TarRefused(`The archive couldn't be decompressed (${e.message}).`)));
      out.on("close", () => src.destroy());
      src.pipe(bz).pipe(out);
    })
    .catch((e: Error) => out.destroy(e));
  return out;
}

/**
 * Download, check, unpack and move WalkMyCode's own copy into place.
 * Resolves with the model's folder; throws InstallError (in words for the
 * user) or an AbortError when cancelled. Whatever happens, no half-made
 * folder is left where the model goes: the work is done in <own>/.incoming.
 */
export async function installModel(deps: InstallDeps = {}): Promise<string> {
  const dirs = deps.dirs ?? modelDirs();
  const model = deps.model ?? MODEL;
  const fetchImpl = deps.fetch ?? fetch;
  const signal = deps.signal;
  const final = join(dirs.own, model.name);
  const work = join(dirs.own, ".incoming");
  const archive = join(work, `${model.name}.tar.bz2.part`);
  const unpack = join(work, `${model.name}.unpack`);
  const p: InstallProgress = { phase: "downloading", received: 0, total: model.bytes, error: null };
  const tell = () => deps.onProgress?.({ ...p });

  const have = await (deps.freeBytes ?? freeBytes)(dirs.own);
  const needed = deps.needed ?? (deps.model ? model.bytes * 3 : NEEDED_BYTES);
  if (have !== null && have < needed) throw new InstallError(`Not enough free space: the speech model needs ${gb(needed)} while it is set up (${gb(MODEL.unpackedBytes)} once done), and this disk has ${gb(have)} free.`);

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    tell();
    let res: Response;
    try {
      res = await fetchImpl(model.url, { redirect: "follow", signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new InstallError("The download couldn't start: GitHub could not be reached. Check the connection and try again.");
    }
    if (!res.ok || !res.body) throw new InstallError(`The download couldn't start: GitHub answered ${res.status}.`);
    const hash = createHash("sha256");
    const file = createWriteStream(archive, { flags: "w" });
    // A failed write is told by the code below; a late one (the file torn down mid-open) is not a crash.
    let writeFailed: Error | null = null;
    file.on("error", (e) => (writeFailed = e));
    try {
      let last = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        p.received += chunk.length;
        if (p.received > model.bytes) throw new InstallError("The download was refused: it is larger than the speech model should be.");
        hash.update(chunk);
        if (!file.write(chunk)) await once(file, "drain");
        if (p.received - last >= 1024 * 1024) {
          last = p.received;
          tell();
        }
      }
      if (writeFailed) throw writeFailed;
      await new Promise<void>((ok, no) => file.end((e?: Error | null) => (e || writeFailed ? no(e ?? writeFailed) : ok())));
    } catch (e) {
      await new Promise<void>((ok) => (file.closed ? ok() : (file.once("close", () => ok()), file.destroy())));
      if (writeFailed && !(e instanceof InstallError) && !signal?.aborted) throw new InstallError(`The download couldn't be saved (${(writeFailed as Error).message.split("\n")[0]}).`);
      if (signal?.aborted || e instanceof InstallError) throw e;
      throw new InstallError("The download stopped part-way (the connection dropped). Try again.");
    }
    p.phase = "verifying";
    tell();
    // The file is pinned: a different one (cut short, or replaced on GitHub since this version was made) is never unpacked.
    if (p.received !== model.bytes) throw new InstallError(`The download was refused: ${p.received} bytes arrived, not the ${model.bytes} expected. ${CHANGED}`);
    if (hash.digest("hex") !== model.sha256) throw new InstallError(`The download was refused: its checksum doesn't match the speech model's. ${CHANGED}`);

    p.phase = "unpacking";
    tell();
    mkdirSync(unpack, { recursive: true });
    try {
      await extractWanted((deps.decompress ?? bunzip)(archive), { dest: unpack, want: model.files, top: model.name, signal });
    } catch (e) {
      if (e instanceof TarRefused) throw new InstallError(e.message);
      throw e;
    }
    for (const f of model.files) if (statSync(join(unpack, f)).size === 0) throw new InstallError(`The archive was refused: ${f} is empty.`);
    // Into place in one rename; a copy that appeared meanwhile is replaced.
    rmSync(final, { recursive: true, force: true });
    await moveIntoPlace(unpack, final, deps.rename ?? renameSync);
    return final;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Errors Windows gives for a moment while antivirus or the indexer still holds files just written. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * The unpacked folder into its place. On Windows a rename can be refused for a moment right after the
 * files were written (Defender scanning 650 MB of new model files, the indexer): it is tried again for
 * about three seconds before the error is let through.
 */
export async function moveIntoPlace(from: string, to: string, rename: (from: string, to: string) => void = renameSync, waits = [50, 100, 200, 300, 500, 800, 1000]): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!code || !BUSY.has(code) || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

/**
 * Remove WalkMyCode's own copy, and only that: the folder must be the model's
 * folder directly inside WalkMyCode's models folder. iReliabee's copy is never touched.
 * Returns whether there was one.
 */
export function removeOwnModel(dirs: ModelDirs = modelDirs()): boolean {
  const own = resolve(dirs.own);
  const target = resolve(own, MODEL.name);
  if (target !== own + sep + MODEL.name) throw new InstallError("WalkMyCode's models folder is not where it should be: nothing was removed.");
  if (dirs.ireliabee && resolve(dirs.ireliabee, MODEL.name) === target) throw new InstallError("That folder is iReliabee's copy: WalkMyCode never removes it.");
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
