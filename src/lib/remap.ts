// A saved map keeps what the analyzer could draw when it was made. One made before WalkMyCode could draw a
// language its folder holds (a Rust project mapped before Rust was on the map: src/analyzer/migrate.ts
// drawnSince) says so on the map, with the one way to map it again (src/components/MapAgain.tsx). Plain
// code, no browser APIs: what to offer, its words, and the workspace mapped again.
import type { Assertion, CodeMap, RepoRef, SourceFile } from "@/analyzer/types";
import type { Target } from "./adapters/target";
import type { RepoSource, Workspace } from "./store";
import { combineRepos, defaultName, tooMany } from "./workspace";

export type MapAgainHow =
  /** Every folder can be read again from disk: its kept handle (the browser asks first) or its path in the desktop app. */
  | "refresh"
  /** One folder the page can't read again by itself (picked with the file input, or its code left elsewhere): choose it again. */
  | "choose"
  /** Several folders, not all of them readable again: Folders adds them again and maps them. */
  | "folders"
  /** Indexed from the command line (`npm run index`, served by /api/demo): index it again. */
  | "index"
  /** WalkMyCode for Claude: the local server made the map, so Claude opens the folder again. */
  | "claude";

/** How this workspace can be mapped again. */
export function mapAgainHow(w: { repos: Pick<RepoSource, "handle" | "path">[]; map: Pick<CodeMap, "repos"> }, target: Target): MapAgainHow {
  if (target === "mcp") return "claude";
  if (w.map.repos.some((r) => r.kind === "cli")) return "index";
  if (w.repos.length && w.repos.every((r) => r.path || r.handle)) return "refresh";
  return w.repos.length <= 1 ? "choose" : "folders";
}

/** "Rust", "Rust and Go", "Rust, Go and Java". */
export function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the map says: the first sentence, what to do, and the button's label (none where the page can't do it). */
export function mapAgainWords(langs: { name: string; files: number }[], how: MapAgainHow, folders = 1): { title: string; body: string; action?: string } {
  const list = listOf(langs.map((l) => l.name));
  const n = langs.reduce((s, l) => s + l.files, 0);
  const them = `its ${n} ${list} file${n === 1 ? "" : "s"}`;
  const folder = folders > 1 ? "folders" : "folder";
  switch (how) {
    case "refresh":
      return { title: `This map was made before WalkMyCode could draw ${list}.`, body: `Map the ${folder} again to draw ${them}.`, action: "Map again" };
    case "choose":
      return { title: `This map was made before WalkMyCode could draw ${list}.`, body: `Choose the folder again to draw ${them}.`, action: "Choose the folder" };
    case "folders":
      return { title: `This map was made before WalkMyCode could draw ${list}.`, body: `In Folders, edit this map and map it again to draw ${them}.`, action: "Folders" };
    case "index":
      return { title: `This map was indexed before WalkMyCode could draw ${list}.`, body: `Index it again to draw ${them}: npm run index -- <the ${folder}>.` };
    case "claude":
      return { title: `This map was made before WalkMyCode could draw ${list}.`, body: `Ask Claude to open the ${folder} again to draw ${them}.` };
  }
}

/** A folder read again: what the folder readers give (src/lib/localFolder.ts PickedFolder). */
export interface FolderRead {
  name: string;
  files: SourceFile[];
  handle?: FileSystemDirectoryHandle;
  path?: string;
}

export type Build = (req: { sources: SourceFile[]; name: string; repos: RepoRef[]; assertions: Assertion[] }) => Promise<{ map: CodeMap; contents: Record<string, string> }>;

/** The workspace mapped again from its folders read afresh: `folders[i]` is `w.repos[i]` read again, or the one
 * folder chosen again. Same name and answers; a new id, so the room starts afresh on the new map. Throws when
 * the folders hold more files than a workspace may. */
export async function mapAgain(w: Workspace, folders: FolderRead[], build: Build, id: string = crypto.randomUUID()): Promise<Workspace> {
  const total = folders.reduce((s, f) => s + f.files.length, 0);
  const why = tooMany(0, total);
  if (why) throw new Error(why);
  // One folder chosen again is named after itself, as when it was first mapped; read again, each keeps its label.
  const chosen = folders.length === 1 && w.repos.length === 1 && !w.repos[0].handle && !w.repos[0].path;
  const rows = folders.map((f, i) => ({ label: chosen ? f.name : (w.repos[i]?.label ?? f.name), files: f.files, kind: (w.repos[i]?.kind === "demo" ? "demo" : "local") as RepoSource["kind"] }));
  const name = rows.length > 1 ? w.name : defaultName([rows[0]?.label ?? w.name]);
  const assertions = w.assertions ?? [];
  const { sources, repos: refs } = combineRepos(rows);
  const { map, contents } = await build({ sources, name, repos: refs, assertions });
  const now = new Date().toISOString();
  const repos: RepoSource[] = rows.map((r, i) => {
    const f = folders[i];
    return { label: refs[i].label, kind: r.kind, fileCount: r.files.length, addedAt: now, ...(f.handle ? { handle: f.handle } : {}), ...(f.path ? { path: f.path } : {}) };
  });
  return { id, name, repos, map, files: contents, ...(assertions.length ? { assertions } : {}) };
}
