// Workspaces on disk for WalkMyCode for Claude (docs/MCP.md §2.3). Folders are read
// from disk the way the CLI reads them (scripts/readDir.ts), mapped with the
// same analyzer in Node, and several folders become one workspace the way
// `npm run index` combines them: each folder's paths start with its name. Each
// workspace's map and the user's answers about it ("Where does this point?")
// are saved under ~/.walkmycode/workspaces/<id>/ (or the old ~/.lantern when
// only that exists); WALKMYCODE_HOME moves ~ (tests), as it does for
// ~/.walkmycode/keys.env (src/lib/providers/keys.ts).
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDir, TooManyFilesError } from "../../scripts/readDir";
import { buildMap } from "../../src/analyzer/build";
import { redactSource } from "../../src/analyzer/config/files";
import { upgradeMap } from "../../src/analyzer/migrate";
import { GRAMMAR_FILES, setGrammarLoader } from "../../src/analyzer/parser";
import type { Assertion, CodeMap } from "../../src/analyzer/types";
import type { WorkspaceInfo } from "../../src/lib/bridge/protocol";
import { dataDirIn, homeBase } from "../../src/lib/dataDir";
import { answersOf } from "../../src/lib/store";
import { combineRepos, defaultName, uniqueLabels } from "../../src/lib/workspace";
import { log } from "./log";

/** Code and config files read per workspace at most: enough for a big monorepo, not for a whole disk. */
export const MAX_FILES = 30_000;

/** ~/.walkmycode, or WALKMYCODE_HOME/.walkmycode; the old .lantern folder when only that one exists. */
export function lanternDir(): string {
  return dataDirIn(homeBase(homedir()));
}

/** Where the tree-sitter grammars come from: a folder of .wasm files (the bundle's wasm/), or node_modules as the CLI reads them. */
export function loadGrammarsFrom(from: { folder: string } | { nodeModules: string }): void {
  setGrammarLoader(async (name) => {
    const file = "folder" in from ? join(from.folder, basename(GRAMMAR_FILES[name])) : join(from.nodeModules, GRAMMAR_FILES[name]);
    return new Uint8Array(await readFile(file));
  });
}

/** Something wrong with the folders asked for, in words the user can act on. */
export class FolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderError";
  }
}

const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** "~/code/app", "file:///…" or a relative path → an absolute path. */
export function expandPath(input: string, cwd = process.cwd()): string {
  let p = input.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (/^file:\/\//i.test(p)) p = fileURLToPath(p);
  if (p === "~" || /^~[\\/]/.test(p)) p = join(homedir(), p.slice(1));
  return resolve(cwd, p);
}

async function checkFolder(dir: string): Promise<void> {
  const s = await stat(dir).catch(() => null);
  if (!s) throw new FolderError(`${dir} doesn't exist. Give the project's full path.`);
  if (!s.isDirectory()) throw new FolderError(`${dir} is a file, not a folder. Give the project's folder.`);
  if (key(dir) === key(parsePath(dir).root)) throw new FolderError(`${dir} is a whole disk. Open a project folder instead.`);
  if (key(dir) === key(resolve(homedir()))) throw new FolderError(`${dir} is the user's whole home folder. Open a project folder inside it.`);
}

/** A workspace's id: a readable name and its folders, so opening the same folders again finds the same saved answers. */
export function workspaceId(name: string, folders: string[]): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";
  return `${slug}-${createHash("sha256").update(folders.map(key).sort().join("\n")).digest("hex").slice(0, 10)}`;
}

export interface OpenedWorkspace {
  info: WorkspaceInfo;
  /** The folders read, absolute. */
  folders: string[];
  map: CodeMap;
  /** Everything read except secret files; config files with their secret values hidden (what the CLI keeps). */
  files: Record<string, string>;
  /** Where its map and answers are saved. */
  savedIn: string;
}

export interface OpenOptions {
  /** A name for a workspace of several folders (one folder is named after itself). */
  name?: string;
  maxFiles?: number;
  /** Where a relative path starts (default: this process's folder). */
  cwd?: string;
  onProgress?: (done: number, total: number) => void;
}

/** Read the folders, map them as one workspace, save the map, and hand back everything the tools and the page need. */
export async function openWorkspace(folders: string[], o: OpenOptions = {}): Promise<OpenedWorkspace> {
  const dirs = [...new Map(folders.map((f) => expandPath(f, o.cwd)).map((d) => [key(d), d])).values()];
  if (!dirs.length) throw new FolderError("No folder was given.");
  for (const d of dirs) await checkFolder(d);
  const labels = uniqueLabels(dirs.map((d) => basename(d)));
  const name = o.name?.trim() || (dirs.length > 1 ? defaultName(labels) : basename(dirs[0]));
  const max = o.maxFiles ?? MAX_FILES;
  const read: { label: string; files: Awaited<ReturnType<typeof readDir>>; kind: "cli" }[] = [];
  let total = 0;
  for (const [i, d] of dirs.entries()) {
    try {
      const files = await readDir(d, { maxFiles: Math.max(0, max - total) });
      total += files.length;
      read.push({ label: dirs.length > 1 ? labels[i] : name, files, kind: "cli" });
    } catch (e) {
      if (!(e instanceof TooManyFilesError)) throw e;
      const what = dirs.length > 1 ? "These folders hold" : `${d} holds`;
      throw new FolderError(`${what} more than ${max.toLocaleString("en-GB")} code and config files. Open a project folder (or a few of them), not a folder of many projects.`);
    }
  }
  const { sources, repos } = combineRepos(read);
  if (dirs.length === 1) repos[0].label = name;
  const id = workspaceId(name, dirs);
  const savedIn = join(lanternDir(), "workspaces", id);
  const built = await buildMap(sources, { name, repos, assertions: await savedAnswers(savedIn), onProgress: o.onProgress && ((done, all) => o.onProgress!(done, all)) });
  // Always the current map version, whatever the analyzer handed back (as the CLI does).
  const map = upgradeMap(built.map, "cli");
  const secret = new Set(map.files.filter((f) => f.skipped === "secret").map((f) => f.path));
  const files = Object.fromEntries(sources.filter((s) => !secret.has(s.path)).map((s) => [s.path, redactSource(s.path, s.content)]));
  const info: WorkspaceInfo = { id, name, repos: repos.map((r) => r.label), files: Object.keys(files).length, mappedAt: map.generatedAt };
  try {
    await save(savedIn, map, info, dirs);
  } catch (e) {
    // The map still works in memory; only the next launch loses the answers.
    log(`could not save the map under ${savedIn}: ${(e as Error).message}`);
  }
  return { info, folders: dirs, map, files, savedIn };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, path);
}

async function save(dir: string, map: CodeMap, info: WorkspaceInfo, folders: string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, "map.json"), map);
  await writeJson(join(dir, "answers.json"), { answers: answersOf(map) });
  await writeJson(join(dir, "workspace.json"), { ...info, folders, savedAt: new Date().toISOString() });
}

/** Keep the user's answers for a workspace (answers.json), so the next map of it is built with them. */
export async function saveAnswers(dir: string, answers: Assertion[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, "answers.json"), { answers });
}

/** The page server's port last time, so this launch can take it again (the page's storage is per port). */
export async function lastPort(): Promise<number | undefined> {
  try {
    const n = Number((await readFile(join(lanternDir(), "page-port"), "utf8")).trim());
    return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : undefined;
  } catch {
    return undefined;
  }
}

export async function keepPort(port: number): Promise<void> {
  try {
    await mkdir(lanternDir(), { recursive: true });
    await writeFile(join(lanternDir(), "page-port"), `${port}\n`, "utf8");
  } catch {
    // Next launch takes any free port: nothing is lost but the page's storage.
  }
}

/** The answers saved with a workspace: answers.json, else the ones its saved map was built with. */
export async function savedAnswers(dir: string): Promise<Assertion[]> {
  try {
    const saved = JSON.parse(await readFile(join(dir, "answers.json"), "utf8")) as { answers?: unknown };
    if (Array.isArray(saved.answers)) return saved.answers as Assertion[];
  } catch {
    // none yet
  }
  try {
    return answersOf(JSON.parse(await readFile(join(dir, "map.json"), "utf8")) as CodeMap);
  } catch {
    return [];
  }
}

/** Why a file could not be written back, for the page: its words and an HTTP status. */
export interface WriteRefused {
  status: number;
  why: string;
}

/**
 * Write an edited file back into the workspace's folder (the code view's Save, POST /api/files/save).
 * Only a file WalkMyCode read for this workspace (never a new one, never a secret one), only inside its
 * folder, and never a config file whose secret values the page sees hidden: writing that copy back would
 * replace the real values. A file changed on disk since it was read is left alone, so nobody's edit is lost.
 */
export async function writeWorkspaceFile(ws: OpenedWorkspace, path: string, text: string): Promise<WriteRefused | null> {
  const known = ws.files[path];
  if (known === undefined) return { status: 404, why: `${path} isn't a file WalkMyCode read for this project.` };
  const repos = ws.map.repos;
  const i = repos.length > 1 ? repos.findIndex((r) => r.prefix && path.startsWith(r.prefix)) : 0;
  const folder = ws.folders[i];
  if (i < 0 || !folder) return { status: 404, why: `${path} isn't in a folder of this project.` };
  const inner = repos.length > 1 ? path.slice(repos[i].prefix.length) : path;
  const file = resolve(folder, inner);
  const rel = relative(resolve(folder), file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { status: 400, why: "That path leaves the project's folder." };
  let disk: string;
  try {
    disk = await readFile(file, "utf8");
  } catch {
    return { status: 404, why: `${path} is no longer on disk.` };
  }
  if (redactSource(path, disk) !== disk) return { status: 409, why: `${path} holds values WalkMyCode keeps hidden (keys, passwords): edit it in your own editor.` };
  if (disk !== known) return { status: 409, why: `${path} changed on disk since WalkMyCode read it: reload the page to see the new version, then edit again.` };
  await writeFile(file, text, "utf8");
  ws.files[path] = text;
  return null;
}
