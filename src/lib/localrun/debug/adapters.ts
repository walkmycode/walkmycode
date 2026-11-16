// The debuggers WalkMyCode drives (docs/DEBUG.md): an open-source Debug Adapter per language, fetched on first
// use into ~/.walkmycode/debuggers/<id>, each pinned to one release and checked against its published SHA-256.
// Microsoft's own C#/C++ debuggers (vsdbg) are licensed for Visual Studio products only, so they are not used.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AdapterAsset {
  url: string;
  sha256: string;
  bytes: number;
}

export interface Adapter {
  id: "codelldb";
  label: string;
  version: string;
  licence: string;
  /** Where it comes from, as the page shows it. */
  source: string;
  /** The languages it debugs (LocalLang ids). */
  langs: readonly string[];
  /** The download for a platform and CPU ("win32-x64", "linux-x64"…), or none. */
  assets: Partial<Record<string, AdapterAsset>>;
  /** Inside the archive: what to unpack (the prefix is dropped). */
  prefix: string;
  /** The adapter's program and the arguments that make it connect to `port` (WalkMyCode listens, it connects). */
  command(dir: string, port: number, platform: NodeJS.Platform): { file: string; args: string[] };
}

const exe = (platform: NodeJS.Platform, name: string) => (platform === "win32" ? `${name}.exe` : name);

export const CODELLDB: Adapter = {
  id: "codelldb",
  label: "CodeLLDB",
  version: "1.12.3",
  licence: "MIT",
  source: "github.com/vadimcn/codelldb",
  langs: ["rust"],
  assets: {
    "win32-x64": { url: "https://github.com/vadimcn/codelldb/releases/download/v1.12.3/codelldb-win32-x64.vsix", sha256: "a916e509308dac817732f63ca604a8b93ed29cd16f38a2fa9f0b64ed58e8f51a", bytes: 50_943_475 },
    "linux-x64": { url: "https://github.com/vadimcn/codelldb/releases/download/v1.12.3/codelldb-linux-x64.vsix", sha256: "1cd7f386598022b51a5b93b9ffa23e812b23f519cfe1833384ec4bef4bfd1be1", bytes: 55_571_094 },
    "linux-arm64": { url: "https://github.com/vadimcn/codelldb/releases/download/v1.12.3/codelldb-linux-arm64.vsix", sha256: "0887f67d440554617894266f80706b700907c36b95e6e49d23b95a0e05318101", bytes: 54_544_514 },
  },
  prefix: "extension/",
  command(dir, port, platform) {
    const lib = platform === "win32" ? join(dir, "lldb", "bin", "liblldb.dll") : join(dir, "lldb", "lib", "liblldb.so");
    return { file: join(dir, "adapter", exe(platform, "codelldb")), args: ["--liblldb", lib, "--connect", String(port)] };
  },
};

export const ADAPTERS: readonly Adapter[] = [CODELLDB];

/** The adapter that debugs a language, or null (not yet). */
export function adapterFor(lang: string): Adapter | null {
  return ADAPTERS.find((a) => a.langs.includes(lang)) ?? null;
}

/** Where WalkMyCode keeps its debuggers. */
export function debuggersHome(home = homedir()): string {
  return join(home, ".walkmycode", "debuggers");
}

/** An adapter's folder: one per version, so an update never half-overwrites the one in use. */
export function adapterDir(a: Adapter, home?: string): string {
  return join(debuggersHome(home), `${a.id}-${a.version}`);
}

export const platformKey = (platform: NodeJS.Platform = process.platform, arch: string = process.arch) => `${platform}-${arch}`;

/** Installed, and its program is there. */
export function adapterReady(a: Adapter, home?: string, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): boolean {
  const dir = adapterDir(a, home);
  return exists(join(dir, ".ok")) && exists(a.command(dir, 0, platform).file);
}

/** What the page shows before fetching it. */
export interface AdapterOffer {
  id: string;
  label: string;
  version: string;
  licence: string;
  source: string;
  bytes: number;
  dir: string;
}

export function offerOf(a: Adapter, home?: string, key = platformKey()): AdapterOffer | null {
  const asset = a.assets[key];
  if (!asset) return null;
  return { id: a.id, label: a.label, version: a.version, licence: a.licence, source: a.source, bytes: asset.bytes, dir: adapterDir(a, home) };
}
