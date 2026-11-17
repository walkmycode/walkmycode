// "Tour a change" on the map (docs/GIT.md): a change read from git (./diffParse.ts) laid over the
// map. Each changed line belongs to a card (nodeAt: its route, else its file's card; a line in a
// schema also to the table it defines), so the cards that changed carry their +/− count. Cards that
// didn't change but use one that did (they import it, call it, read or write its table) are
// "affected". The steps are the changed files, ordered from data to screen along the map's lanes
// (tables, then logic, then the API, then the pages), each with a plain, factual line; the guide
// can be asked to tell it as a story and review it (storyAsk, mergeStory). No React: pure, so
// tests/diffTour.test.ts checks it without a browser.
import type { CodeMap, EdgeKind, Layer, MapEdge } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import type { Tour, TourStep } from "@/lib/claude/tools";
import { indexOf, inOf } from "./mapIndex";
import { nodeAt } from "./store";
import { countLabel, parseDiff, type DiffFile, type RangeChange } from "./diffParse";

/** One changed file, as a step of the tour. */
export interface ChangeStep {
  file: string;
  /** What the step is called: the cards (or functions) that changed, else the file's name. */
  title: string;
  added: number;
  removed: number;
  /** Changed cards in this file, most lines first. */
  cards: string[];
  /** Functions in the file whose lines changed (the map's own list of them). */
  fns: string[];
  /** The lines to show: from the first changed line to the last, in the file as it is now. */
  start: number;
  end: number;
  /** A new file. */
  added_file: boolean;
  /** The plain line the step says when no AI tells it. */
  say: string;
}

/** A card that didn't change but uses one that did, and the arrow (and so the line) that says so. */
export interface Affected {
  id: string;
  /** The changed card it uses. */
  uses: string;
  via: MapEdge;
}

export interface ChangePlan {
  steps: ChangeStep[];
  /** Changed card → its lines added and removed. */
  changed: Map<string, { added: number; removed: number }>;
  affected: Affected[];
  /** Files taken out by the change, and binary files: nothing to show for them. */
  gone: string[];
  binary: string[];
}

/** A change on screen: what it is, git's counts, the files read from its diff, the plan and its tour. */
export interface TouredChange {
  /** "feat/x → main", "Uncommitted changes". */
  label: string;
  base: string | null;
  totals: { files: number; added: number; removed: number };
  files: DiffFile[];
  plan: ChangePlan;
  tour: Tour;
  /** Only the first part of the change was read (a very big change). */
  cut: boolean;
}

/** Arrow kinds where `from` depends on `to`: a change to `to` can break `from` (as src/lib/impact.ts reads them). */
const DEPENDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["imports", "calls", "calls-route", "calls-rpc", "consumes", "reads", "writes", "uses-service"]);

/** Data first, up to the screen: the order the steps go in, by the lane of their cards. */
const LANE_ORDER: Record<Layer, number> = { data: 0, external: 1, logic: 2, api: 3, ui: 4 };
/** A file with no card: a schema or migration is data, anything else comes last. */
const laneOfPath = (p: string) => (/\.(sql|prisma)$|(^|\/)migrations?\//i.test(p) ? 0 : 5);

/** The most steps a tour has (the rest of a huge change is listed, not walked). */
export const STEPS_MAX = 40;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A diff's path as the map names it: as it is, or, in a workspace of several folders, under the folder's label. */
export function mapPath(map: CodeMap, files: Record<string, string>, path: string): string {
  if (files[path] !== undefined || map.files.some((f) => f.path === path)) return path;
  for (const r of map.repos ?? []) {
    const p = `${r.label}/${path}`;
    if (files[p] !== undefined || map.files.some((f) => f.path === p)) return p;
  }
  return path;
}

/** The changed lines of a file, by their number in the file now. A removal is counted at the line
 * that follows it (the last line, for a removal at the end). */
function changedLines(f: DiffFile): { line: number; add: boolean }[] {
  const out: { line: number; add: boolean }[] = [];
  for (const h of f.hunks) {
    let at = h.newStart;
    for (const l of h.lines) {
      if (l.kind === "add") out.push({ line: l.new!, add: true });
      else if (l.kind === "del") out.push({ line: Math.max(1, at), add: false });
      if (l.new !== undefined) at = l.new + 1;
    }
  }
  return out;
}

/** The cards a line of a file belongs to: its route or its file's card, and the table a schema defines there. */
function cardsAt(map: CodeMap, defs: MapEdge[], file: string, line: number): string[] {
  const out: string[] = [];
  const own = nodeAt(map, file, line);
  if (own) out.push(own.id);
  // The table whose definition starts last at or before this line (a Prisma model, a CREATE TABLE).
  let table: { id: string; at: number } | null = null;
  for (const e of defs) {
    const at = e.evidence.find((v) => v.file === file)?.line;
    if (at !== undefined && at <= line && (!table || at > table.at)) table = { id: e.to, at };
  }
  if (table) out.push(table.id);
  return out;
}

/** The functions in a file (the map's list) that hold any of these lines: the innermost for each. */
function fnsAt(map: CodeMap, file: string, lines: number[]): string[] {
  const fns = map.files.find((f) => f.path === file)?.fns;
  if (!fns) return [];
  const out = new Set<string>();
  for (const line of lines) {
    let best: { name: string; span: number } | null = null;
    for (const [name, [s, e]] of Object.entries(fns)) if (line >= s && line <= e && (!best || e - s < best.span)) best = { name, span: e - s };
    if (best) out.add(best.name);
  }
  return [...out];
}

const list = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`);

/** Lay a change over the map: the changed cards, the cards that use them, and the steps in lane order. */
export function planChange(map: CodeMap, diff: DiffFile[], files: Record<string, string> = {}): ChangePlan {
  const ix = indexOf(map);
  const name = (id: string) => ix.node.get(id)?.name ?? id;
  const changed = new Map<string, { added: number; removed: number }>();
  const defs = map.edges.filter((e) => e.kind === "defines");
  const gone: string[] = [];
  const binary: string[] = [];
  const steps: ChangeStep[] = [];
  const lanes = new Map<ChangeStep, number>();
  for (const raw of diff) {
    const file = mapPath(map, files, raw.path);
    if (raw.status === "deleted") {
      gone.push(file);
      continue;
    }
    if (raw.status === "binary") {
      binary.push(file);
      continue;
    }
    const lines = changedLines(raw);
    if (!lines.length) continue;
    const fileDefs = defs.filter((e) => e.evidence.some((v) => v.file === file));
    const mine = new Map<string, number>();
    for (const { line, add } of lines) {
      for (const id of cardsAt(map, fileDefs, file, line)) {
        const c = changed.get(id) ?? { added: 0, removed: 0 };
        if (add) c.added++;
        else c.removed++;
        changed.set(id, c);
        mine.set(id, (mine.get(id) ?? 0) + 1);
      }
    }
    const cards = [...mine.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const nums = lines.map((l) => l.line);
    let start = Math.min(...nums);
    let end = Math.max(...nums);
    // A long spread of changes: the first hunk's, so the step shows something that fits on screen.
    if (end - start > 60) {
      const first = changedLines({ ...raw, hunks: raw.hunks.slice(0, 1) }).map((l) => l.line);
      start = Math.min(...first);
      end = Math.max(...first);
    }
    const fns = fnsAt(map, file, nums);
    const lane = cards.length ? Math.min(...cards.map((id) => LANE_ORDER[ix.node.get(id)?.layer ?? "logic"] ?? 2)) : laneOfPath(file);
    const base = file.split("/").pop() ?? file;
    const tables = cards.filter((id) => ix.node.get(id)?.kind === "table").map(name);
    const routes = cards.filter((id) => ix.node.get(id)?.kind === "route").map(name);
    const title = tables.length ? `${list(tables, 2)} ${tables.length === 1 ? "table" : "tables"}` : routes.length ? list(routes, 2) : fns.length ? `${list(fns, 2)} in ${base}` : base;
    const step: ChangeStep = { file, title, added: raw.added, removed: raw.removed, cards, fns, start, end, added_file: raw.status === "added", say: "" };
    steps.push(step);
    lanes.set(step, lane);
  }

  // Not changed, but uses what changed: one arrow back from each changed card.
  const affected: Affected[] = [];
  const seen = new Set<string>();
  for (const id of changed.keys()) {
    for (const e of inOf(ix, id)) {
      if (!DEPENDS.has(e.kind) || changed.has(e.from) || seen.has(e.from)) continue;
      seen.add(e.from);
      affected.push({ id: e.from, uses: id, via: e });
    }
  }

  steps.sort((a, b) => lanes.get(a)! - lanes.get(b)! || a.file.localeCompare(b.file));
  const shown = steps.slice(0, STEPS_MAX);
  for (const s of shown) s.say = factual(s, affected, name);
  return { steps: shown, changed, affected, gone, binary };
}

/** What a step says with no AI: the file, how many lines, where, and what on the map. Facts only. */
function factual(s: ChangeStep, affected: Affected[], name: (id: string) => string): string {
  const counts = s.added_file ? `a new file, ${plural(s.added, "line")}` : [s.added ? `${plural(s.added, "line")} added` : "", s.removed ? `${plural(s.removed, "line")} taken out` : ""].filter(Boolean).join(" and ");
  const where = s.fns.length ? `, in ${list(s.fns)}` : "";
  const lines = s.start === s.end ? `line ${s.start}` : `lines ${s.start} to ${s.end}`;
  const cards = s.cards.length ? ` On the map: ${list(s.cards.map(name))}.` : " It isn't a card on the map.";
  const users = [...new Set(affected.filter((a) => s.cards.includes(a.uses)).map((a) => name(a.id)))];
  const uses = users.length ? ` Not changed, but uses it: ${list(users)}.` : "";
  return `${s.file}: ${counts}${where} (${lines}).${cards}${uses}`;
}

/** The change as a tour the existing player plays: one step per changed file, data first. */
export function changeTour(label: string, plan: ChangePlan): Tour {
  return {
    title: label,
    change: label,
    steps: plan.steps.map((s) => ({ say: s.say, file: s.file, start_line: s.start, end_line: s.end, node_ids: s.cards })),
  };
}

/** Everything the map needs for a change read from git. */
export function tourChange(map: CodeMap, files: Record<string, string>, raw: RangeChange): TouredChange {
  const diff = parseDiff(raw.diff).map((f) => ({ ...f, path: mapPath(map, files, f.path) }));
  const plan = planChange(map, diff, files);
  const label = raw.base === null ? "Uncommitted changes" : `${raw.head ?? "This folder"} → ${raw.base === "HEAD~1" ? "the commit before" : raw.base}`;
  const totals = raw.files.reduce((t, f) => ({ files: t.files + 1, added: t.added + f.added, removed: t.removed + f.removed }), { files: 0, added: 0, removed: 0 });
  return { label, base: raw.base, totals, files: diff, plan, tour: changeTour(label, plan), cut: raw.cut };
}

/** What the map lights for a change: the changed cards with their count, the cards that use them
 * ("affected"), the arrows between them, and the step's own cards ("now"). Everything else fades. */
export function changeLit(map: CodeMap, plan: ChangePlan, now: string[] = []): Lit {
  const ix = indexOf(map);
  const changed = new Map<string, string>();
  for (const [id, c] of plan.changed) changed.set(id, countLabel(c.added, c.removed));
  const affected = new Set(plan.affected.map((a) => a.id));
  const nodes = new Set<string>([...changed.keys(), ...affected, ...now.filter((id) => ix.node.has(id))]);
  const edges = new Set<string>(plan.affected.map((a) => a.via.id));
  for (const e of map.edges) if (changed.has(e.from) && changed.has(e.to)) edges.add(e.id);
  const services = new Set<string>();
  for (const id of nodes) {
    const s = ix.node.get(id)?.service;
    if (s) services.add(s);
  }
  return { nodes, edges, services, change: { changed, affected, now: new Set(now) } };
}

// ── the code: added and removed lines in the editor ──

/** A file's change as the editor marks it: lines added (by their number now), and removed lines shown
 * where they were, before line `at` (one past the last line: at the end). */
export interface DiffMarks {
  added: number[];
  removed: { at: number; lines: string[] }[];
}

export function editorMarks(f: DiffFile): DiffMarks {
  const added: number[] = [];
  const removed: DiffMarks["removed"] = [];
  for (const h of f.hunks) {
    let at = h.newStart;
    let block: { at: number; lines: string[] } | null = null;
    for (const l of h.lines) {
      if (l.kind === "del") {
        if (!block) removed.push((block = { at, lines: [] }));
        block.lines.push(l.text);
        continue;
      }
      block = null;
      if (l.kind === "add") added.push(l.new!);
      at = l.new! + 1;
    }
  }
  // A hunk of removals only in an emptied file ("@@ -1,3 +0,0 @@"): before the first line.
  for (const r of removed) r.at = Math.max(1, r.at);
  return { added, removed };
}

/** Whether the file as WalkMyCode has it is the file the diff was made against: every added and unchanged
 * line is where the diff says. When not (it changed since it was mapped), the marks would be wrong. */
export function marksFit(f: DiffFile, text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const h of f.hunks) for (const l of h.lines) if (l.new !== undefined && (lines[l.new - 1] ?? "").replace(/\r$/, "") !== l.text.replace(/\r$/, "")) return false;
  return true;
}

// ── the guide: the story and the review ──

/** The most diff the guide is given to read. */
const STORY_DIFF_MAX = 40_000;

/** What the guide is asked: tell the change as a story, one step per file in this order, and review it,
 * grounded in the diff and the code, with path:line citations. */
export function storyAsk(c: TouredChange, map: CodeMap): string {
  const ix = indexOf(map);
  const name = (id: string) => ix.node.get(id)?.name ?? id;
  const steps = c.plan.steps.map((s, i) => `${i + 1}. ${s.file} lines ${s.start}-${s.end} (${countLabel(s.added, s.removed)})${s.cards.length ? `, cards: ${s.cards.map((id) => `${name(id)} [${id}]`).join(", ")}` : ""}`);
  const affected = c.plan.affected.map((a) => `- ${name(a.id)} [${a.id}] ${a.via.kind} ${name(a.uses)} (${a.via.evidence[0]?.file}:${a.via.evidence[0]?.line})`);
  let diff = "";
  for (const f of c.files) {
    const part = `--- ${f.path}${f.status === "added" ? " (new file)" : ""}\n${f.hunks.map((h) => `@@ ${h.newStart} @@\n${h.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.new ?? ""}| ${l.text}`).join("\n")}`).join("\n")}\n`;
    if (diff.length + part.length > STORY_DIFF_MAX) {
      diff += `(…the rest of the change is left out: read the files for it)\n`;
      break;
    }
    diff += part;
  }
  return [
    `The user is touring a change: ${c.label}. ${plural(c.totals.files, "file")}, ${c.totals.added} lines added and ${c.totals.removed} taken out.${c.cut ? " Only the first part of it was read." : ""}`,
    `The steps, from the data up to the screen:\n${steps.join("\n")}`,
    affected.length ? `Not changed, but they use what changed:\n${affected.join("\n")}` : "Nothing else on the map uses what changed.",
    `The change (each line: + added, - taken out, then its line number in the file now):\n${diff}`,
    `First, as your reply: review the change for the user in a few short bullet points. Say what it does as a whole, then anything a careful reviewer would raise (a bug, a missed case, an order that looks wrong, something affected that may need changing too). Ground every point in the lines above or in code you read, and cite each as path:line. If nothing looks wrong, say so.`,
    `Then call finish_tour with exactly ${c.plan.steps.length} steps, in the order above, each with the same file, start_line, end_line and node_ids as that step: say, in one to three plain sentences, what changed there and why it matters for the step after it.`,
  ].join("\n\n");
}

/** The guide's story laid onto the change's own tour: each step keeps its file, lines and cards, and takes
 * the guide's words for the step about the same file (in order). A step the guide skipped keeps its facts. */
export function mergeStory(own: Tour, story: Tour): Tour {
  const pool = [...story.steps];
  const steps: TourStep[] = own.steps.map((s) => {
    const i = pool.findIndex((t) => t.file === s.file);
    if (i < 0) return s;
    const [t] = pool.splice(i, 1);
    return t.say.trim() ? { ...s, say: t.say.trim() } : s;
  });
  return { ...own, steps, told: true };
}
