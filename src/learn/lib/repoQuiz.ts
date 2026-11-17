/**
 * A quiz written from the user's own codebase (docs/LEARNING.md, "Know your
 * codebase"), so a new teammate learns how this code behaves. The AI writes the
 * questions from the map and the code it is shown; this file says what it is
 * shown, and keeps only the questions that hold up:
 *
 * - each is multiple choice, four options and one right answer, with why;
 * - each cites the lines that prove it (path:start-end) and quotes a few words
 *   from them. A question whose file is not in the project, whose lines the file
 *   does not have, or whose lines do not hold what it quotes, is thrown away;
 * - the cited lines are kept as a hash, plus a short excerpt to show beside the
 *   answer (never more of the code than that). When the lines change, the hash no
 *   longer matches: lines that only moved are followed, anything else makes the
 *   question stale, and a stale question is never asked until it is rewritten.
 *
 * Questions come back like recall cards (recall.ts: the same boxes and days).
 * Plain code, no React, so tests read it.
 */
import { z } from "zod";
import type { CodeMap } from "@/analyzer/types";
import { review, type Spaced } from "./recall";

export type Cite = { path: string; start: number; end: number; hash: string };
/** A short excerpt shown beside the answer: lines `from`.. of `path`, the cited ones marked. */
export type Shown = { path: string; from: number; lines: string[]; marks: [number, number][] };

export type QuizQuestion = Spaced & {
  id: string;
  /** The part of the code it is about, in plain words ("Signing in"). */
  topic: string;
  q: string;
  options: string[];
  /** 0..3, the index of the right option. */
  answer: number;
  explain: string;
  /** Why each option is wrong, where the AI said; null for the right one. */
  wrong: (string | null)[];
  cites: Cite[];
  shown: Shown[];
  /** The latest answer was right. */
  last?: boolean;
  /** Its cited lines changed: not asked until it is rewritten or dropped. */
  stale?: boolean;
  madeAt: number;
};

/** One project's quiz, kept with the Learn room's other work (store.ts, "quiz-<project>"). */
export type RepoQuiz = { project: string; questions: QuizQuestion[]; updatedAt: number };

export const LETTERS = ["A", "B", "C", "D"] as const;
/** The most lines one citation may cover, and the most questions kept per project. */
export const CITE_MAX = 30;
export const QUIZ_MAX = 120;
/** How many questions one ask writes. */
export const BATCH = 12;
/** The code sent with the ask, all files together and per file. */
export const CODE_MAX = 40_000;
const FILE_MAX = 6_000;
/** Cited lines this close together are shown as one excerpt. */
const GAP = 6;
const LINE_MAX = 200;

/** Never cited or sent: .env files (examples apart), keys, certificates, credentials. */
const SECRET = /(^|\/)(\.env(?!\.(example|sample|template|dist)$)[^/]*|[^/]*\.(pem|key|p12|pfx|jks|keystore|crt|cer|kdbx)|[^/]*(secret|credential|private[-_]?key|service[-_]?account)[^/]*)$/i;
/** Files that say little about how the code behaves. */
const NOT_CODE = /\.(css|scss|sass|less|md|mdx|txt|svg|png|jpe?g|gif|ico|webp|lock|map|min\.js)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json)$/i;

/** The key a project's quiz is kept under: "quiz-team-tasks". */
export function quizKey(project: string): string {
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `quiz-${slug || "project"}`;
}

export const linesOf = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

/** FNV-1a over the lines, each without its trailing spaces, so only a real change of the code changes it. */
export function hashLines(lines: string[]): string {
  let h = 0x811c9dc5;
  const text = lines.map((l) => l.trimEnd()).join("\n");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cleanPath = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");

// ── What the AI writes, and the checks it must pass ──

const Letter = z.enum(["A", "B", "C", "D", "a", "b", "c", "d"]).transform((l) => "abcd".indexOf(l.toLowerCase()));
const RawCite = z.object({
  path: z.string().min(1).max(300),
  start: z.coerce.number().int().min(1),
  end: z.coerce.number().int().min(1),
  quote: z.string().trim().min(3).max(400),
});
const RawQuestion = z.object({
  topic: z.string().trim().min(1).max(60),
  q: z.string().trim().min(10).max(500),
  options: z.array(z.string().trim().min(1).max(240)).length(4),
  answer: z.union([z.number().int().min(0).max(3), z.string().regex(/^[0-3]$/).transform(Number), Letter]),
  explain: z.string().trim().min(10).max(1200),
  // Why each option is wrong: optional, and read loosely (a short list, or "" for the right one).
  wrong: z.array(z.string().max(600).nullable().catch(null)).max(4).optional().catch(undefined),
  cites: z.array(RawCite).min(1).max(3),
});
type Raw = z.infer<typeof RawQuestion>;

/** The quoted words are in the cited lines; "a … b" means both parts are there. */
function holds(lines: string[], quote: string): boolean {
  const text = squash(lines.join(" "));
  const parts = quote.split(/\s*(?:\.\.\.|…)\s*/).map(squash).filter(Boolean);
  return parts.length > 0 && parts.every((p) => p.length >= 3 && text.includes(p));
}

/** Why a raw question cannot be kept, or null. */
function fault(r: Raw, files: Record<string, string>): string | null {
  if (new Set(r.options.map((o) => squash(o).toLowerCase())).size < 4) return "two of its options are the same";
  for (const c of r.cites) {
    const path = cleanPath(c.path);
    if (SECRET.test(path)) return `it cites ${path}, which WalkMyCode never shows`;
    const text = files[path];
    if (text === undefined) return `it cites ${path}, which is not in the project`;
    const lines = linesOf(text);
    if (c.end < c.start || c.end > lines.length) return `it cites ${path}:${c.start}-${c.end}, lines the file does not have`;
    if (c.end - c.start + 1 > CITE_MAX) return `it cites more than ${CITE_MAX} lines at once`;
    if (!holds(lines.slice(c.start - 1, c.end), c.quote)) return `${path}:${c.start}-${c.end} does not hold what it quotes`;
  }
  return null;
}

/** The excerpts shown beside an answer: each file's cited lines, with a line around them, close ones joined. */
export function excerptsFor(cites: Omit<Cite, "hash">[], files: Record<string, string>): Shown[] {
  const out: Shown[] = [];
  const paths = [...new Set(cites.map((c) => c.path))];
  for (const path of paths) {
    const lines = linesOf(files[path] ?? "");
    const mine = cites.filter((c) => c.path === path).sort((a, b) => a.start - b.start);
    let win: { from: number; to: number; marks: [number, number][] } | null = null;
    const flush = () => {
      if (!win) return;
      out.push({ path, from: win.from, lines: lines.slice(win.from - 1, win.to).map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l)), marks: win.marks });
    };
    for (const c of mine) {
      const from = Math.max(1, c.start - 1);
      const to = Math.min(lines.length, c.end + 1);
      if (win && from - win.to <= GAP) {
        win.to = Math.max(win.to, to);
        win.marks.push([c.start, c.end]);
      } else {
        flush();
        win = { from, to, marks: [[c.start, c.end]] };
      }
    }
    flush();
  }
  return out;
}

/** "q-1a2b3c4d": from the question's words, so the same question written twice is one question. */
export const questionId = (q: string) => `q-${hashLines([squash(q).toLowerCase()])}`;

/**
 * The AI's reply as questions, each checked against the project's files: the ones
 * that hold up, and the ones thrown away with why. Pure: `files` is the code as the
 * map has it (path → text), `now` when they were written.
 */
export function checkQuestions(raw: unknown, files: Record<string, string>, now: number): { kept: QuizQuestion[]; dropped: { q: string; why: string }[] } {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { questions?: unknown })?.questions) ? (raw as { questions: unknown[] }).questions : [];
  const kept: QuizQuestion[] = [];
  const dropped: { q: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const parsed = RawQuestion.safeParse(item);
    const q = typeof (item as { q?: unknown })?.q === "string" ? String((item as { q: string }).q).slice(0, 200) : "";
    if (!parsed.success) {
      dropped.push({ q, why: "it was not a whole question: four options, one answer, why, and the lines it comes from" });
      continue;
    }
    const r = parsed.data;
    const why = fault(r, files);
    if (why) {
      dropped.push({ q: r.q, why });
      continue;
    }
    const id = questionId(r.q);
    if (seen.has(id)) continue;
    seen.add(id);
    const cites = r.cites.map((c) => {
      const path = cleanPath(c.path);
      return { path, start: c.start, end: c.end, hash: hashLines(linesOf(files[path]).slice(c.start - 1, c.end)) };
    });
    const wrong = [0, 1, 2, 3].map((i) => r.wrong?.[i]?.trim() || null).map((w, i) => (i === r.answer ? null : w));
    kept.push({ id, topic: r.topic, q: r.q, options: r.options, answer: r.answer, explain: r.explain, wrong, cites, shown: excerptsFor(cites, files), madeAt: now, box: 0, due: now, seen: 0, right: 0 });
  }
  return { kept, dropped };
}

// ── Keeping questions true to the code ──

/** Where the cited lines are now: where they were, else the one place they moved to, else null. */
function follow(c: Cite, files: Record<string, string>): Cite | null {
  const text = files[c.path];
  if (text === undefined) return null;
  const lines = linesOf(text);
  const len = c.end - c.start + 1;
  if (c.end <= lines.length && hashLines(lines.slice(c.start - 1, c.end)) === c.hash) return c;
  let found: number | null = null;
  for (let i = 0; i + len <= lines.length; i++) {
    if (hashLines(lines.slice(i, i + len)) !== c.hash) continue;
    if (found !== null) return null; // in two places: which one is meant cannot be told
    found = i + 1;
  }
  return found === null ? null : { ...c, start: found, end: found + len - 1 };
}

/**
 * The questions checked against the code as it is now. Lines that only moved are
 * followed (the excerpt is taken again); a question whose lines changed or are gone
 * is marked stale. `moved` and `stale` count what changed this time.
 */
export function refreshQuestions(qs: QuizQuestion[], files: Record<string, string>): { questions: QuizQuestion[]; moved: number; stale: number } {
  let moved = 0;
  let stale = 0;
  const questions = qs.map((q) => {
    if (q.stale) return q;
    const now = q.cites.map((c) => follow(c, files));
    if (now.some((c) => c === null)) {
      stale++;
      return { ...q, stale: true };
    }
    const cites = now as Cite[];
    if (cites.every((c, i) => c === q.cites[i])) return q;
    moved++;
    return { ...q, cites, shown: excerptsFor(cites, files) };
  });
  return { questions, moved, stale };
}

/** New questions added to the set: one already there (by its words) keeps its progress. Oldest go past the limit. */
export function mergeQuestions(have: QuizQuestion[], add: QuizQuestion[]): QuizQuestion[] {
  const ids = new Set(have.map((q) => q.id));
  const all = [...have, ...add.filter((q) => !ids.has(q.id))];
  return all.slice(Math.max(0, all.length - QUIZ_MAX));
}

// ── Asking and answering ──

/** The question after an answer: right comes back later (the next box), wrong tomorrow. */
export function answerQuestion(q: QuizQuestion, chosen: number, now: number): QuizQuestion {
  const right = chosen === q.answer;
  return { ...review(q, right, now), last: right };
}

/** The questions to ask now (never a stale one), the longest overdue first; only a topic's when given. */
export function dueQuestions(qs: QuizQuestion[], now: number, topic?: string): QuizQuestion[] {
  return qs.filter((q) => !q.stale && q.due <= now && (!topic || q.topic === topic)).sort((a, b) => a.due - b.due);
}

/** Each topic, in the order first written: how many questions, how many last answered right, how many due. */
export function topicsOf(qs: QuizQuestion[], now: number): { topic: string; total: number; right: number; due: number }[] {
  const by = new Map<string, { topic: string; total: number; right: number; due: number }>();
  for (const q of qs) {
    if (q.stale) continue;
    const t = by.get(q.topic) ?? { topic: q.topic, total: 0, right: 0, due: 0 };
    t.total++;
    if (q.last) t.right++;
    if (q.due <= now) t.due++;
    by.set(q.topic, t);
  }
  return [...by.values()];
}

/** How many questions sit in each box. */
export function boxCounts(qs: QuizQuestion[], boxes: number): number[] {
  const out = Array.from({ length: boxes }, () => 0);
  for (const q of qs) if (!q.stale) out[Math.min(q.box, boxes - 1)]++;
  return out;
}

// ── What the AI is shown ──

const cap = <T,>(xs: T[], n: number) => xs.slice(0, n);

/** The map in a few lines: routes, tables, outside services, and the links that show how things flow. */
export function mapDigest(map: CodeMap): string {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const at = (file?: string, line?: number) => (file ? ` (${file}${line ? `:${line}` : ""})` : "");
  const routes = cap(map.nodes.filter((n) => n.kind === "route"), 60).map((n) => `- ${[n.method, n.path ?? n.name].filter(Boolean).join(" ")}${at(n.file, n.line)}`);
  const tables = cap(map.nodes.filter((n) => n.kind === "table"), 30).map((n) => `- ${n.name}${n.columns?.length ? `: ${n.columns.map((c) => c.name).join(", ")}` : ""}${at(n.columnsAt?.file ?? n.file, n.columnsAt?.line ?? n.line)}`);
  const outside = map.nodes.filter((n) => n.kind === "service" && !n.internal).map((n) => n.name);
  const links = cap(map.edges.filter((e) => e.kind !== "imports" && e.evidence.length), 80).map((e) => {
    const ev = e.evidence[0];
    return `- ${byId.get(e.from)?.name ?? e.from} ${e.kind} ${byId.get(e.to)?.name ?? e.to} (${ev.file}:${ev.line})`;
  });
  return [
    `Project: ${map.name} (${map.system.kind}, ${map.files.length} files).`,
    routes.length ? `Routes:\n${routes.join("\n")}` : "",
    tables.length ? `Database tables:\n${tables.join("\n")}` : "",
    outside.length ? `Outside services: ${outside.join(", ")}` : "",
    links.length ? `How things connect:\n${links.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** The files that say most about how the code behaves (the most cards and links on the map), with line numbers. */
export function codeDigest(map: CodeMap, files: Record<string, string>, only?: string[]): string {
  const score = new Map<string, number>();
  const add = (f: string | undefined, n: number) => f && score.set(f, (score.get(f) ?? 0) + n);
  for (const n of map.nodes) add(n.file, n.kind === "route" || n.kind === "table" ? 4 : 3);
  for (const e of map.edges) for (const ev of e.evidence) add(ev.file, e.kind === "imports" ? 0.5 : 2);
  const skipped = new Set(map.files.filter((f) => f.skipped).map((f) => f.path));
  const ok = (p: string) => files[p] !== undefined && !SECRET.test(p) && !NOT_CODE.test(p) && !skipped.has(p);
  const ranked = (only ?? Object.keys(files)).filter(ok).sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || a.length - b.length);
  const parts: string[] = [];
  let size = 0;
  for (const path of ranked) {
    if (CODE_MAX - size < 800) break;
    const lines = linesOf(files[path]);
    const room = Math.min(FILE_MAX, CODE_MAX - size);
    const out: string[] = [];
    let used = 0;
    for (let i = 0; i < lines.length; i++) {
      const row = `${String(i + 1).padStart(4)}| ${lines[i].length > LINE_MAX ? `${lines[i].slice(0, LINE_MAX)}…` : lines[i]}`;
      if (used + row.length + 1 > room) {
        out.push(`     (the file goes on to line ${lines.length})`);
        break;
      }
      out.push(row);
      used += row.length + 1;
    }
    const block = `=== ${path} ===\n${out.join("\n")}`;
    parts.push(block);
    size += block.length;
  }
  return parts.join("\n\n");
}

const SHAPE = `{"questions":[{"topic":"Signing in","q":"…","options":["…","…","…","…"],"answer":1,"explain":"…","wrong":["why A is wrong",null,"why C is wrong","why D is wrong"],"cites":[{"path":"lib/auth.ts","start":12,"end":18,"quote":"a few words copied exactly from those lines"}]}]}`;

const RULES = [
  "Ask about behaviour: what happens when something is done, fails, or is missing; which part decides something; what a change would break. Not trivia such as file names or line counts.",
  "Each question has exactly four options and one right answer. Make the wrong options things a newcomer could believe.",
  "explain: two or three plain sentences saying why the right answer is right, naming the lines (\"line 22\").",
  "wrong: for each option, one short sentence saying why it is wrong, or null for the right one.",
  "cites: one to three places that prove the answer, as path, start line, end line (at most 30 lines), exactly as numbered in the code below, and quote: a few words copied exactly from those lines. A question whose lines do not hold its quote is thrown away.",
  "topic: the part of the app it is about, in two or three plain words (\"Signing in\", \"Creating tasks\", \"Emails\", \"The database\"). Reuse a topic already used when it fits.",
  "Plain English for a new teammate: short, concrete, no jargon.",
];

/** The ask for a new set of questions, from the map and the code; `have` are questions already written (not to repeat). */
export function quizPrompt(map: CodeMap, files: Record<string, string>, have: Pick<QuizQuestion, "q" | "topic">[], count = BATCH): string {
  const topics = [...new Set(have.map((q) => q.topic))];
  return [
    `Write ${count} multiple-choice questions that teach a new teammate how the project "${map.name}" works, from its map and its code below. Spread them over the main parts of the app, two to four questions per part.`,
    RULES.map((r) => `- ${r}`).join("\n"),
    topics.length ? `Topics already used: ${topics.join(", ")}.` : "",
    have.length ? `Questions already asked (write different ones):\n${cap(have, 60).map((q) => `- ${q.q}`).join("\n")}` : "",
    `Reply with JSON of this shape:\n${SHAPE}`,
    `THE MAP\n${mapDigest(map)}`,
    `THE CODE (line numbers on the left)\n${codeDigest(map, files)}`,
  ].filter(Boolean).join("\n\n");
}

/** The ask for questions whose code has changed: the same ideas, written again from the code as it is now. */
export function rewritePrompt(map: CodeMap, files: Record<string, string>, stale: QuizQuestion[]): string {
  const paths = [...new Set(stale.flatMap((q) => q.cites.map((c) => c.path)))].filter((p) => files[p] !== undefined);
  return [
    `The code of the project "${map.name}" has changed, and these questions about it may no longer be true. Write each again from the code as it is now: one question for each, on the same idea, or leave it out if the idea is gone from the code.`,
    stale.map((q) => `- [${q.topic}] ${q.q} (it was about ${q.cites.map((c) => `${c.path}:${c.start}-${c.end}`).join(", ")})`).join("\n"),
    RULES.map((r) => `- ${r}`).join("\n"),
    `Reply with JSON of this shape:\n${SHAPE}`,
    `THE CODE NOW (line numbers on the left)\n${codeDigest(map, files, paths.length ? paths : undefined)}`,
  ].join("\n\n");
}

/** "Why not A?": the follow-up asked about one option, with the question, its answer and its lines. */
export function whyNotPrompt(q: QuizQuestion, option: number): string {
  const code = q.shown.map((s) => `=== ${s.path} ===\n${s.lines.map((l, i) => `${String(s.from + i).padStart(4)}| ${l}`).join("\n")}`).join("\n\n");
  return [
    `A new teammate is learning how this codebase works. They were asked:\n${q.q}`,
    q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n"),
    `The right answer is ${LETTERS[q.answer]}. ${q.explain}`,
    `They ask: why not ${LETTERS[option]}?${option === q.answer ? " (That is the right one: say why, and what would make it wrong.)" : ""}`,
    `Answer in two to four short, plain sentences, pointing at the lines below as path:line. Say only what these lines show.`,
    code,
  ].join("\n\n");
}
