// "If you change it": everything a change to one card (or to one function in its
// file) could reach, worked out from the map alone (docs/SHELL.md §4, Change impact).
//
// Backwards, what uses it: the cards whose code depends on it, one step at a
// time. Forwards, what it touches: the tables its code reads or writes and the
// outside services it talks to. And the test files that import it, or import a
// file that uses it. No AI: every item comes with the arrow (and so the
// file:line) that put it on the list. Pure, so tests/impact.test.ts checks it
// without a browser.
import type { CodeMap, EdgeKind, MapEdge, MapNode } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import type { Tour, TourStep } from "@/lib/claude/tools";
import { indexOf, inOf, outOf } from "./mapIndex";

/** How far back to look: what uses it, what uses those, or everything. */
export type Reach = 1 | 2 | "all";

/** "If you change it" as the room asks for it: one card, narrowed to a function in its file or
 * not, how far back to look, and whether the map shows it now (`on`: the map's light is its own). */
export interface ImpactAsk {
  id: string;
  fn?: string;
  reach: Reach;
  on: boolean;
}

/** Arrow kinds where `from` depends on `to`, so a change to `to` can break `from`:
 * code that imports it, calls it (a function, a route by HTTP, a gRPC method), or
 * picks up the messages on a queue; and, when a table or an outside service is the
 * thing changed, the code that reads, writes or talks to it. The map has no
 * separate "renders" or "uses" arrows: a page using a component is an import.
 * Left out: `defines` (a schema creating a table is the table, not a user of it),
 * and `proxies` and `depends-on`, which only join services on the system view and
 * carry no code. `publishes` is the one the other way round: the queue depends on
 * what its publisher sends, so it is walked from the publisher to the queue. */
const DEPENDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["imports", "calls", "calls-route", "calls-rpc", "consumes", "reads", "writes", "uses-service"]);
/** Arrows the code itself runs along, followed forwards to find the tables and services it reaches. */
const RUNS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["imports", "calls", "calls-route", "calls-rpc"]);

/** The functions of a card that matter: a set of names, or null for the whole card. */
type Fns = Set<string> | null;
type FnTable = Record<string, [number, number, string[]]>;

/** One card that uses the changed thing, `step` arrows away, and the arrow that reached it. */
export interface ImpactUser {
  id: string;
  step: number;
  /** The arrow from this card to the one it depends on (for a queue: from its publisher). */
  via: MapEdge;
  /** What it depends on through that arrow: the changed card at step 1. */
  on: string;
  /** Reached through a guess (a dashed arrow). */
  guess: boolean;
}

/** A table the changed code reads or writes, with the arrows (and so the lines) that say so. */
export interface ImpactTable {
  id: string;
  reads: MapEdge[];
  writes: MapEdge[];
}

/** An outside service (or one of the system's own whose code isn't here) the changed code talks to. */
export interface ImpactService {
  id: string;
  via: MapEdge;
}

/** A test file that imports the changed file (`direct`), or a file that uses it. */
export interface ImpactTest {
  path: string;
  /** The import line in the test file. */
  line: number;
  /** The file it imports. */
  imports: string;
  direct: boolean;
}

export interface Impact {
  origin: string;
  /** Narrowed to one function in the card's file (selected lines inside it). */
  fn?: string;
  /** Every card that depends on it, nearest first. */
  users: ImpactUser[];
  /** Each arrow walked backwards, with the step of the card it reached. */
  walked: Map<string, number>;
  tables: ImpactTable[];
  services: ImpactService[];
  /** The cards and arrows between the changed code and those tables and services. */
  path: { nodes: Set<string>; edges: Set<string> };
  tests: ImpactTest[];
  /** How many test files the map lists that WalkMyCode could read. */
  testFiles: number;
}

const fnsOfNode = (map: CodeMap, n: MapNode | undefined): FnTable | undefined =>
  // A route card is one handler already: its arrows name the method, not a function in the file.
  n?.file && n.kind !== "route" ? map.files.find((f) => f.path === n.file)?.fns : undefined;

/** Whether a call written in a function (`checkPassword`, `this.load`) is a call to `name`. */
const callsFn = (call: string, name: string) => call === name || call === `this.${name}` || call === `self.${name}`;

/** The seed functions and every function in the same file that calls one of them, at any depth:
 * changing a helper changes what its callers do. */
function withCallers(fns: FnTable | undefined, seeds: Iterable<string>): Set<string> {
  const out = new Set(seeds);
  if (!fns) return out;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, [, , calls]] of Object.entries(fns)) {
      if (out.has(name)) continue;
      if (calls.some((c) => [...out].some((s) => callsFn(c, s)))) {
        out.add(name);
        grew = true;
      }
    }
  }
  return out;
}

/** The seed functions and every function in the same file they call, at any depth: what runs. */
function withCallees(fns: FnTable | undefined, seeds: Iterable<string>): Set<string> {
  const out = new Set(seeds);
  if (!fns) return out;
  const todo = [...out];
  while (todo.length) {
    const f = todo.pop()!;
    for (const c of fns[f]?.[2] ?? []) {
      for (const name of Object.keys(fns)) {
        if (!out.has(name) && callsFn(c, name)) {
          out.add(name);
          todo.push(name);
        }
      }
    }
  }
  return out;
}

/** An arrow touches the functions that matter when nothing is narrowed, when the arrow
 * doesn't say which functions it joins, or when one of them is among those that matter. */
const touches = (onEdge: string[] | undefined, mine: Fns) => mine === null || !onEdge?.length || onEdge.some((f) => mine.has(f));

/** The union of two function sets (null, the whole card, wins); null when nothing grew. */
function grow(old: Fns, add: Fns): Fns | undefined {
  if (old === null) return undefined;
  if (add === null) return null;
  const merged = new Set(old);
  for (const f of add) merged.add(f);
  return merged.size === old.size ? undefined : merged;
}

/** The function whose lines hold `line` in a file (the innermost one), if the map lists it. */
export function fnAt(map: CodeMap, file: string, line: number): string | undefined {
  const fns = map.files.find((f) => f.path === file)?.fns;
  let best: { name: string; span: number } | undefined;
  for (const [name, [s, e]] of Object.entries(fns ?? {})) {
    if (line >= s && line <= e && (!best || e - s < best.span)) best = { name, span: e - s };
  }
  return best?.name;
}

/** What a change to a card (or to one function in its file) could reach. `files` is the
 * workspace's file contents, read for the test files' imports; without it no tests are found. */
export function impactOf(map: CodeMap, id: string, opts: { fn?: string; files?: Record<string, string> } = {}): Impact {
  const ix = indexOf(map);
  const origin = ix.node.get(id);
  const table = fnsOfNode(map, origin);
  const fn = opts.fn && table?.[opts.fn] ? opts.fn : undefined;

  // ── backwards: who depends on it ──
  // Breadth first. Each card carries the functions in it that are affected, so a card
  // that only calls signIn() is not reached when only currentUser() changes. A card met
  // again with more functions affected is walked again (its step stays the first one).
  const reached = new Map<string, { step: number; fns: Fns; via?: MapEdge; on?: string }>();
  reached.set(id, { step: 0, fns: fn ? withCallers(table, [fn]) : null });
  const walked = new Map<string, number>();
  let frontier = [id];
  for (let step = 1; frontier.length; step++) {
    const next = new Set<string>();
    for (const at of frontier) {
      const mine = reached.get(at)!.fns;
      // The arrows into it that mean "depends on", and a queue it publishes to.
      const pairs: { e: MapEdge; dep: string; fnsHere?: string[]; fnsThere?: string[] }[] = [];
      for (const e of inOf(ix, at)) if (DEPENDS.has(e.kind)) pairs.push({ e, dep: e.from, fnsHere: e.toFns, fnsThere: e.fromFns });
      for (const e of outOf(ix, at)) if (e.kind === "publishes") pairs.push({ e, dep: e.to, fnsHere: e.fromFns });
      for (const { e, dep, fnsHere, fnsThere } of pairs) {
        if (dep === id || !touches(fnsHere, mine)) continue;
        const depNode = ix.node.get(dep);
        const theirs: Fns = fnsThere?.length && fnsOfNode(map, depNode) ? withCallers(fnsOfNode(map, depNode), fnsThere) : null;
        const had = reached.get(dep);
        if (!walked.has(e.id)) walked.set(e.id, had ? Math.min(had.step, step) : step);
        if (!had) {
          reached.set(dep, { step, fns: theirs, via: e, on: at });
          next.add(dep);
        } else {
          const more = grow(had.fns, theirs);
          if (more !== undefined) {
            had.fns = more;
            next.add(dep);
          }
        }
      }
    }
    frontier = [...next];
  }
  const users: ImpactUser[] = [];
  for (const [uid, r] of reached) if (uid !== id && r.via) users.push({ id: uid, step: r.step, via: r.via, on: r.on!, guess: r.via.confidence === "likely" });
  users.sort((a, b) => a.step - b.step);

  // ── forwards: the tables and services its code reaches ──
  const tables = new Map<string, ImpactTable>();
  const services = new Map<string, ImpactService>();
  const ran = new Map<string, { fns: Fns; via: MapEdge | null }>();
  ran.set(id, { fns: fn ? withCallees(table, [fn]) : null, via: null });
  const todo = [id];
  const pathEnds = new Set<string>();
  while (todo.length) {
    const at = todo.shift()!;
    const mine = ran.get(at)!.fns;
    for (const e of outOf(ix, at)) {
      if (!touches(e.fromFns, mine)) continue;
      const to = ix.node.get(e.to);
      if ((e.kind === "reads" || e.kind === "writes") && to?.kind === "table") {
        const t = tables.get(e.to) ?? { id: e.to, reads: [], writes: [] };
        t[e.kind].push(e);
        tables.set(e.to, t);
        pathEnds.add(at);
      } else if (to?.kind === "service" && (e.kind === "uses-service" || RUNS.has(e.kind))) {
        if (!services.has(e.to)) services.set(e.to, { id: e.to, via: e });
        pathEnds.add(at);
      } else if (RUNS.has(e.kind) && e.to !== id) {
        const theirs: Fns = e.toFns?.length && fnsOfNode(map, to) ? withCallees(fnsOfNode(map, to), e.toFns) : null;
        const had = ran.get(e.to);
        if (!had) {
          ran.set(e.to, { fns: theirs, via: e });
          todo.push(e.to);
        } else {
          const more = grow(had.fns, theirs);
          if (more !== undefined) {
            had.fns = more;
            todo.push(e.to);
          }
        }
      }
    }
  }
  // The cards between the changed code and what it reaches, for the map's light.
  const path = { nodes: new Set<string>(), edges: new Set<string>() };
  const join = (e: MapEdge) => {
    path.edges.add(e.id);
    path.nodes.add(e.to);
  };
  for (const t of tables.values()) for (const e of [...t.reads, ...t.writes]) join(e);
  for (const s of services.values()) join(s.via);
  for (const end of pathEnds) {
    for (let at: string | undefined = end; at && !path.nodes.has(at); ) {
      path.nodes.add(at);
      const via: MapEdge | null | undefined = ran.get(at)?.via;
      if (via) path.edges.add(via.id);
      at = via?.from;
    }
  }

  // ── tests ──
  const targets = new Map<string, boolean>();
  for (const u of users) {
    const f = ix.node.get(u.id)?.file;
    if (f && !targets.has(f)) targets.set(f, false);
  }
  if (origin?.file) targets.set(origin.file, true);
  const known = opts.files ? testImports(map, opts.files) : [];
  const tests: ImpactTest[] = [];
  for (const t of known) {
    const hit = t.imports.find((i) => targets.get(i.file)) ?? t.imports.find((i) => targets.has(i.file));
    if (hit) tests.push({ path: t.path, line: hit.line, imports: hit.file, direct: targets.get(hit.file)! });
  }
  tests.sort((a, b) => Number(b.direct) - Number(a.direct) || a.path.localeCompare(b.path));

  return { origin: id, ...(fn ? { fn } : {}), users, walked, tables: [...tables.values()], services: [...services.values()], path, tests, testFiles: known.length };
}

/** The cards within reach: what uses it (1), what uses those too (2), or all of them. */
export function usersWithin(imp: Impact, reach: Reach): ImpactUser[] {
  return reach === "all" ? imp.users : imp.users.filter((u) => u.step <= reach);
}

/** What the map lights for an impact: the changed card, the cards within reach and the
 * arrows that reached them, and the tables and services its code touches. */
export function impactLit(map: CodeMap, imp: Impact, reach: Reach): Lit {
  const ix = indexOf(map);
  const nodes = new Set<string>([imp.origin, ...imp.path.nodes]);
  const edges = new Set<string>(imp.path.edges);
  const max = reach === "all" ? Infinity : reach;
  for (const u of imp.users) if (u.step <= max) nodes.add(u.id);
  for (const [e, step] of imp.walked) if (step <= max) edges.add(e);
  const services = new Set<string>();
  for (const n of nodes) {
    const s = ix.node.get(n)?.service;
    if (s) services.add(s);
  }
  return { nodes, edges, services, origin: imp.origin };
}

// ── words ──

const PLURAL: Record<string, [string, string]> = {
  route: ["API route", "API routes"],
  ui: ["component", "components"],
  module: ["module", "modules"],
  table: ["table", "tables"],
  service: ["service", "services"],
  channel: ["queue", "queues"],
  rpc: ["gRPC service", "gRPC services"],
};
const groupOf = (n: MapNode | undefined) => (!n ? "module" : n.kind === "route" || n.kind === "table" || n.kind === "service" || n.kind === "channel" || n.kind === "rpc" ? n.kind : n.layer === "ui" ? "ui" : "module");

/** "6 API routes", "2 components and 1 module"; "nothing" for none. */
export function countWords(map: CodeMap, ids: string[]): string {
  const ix = indexOf(map);
  const counts = new Map<string, number>();
  for (const id of ids) {
    const g = groupOf(ix.node.get(id));
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const parts = Object.keys(PLURAL)
    .filter((g) => counts.has(g))
    .map((g) => `${counts.get(g)} ${PLURAL[g][counts.get(g) === 1 ? 0 : 1]}`);
  if (!parts.length) return "nothing";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The changed thing, as the panel and the tour name it: "currentUser()" or the card's name. */
export function impactName(map: CodeMap, imp: Impact): string {
  return imp.fn ? `${imp.fn}()` : (indexOf(map).node.get(imp.origin)?.name ?? imp.origin);
}

const VERB: Partial<Record<EdgeKind, string>> = { imports: "uses code from", calls: "calls", "calls-route": "sends a request to", "calls-rpc": "calls", consumes: "picks up messages from", reads: "reads", writes: "writes to", "uses-service": "talks to", publishes: "gets its messages from" };

/** How a user depends on what it is on: "calls", "sends a request to". */
export const verbOf = (u: ImpactUser) => VERB[u.via.kind] ?? "uses";

const nameOf = (map: CodeMap, id: string) => indexOf(map).node.get(id)?.name ?? id;

/** Where a user uses what it depends on. The arrow's own line, unless it names the functions it
 * calls and the user's code is at hand: then the first line inside the user that calls one of
 * them (a route's arrow starts at its handler, `export async function GET()`, a few lines above). */
export function lineOfUse(map: CodeMap, u: ImpactUser, files?: Record<string, string>): { file: string; line: number } {
  const ev = u.via.evidence[0];
  const names = u.via.toFns?.filter((f) => /^[A-Za-z_$][\w$]*$/.test(f));
  const text = files?.[ev.file];
  if (!names?.length || !text) return { file: ev.file, line: ev.line };
  const n = indexOf(map).node.get(u.id);
  const last = n?.file === ev.file && n.endLine && n.endLine >= ev.line ? n.endLine : ev.line + 40;
  const call = new RegExp(`\\b(?:${names.join("|")})\\s*\\(`);
  const lines = text.split("\n");
  for (let i = ev.line; i <= Math.min(last, lines.length); i++) if (call.test(lines[i - 1])) return { file: ev.file, line: i };
  return { file: ev.file, line: ev.line };
}
const at = (e: MapEdge) => `${e.evidence[0].file}:${e.evidence[0].line}`;

/** Where the changed thing's own code is: its function's lines, the card's lines, or the
 * first line that points at it (a table, an outside service). */
function homeOf(map: CodeMap, imp: Impact): { file: string; start: number; end: number } | null {
  const n = indexOf(map).node.get(imp.origin);
  const f = imp.fn && n?.file ? map.files.find((x) => x.path === n.file)?.fns?.[imp.fn] : undefined;
  if (f && n?.file) return { file: n.file, start: f[0], end: f[1] };
  if (n?.file) return { file: n.file, start: n.line ?? 1, end: n.endLine ?? n.line ?? 1 };
  if (n?.columnsAt) return { file: n.columnsAt.file, start: n.columnsAt.line, end: n.columnsAt.line };
  const e = inOf(indexOf(map), imp.origin)[0];
  return e ? { file: e.evidence[0].file, start: e.evidence[0].line, end: e.evidence[0].line } : null;
}

/** "Tour the impact": a tour (the guide's own player) from the changed code, through each
 * card within reach, to the tables and services, every step on the line that links it.
 * Written from the map (and the files, for the exact call lines), so it needs no AI. */
export function impactTour(map: CodeMap, imp: Impact, reach: Reach, files?: Record<string, string>, most = 14): Tour | null {
  const home = homeOf(map, imp);
  if (!home) return null;
  const name = impactName(map, imp);
  const users = usersWithin(imp, reach);
  const direct = users.filter((u) => u.step === 1);
  const steps: TourStep[] = [];
  const tests = imp.tests.length
    ? ` ${imp.tests.length === 1 ? "One test file" : `${imp.tests.length} test files`} import${imp.tests.length === 1 ? "s" : ""} it, or code that uses it.`
    : " No test file imports it, so no test will warn you if a change breaks something.";
  steps.push({
    say: `This is ${name}. ${direct.length ? `${countWords(map, direct.map((u) => u.id))} use${direct.length === 1 ? "s" : ""} it directly` : "Nothing on the map uses it"}${users.length > direct.length ? `, and ${countWords(map, users.filter((u) => u.step > 1).map((u) => u.id))} further along` : ""}.${tests}`,
    file: home.file,
    start_line: home.start,
    end_line: home.end,
    node_ids: [imp.origin],
  });
  const room = Math.max(0, most - 1 - Math.min(imp.tables.length + imp.services.length, 4));
  for (const u of users.slice(0, room)) {
    const ev = lineOfUse(map, u, files);
    const who = nameOf(map, u.id);
    const say =
      u.step === 1
        ? `${who} ${verbOf(u)} it here, so a change to ${name} reaches it directly.`
        : `${who} ${verbOf(u)} ${nameOf(map, u.on)}, which uses it: ${u.step} steps away.`;
    steps.push({ say: u.guess ? `${say} This link is a guess.` : say, file: ev.file, start_line: ev.line, end_line: ev.line, node_ids: [u.id, u.on] });
  }
  for (const t of imp.tables.slice(0, 4)) {
    const e = t.writes[0] ?? t.reads[0];
    const how = t.reads.length && t.writes.length ? "reads and writes" : t.writes.length ? "writes to" : "reads";
    const where = e.from === imp.origin ? "here" : `here, through ${nameOf(map, e.from)}`;
    steps.push({ say: `Its code ${how} the ${nameOf(map, t.id)} table ${where}.`, file: e.evidence[0].file, start_line: e.evidence[0].line, end_line: e.evidence[0].line, node_ids: [t.id, e.from] });
  }
  for (const s of imp.services.slice(0, Math.max(0, 4 - Math.min(imp.tables.length, 4)))) {
    steps.push({ say: `It talks to ${nameOf(map, s.id)} here.`, file: s.via.evidence[0].file, start_line: s.via.evidence[0].line, end_line: s.via.evidence[0].line, node_ids: [s.id, s.via.from] });
  }
  const left = users.length - Math.min(users.length, room);
  if (left > 0) steps[steps.length - 1] = { ...steps[steps.length - 1], say: `${steps[steps.length - 1].say} And ${left} more, listed in Details.` };
  return { title: `What changing ${name} reaches`, steps };
}

/** What the guide is told for "Explain the risks": the lists, every item with its line. */
export function impactContext(map: CodeMap, imp: Impact, reach: Reach): string {
  const n = indexOf(map).node.get(imp.origin);
  const name = impactName(map, imp);
  const home = homeOf(map, imp);
  const lines = [`The user is about to change ${name}${n && imp.fn ? ` in ${n.name} [${n.id}]` : n ? ` [${n.id}]` : ""}${home ? `, at ${home.file}:${home.start}-${home.end}` : ""}. WalkMyCode worked out from the map what that change could reach:`];
  const users = usersWithin(imp, reach);
  lines.push(users.length ? `What uses it (${reach === "all" ? "everything found" : reach === 1 ? "directly" : "up to two steps away"}):` : "Nothing on the map uses it.");
  for (const u of users.slice(0, 60)) lines.push(`- step ${u.step}: ${nameOf(map, u.id)} [${u.id}] ${verbOf(u)} ${u.step === 1 ? name : nameOf(map, u.on)} (${at(u.via)}${u.guess ? ", GUESS" : ""})`);
  if (users.length > 60) lines.push(`- and ${users.length - 60} more`);
  for (const t of imp.tables) {
    for (const e of t.reads) lines.push(`- reads the ${nameOf(map, t.id)} table (${at(e)})`);
    for (const e of t.writes) lines.push(`- writes the ${nameOf(map, t.id)} table (${at(e)})`);
  }
  for (const s of imp.services) lines.push(`- talks to ${nameOf(map, s.id)} (${at(s.via)})`);
  if (imp.tests.length) for (const t of imp.tests.slice(0, 20)) lines.push(`- test ${t.path}:${t.line} imports ${t.imports}${t.direct ? "" : " (which uses it)"}`);
  else lines.push(imp.testFiles ? `- none of the ${imp.testFiles} test files imports it or the code that uses it` : "- the project has no test files WalkMyCode could read");
  return lines.join("\n");
}

// ── test files ──

interface TestFile {
  path: string;
  imports: { file: string; line: number }[];
}
const testCache = new WeakMap<Record<string, string>, { map: CodeMap; tests: TestFile[] }>();

/** Test files the map lists (the analyzer leaves them off the map as "test") are not tests when
 * they are stories, mocks or fixtures. */
const NOT_A_TEST = /\.stories\.|(^|\/)(__mocks__|fixtures?)\//;

/** Each test file the map lists with what it imports, resolved to the project's files.
 * Read once per map and file set. */
export function testImports(map: CodeMap, files: Record<string, string>): TestFile[] {
  const hit = testCache.get(files);
  if (hit?.map === map) return hit.tests;
  const known = new Set(map.files.map((f) => f.path));
  const tests: TestFile[] = [];
  for (const f of map.files) {
    if (f.skipped !== "test" || NOT_A_TEST.test(f.path)) continue;
    const text = files[f.path];
    if (typeof text !== "string" || !text) continue;
    const imports: TestFile["imports"] = [];
    for (const { spec, line } of importSpecs(f.path, text)) {
      const to = resolveSpec(f.path, spec, known);
      if (to && to !== f.path && !imports.some((i) => i.file === to)) imports.push({ file: to, line });
    }
    tests.push({ path: f.path, imports });
  }
  testCache.set(files, { map, tests });
  return tests;
}

const JS_IMPORT = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\b(?:jest|vi)\.mock\(\s*["']([^"']+)["']/g;
const PY_IMPORT = /^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import|import[ \t]+([.\w]+))/gm;

/** The modules a file imports, by the text it writes them with, and their lines. */
export function importSpecs(path: string, text: string): { spec: string; line: number }[] {
  const re = /\.py$/.test(path) ? PY_IMPORT : JS_IMPORT;
  const out: { spec: string; line: number }[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const spec = m.slice(1).find((x) => x);
    if (spec) out.push({ spec: /\.py$/.test(path) ? `py:${spec}` : spec, line: text.slice(0, m.index).split("\n").length + (m[0].startsWith("\n") ? 1 : 0) });
  }
  return out;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
function joinPath(dir: string, rel: string): string {
  const parts = dir ? dir.split("/") : [];
  for (const s of rel.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") parts.pop();
    else parts.push(s);
  }
  return parts.join("/");
}
const EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "vue", "svelte"];
function tryFile(base: string, known: Set<string>): string | null {
  if (known.has(base)) return base;
  const stripped = base.replace(/\.[cm]?js$/, "");
  for (const b of stripped === base ? [base] : [base, stripped]) {
    for (const e of EXTS) if (known.has(`${b}.${e}`)) return `${b}.${e}`;
    for (const e of EXTS) if (known.has(`${b}/index.${e}`)) return `${b}/index.${e}`;
  }
  return null;
}
/** Every folder from the file's own up to the project's root: an alias like `@/` is tried from each. */
function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let d = dirOf(path); ; d = dirOf(d)) {
    out.push(d);
    if (!d) return out;
  }
}

/** A written import to a file in the project: relative paths, the `@/` and `~/` aliases
 * (from `src/`, the folder itself or `app/`), and Python's dotted modules. Packages are not files here. */
export function resolveSpec(from: string, spec: string, known: Set<string>): string | null {
  if (spec.startsWith("py:")) {
    const m = /^(\.*)(.*)$/.exec(spec.slice(3))!;
    const rest = m[2].replace(/\./g, "/");
    let roots: string[];
    if (m[1].length) {
      let d = dirOf(from);
      for (let i = 1; i < m[1].length; i++) d = dirOf(d);
      roots = [d];
    } else roots = ancestors(from).flatMap((d) => [d, joinPath(d, "src")]);
    for (const r of roots) {
      const c = joinPath(r, rest);
      if (known.has(`${c}.py`)) return `${c}.py`;
      if (known.has(`${c}/__init__.py`)) return `${c}/__init__.py`;
    }
    return null;
  }
  if (spec.startsWith(".")) return tryFile(joinPath(dirOf(from), spec), known);
  if (spec.startsWith("@/") || spec.startsWith("~/")) {
    for (const d of ancestors(from)) {
      for (const root of ["src", "", "app"]) {
        const hit = tryFile(joinPath(joinPath(d, root), spec.slice(2)), known);
        if (hit) return hit;
      }
    }
    return null;
  }
  if (spec.startsWith("/")) return tryFile(spec.slice(1), known);
  return null;
}
