// A codebase on this computer named in a Learn request ("…in my kola v2 codebase"),
// found and read for the professor: src/learn/lib/codebaseAsk.ts says what the request
// asks for and how the professor is told; this file finds the folder and picks the files
// that matter for the subject. Read only. The folder is read with Explore's own reader
// (src/lib/serverFolder.ts, src/lib/folderRules.ts): never a real .env, keys, credentials,
// hidden or build folders; config files have their secret values hidden.
//
// Where it looks: an absolute path in the request first; else the folders WalkMyCode
// already knows (Explore's saved workspaces, ~/.walkmycode/workspaces/*/workspace.json,
// and "Set up this project"'s setup_roots in config.json), the folders beside them, and
// the folders in the home folder, matched by name (codebaseAsk.ts, scoreFolder).
import "server-only";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { otherFileMode, redactSource } from "@/analyzer/config/files";
import { codebaseAsked, pickCodebase, scoreFolder, topicTerms, wordsOf, type Candidate, type CodebaseDigest, type CodebaseFile, type CodebaseLookup } from "@/learn/lib/codebaseAsk";
import { dataDirIn, homeBase } from "./dataDir";
import { SKIP } from "./folderRules";
import { refuseHosted } from "./learnStore";
import { HttpError } from "./providers/guard";
import { readFolderAt } from "./serverFolder";

/** The most of the codebase's text sent with the lesson's prompt, and of any one file. */
export const DIGEST_MAX = 45_000;
export const FILE_EXCERPT = 7_000;
/** The most files sent. */
const MAX_PICKED = 10;
/** Never read, whatever the folder reader would keep: any .env (keys.env too), keys, certificates, credentials. */
const SECRET = /(^|\/)(\.env(?!\.(example|sample|template|dist)$)[^/]*|[^/]*\.env|[^/]*\.(pem|key|p12|pfx|jks|keystore|crt|cer|kdbx)|[^/]*(secret|credential|private[-_]?key|service[-_]?account)[^/]*)$/i;
/** What makes a folder a project, not a folder of projects. */
const PROJECT = ["package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json", "pubspec.yaml", "Gemfile", "deno.json", ".git"];

export type LookOptions = {
  /** The home folder (tests give a temp folder). */
  home?: string;
  /** WalkMyCode's data folders, where workspaces/ and config.json are. */
  dataDirs?: string[];
};

const key = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const readJson = (file: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const childDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .slice(0, 500)
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
};
export const isProject = (dir: string) => PROJECT.some((f) => existsSync(join(dir, f)));
const isRoot = (p: string) => resolve(p) === parse(resolve(p)).root;

function defaultDataDirs(): string[] {
  const dirs = [dataDirIn(homeBase(homedir())), dataDirIn(homeBase(process.cwd()))];
  return [...new Map(dirs.map((d) => [key(d), d])).values()];
}

/** The folders WalkMyCode already knows: Explore's saved workspaces (by folder and by the workspace's name) and setup_roots. */
export function knownFolders(dataDirs: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const data of dataDirs) {
    const ws = join(data, "workspaces");
    let ids: string[] = [];
    try {
      ids = readdirSync(ws);
    } catch {
      /* none saved */
    }
    for (const id of ids) {
      const w = readJson(join(ws, id, "workspace.json"));
      const folders = Array.isArray(w?.folders) ? w.folders.filter((f): f is string => typeof f === "string") : [];
      for (const f of folders) {
        out.push({ name: basename(f), path: f });
        if (typeof w?.name === "string" && folders.length === 1 && w.name !== basename(f)) out.push({ name: w.name, path: f });
      }
    }
    const roots = readJson(join(data, "config.json"))?.setup_roots;
    if (roots && typeof roots === "object") {
      for (const [name, v] of Object.entries(roots as Record<string, unknown>)) {
        for (const f of Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []) out.push({ name: basename(f), path: f }, { name, path: f });
      }
    }
  }
  return out.filter((c) => isAbsolute(c.path) && isDir(c.path));
}

/** The longest part of a path the request gave that is a folder: "C:\code\shop and its checkout" → C:\code\shop. */
export function folderOfPath(raw: string, home: string): string | null {
  let p = raw.replace(/^~(?=[\\/])/, home);
  for (;;) {
    if (isAbsolute(p) && isDir(p)) return resolve(p);
    const cut = p.search(/\s+\S*$/);
    if (cut <= 0) return null;
    p = p.slice(0, cut).replace(/[\s.,;:!]+$/, "");
  }
}

type Found = { dir: string } | { missing: { looked: string[]; near: string[]; why?: string } };

/** Where the codebase the request names is, or what was looked through. */
export function findCodebase(request: string, opts: LookOptions = {}): Found | null {
  const ask = codebaseAsked(request);
  if (!ask) return null;
  const home = opts.home ?? homedir();
  const known = knownFolders(opts.dataDirs ?? defaultDataDirs());
  const homeKey = key(home);

  // A path in the request: that folder, or, when it holds projects rather than being one, the project named in it.
  for (const raw of ask.paths) {
    const dir = folderOfPath(raw, home);
    if (!dir) continue;
    const broad = key(dir) === homeKey || isRoot(dir);
    if (!broad && isProject(dir)) return { dir };
    const own = new Set(wordsOf(dir));
    const { best } = pickCodebase(ask.words.filter((w) => !own.has(w)), childDirs(dir).map((p) => ({ name: basename(p), path: p })));
    if (best) return { dir: best.path };
    if (!broad) return { dir };
  }
  if (ask.paths.length && !ask.words.length) return { missing: { looked: [], near: [], why: `${ask.paths[0]} is not a folder on this computer` } };

  // By name: the known folders, the folders beside them, the home folder's, and those of any folder named in the request ("in myenvironment").
  const bases = new Map<string, string>([[homeKey, home]]);
  for (const c of known) {
    const up = dirname(c.path);
    if (!isRoot(up)) bases.set(key(up), up);
  }
  for (const d of childDirs(home)) if (ask.words.some((w) => wordsOf(basename(d)).join("") === w)) bases.set(key(d), d);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of [...known, ...[...bases.values()].flatMap((b) => childDirs(b).map((p) => ({ name: basename(p), path: p })))]) {
    const k = `${key(c.path)}|${c.name}`;
    // A folder of projects is where to look, not what was asked for, unless it is a project itself.
    if (seen.has(k) || (bases.has(key(c.path)) && !isProject(c.path))) continue;
    seen.add(k);
    candidates.push(c);
  }
  const { best, near } = pickCodebase(ask.words, candidates);
  if (best && scoreFolder(ask.words, best.name) >= 2) return { dir: best.path };
  const looked = [...bases.values()];
  return { missing: { looked, near: [best, ...near].filter((c): c is Candidate => !!c).map((c) => c.name) } };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = (t: string) => (t.length > 5 ? t.replace(/(es|s)$/, "") : t);
/** Files that say little about how the code works: tests, generated code, lock files, minified bundles. */
const WEAK = /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures?)\/|\.(test|spec|stories)\.[a-z]+$|_pb\.|\.pb\.|(^|\/)generated\/|\.d\.ts$|\.min\.|lock(file)?\.|\.lock$/i;
const ENTRY = /(^|\/)(index|main|app|page|layout|server|router|routes?|api)\.[a-z]+$/i;

/** One file cut to fit: whole when small, else the part around its first mention of the subject. */
export function excerpt(path: string, content: string, terms: string[], max = FILE_EXCERPT): CodebaseFile {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (content.length <= max) return { path, content: lines.join("\n"), from: 1, to: lines.length, lines: lines.length };
  const re = terms.length ? new RegExp(terms.map((t) => escape(stem(t))).join("|"), "i") : null;
  const hit = re ? lines.findIndex((l) => re.test(l)) : -1;
  const start = Math.max(0, hit - 20);
  const out: string[] = [];
  let size = 0;
  for (let i = start; i < lines.length && size + lines[i].length + 1 <= max; i++) {
    out.push(lines[i]);
    size += lines[i].length + 1;
  }
  return { path, content: out.join("\n"), from: start + 1, to: start + out.length, lines: lines.length };
}

/** The codebase read, and the files that matter for the subject picked: by their paths and by how often they mention it. */
export async function digestCodebase(dir: string, terms: string[]): Promise<CodebaseDigest | { error: string }> {
  const read = await readFolderAt(dir);
  if ("error" in read) return read;
  const files = read.files.filter((f) => f.content && !SECRET.test(f.path) && otherFileMode(f.path) !== null);
  const code = files.filter((f) => !/\.(md|mdx|markdown|txt|rst|adoc)$/i.test(f.path));
  const res = terms.map((t) => new RegExp(escape(stem(t)), "gi"));
  const scored = files.map((f) => {
    const p = f.path.toLowerCase();
    let s = 0;
    terms.forEach((t, i) => {
      if (p.includes(stem(t))) s += 10;
      s += Math.min(25, (f.content.match(res[i]) ?? []).length);
    });
    if (!terms.length || s === 0) s += ENTRY.test(f.path) && f.path.split("/").length <= 4 ? 2 : 0;
    if (/(^|\/)readme\.md$/i.test(f.path) && f.path.split("/").length === 1) s += 1;
    if (WEAK.test(f.path)) s *= 0.3;
    if (f.content.length > 80_000) s *= 0.4;
    return { f, s };
  });
  const ranked = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.f.path.length - b.f.path.length);
  const picked: CodebaseFile[] = [];
  let size = 0;
  // The manifest first: it says what the project is built with.
  const manifest = files.find((f) => /^(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|composer\.json|pubspec\.yaml)$/.test(f.path));
  for (const f of [...(manifest ? [manifest] : []), ...ranked.map((x) => x.f).filter((f) => f !== manifest)]) {
    // A few lines left over would be the top of a file (its imports), not what it does.
    if (picked.length >= MAX_PICKED || DIGEST_MAX - size < 1_500) break;
    const one = excerpt(f.path, redactSource(f.path, f.content), terms, Math.min(f === manifest ? 2_500 : FILE_EXCERPT, DIGEST_MAX - size));
    if (!one.content.trim()) continue;
    picked.push(one);
    size += one.content.length;
  }
  // The folders that matter: by how much of the subject is in them, then by size.
  const byDir = new Map<string, { n: number; s: number }>();
  for (const { f, s } of scored.filter((x) => code.includes(x.f))) {
    const d = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ".";
    const v = byDir.get(d) ?? { n: 0, s: 0 };
    byDir.set(d, { n: v.n + 1, s: v.s + s });
  }
  const folders = [...byDir.entries()]
    .sort((a, b) => b[1].s - a[1].s || b[1].n - a[1].n)
    .slice(0, 24)
    .map(([d, v]) => `${d} (${v.n})`);
  return { name: read.name, path: read.path, files: code.length, folders, picked, terms };
}

/** The whole lookup: not asked, found and read, or not found (and where it was looked for). */
export async function lookupCodebase(request: string, opts: LookOptions = {}): Promise<CodebaseLookup> {
  const ask = codebaseAsked(request);
  const where = findCodebase(request, opts);
  if (!ask || !where) return { asked: false };
  if ("missing" in where) return { missing: { phrase: ask.phrase, ...where.missing } };
  const terms = topicTerms(request, [basename(where.dir), ...wordsOf(where.dir)]);
  const d = await digestCodebase(where.dir, terms);
  if ("error" in d) return { missing: { phrase: ask.phrase, looked: [], near: [], why: d.error } };
  return { found: d };
}

/** POST /api/learn/codebase {request}: what lookupCodebase says. On this computer only (not hosted WalkMyCode). */
export function learnCodebaseHandler(opts: LookOptions = {}) {
  return async (req: Request): Promise<Response> => {
    refuseHosted();
    const body = (await req.json().catch(() => null)) as { request?: unknown } | null;
    if (typeof body?.request !== "string" || body.request.length > 4000 || body.request.includes("\0")) throw new HttpError(400, "request: the lesson's request, as text.");
    return Response.json(await lookupCodebase(body.request, opts), { headers: { "cache-control": "no-store" } });
  };
}
