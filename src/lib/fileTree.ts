// The Files panel's model (docs/MOTION.md §4.10): the workspace's files as
// folders, flattened into the rows on show, so the panel can draw only the
// rows in view (a workspace holds up to 12,000 files) and work out where any
// row is without the DOM. Pure: no React, no browser.
import type { CodeMap } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import { nodeById } from "./store";

/** What a file is, for its icon and the search's chips. */
export type FileKind = "code" | "doc" | "config" | "image" | "other";

export interface TreeFile {
  name: string;
  path: string;
  skipped?: string;
  config?: boolean;
  kind: FileKind;
  /** In the project but not on the map (README.md, LICENSE, images…): listed, a shade quieter. */
  unmapped?: boolean;
}

export interface TreeDir {
  name: string;
  path: string;
  dirs: Map<string, TreeDir>;
  files: TreeFile[];
}

export interface TreeRow {
  kind: "dir" | "file";
  path: string;
  name: string;
  depth: number;
  /** A repo's top folder (a workspace of several repos). */
  repo?: boolean;
  skipped?: string;
  config?: boolean;
  /** A file's own kind (TreeRow.kind is "dir" or "file"). */
  fileKind?: FileKind;
  unmapped?: boolean;
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|sql|prisma|dart|php|twig|rs|go|java|kt|kts|scala|cs|fs|rb|swift|c|h|cc|cpp|hpp|m|mm|vue|svelte|astro|html|css|scss|sass|less|sh|bash|ps1|lua|ex|exs|erl|hs|clj|r|jl|zig|nim|graphql|gql|proto)$/i;
const DOC = /\.(md|mdx|markdown|txt|rst|adoc|pdf)$|(^|\/)(README|LICEN[CS]E|COPYING|CHANGELOG|CHANGES|CONTRIBUTING|NOTICE|AUTHORS|CODEOWNERS|SECURITY)([.-][^/]*)?$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i;
const CONFIG = /\.(json|jsonc|json5|ya?ml|toml|ini|cfg|conf|xml|lock|properties|env\.[a-z]+)$|(^|\/)(\.[^/]+|Dockerfile[^/]*|Makefile|Procfile|Justfile|Gemfile|go\.mod|go\.sum)$/i;

/** A file's kind by its name (and whether the map read it as config). */
export function fileKind(path: string, config = false): FileKind {
  if (IMAGE.test(path)) return "image";
  if (DOC.test(path)) return "doc";
  if (config) return "config";
  if (CODE.test(path)) return "code";
  return CONFIG.test(path) ? "config" : "other";
}

/** The folder structure of the map's files (each repo is a top folder when there are several). */
export function buildTree(map: Pick<CodeMap, "files">, paths: readonly string[] = []): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: new Map(), files: [] };
  const onMap = new Set(map.files.map((f) => f.path));
  // Every other file the folder holds (the workspace's files: README.md, images…), after the map's own.
  const others = paths.filter((p) => !onMap.has(p)).map((path) => ({ path, unmapped: true as const }));
  for (const f of [...map.files, ...others]) {
    const parts = f.path.split("/");
    let d = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let nd = d.dirs.get(parts[i]);
      if (!nd) {
        nd = { name: parts[i], path: parts.slice(0, i + 1).join("/"), dirs: new Map(), files: [] };
        d.dirs.set(parts[i], nd);
      }
      d = nd;
    }
    if ("unmapped" in f) {
      d.files.push({ name: parts[parts.length - 1], path: f.path, kind: fileKind(f.path), unmapped: true });
      continue;
    }
    const config = f.lang === "config" || f.lang === "proto" || !!f.configKind;
    d.files.push({ name: parts[parts.length - 1], path: f.path, skipped: f.skipped, config, kind: fileKind(f.path, config) });
  }
  // Sorted once here, so opening a folder in a 12,000-file workspace never sorts again.
  const sort = (d: TreeDir) => {
    d.files.sort((a, b) => a.name.localeCompare(b.name));
    d.dirs = new Map([...d.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)));
    d.dirs.forEach(sort);
  };
  sort(root);
  return root;
}

/**
 * The rows on show, top to bottom: in each folder its folders (repos first,
 * in the order they were added, then by name), then its files by name; a
 * folder's contents only when it is open.
 */
export function flatten(root: TreeDir, expanded: ReadonlySet<string>, repoOrder: readonly string[] = []): TreeRow[] {
  const rank = new Map(repoOrder.map((label, i) => [label, i]));
  const out: TreeRow[] = [];
  const walk = (d: TreeDir, depth: number) => {
    const dirs = [...d.dirs.values()];
    if (depth === 0 && rank.size) dirs.sort((a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity) || a.name.localeCompare(b.name));
    for (const sub of dirs) {
      out.push({ kind: "dir", path: sub.path, name: sub.name, depth, ...(depth === 0 && rank.has(sub.name) ? { repo: true } : {}) });
      if (expanded.has(sub.path)) walk(sub, depth + 1);
    }
    for (const f of d.files) {
      out.push({ kind: "file", path: f.path, name: f.name, depth, ...(f.skipped ? { skipped: f.skipped } : {}), ...(f.config ? { config: true } : {}), fileKind: f.kind, ...(f.unmapped ? { unmapped: true } : {}) });
    }
  };
  walk(root, 0);
  return out;
}

/** The folders a file sits in, outermost first: "a/b/c.ts" → ["a", "a/b"]. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** The rows to draw for a scroll position: those in view plus `overscan` either side. */
export function windowOf(scrollTop: number, viewHeight: number, rowHeight: number, count: number, overscan = 8): { start: number; end: number } {
  if (rowHeight <= 0 || count === 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  return { start, end };
}

/**
 * The rail from the file's top folder down to it, as an SVG path: down the
 * left of each level, then across to the next. Null when the file or one of
 * its folders is not on show.
 */
export function railPath(rows: readonly TreeRow[], path: string, rowHeight: number, indent: number, pad: number): string | null {
  const index = new Map(rows.map((r, i) => [r.path, i]));
  const chain = [...ancestorsOf(path), path].map((p) => index.get(p));
  if (chain.length < 2 || chain.some((i) => i === undefined)) return null;
  const x = (depth: number) => pad + depth * indent + indent / 2;
  const y = (i: number) => i * rowHeight + rowHeight / 2;
  const at = chain as number[];
  let d = `M ${x(0)} ${y(at[0]) + rowHeight / 3}`;
  for (let k = 1; k < at.length; k++) d += ` V ${y(at[k])} H ${x(k) - indent / 4}`;
  return d;
}

/** Whether row `i` sits fully inside the view (with a margin). */
export function rowInView(i: number, rowHeight: number, scrollTop: number, viewHeight: number, margin = 4): boolean {
  const top = i * rowHeight;
  return top >= scrollTop + margin && top + rowHeight <= scrollTop + viewHeight - margin;
}

/** Where to scroll so row `i` sits in the middle of the view. */
export function centreOn(i: number, rowHeight: number, viewHeight: number, total: number): number {
  const top = i * rowHeight - viewHeight / 2 + rowHeight / 2;
  return Math.max(0, Math.min(top, total * rowHeight - viewHeight));
}

/**
 * The files a trace passes through, numbered in the order it lights them
 * (1, 2, 3…). A trace that stays in one file numbers nothing.
 */
export function traceOrder(map: CodeMap, lit: Pick<Lit, "nodes"> | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!lit) return out;
  for (const id of lit.nodes) {
    const file = nodeById(map, id)?.file;
    if (file && !out.has(file)) out.set(file, out.size + 1);
  }
  return out.size > 1 ? out : new Map();
}

/** For each folder, the trace steps inside it (so a folded folder can show where the trace went). */
export function stepsInside(numbers: ReadonlyMap<string, number>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [file, n] of numbers) {
    for (const dir of ancestorsOf(file)) {
      const list = out.get(dir);
      if (list) list.push(n);
      else out.set(dir, [n]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}
