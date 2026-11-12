// Several folders, one map (docs/SERVICES.md §6.2). With one repo nothing
// changes: its paths go to the analyzer as they are. With several, every
// path is prefixed with its repo's label ("web/src/lib/api.ts"), so node ids,
// evidence, file lists and citations keep working unchanged. Plain code, no
// browser APIs: the Connect page, the CLI and the tests all use it.
import type { RepoRef, SourceFile } from "@/analyzer/types";

/** Files read from one folder, and from a whole workspace. */
export const MAX_FILES_PER_REPO = 4000;
export const MAX_FILES_PER_WORKSPACE = 12_000;

export interface RepoInput {
  label: string;
  files: SourceFile[];
  kind?: RepoRef["kind"];
}

/** A label that is safe as the first segment of a path. */
function cleanLabel(label: string): string {
  return label.replace(/[\\/]+/g, "-").replace(/^\.+/, "").trim() || "repo";
}

/** "api", "api", "web" → "api", "api-2", "web". */
export function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.map((l) => {
    const base = cleanLabel(l);
    let out = base;
    for (let i = 2; seen.has(out.toLowerCase()); i++) out = `${base}-${i}`;
    seen.add(out.toLowerCase());
    return out;
  });
}

/** The sources the analyzer sees and the repos the map records. */
export function combineRepos(repos: RepoInput[]): { sources: SourceFile[]; repos: RepoRef[] } {
  if (repos.length === 1) {
    const r = repos[0];
    return { sources: r.files, repos: [{ label: cleanLabel(r.label), prefix: "", kind: r.kind ?? "local" }] };
  }
  const labels = uniqueLabels(repos.map((r) => r.label));
  const sources: SourceFile[] = [];
  const refs: RepoRef[] = [];
  repos.forEach((r, i) => {
    const prefix = `${labels[i]}/`;
    refs.push({ label: labels[i], prefix, kind: r.kind ?? "local" });
    for (const f of r.files) sources.push({ path: prefix + f.path, content: f.content });
  });
  return { sources, repos: refs };
}

/** The other way: a workspace's files back into one list per repo, so the Connect page can
 * show the repos that made a map and build it again. */
export function splitRepos(files: Record<string, string>, repos: Pick<RepoRef, "label" | "prefix">[]): { label: string; files: SourceFile[] }[] {
  if (repos.length <= 1) return [{ label: repos[0]?.label ?? "repo", files: Object.entries(files).map(([path, content]) => ({ path, content })) }];
  return repos.map((r) => {
    const prefix = r.prefix || `${r.label}/`;
    return {
      label: r.label,
      files: Object.entries(files)
        .filter(([p]) => p.startsWith(prefix))
        .map(([p, content]) => ({ path: p.slice(prefix.length), content })),
    };
  });
}

/** Why a folder of `adding` files can't join a workspace that already holds `current`, or null. */
export function tooMany(current: number, adding: number): string | null {
  const total = current + adding;
  if (total <= MAX_FILES_PER_WORKSPACE) return null;
  return `That would make ${total.toLocaleString("en-GB")} files, and a workspace holds at most ${MAX_FILES_PER_WORKSPACE.toLocaleString("en-GB")}. Remove a folder, or index the big one with the command line instead.`;
}

/** A name for a workspace nobody has named yet: the repo's own, or the labels joined. */
export function defaultName(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "workspace";
  return labels.slice(0, 3).join(" + ") + (labels.length > 3 ? ` + ${labels.length - 3} more` : "");
}

/** What attachFolder needs of a workspace (store.ts's Workspace has it all). */
export interface CodeLess {
  repos: { label: string }[];
  map: { files: { path: string; skipped?: string }[]; repos?: Pick<RepoRef, "label" | "prefix">[] };
  files: Record<string, string>;
}

export type Attached<W> = { ok: true; workspace: W & { codeElsewhere?: boolean }; label: string; missing: string[] } | { ok: false; why: string };

/** A map restored without its code (WalkMyCode Lite, from the viewer's Claude space) gets it
 * back from the folder it was made from, picked again: the folder's files go in under the
 * repo's prefix (none for one repo; for several, the repo named like the folder, else the
 * first still without code), secrets left out and config secrets hidden as when it was
 * mapped (`redact`). The map is kept as it is, so the room stays where it was. A folder
 * none of whose files are on the map is turned away. `missing`: repos still without code. */
export function attachFolder<W extends CodeLess>(w: W, folder: { name: string; files: SourceFile[] }, redact: (path: string, text: string) => string): Attached<W> {
  const refs = w.map.repos?.length === w.repos.length ? w.map.repos : w.repos.map((r) => ({ label: r.label, prefix: w.repos.length > 1 ? `${r.label}/` : "" }));
  const hasCode = (prefix: string) => Object.keys(w.files).some((p) => p.startsWith(prefix));
  const ref =
    refs.length === 1
      ? refs[0]
      : (refs.find((r) => r.label.toLowerCase() === folder.name.toLowerCase()) ?? refs.find((r) => !hasCode(r.prefix || `${r.label}/`)));
  if (!ref) return { ok: false, why: `Every folder of this map already has its code here.` };
  const prefix = refs.length === 1 ? "" : ref.prefix || `${ref.label}/`;
  const onMap = new Set(w.map.files.map((f) => f.path));
  const secret = new Set(w.map.files.filter((f) => f.skipped === "secret").map((f) => f.path));
  const mine = w.map.files.filter((f) => f.path.startsWith(prefix)).length;
  const hits = folder.files.filter((f) => onMap.has(prefix + f.path)).length;
  if (!hits || hits < Math.min(mine, Math.max(1, Math.ceil(mine * 0.3)))) {
    return { ok: false, why: `“${folder.name}” doesn’t look like ${ref.label}: ${hits ? "only a few" : "none"} of its files are on this map. Choose the folder this map was made from.` };
  }
  const files = { ...w.files };
  for (const f of folder.files) {
    const path = prefix + f.path;
    if (secret.has(path) || (!f.content && !onMap.has(path))) continue;
    files[path] = redact(path, f.content);
  }
  const missing = refs.filter((r) => !Object.keys(files).some((p) => p.startsWith(refs.length === 1 ? "" : r.prefix || `${r.label}/`))).map((r) => r.label);
  const { codeElsewhere: _gone, ...rest } = w as W & { codeElsewhere?: boolean };
  void _gone;
  const workspace = { ...rest, files, ...(missing.length ? { codeElsewhere: true } : {}) } as W & { codeElsewhere?: boolean };
  return { ok: true, workspace, label: ref.label, missing };
}
