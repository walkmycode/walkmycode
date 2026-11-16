// Fetching a debugger the first time it's needed (the user said yes on the page): download the pinned
// release, check its SHA-256, unpack it into a fresh folder, and only then mark it ready (".ok"). A failed or
// tampered download leaves nothing behind that could be run.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { adapterDir, platformKey, type Adapter } from "./adapters";
import { unzipTo } from "./zip";

export interface InstallProgress {
  got: number;
  total: number;
  phase: "download" | "check" | "unpack";
}

/** `fetchBytes`: tests pass their own; by default the real download, with progress. */
export async function installAdapter(
  a: Adapter,
  progress: (p: InstallProgress) => void,
  o: { home?: string; key?: string; fetchBytes?: (url: string, onBytes: (n: number) => void) => Promise<Buffer> } = {},
): Promise<string> {
  const asset = a.assets[o.key ?? platformKey()];
  if (!asset) throw new Error(`${a.label} has no build for this computer (${o.key ?? platformKey()}).`);
  const dir = adapterDir(a, o.home);
  let got = 0;
  const bytes = await (o.fetchBytes ?? download)(asset.url, (n) => {
    got += n;
    progress({ got, total: asset.bytes, phase: "download" });
  });
  progress({ got: bytes.length, total: asset.bytes, phase: "check" });
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== asset.sha256) throw new Error(`The ${a.label} download didn't match its published checksum, so it wasn't kept. Try again; if it happens again, the download may have been tampered with.`);
  progress({ got: bytes.length, total: asset.bytes, phase: "unpack" });
  // Unpacked beside the final folder, then moved in: a half-unpacked debugger never looks ready.
  const tmp = `${dir}.part-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    unzipTo(bytes, tmp, a.prefix, (rel) => rel.startsWith("images/"));
    writeFileSync(`${tmp}/.ok`, `${a.id} ${a.version} ${asset.sha256}\n`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    renameSync(tmp, dir);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  if (!existsSync(`${dir}/.ok`)) throw new Error(`${a.label} could not be put in place.`);
  return dir;
}

async function download(url: string, onBytes: (n: number) => void): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`The download failed (${r.status}). Check the connection and try again.`);
  const parts: Uint8Array[] = [];
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.length);
  }
  return Buffer.concat(parts);
}
