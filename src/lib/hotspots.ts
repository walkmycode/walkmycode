// Hotspots (docs/GIT.md, "Hotspots"): code that changes often and is large is where things break most.
// git says how often each file changed over a span of time (src/lib/localrun/git.ts, churn); this
// module reads what git printed, puts each file on its map cards, scores each card as changes ×
// lines, and sorts the cards into five heat levels by rank, so one huge file doesn't make every other
// card look cold. Also the words the Details panel says about a hot card, and the tour of the
// hottest files. No React and no git here, so tests can check all of it.
import type { CodeMap, MapNode } from "@/analyzer/types";
import type { Tour } from "./claude/tools";

/** The spans the window picker offers; git is only ever asked for one of these. */
export const SPANS = ["30", "90", "365", "all"] as const;
export type Span = (typeof SPANS)[number];
export const DEFAULT_SPAN: Span = "90";
const SPAN_DAYS: Record<Span, number | null> = { "30": 30, "90": 90, "365": 365, all: null };
/** "Over the last 90 days", "Hotspots · last 90 days". */
export const SPAN_WORDS: Record<Span, string> = { "30": "the last 30 days", "90": "the last 90 days", "365": "the last year", all: "all of the history" };
export const SPAN_SHORT: Record<Span, string> = { "30": "last 30 days", "90": "last 90 days", "365": "last year", all: "all time" };

export const isSpan = (v: unknown): v is Span => typeof v === "string" && (SPANS as readonly string[]).includes(v);

/** The date git's --since gets for a span (ISO 8601), or null for all of the history. */
export function sinceOf(span: Span, now: number): string | null {
  const days = SPAN_DAYS[span];
  return days === null ? null : new Date(now - days * 86_400_000).toISOString();
}

/** The most commits read for one span: older ones are left out (and `capped` says so). */
export const CHURN_MAX_COMMITS = 3000;
/** Each commit starts with a record separator, then its hash and its author's email and name. */
export const CHURN_FORMAT = "--format=%x1e%H%x1f%ae%x1f%an";

export interface FileChurn {
  /** Commits in the span that changed the file. */
  changes: number;
  /** Different people (by email) who made those commits. */
  authors: number;
}

/** How often each file changed over a span, as git says. */
export interface Churn {
  span: Span;
  /** Commits in the span that changed anything in the folder (at most CHURN_MAX_COMMITS). */
  commits: number;
  /** There were more: only the newest CHURN_MAX_COMMITS were read. */
  capped: boolean;
  /** Path from the folder, forward slashes → how often it changed. A renamed file is counted under its
   * newest name, its older names' changes included. */
  files: Record<string, FileChurn>;
}

/** `git log --name-status -M` with CHURN_FORMAT into changes and authors per file. Newest first, as git
 * prints it, so a rename is met after the newer name's changes: from then on the old name counts as the
 * new one. Asked for one commit more than the limit, so `capped` knows there were more. */
export function parseChurn(out: string, span: Span, max = CHURN_MAX_COMMITS): Churn {
  const records = out.split("\x1e").slice(1);
  const capped = records.length > max;
  const counted = capped ? records.slice(0, max) : records;
  const alias = new Map<string, string>();
  const changes = new Map<string, number>();
  const people = new Map<string, Set<string>>();
  for (const r of counted) {
    const [head, ...rest] = r.split("\n");
    const [, email = "", name = ""] = head.split("\x1f");
    const who = (email.trim() || name.trim()).toLowerCase();
    const seen = new Set<string>();
    for (const line of rest) {
      const parts = line.replace(/\r$/, "").split("\t");
      if (parts.length < 2 || !/^[A-Z]/.test(parts[0])) continue;
      const status = parts[0][0];
      let path: string;
      if ((status === "R" || status === "C") && parts.length >= 3) {
        const now = alias.get(unquote(parts[2])) ?? unquote(parts[2]);
        // A copy leaves the old file where it was; a rename makes its past this file's past.
        if (status === "R") alias.set(unquote(parts[1]), now);
        path = now;
      } else path = alias.get(unquote(parts[1])) ?? unquote(parts[1]);
      if (seen.has(path)) continue;
      seen.add(path);
      changes.set(path, (changes.get(path) ?? 0) + 1);
      if (who) {
        let s = people.get(path);
        if (!s) people.set(path, (s = new Set()));
        s.add(who);
      }
    }
  }
  const files: Record<string, FileChurn> = {};
  for (const [path, n] of changes) files[path] = { changes: n, authors: people.get(path)?.size ?? 0 };
  return { span, commits: counted.length, capped, files };
}

/** git quotes a path with unusual characters ("caf\303\251.ts"); those are rare and left as git wrote them,
 * only the quotes come off. */
const unquote = (p: string) => (p.length > 1 && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** One card's heat. */
export interface CardHeat {
  /** Changes in the span, summed over the card's files. */
  changes: number;
  /** People who made them: exact for a card of one file, the most of any one file for several. */
  authors: number;
  /** Lines of the card's own code: its lines in the file when the map knows them, else its files' lines. */
  lines: number;
  score: number;
  level: HeatLevel;
  files: string[];
}

/** One of the hottest files, for the Details panel's list. */
export interface HotFile {
  path: string;
  changes: number;
  authors: number;
  lines: number;
  score: number;
  /** Its score against the hottest file's, 0..1 (the bar). */
  share: number;
  /** The card a click selects: the hottest card the file is on. */
  card: string;
}

export interface Heat {
  span: Span;
  commits: number;
  capped: boolean;
  cards: Map<string, CardHeat>;
  /** The hottest files on the map, at most five. */
  top: HotFile[];
}

/** The files behind a card: its own file; for a table with none, the files that create it (a schema, a
 * migration) or list its columns; else (an outside service, a queue, a table only read) the files whose
 * lines link to it on the map. */
function cardFiles(n: MapNode, defined: Map<string, Set<string>>, linked: Map<string, Set<string>>): string[] {
  if (n.file) return [n.file];
  const own = defined.get(n.id) ?? (n.columnsAt ? new Set([n.columnsAt.file]) : undefined);
  return [...(own ?? linked.get(n.id) ?? [])].sort();
}

/** A map path for each path git gave from the folder: as it is, or under one of the workspace's repos'
 * labels (several folders: the map's paths start with the folder's label). The folder git read may also
 * be the one above the folder mapped (Source Control was given the repo, the map was made of its src/):
 * then most paths start with that folder's name, which comes off. */
function pathResolver(map: CodeMap, texts: Record<string, string>, paths: string[]): (p: string) => string | null {
  const known = new Set([...map.files.map((f) => f.path), ...Object.keys(texts)]);
  const prefixes = (map.repos ?? []).map((r) => r.prefix).filter(Boolean);
  const direct = (p: string) => {
    if (known.has(p)) return p;
    for (const pre of prefixes) if (known.has(pre + p)) return pre + p;
    return null;
  };
  let hits = 0;
  const under = new Map<string, number>();
  for (const p of paths) {
    if (direct(p)) hits++;
    const i = p.indexOf("/");
    if (i > 0 && direct(p.slice(i + 1))) under.set(p.slice(0, i + 1), (under.get(p.slice(0, i + 1)) ?? 0) + 1);
  }
  const [top, n] = [...under.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (n <= hits) return direct;
  return (p) => (p.startsWith(top) ? direct(p.slice(top.length)) : null);
}

/** A file's length in lines: as the map counted it, else from its text. */
function lineCounter(map: CodeMap, texts: Record<string, string>): (p: string) => number {
  const counted = new Map(map.files.map((f) => [f.path, f.lines]));
  return (p) => counted.get(p) ?? (texts[p] !== undefined ? texts[p].split("\n").length : 0);
}

/** The level of each score among the changed cards, by rank: the top tenth are hottest, then the next
 * fifteenth part, the next quarter, and the bottom half. Equal scores share a level. */
export function levelsOf(scores: number[]): HeatLevel[] {
  const sorted = scores.filter((s) => s > 0).sort((a, b) => a - b);
  const n = sorted.length;
  return scores.map((s) => {
    if (s <= 0 || !n) return 0;
    // The share of changed cards scoring this or less (the highest place of its ties).
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= s) lo = mid + 1;
      else hi = mid;
    }
    const q = lo / n;
    return q > 0.9 ? 4 : q > 0.75 ? 3 : q > 0.5 ? 2 : 1;
  });
}

/** Every card's heat over the span, and the hottest files. `texts`: the repo's files the app holds. */
export function heatOf(map: CodeMap, churn: Churn, texts: Record<string, string> = {}): Heat {
  const resolve = pathResolver(map, texts, Object.keys(churn.files));
  const linesOf = lineCounter(map, texts);
  const byFile = new Map<string, FileChurn>();
  for (const [p, c] of Object.entries(churn.files)) {
    const at = resolve(p);
    if (!at) continue;
    const was = byFile.get(at);
    byFile.set(at, was ? { changes: was.changes + c.changes, authors: Math.max(was.authors, c.authors) } : c);
  }
  // Cards with no file of their own: the files that create them, or whose code links to them (never
  // config lines or the user's answers).
  const defined = new Map<string, Set<string>>();
  const linked = new Map<string, Set<string>>();
  const fileless = new Set(map.nodes.filter((n) => !n.file).map((n) => n.id));
  const add = (m: Map<string, Set<string>>, id: string, file: string) => {
    let s = m.get(id);
    if (!s) m.set(id, (s = new Set()));
    s.add(file);
  };
  for (const e of map.edges) {
    for (const end of [e.to, e.from]) {
      if (!fileless.has(end)) continue;
      for (const v of e.evidence) {
        if (v.role === "config" || v.role === "user") continue;
        add(e.kind === "defines" && end === e.to ? defined : linked, end, v.file);
      }
    }
  }
  const rows: { id: string; heat: Omit<CardHeat, "level"> }[] = [];
  for (const n of map.nodes) {
    const files = cardFiles(n, defined, linked);
    let changes = 0;
    let authors = 0;
    let lines = 0;
    let score = 0;
    for (const f of files) {
      const c = byFile.get(f);
      const l = linesOf(f);
      lines += l;
      if (!c) continue;
      changes += c.changes;
      authors = Math.max(authors, c.authors);
      // Summed file by file: a card over several files is as hot as they are together, no hotter.
      score += c.changes * Math.max(1, l);
    }
    // A card that is part of its file (a route's handler) is as large as its own lines.
    const own = n.file && n.line && n.endLine && n.endLine >= n.line ? n.endLine - n.line + 1 : 0;
    if (own) {
      lines = own;
      score = changes * own;
    }
    rows.push({ id: n.id, heat: { changes, authors, lines, score, files } });
  }
  const levels = levelsOf(rows.map((r) => r.heat.score));
  const cards = new Map<string, CardHeat>();
  rows.forEach((r, i) => cards.set(r.id, { ...r.heat, level: levels[i] }));

  // The hottest files that are on a card: changes × the file's lines.
  const cardOf = new Map<string, { id: string; score: number }>();
  for (const n of map.nodes) {
    if (!n.file) continue;
    const h = cards.get(n.id)!;
    const was = cardOf.get(n.file);
    if (!was || h.score > was.score) cardOf.set(n.file, { id: n.id, score: h.score });
  }
  const hot = [...byFile.entries()]
    .filter(([p, c]) => c.changes > 0 && cardOf.has(p))
    .map(([path, c]) => {
      const lines = linesOf(path);
      return { path, changes: c.changes, authors: c.authors, lines, score: c.changes * Math.max(1, lines), share: 0, card: cardOf.get(path)!.id };
    })
    .sort((a, b) => b.score - a.score || b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, 5);
  for (const h of hot) h.share = hot[0].score ? h.score / hot[0].score : 0;
  return { span: churn.span, commits: churn.commits, capped: churn.capped, cards, top: hot };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 changes" on a card. */
export const changesLabel = (n: number) => plural(n, "change");

/** Whether any test file in the repo imports this one, when that can be told from the text (JavaScript
 * and TypeScript only): a test file whose import names it. null when it can't be told. */
export function testsImporting(map: CodeMap, texts: Record<string, string>, path: string): number | null {
  if (!/\.[cm]?[jt]sx?$/.test(path)) return null;
  const tests = map.files.filter((f) => f.skipped === "test" && /\.[cm]?[jt]sx?$/.test(f.path) && texts[f.path] !== undefined);
  if (!tests.length) return null;
  const stem = path.split("/").pop()!.replace(/\.[cm]?[jt]sx?$/, "");
  if (stem === "index") return null;
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)["'][^"'\\n]*\\b${esc}(?:\\.[cm]?[jt]sx?)?["']`);
  return tests.filter((t) => named.test(texts[t.path])).length;
}

/** The short, factual note on a selected hot card: how often, out of how many, by how many people. */
export function hotNote(h: CardHeat, heat: Heat, tests: number | null): string {
  const out = heat.span === "all" && !heat.capped ? `${heat.commits}` : `the last ${heat.commits}`;
  const lines = `It is ${plural(h.lines, "line")} long.`;
  const said =
    h.files.length > 1
      ? `Its ${h.files.length} files changed ${plural(h.changes, "time")} in ${out} commits.`
      : `Changed in ${h.changes} of ${out} commits, by ${plural(h.authors, "person", "people")}.`;
  const t = tests === null ? "" : tests === 0 ? " No test file imports it." : ` ${plural(tests, "test file")} import${tests === 1 ? "s" : ""} it.`;
  return `${said} ${lines}${t}`;
}

/** "Tour the hotspots": the hottest files, hottest first, each step on its card. No AI needed. */
export function hotTour(map: CodeMap, heat: Heat): Tour | null {
  if (!heat.top.length) return null;
  const steps = heat.top.map((f, i) => {
    const n = map.nodes.find((x) => x.id === f.card);
    const start = n?.line ?? 1;
    const end = n?.endLine && n.endLine >= start ? n.endLine : Math.max(start, f.lines);
    const where = i === 0 ? "The hottest file" : `Number ${i + 1}`;
    return {
      say: `${where}: ${f.path}. It changed ${plural(f.changes, "time")} in ${SPAN_WORDS[heat.span]}, by ${plural(f.authors, "person", "people")}, and it is ${plural(f.lines, "line")} long. Code that changes often and is large is where bugs tend to appear, so read it, review it and test it first.`,
      file: f.path,
      start_line: start,
      end_line: end,
      node_ids: n ? [n.id] : [],
    };
  });
  return { title: `Hotspots · ${SPAN_SHORT[heat.span]}`, steps };
}

/** What the guide is told for "Why is it hot?": the commits in the span that changed the file. */
export function whyHotContext(path: string, span: Span, commits: { hash: string; subject: string; author: string; date: string }[], now: number): string {
  const since = sinceOf(span, now);
  const from = since ? Date.parse(since) : null;
  const within = commits.filter((c) => from === null || !(Date.parse(c.date) < from));
  const shown = within.slice(0, 40);
  const lines = [`The commits that changed ${path} in ${SPAN_WORDS[span]}, newest first (${within.length} in all${within.length > shown.length ? `, the newest ${shown.length} shown` : ""}):`];
  for (const c of shown) lines.push(`- ${c.date.slice(0, 10)} ${c.hash} ${c.author}: ${c.subject}`);
  return lines.join("\n");
}
