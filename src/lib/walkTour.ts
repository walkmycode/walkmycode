// A tour saved to share (docs/VOICE.md §6): the `.walktour` file. A teammate opens it on the
// same code and the tour plays in the Guide's tour player, onboarding without a meeting.
//
// The file is JSON, versioned, and checked with zod when it is read. It holds the tour's
// name, the day it was made, and for each step its file, its lines, the narration, the
// lines it shows (the excerpt only, never a whole file) with a hash of them, and, when
// asked for, the step's map cards by name and the maker's own voice as a short clip.
// Nothing WalkMyCode hides ever goes in: no real .env, no keys, nothing in a hidden folder
// it never reads; config lines go in with their secret values hidden, as the Code panel
// shows them.
//
// Opened again, each step checks that its file is still there and that its lines still
// hash the same. When they don't, the step says plainly that the code changed since, and
// a simple search finds the lines where they moved to. A tour made on another project,
// where most of its files are missing, is not played: the Guide says so instead.
//
// Also: the same tour as a clean Markdown document. Pure, so all of it is tested
// (tests/walkTour.test.ts).
import { z } from "zod";
import { listsHiddenDir, otherFileMode, redactSource } from "@/analyzer/config/files";
import type { Tour, TourStep } from "@/lib/claude/tools";

export const WALKTOUR_VERSION = 1;
export const WALKTOUR_EXT = ".walktour";
/** The most lines one step carries; a longer step keeps its first ones (its hash covers those). */
export const MAX_EXCERPT_LINES = 80;
/** The most steps a tour file holds. */
export const MAX_STEPS = 60;
/** One step's recorded voice, as audio bytes (about three minutes of speech). */
export const MAX_CLIP_BYTES = 2_000_000;
/** All of a tour's recordings together. */
export const MAX_AUDIO_BYTES = 16_000_000;
/** A tour file bigger than this is not read. */
export const MAX_FILE_CHARS = 24_000_000;

/** A step's narration as its maker recorded it. */
export interface Clip {
  type: string;
  base64: string;
}

const HASH = /^fnv1a32:[0-9a-f]{8}$/;
const clipSchema = z.object({
  type: z.string().max(80).regex(/^audio\/[\w.+-]+(;\s*codecs=[\w.,"-]+)?$/),
  base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
const stepSchema = z.object({
  file: z.string().min(1).max(500),
  lines: z.tuple([z.int().min(1), z.int().min(1)]).refine(([a, b]) => b >= a),
  text: z.string().max(8000),
  excerpt: z.string().max(400_000).optional(),
  hash: z.string().regex(HASH),
  cards: z.array(z.object({ id: z.string().max(400), name: z.string().max(400) })).max(40).optional(),
  audio: clipSchema.optional(),
});
const tourSchema = z.object({
  format: z.literal("walktour"),
  version: z.literal(WALKTOUR_VERSION),
  name: z.string().trim().min(1).max(200),
  created: z.string().max(40),
  project: z.string().max(200).optional(),
  steps: z.array(stepSchema).min(1).max(MAX_STEPS),
});

export type WalkTour = z.infer<typeof tourSchema>;
export type WalkTourStep = z.infer<typeof stepSchema>;

// ── what never goes in ──

/** A file a tour never carries: a secret WalkMyCode never even lists (a real .env, keys,
 * credentials), anything inside a hidden folder it never reads (.git, .ssh, caches), or a path
 * that climbs out of the project. */
export function hiddenFromTours(path: string): boolean {
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\\")) return true;
  const parts = path.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return true;
  if (otherFileMode(path) === null) return true;
  return parts.slice(0, -1).some((p) => p.startsWith(".") && !listsHiddenDir(p) && p !== ".github");
}

// ── the excerpt and its hash ──

const linesOf = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

/** The lines a step shows, `start` to `end` (1-based), at most MAX_EXCERPT_LINES of them, with any
 * secret values hidden as the Code panel hides them. Empty when the file has no such lines. */
export function excerptOf(path: string, text: string, start: number, end: number): string {
  const all = linesOf(text);
  if (start < 1 || start > all.length) return "";
  const last = Math.min(end, all.length, start + MAX_EXCERPT_LINES - 1);
  return redactSource(path, all.slice(start - 1, last).join("\n"));
}

/** Lines as compared: no line-ending or trailing-space differences. */
const normal = (s: string) =>
  linesOf(s)
    .map((l) => l.trimEnd())
    .join("\n");

/** A short hash of an excerpt (FNV-1a, 32 bits): enough to tell that lines changed, not a seal. */
export function hashExcerpt(excerpt: string): string {
  let h = 0x811c9dc5;
  const s = normal(excerpt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a32:${h.toString(16).padStart(8, "0")}`;
}

// ── saving ──

const clipBytes = (c: Clip) => Math.floor((c.base64.length * 3) / 4) - (c.base64.endsWith("==") ? 2 : c.base64.endsWith("=") ? 1 : 0);

export interface SaveChoice {
  name: string;
  /** When the tour was saved (an ISO date). */
  created: string;
  /** The project's name, for the "made on another project" message. */
  project?: string;
  /** Carry the lines each step shows (always their hash, so a change is still noticed). */
  lines: boolean;
  /** Each step's map cards, by id and name (no code), when the maker asked for the map. */
  cards?: (step: TourStep, i: number) => { id: string; name: string }[];
  /** The maker's own voice, one clip per step (or none for a step). */
  clips?: readonly (Clip | null | undefined)[];
}

export interface Saved {
  tour: WalkTour;
  /** Steps left out because their files are ones WalkMyCode hides. */
  left: string[];
  /** Recordings left out because they were too big. */
  clipsLeft: number;
}

/** The tour as a `.walktour` file's contents, from the tour on screen and the project's files. */
export function buildWalkTour(tour: Tour, files: Readonly<Record<string, string>>, o: SaveChoice): Saved {
  const left: string[] = [];
  let clipsLeft = 0;
  let audio = 0;
  const steps: WalkTourStep[] = [];
  tour.steps.slice(0, MAX_STEPS).forEach((s, i) => {
    if (hiddenFromTours(s.file)) {
      left.push(s.file);
      return;
    }
    const start = Math.max(1, Math.floor(s.start_line));
    const end = Math.max(start, Math.floor(s.end_line));
    const excerpt = excerptOf(s.file, files[s.file] ?? "", start, end);
    const cards = o.cards?.(s, i).filter((c) => c.id && c.name);
    const clip = o.clips?.[i];
    let keep: Clip | undefined;
    if (clip) {
      const n = clipBytes(clip);
      if (n > MAX_CLIP_BYTES || audio + n > MAX_AUDIO_BYTES) clipsLeft++;
      else {
        audio += n;
        keep = { type: clip.type, base64: clip.base64 };
      }
    }
    steps.push({
      file: s.file,
      lines: [start, end],
      text: s.say,
      ...(o.lines ? { excerpt } : {}),
      hash: hashExcerpt(excerpt),
      ...(cards?.length ? { cards } : {}),
      ...(keep ? { audio: keep } : {}),
    });
  });
  const name = o.name.trim() || tour.title.trim() || "A tour";
  return {
    tour: { format: "walktour", version: WALKTOUR_VERSION, name: name.slice(0, 200), created: o.created, ...(o.project ? { project: o.project.slice(0, 200) } : {}), steps },
    left,
    clipsLeft,
  };
}

/** The file's text. */
export function walkTourText(t: WalkTour): string {
  return `${JSON.stringify(t, null, 2)}\n`;
}

/** A file name from the tour's name: "How a task gets created" → "how-a-task-gets-created.walktour". */
export function tourFileName(name: string, kind: "tour" | "markdown"): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "tour";
  return `${slug}${kind === "tour" ? WALKTOUR_EXT : ".md"}`;
}

// ── reading ──

export type Read = { ok: true; tour: WalkTour; left: string[]; clipsLeft: number } | { ok: false; why: string };

const NOT_A_TOUR = "This isn't a tour file: WalkMyCode couldn't read it as one.";

/** A `.walktour` file's text, checked. Steps in files WalkMyCode hides are dropped (a hand-made
 * file could name one); recordings over the size caps are dropped and the step is read aloud. */
export function readWalkTour(text: string): Read {
  if (text.length > MAX_FILE_CHARS) return { ok: false, why: "This tour file is too big to open." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, why: NOT_A_TOUR };
  }
  if (!raw || typeof raw !== "object" || (raw as { format?: unknown }).format !== "walktour") return { ok: false, why: NOT_A_TOUR };
  const v = (raw as { version?: unknown }).version;
  if (typeof v === "number" && v > WALKTOUR_VERSION) return { ok: false, why: "This tour file was made by a newer WalkMyCode. Update WalkMyCode, then open it again." };
  const parsed = tourSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, why: "This tour file is damaged or incomplete, so WalkMyCode can't play it." };
  const left: string[] = [];
  let clipsLeft = 0;
  let audio = 0;
  const steps: WalkTourStep[] = [];
  for (const s of parsed.data.steps) {
    if (hiddenFromTours(s.file)) {
      left.push(s.file);
      continue;
    }
    if (s.audio) {
      const n = clipBytes(s.audio);
      if (n > MAX_CLIP_BYTES || audio + n > MAX_AUDIO_BYTES) {
        clipsLeft++;
        const { audio: _drop, ...rest } = s;
        void _drop;
        steps.push(rest);
        continue;
      }
      audio += n;
    }
    steps.push(s);
  }
  if (!steps.length) return { ok: false, why: "Nothing in this tour can be shown: all its steps are in files WalkMyCode keeps hidden." };
  return { ok: true, tour: { ...parsed.data, steps }, left, clipsLeft };
}

// ── checking it against the open project ──

export type StepState = { kind: "same" } | { kind: "moved"; start: number; end: number } | { kind: "changed" } | { kind: "missing" };

/** Where an excerpt's lines are in a file now: the start line (1-based) of an exact match, the one
 * nearest `near` when there are several, or null. Lines compare without trailing spaces. */
export function findExcerpt(text: string, excerpt: string, near = 1): number | null {
  // Blank lines at either end say nothing about where the lines are: matched without them.
  const want = normal(excerpt).split("\n");
  while (want.length && !want[want.length - 1].trim()) want.pop();
  let blank = 0;
  while (blank < want.length && !want[blank].trim()) blank++;
  want.splice(0, blank);
  if (!want.length) return null;
  const have = normal(text).split("\n");
  let best: number | null = null;
  for (let i = 0; i + want.length <= have.length; i++) {
    let k = 0;
    while (k < want.length && have[i + k] === want[k]) k++;
    if (k < want.length) continue;
    const start = i + 1 - blank;
    if (start < 1) continue;
    if (best === null || Math.abs(start - near) < Math.abs(best - near)) best = start;
  }
  return best;
}

/** One step against the open project's files. */
export function checkStep(s: WalkTourStep, files: Readonly<Record<string, string>>): StepState {
  const text = files[s.file];
  if (text === undefined) return { kind: "missing" };
  const [start, end] = s.lines;
  if (hashExcerpt(excerptOf(s.file, text, start, end)) === s.hash) return { kind: "same" };
  if (s.excerpt?.trim()) {
    const at = findExcerpt(text, s.excerpt, start);
    // Only when the lines found are the ones the hash was made of (a redacted line could match by chance).
    if (at !== null && at !== start && hashExcerpt(excerptOf(s.file, text, at, at + (end - start))) === s.hash) return { kind: "moved", start: at, end: at + (end - start) };
  }
  return { kind: "changed" };
}

const range = (a: number, b: number) => (a === b ? `line ${a}` : `lines ${a}–${b}`);

/** What a step says when its code is not as it was. */
export function stepNote(s: WalkTourStep, state: StepState): string | undefined {
  const [a, b] = s.lines;
  if (state.kind === "moved") return `The code has changed since this tour was made. These lines have moved: they were at ${range(a, b)}, and are now at ${range(state.start, state.end)}.`;
  if (state.kind === "changed") return `The code has changed since this tour was made: ${range(a, b)} are no longer the lines this step describes.`;
  if (state.kind === "missing") return `${s.file} isn't in the open project, so this step can't show its lines.`;
  return undefined;
}

export interface Replay {
  /** The tour for the tour player, each step pointing at its lines as they are now. */
  tour: Tour;
  states: StepState[];
  /** Most of the tour's files are missing: it was made on another project. */
  otherProject: boolean;
  /** Steps whose code changed (or moved) since. */
  changed: number;
  missing: number;
}

/** A tour file against the open project's files: the tour to play, and how much of it still fits. */
export function replayTour(wt: WalkTour, files: Readonly<Record<string, string>>): Replay {
  const states = wt.steps.map((s) => checkStep(s, files));
  const all = new Set(wt.steps.map((s) => s.file));
  const gone = new Set(wt.steps.filter((s) => files[s.file] === undefined).map((s) => s.file));
  const steps: TourStep[] = wt.steps.map((s, i) => {
    const st = states[i];
    const [start, end] = st.kind === "moved" ? [st.start, st.end] : s.lines;
    const note = stepNote(s, st);
    return {
      say: s.text,
      file: s.file,
      start_line: start,
      end_line: end,
      node_ids: (s.cards ?? []).map((c) => c.id),
      ...(note ? { note } : {}),
      ...(s.audio ? { clip: s.audio } : {}),
    };
  });
  return {
    tour: { title: wt.name, steps },
    states,
    otherProject: gone.size * 2 > all.size,
    changed: states.filter((s) => s.kind === "moved" || s.kind === "changed").length,
    missing: states.filter((s) => s.kind === "missing").length,
  };
}

/** The plain message for a tour made on another project. */
export function otherProjectNote(wt: WalkTour, here?: string): string {
  const made = wt.project ? `“${wt.project}”` : "another project";
  return `This tour was made on ${made}${here && wt.project !== here ? `, not ${here}` : ""}: most of its files aren't in the project that's open. Open that project, then open the tour again.`;
}

// ── as Markdown ──

/** A step's heading: its narration's first sentence, kept short. */
export function stepTitle(text: string, file: string): string {
  const first = text.trim().split(/(?<=[.!?])\s+/)[0]?.replace(/[.!?]+$/, "").trim() ?? "";
  if (!first) return file.split("/").pop() || file;
  if (first.length <= 64) return first;
  const cut = first.slice(0, 64);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

const FENCE_LANG: Record<string, string> = { ts: "ts", tsx: "tsx", mts: "ts", cts: "ts", js: "js", jsx: "jsx", mjs: "js", cjs: "js", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", cs: "csharp", php: "php", dart: "dart", sql: "sql", prisma: "prisma", json: "json", yml: "yaml", yaml: "yaml", toml: "toml", css: "css", scss: "scss", html: "html", vue: "vue", svelte: "svelte", sh: "bash", c: "c", h: "c", cpp: "cpp", hpp: "cpp", swift: "swift", md: "md" };

/** The fence a block of code needs: longer than any run of backticks inside it. */
function fence(code: string): string {
  const run = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, run + 1));
}

/** The tour as a Markdown document: a heading per step, its file:line, its lines in fenced code, and what it says. */
export function walkTourMarkdown(wt: WalkTour): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(wt.created)?.[0];
  const out = [`# ${wt.name}`, "", `A tour of ${wt.project ? `**${wt.project}**` : "the code"} in ${wt.steps.length} step${wt.steps.length === 1 ? "" : "s"}${day ? `, made on ${day}` : ""} with WalkMyCode.`, ""];
  wt.steps.forEach((s, i) => {
    const [a, b] = s.lines;
    out.push(`## ${i + 1}. ${stepTitle(s.text, s.file)}`, "", `\`${s.file}:${a === b ? a : `${a}–${b}`}\``, "");
    if (s.excerpt?.trim()) {
      const f = fence(s.excerpt);
      const lang = FENCE_LANG[s.file.split(".").pop()?.toLowerCase() ?? ""] ?? "";
      out.push(`${f}${lang}`, s.excerpt.replace(/\s+$/, ""), f, "");
    }
    if (s.text.trim()) out.push(s.text.trim(), "");
  });
  return `${out.join("\n").trimEnd()}\n`;
}
