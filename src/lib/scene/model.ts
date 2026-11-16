/**
 * An analogy as a scene to watch (docs/LEARNING.md, "Use analogy"): the
 * everyday picture and the real thing, stepped through together. A scene is
 * data: a few holders (a child, a variable, a country), a few things they hold
 * (a toy, a value, a place in a queue), and at each step who holds what. The
 * same data draws both sides, so the picture can never say something the real
 * thing does not.
 *
 * One scene is drawn two ways (src/components/scene/SceneBlock.tsx): as a
 * stage, the picture above the real thing, column for column; and as a UML
 * sequence diagram, where each holder is a lifeline and each hand-over a
 * message. Both come from this file, so they cannot disagree either.
 *
 * It is used by the Learn room's "Watch it happen" (src/learn/lib/scene.ts
 * asks the professor for one) and by a fenced ```scene block in any answer:
 * the professor's, the Explore guide's, or an AI app's through the MCP server.
 * This file has no React, no DOM and no drawings, so tests can drive it.
 */

/** A word in the picture (`a`) and what it is for real (`r`). */
export type Pair = { a: string; r: string };

/**
 * A drawing a model makes itself, for something the set has no drawing of: a
 * short list of plain shapes on the same 64 × 64 square, back to front. It is
 * numbers and names only (the page turns each into one SVG element), so
 * nothing a model writes is ever put on the page as markup.
 */
export type Shape =
  | { s: "circle"; x: number; y: number; r: number; c: ShapeColour }
  | { s: "rect"; x: number; y: number; w: number; h: number; rx?: number; c: ShapeColour }
  | { s: "ellipse"; x: number; y: number; rx: number; ry: number; c: ShapeColour }
  | { s: "line"; x1: number; y1: number; x2: number; y2: number; c: ShapeColour }
  | { s: "poly"; p: number[]; c: ShapeColour };
export const SHAPE_COLOURS = ["t", "dark", "light", "white", "grey", "ink", "yellow", "pink", "red", "blue", "green", "purple", "orange", "brown", "sky", "cream", "skin"] as const;
export type ShapeColour = (typeof SHAPE_COLOURS)[number];
/** As many shapes as one small drawing needs; more is a scribble. */
export const MAX_SHAPES = 14;

/** Keep only shapes the page can draw, inside the square; null when nothing is left. */
export function cleanShapes(raw: unknown): Shape[] | null {
  if (!Array.isArray(raw)) return null;
  const n = (v: unknown, min = 0, max = 64) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v)) * 10) / 10 : null);
  const out: Shape[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    if (!x || typeof x !== "object") continue;
    const c = SHAPE_COLOURS.find((k) => k === x.c) ?? "t";
    if (x.s === "circle") {
      const [cx, cy, r] = [n(x.x), n(x.y), n(x.r, 0.5, 40)];
      if (cx !== null && cy !== null && r !== null) out.push({ s: "circle", x: cx, y: cy, r, c });
    } else if (x.s === "rect") {
      const [rx, ry, w, h, round] = [n(x.x), n(x.y), n(x.w, 0.5), n(x.h, 0.5), n(x.rx, 0, 32)];
      if (rx !== null && ry !== null && w !== null && h !== null) out.push({ s: "rect", x: rx, y: ry, w, h, ...(round ? { rx: round } : {}), c });
    } else if (x.s === "ellipse") {
      const [cx, cy, rx, ry] = [n(x.x), n(x.y), n(x.rx, 0.5, 40), n(x.ry, 0.5, 40)];
      if (cx !== null && cy !== null && rx !== null && ry !== null) out.push({ s: "ellipse", x: cx, y: cy, rx, ry, c });
    } else if (x.s === "line") {
      const [x1, y1, x2, y2] = [n(x.x1), n(x.y1), n(x.x2), n(x.y2)];
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) out.push({ s: "line", x1, y1, x2, y2, c });
    } else if (x.s === "poly" && Array.isArray(x.p)) {
      const p = (x.p as unknown[]).slice(0, 24).map((v) => n(v));
      if (p.length >= 6 && p.length % 2 === 0 && p.every((v) => v !== null)) out.push({ s: "poly", p: p as number[], c });
    }
    if (out.length === MAX_SHAPES) break;
  }
  return out.length ? out : null;
}

/** Someone or something that holds: named in the picture (`a`) and for real (`r`), with the drawing for each side when one was named, or one made for it (`draw`). */
export type SceneActor = { id: string; a: string; r: string; ia?: string; ir?: string; tint?: string; draw?: Shape[] };
/** What is held, in the picture and for real. */
export type SceneThing = SceneActor;
/** Who checks the rules (a teacher, the compiler), and where things go when they are gone (a toy box, freed memory). */
export type SceneAside = Pair & { ia?: string; ir?: string; draw?: Shape[] };

export type SceneStep = {
  /** The line of `code` this step is about (1 is the first line). */
  line?: number;
  /** Who holds each thing now; null before it exists and once it is gone (dropped, used up, tidied away). */
  holds: Record<string, string | null>;
  /** Who has each thing on loan, while its holder still holds it. */
  lent: Record<string, string[]>;
  /** Holders that can no longer be used, or are out of it. */
  off: string[];
  /** What happens, in the picture and for real. One sentence each. */
  a: string;
  r: string;
  /** The word for what this step does to a thing: "gives away" and "move". */
  verb?: Pair;
  /** The word for a thing appearing: "brings" and "String::from". */
  made?: Pair;
  /** Something a holder does that moves nothing: "shows it round" and "println! reads r". */
  note?: Pair & { who: string };
  /** The checker stops it here: who broke the rule, what is said, and the real error. */
  stop?: Pair & { who: string };
  /** The entry of `map` this step teaches. */
  word?: number;
};

export type SceneWord = Pair & { why?: string; icon?: string; draw?: Shape[] };

export type Scene = {
  title: string;
  /** Where the picture is set ("a playroom"). */
  place: string;
  actors: SceneActor[];
  things: SceneThing[];
  /** The picture's words and what each stands for. */
  map: SceneWord[];
  /** The real side, a line at a time: code, or (when `plain`) the real steps in the subject's own words. */
  code: string;
  language: string;
  /** A subject without code: the real side is words, not a program. */
  plain?: boolean;
  steps: SceneStep[];
  /** The one-line takeaway. */
  rule: string;
  /** Where the picture stops being true. */
  breaks: string;
  watcher?: SceneAside;
  bin?: SceneAside;
  /** The word for a loan: "lends" and "&s1". */
  loan?: Pair;
  /** How it is first shown: as a stage (the default) or as a sequence diagram. */
  view?: "stage" | "sequence";
};

/** Where a thing is at a step: with a holder, in the bin (gone for good), or not there yet. */
export type Place = { at: "actor"; id: string } | { at: "bin" } | null;

export function placeOf(scene: Scene, index: number, thing: string): Place {
  const now = scene.steps[index]?.holds[thing];
  if (now) return { at: "actor", id: now };
  // Gone only if someone held it before: a thing nobody has had yet is simply not in the picture.
  for (let k = index - 1; k >= 0; k--) if (scene.steps[k].holds[thing]) return { at: "bin" };
  return null;
}

/** What the page draws for one step: each holder with what it holds and what it has on loan, and what is gone. */
export type SceneView = {
  actors: (SceneActor & { off: boolean; holds: SceneThing[]; lent: SceneThing[] })[];
  gone: SceneThing[];
};

const clamp = (scene: Scene, index: number) => Math.max(0, Math.min(scene.steps.length - 1, index));

export function sceneView(scene: Scene, index: number): SceneView {
  const i = clamp(scene, index);
  const step = scene.steps[i];
  return {
    actors: scene.actors.map((actor) => ({
      ...actor,
      off: step.off.includes(actor.id),
      holds: scene.things.filter((t) => step.holds[t.id] === actor.id),
      lent: scene.things.filter((t) => (step.lent[t.id] ?? []).includes(actor.id)),
    })),
    gone: scene.things.filter((t) => placeOf(scene, i, t.id)?.at === "bin"),
  };
}

/** The words a scene uses when the professor gave none. */
export function sceneWords(scene: Scene) {
  const code = !scene.plain;
  return {
    bin: scene.bin ?? (code ? { a: "tidied away", r: "freed" } : { a: "gone", r: "ended" }),
    loan: scene.loan ?? (code ? { a: "lends", r: "borrow" } : { a: "shows", r: "shares" }),
    move: code ? { a: "hands over", r: "move" } : { a: "hands over", r: "passes on" },
    off: code ? { a: "empty-handed", r: "cannot be used" } : { a: "out of it", r: "no longer acts" },
  };
}

/** What a step did, as a sequence diagram sees it: a message between two lifelines, or a note on one. */
export type SceneEvent =
  | ({ kind: "move" | "loan"; from: string; to: string; thing: SceneThing } & Pair)
  | ({ kind: "made" | "end"; who: string; thing: SceneThing } & Pair)
  | ({ kind: "note" | "stop"; who: string } & Pair);

export function sceneEvents(scene: Scene, index: number): SceneEvent[] {
  const step = scene.steps[index];
  const prev = scene.steps[index - 1];
  if (!step) return [];
  const words = sceneWords(scene);
  const out: SceneEvent[] = [];
  for (const thing of scene.things) {
    const now = placeOf(scene, index, thing.id);
    const before = index > 0 ? placeOf(scene, index - 1, thing.id) : null;
    // With no words of its own, a thing appearing is simply named, in the picture and for real.
    // The step's own words are for the first thing it brings in; anything else that appears with it is named.
    if (now?.at === "actor" && !before) out.push({ kind: "made", who: now.id, thing, ...((out.some((e) => e.kind === "made") ? null : step.made) ?? { a: thing.a, r: thing.r }) });
    else if (now?.at === "bin" && before?.at === "actor") out.push({ kind: "end", who: before.id, thing, ...(step.verb ?? words.bin) });
    else if (now?.at === "actor" && before?.at === "actor" && now.id !== before.id) out.push({ kind: "move", from: before.id, to: now.id, thing, ...(step.verb ?? words.move) });
    if (now?.at === "actor") for (const b of step.lent[thing.id] ?? []) if (!(prev?.lent[thing.id] ?? []).includes(b)) out.push({ kind: "loan", from: now.id, to: b, thing, ...words.loan });
  }
  if (step.note) out.push({ kind: "note", ...step.note });
  if (step.stop) out.push({ kind: "stop", ...step.stop });
  return out;
}

const LANGS = ["python", "javascript", "typescript", "sql", "rust"];
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
/** A drawing's name or a colour's: one plain lower-case word, or nothing. */
const word = (v: unknown) => str(v, 24).toLowerCase().replace(/[^a-z]/g, "");
const pair = (v: unknown, max = 40): Pair | null => {
  const p = v as Record<string, unknown> | null;
  const a = str(p?.a, max);
  const r = str(p?.r, max);
  return a && r ? { a, r } : null;
};
const drawn = (x: Record<string, unknown> | null | undefined) => {
  const draw = cleanShapes(x?.draw);
  return { ...(word(x?.ia) ? { ia: word(x?.ia) } : {}), ...(word(x?.ir) ? { ir: word(x?.ir) } : {}), ...(draw ? { draw } : {}) };
};

/** Keep only a scene the page can draw and that is consistent with itself; null otherwise. `language` is null for a subject without code. */
export function cleanScene(raw: unknown, language: string | null): Scene | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const named = (list: unknown, max: number): SceneActor[] =>
    (Array.isArray(list) ? (list as Record<string, unknown>[]) : [])
      .map((x) => ({ id: id(x?.id), a: str(x?.a, 60), r: str(x?.r, 60), ...drawn(x), ...(word(x?.tint) ? { tint: word(x?.tint) } : {}) }))
      .filter((x, i, all) => x.id && x.a && x.r && all.findIndex((y) => y.id === x.id) === i)
      .slice(0, max);
  const actors = named(r.actors, 4);
  const things = named(r.things, 3);
  const code = str(r.code, 1200).replace(/\r\n/g, "\n");
  const lines = code.split("\n").length;
  if (actors.length < 2 || !things.length || !code) return null;
  const isActor = (v: unknown): v is string => typeof v === "string" && actors.some((a) => a.id === v);

  // The words first: a step points at one by its place in the list the professor wrote.
  const kept: number[] = [];
  const map: SceneWord[] = [];
  (Array.isArray(r.map) ? (r.map as Record<string, unknown>[]) : []).forEach((m, n) => {
    const a = str(m?.a, 60);
    const real = str(m?.r, 80);
    if (!a || !real || map.length === 6) return;
    kept[n] = map.length;
    const draw = cleanShapes(m?.draw);
    map.push({ a, r: real, ...(str(m?.why, 110) ? { why: str(m?.why, 110) } : {}), ...(word(m?.icon) ? { icon: word(m?.icon) } : {}), ...(draw ? { draw } : {}) });
  });

  const steps: SceneStep[] = [];
  for (const s of Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : []) {
    if (!s || typeof s !== "object") continue;
    const given = (s.holds ?? {}) as Record<string, unknown>;
    const loans = (s.lent ?? {}) as Record<string, unknown>;
    const holds: Record<string, string | null> = {};
    const lent: Record<string, string[]> = {};
    for (const t of things) {
      const h = id(given[t.id]);
      // A thing with no holder named keeps the one it had; before any, it is not there yet.
      holds[t.id] = isActor(h) ? h : given[t.id] === null ? null : (steps.at(-1)?.holds[t.id] ?? null);
      const borrowers = (Array.isArray(loans[t.id]) ? (loans[t.id] as unknown[]) : []).map(id).filter((b) => isActor(b) && b !== holds[t.id]);
      // Nothing gone can be on loan.
      if (borrowers.length && holds[t.id] !== null) lent[t.id] = [...new Set(borrowers)];
    }
    const line = Number(s.line);
    const a = str(s.a);
    const real = str(s.r);
    if (!a || !real) continue;
    const verb = pair(s.verb);
    const made = pair(s.made);
    const who = (v: unknown, max: number) => {
      const p = pair(v, max);
      const w = id((v as Record<string, unknown> | null)?.who);
      return p && isActor(w) ? { who: w, ...p } : null;
    };
    const note = who(s.note, 60);
    const stop = who(s.stop, 90);
    const at = Number.isInteger(s.word) ? kept[s.word as number] : undefined;
    steps.push({
      ...(Number.isInteger(line) && line >= 1 && line <= lines ? { line } : {}),
      holds,
      lent,
      off: [...new Set((Array.isArray(s.off) ? (s.off as unknown[]) : []).map(id).filter(isActor))],
      a,
      r: real,
      ...(verb ? { verb } : {}),
      ...(made ? { made } : {}),
      ...(note ? { note } : {}),
      ...(stop ? { stop } : {}),
      ...(at !== undefined ? { word: at } : {}),
    });
    if (steps.length === 8) break;
  }
  if (steps.length < 2) return null;
  const aside = (v: unknown): SceneAside | null => {
    const p = pair(v);
    return p ? { ...p, ...drawn(v as Record<string, unknown>) } : null;
  };
  const watcher = aside(r.watcher);
  const bin = aside(r.bin);
  const loan = pair(r.loan);
  const lang = LANGS.find((l) => l === str(r.language).toLowerCase()) ?? language ?? "python";
  return {
    title: str(r.title, 80) || "The picture",
    place: str(r.place, 60),
    actors,
    things,
    map,
    code,
    language: lang,
    ...(language ? {} : { plain: true }),
    steps,
    rule: str(r.rule),
    breaks: str(r.breaks),
    ...(watcher ? { watcher } : {}),
    ...(bin ? { bin } : {}),
    ...(loan ? { loan } : {}),
    ...(r.view === "sequence" ? { view: "sequence" as const } : {}),
  };
}

/**
 * A ```scene block from an answer, as a scene; null if it is not one (still
 * arriving, or not valid). Its real side is code unless the block says the
 * subject has none ("language": "none").
 */
export function readSceneBlock(text: string): Scene | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const language = str((raw as Record<string, unknown> | null)?.language, 20).toLowerCase();
  return cleanScene(raw, ["none", "text", "plain", "words"].includes(language) ? null : language || "code");
}

/**
 * How any model writes a scene into an answer. Short on purpose: it rides in
 * every system prompt. The app picks the drawings from the everyday names.
 */
export const SCENE_BLOCK = `To show an idea as a picture to watch (the user asks for an analogy, to have it explained simply, or for a sequence diagram a beginner can follow), add one fenced \`\`\`scene block of JSON and nothing else in it:
{"title": "the picture in a few words", "place": "where it is set", "view": "stage" or "sequence" (sequence when a sequence diagram was asked for), "language": the code's language or "none", "actors": [{"id": "ama", "a": "everyday name", "r": "real name"}], "things": [{"id": "toy", "a": "everyday name", "r": "real name"}], "code": "the real lines, one step per line", "steps": [{"line": 1, "holds": {"toy": "ama"}, "lent": {}, "off": [], "a": "what happens in the picture", "r": "what happens for real", "verb": {"a": "gives away", "r": "move"}}], "map": [{"a": "picture word", "r": "real word", "why": "a few words"}], "rule": "the one thing to remember", "breaks": "where the picture stops being true"}
2 to 4 actors (who holds or acts), 1 to 3 things (what is held or passed), 3 to 8 steps. In each step "holds" names who has each thing now (null once it is gone), "lent" who has it on loan, "off" who can no longer act. Everyday names are things a ten-year-old knows (a child, a nurse, a train, a letter, a key, a ball): the app draws them. Both sides must agree at every step, and every real name must be true to what you read.`;
