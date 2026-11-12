"use client";
// What is open lives in the browser: a workspace of 1..n repos, its one map
// and the file contents, kept in memory and mirrored to IndexedDB so a
// reload doesn't lose it. Inside Claude (WalkMyCode Lite) the map, not the code,
// is also kept in the viewer's private space (src/lib/adapters/storage.ts). On
// WalkMyCode for Claude's page the local server holds it instead, and keeps the
// user's answers (src/lib/adapters/serverStorage.ts).
// `useRepo()` is the one-repo view most components still use.
import { useSyncExternalStore } from "react";
import type { Assertion, CodeMap, MapEdge, MapNode } from "@/analyzer/types";
import { upgradeMap } from "@/analyzer/migrate";
import type { Tour } from "./claude/tools";
import { TARGET } from "./adapters/target";
import { indexOf, inOf, outOf } from "./mapIndex";

export interface RepoSource {
  label: string;
  kind: "local" | "demo" | "github";
  /** Kept so "Refresh" can re-read a local folder after asking permission again. */
  handle?: FileSystemDirectoryHandle;
  fileCount: number;
  addedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  repos: RepoSource[];
  map: CodeMap;
  files: Record<string, string>;
  /** The map was made by an older WalkMyCode (or with files it did not read then); rebuild it. */
  needsReindex?: boolean;
  /** What the user told WalkMyCode about settings with no value ("Where does this point?",
   * docs/SERVICES.md §13). Kept when the workspace is mapped again. */
  assertions?: Assertion[];
  /** WalkMyCode Lite: the map came from the viewer's private space in Claude without its code
   * (too big to go along), which stays in the browser where the folders were added
   * (src/lib/adapters/storage.ts). The map says so and asks for the folder again. */
  codeElsewhere?: boolean;
  /** The example app's starter tour (the home page's "Try with an example app"), offered on its map. */
  starterTour?: Tour;
}

/** The one-repo view: what `Guide`, `Inspector`, `FileTree` and the tools read. */
export interface Repo {
  map: CodeMap;
  files: Record<string, string>;
  source: { kind: "local" | "demo"; label: string };
}

let workspace: Workspace | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ws-${Date.now().toString(36)}`;
}

export function setWorkspace(w: Workspace | null) {
  workspace = w;
  emit();
  void persist(w);
}
export function getWorkspace() {
  return workspace;
}
export function useWorkspace(): Workspace | null {
  return useSyncExternalStore(subscribe, () => workspace, () => null);
}

/** A workspace built from the Connect page's list of repos (one map for all of them). */
export function newWorkspace(name: string, repos: RepoSource[], map: CodeMap, files: Record<string, string>, assertions: Assertion[] = []): Workspace {
  return { id: newId(), name, repos, map, files, ...(assertions.length ? { assertions } : {}) };
}

/** The answers a map was built with (an indexed demo made with `--assume`): about settings, then about addresses. */
export function answersOf(map: CodeMap): Assertion[] {
  return [...(map.unresolvedBases ?? []), ...(map.publicHosts ?? [])].flatMap((b) => (b.answer ? [b.answer] : []));
}

/** Wrap a single repo as a workspace of one. */
export function workspaceFromRepo(r: Repo, needsReindex = false): Workspace {
  const map = upgradeMap(r.map, r.source.kind);
  const assertions = answersOf(map);
  return {
    id: newId(),
    name: r.source.label,
    repos: [{ label: r.source.label, kind: r.source.kind, fileCount: Object.keys(r.files).length, addedAt: new Date().toISOString() }],
    map,
    files: r.files,
    needsReindex: needsReindex || undefined,
    ...(assertions.length ? { assertions } : {}),
  };
}
function repoOf(w: Workspace | null): Repo | null {
  if (!w) return null;
  const kind = w.repos[0]?.kind === "demo" ? "demo" : "local";
  return { map: w.map, files: w.files, source: { kind, label: w.name } };
}

// ── one-repo wrappers ──
export function setRepo(r: Repo | null) {
  setWorkspace(r ? workspaceFromRepo(r) : null);
}
export function getRepo(): Repo | null {
  return repoOf(workspace);
}
// The one-repo view is a snapshot: the same object for the same workspace,
// so useSyncExternalStore sees no change and consumers' memos hold.
let repoView: Repo | null = null;
let repoViewOf: Workspace | null = null;
function repoSnapshot(): Repo | null {
  if (workspace !== repoViewOf) {
    repoViewOf = workspace;
    repoView = repoOf(workspace);
  }
  return repoView;
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useRepo(): Repo | null {
  return useSyncExternalStore(subscribe, repoSnapshot, () => null);
}

// ── IndexedDB mirror ──
const DB = "lantern";
const KEY = "workspace";
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const store = ev.oldVersion < 1 ? db.createObjectStore("kv") : req.transaction!.objectStore("kv");
      if (ev.oldVersion === 1) {
        // Version 1 kept a single repo under "repo": carry it over as a one-repo
        // workspace. Its map predates services, so it may need a rebuild.
        const old = store.get("repo");
        old.onsuccess = () => {
          const r = old.result as Repo | undefined;
          if (r?.map) store.put(workspaceFromRepo(r, (r.map as { version?: number }).version !== 2), KEY);
          store.delete("repo");
        };
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function persist(w: Workspace | null) {
  // WalkMyCode for Claude: the local server holds the workspace; only the user's answers go back to it.
  if (TARGET === "mcp") {
    void import("./adapters/serverStorage").then((s) => s.saveServerAnswers(w)).catch((e: unknown) => console.info("WalkMyCode: the answer is kept on this page only.", (e as Error)?.message));
    return;
  }
  try {
    const db = await openDb();
    const tx = db.transaction("kv", "readwrite");
    if (w) tx.objectStore("kv").put(w, KEY);
    else tx.objectStore("kv").delete(KEY);
    await new Promise((res) => (tx.oncomplete = res));
  } catch {
    /* private mode or blocked storage: the session still works in memory */
  }
  // Inside Claude, the viewer's private space keeps the map too; elsewhere this does nothing.
  void import("./adapters/storage").then((s) => s.saveRemote(w)).catch(() => {});
}
/** This browser's copy; inside Claude, when this browser has none, the map from the viewer's private space. */
async function stored(): Promise<Workspace | undefined> {
  if (TARGET === "mcp") return (await import("./adapters/serverStorage").then((s) => s.loadServerWorkspace()).catch(() => null)) ?? undefined;
  try {
    const db = await openDb();
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(KEY);
    const w = await new Promise<Workspace | undefined>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (w) return w;
  } catch {
    /* blocked storage: try the private space */
  }
  const remote = await import("./adapters/storage").then((s) => s.loadRemote()).catch(() => null);
  if (remote) void persist(remote);
  return remote ?? undefined;
}
/** The one restore in flight: the home page, the map and the page itself all ask at start,
 * and inside Claude each ask would otherwise read the whole map from the viewer's space again. */
let restoring: Promise<Workspace | null> | null = null;
export function restoreWorkspace(): Promise<Workspace | null> {
  if (workspace) return Promise.resolve(workspace);
  restoring ??= restoreOnce().finally(() => {
    restoring = null;
  });
  return restoring;
}
async function restoreOnce(): Promise<Workspace | null> {
  try {
    const w = await stored();
    if (w && !workspace) {
      if ((w.map as { version?: number }).version !== 2) {
        w.map = upgradeMap(w.map, w.repos[0]?.kind ?? "local");
        w.needsReindex = true;
      }
      workspace = w;
      emit();
    }
    return workspace;
  } catch {
    return null;
  }
}
export async function restoreRepo(): Promise<Repo | null> {
  return repoOf(await restoreWorkspace());
}

// ── Map helpers ──
// Lookups go through the map's index (src/lib/mapIndex.ts), built once per map.
export function nodeById(map: CodeMap, id: string): MapNode | undefined {
  return indexOf(map).node.get(id);
}
/** A node's edges in and out, in map order. The arrays are shared: don't change them. */
export function edgesOf(map: CodeMap, id: string): { in: MapEdge[]; out: MapEdge[] } {
  const ix = indexOf(map);
  return { in: inOf(ix, id), out: outOf(ix, id) };
}
/** The node that owns a line of a file: its route if the registration or the
 * route's named handler spans it (smallest span wins), else the file. */
export function nodeAt(map: CodeMap, file: string, line: number): MapNode | undefined {
  const fns = map.files.find((f) => f.path === file)?.fns;
  let best: { node: MapNode; span: number } | undefined;
  const consider = (n: MapNode, start: number, end: number) => {
    if (line < start || line > end) return;
    if (!best || end - start < best.span) best = { node: n, span: end - start };
  };
  for (const n of map.nodes) {
    if (n.file !== file || n.kind !== "route" || n.line === undefined || n.endLine === undefined) continue;
    consider(n, n.line, n.endLine);
    const fn = n.handler ? fns?.[n.handler] : undefined;
    if (fn) consider(n, fn[0], fn[1]);
  }
  return best?.node ?? map.nodes.find((n) => n.file === file && n.kind !== "route");
}

/** Nodes and edges within `hops` of a node, ignoring plain imports unless asked. */
export function neighbourhood(map: CodeMap, id: string, hops = 1, withImports = false): { nodes: Set<string>; edges: Set<string> } {
  const ix = indexOf(map);
  const nodes = new Set([id]);
  const edges = new Set<string>();
  const counts = (e: MapEdge) => withImports || e.kind !== "imports";
  // Breadth first, one hop at a time, over the adjacency lists.
  let frontier = [id];
  for (let h = 0; h < hops && frontier.length; h++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const e of outOf(ix, f)) {
        if (counts(e) && !nodes.has(e.to)) {
          nodes.add(e.to);
          next.push(e.to);
        }
      }
      for (const e of inOf(ix, f)) {
        if (counts(e) && !nodes.has(e.from)) {
          nodes.add(e.from);
          next.push(e.from);
        }
      }
    }
    frontier = next;
  }
  // Every edge between two of those nodes.
  if (hops > 0) for (const n of nodes) for (const e of outOf(ix, n)) if (counts(e) && nodes.has(e.to)) edges.add(e.id);
  return { nodes, edges };
}

/** The service a node belongs to (a ServiceDef id is its own service); undefined for outside companies. */
export function serviceOf(map: CodeMap, id: string): string | undefined {
  if (map.services.some((s) => s.id === id)) return id;
  return nodeById(map, id)?.service;
}

/** "Trace it": follow the flow from a node forwards (UI → API → logic → data) and backwards.
 * Crossing into another service starts the layers again (web's logic calls users' route), and a
 * queue sits between layers: anything can put messages on it and anything can pick them up. */
export function trace(map: CodeMap, id: string): { nodes: string[]; edges: string[]; services: string[] } {
  const order: Record<string, number> = { ui: 0, api: 1, logic: 2, data: 3, external: 3 };
  const ix = indexOf(map);
  const byId = ix.node;
  const layer = (n: string) => (byId.get(n)?.kind === "channel" ? 1.5 : (order[byId.get(n)?.layer ?? "logic"] ?? 2));
  const hop = (a: string, b: string) => {
    const x = byId.get(a)?.service;
    const y = byId.get(b)?.service;
    return !!x && !!y && x !== y;
  };
  const isChan = (n: string) => byId.get(n)?.kind === "channel";
  const nodes = new Set([id]);
  const edges = new Set<string>();
  const walk = (start: string, forward: boolean, depth: number) => {
    if (depth > 8) return;
    // The edges leaving (or, walking back, arriving at) `start`, in map order.
    for (const e of forward ? outOf(ix, start) : inOf(ix, start)) {
      const [a, b] = forward ? [e.from, e.to] : [e.to, e.from];
      if (e.kind === "imports" && layer(b) === layer(a)) continue; // stay cross-layer unless it's a real call
      const free = hop(a, b) || isChan(a) || isChan(b);
      if (!free && (forward ? layer(b) < layer(a) : layer(b) > layer(a))) continue;
      edges.add(e.id);
      if (!nodes.has(b)) {
        nodes.add(b);
        walk(b, forward, depth + 1);
      }
    }
  };
  walk(id, true, 0);
  walk(id, false, 0);
  const services = new Set<string>();
  for (const n of nodes) {
    const s = byId.get(n)?.service;
    if (s) services.add(s);
  }
  return { nodes: [...nodes], edges: [...edges], services: [...services] };
}

/** "Trace" on the system view: the services this one sends to and hears from, following
 * requests, messages and database links both ways (declared start-up order is not a flow). */
export function traceService(map: CodeMap, id: string): { nodes: string[]; edges: string[]; services: string[] } {
  const flow = map.system.links.filter((l) => l.kind !== "depends-on");
  const services = new Set([id]);
  const edges = new Set<string>();
  const walk = (start: string, forward: boolean) => {
    for (const l of flow) {
      const [a, b] = forward ? [l.from, l.to] : [l.to, l.from];
      if (a !== start) continue;
      for (const e of l.edgeIds) edges.add(e);
      if (!services.has(b)) {
        services.add(b);
        walk(b, forward);
      }
    }
  };
  walk(id, true);
  walk(id, false);
  const nodes = new Set<string>();
  for (const e of map.edges) {
    if (!edges.has(e.id)) continue;
    nodes.add(e.from);
    nodes.add(e.to);
  }
  return { nodes: [...nodes], edges: [...edges], services: [...services] };
}

/** A file's new text after a save: the workspace (and so the map's tools, the
 * AI and every open panel) sees it at once. The map itself is not rebuilt. */
export function updateFileContent(path: string, text: string) {
  if (!workspace || workspace.files[path] === text) return;
  setWorkspace({ ...workspace, files: { ...workspace.files, [path]: text } });
}
