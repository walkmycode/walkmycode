/**
 * An analogy as a scene to watch (docs/LEARNING.md, "Use analogy"): the
 * everyday picture and the real thing side by side, stepped through together.
 * A scene is data: a few holders (a child, a variable, a country), a few
 * things they hold (a toy, a value, a place in a queue), and at each step who
 * holds what. The same data draws both sides, so the picture can never say
 * something the real thing does not.
 *
 * In a lesson with code the real side is the code, a line at a time. In any
 * other subject it is the real steps in the subject's own terms: "a queue at a
 * bus stop" beside "first in, first out".
 *
 * The professor writes a scene for a board when the student first asks to
 * watch it; it is then kept with the lesson. AnalogyScene.tsx draws it.
 */
import { plain } from "./markup";
import { PERSONA, student } from "./professor";
import type { CodeLanguage, Lesson, Profile } from "./types";

/** Someone or something that holds: named in the picture (`a`) and for real (`r`). */
export type SceneActor = { id: string; a: string; r: string };
/** What is held, in the picture and for real. */
export type SceneThing = { id: string; a: string; r: string };

export type SceneStep = {
  /** The line of `code` this step is about (1 is the first line). */
  line?: number;
  /** Who holds each thing now; null once it is gone (dropped, used up, tidied away). */
  holds: Record<string, string | null>;
  /** Who has each thing on loan, while its holder still holds it. */
  lent: Record<string, string[]>;
  /** Holders that can no longer be used, or are out of it. */
  off: string[];
  /** What happens, in the picture and for real. One sentence each. */
  a: string;
  r: string;
};

export type Scene = {
  title: string;
  /** Where the picture is set ("a playroom"). */
  place: string;
  actors: SceneActor[];
  things: SceneThing[];
  /** The picture's words and what each stands for. */
  map: { a: string; r: string }[];
  /** The real side, a line at a time: code, or (when `plain`) the real steps in the subject's own words. */
  code: string;
  language: CodeLanguage;
  /** A subject without code: the real side is words, not a program. */
  plain?: boolean;
  steps: SceneStep[];
  /** The one-line takeaway. */
  rule: string;
  /** Where the picture stops being true. */
  breaks: string;
};

/** What the page draws for one step: each holder with what it holds and what it has on loan, and what is gone. */
export type SceneView = {
  actors: (SceneActor & { off: boolean; holds: SceneThing[]; lent: SceneThing[] })[];
  gone: SceneThing[];
};

export function sceneView(scene: Scene, index: number): SceneView {
  const step = scene.steps[Math.max(0, Math.min(scene.steps.length - 1, index))];
  return {
    actors: scene.actors.map((actor) => ({
      ...actor,
      off: step.off.includes(actor.id),
      holds: scene.things.filter((t) => step.holds[t.id] === actor.id),
      lent: scene.things.filter((t) => (step.lent[t.id] ?? []).includes(actor.id)),
    })),
    gone: scene.things.filter((t) => step.holds[t.id] === null),
  };
}

const LANGS: CodeLanguage[] = ["python", "javascript", "typescript", "sql", "rust"];

/** The lesson's programming language, or null for a subject taught without code. */
export function sceneLanguage(lesson: Lesson): CodeLanguage | null {
  const coded = lesson.boards.find((b) => b.kind === "code") ?? lesson.boards.find((b) => b.example);
  return coded ? (coded.kind === "code" ? (coded.language ?? "python") : (coded.example?.language ?? "python")) : null;
}

export function scenePrompt(lesson: Lesson, boardIndex: number, profile: Profile): string {
  const board = lesson.boards[boardIndex];
  const language = sceneLanguage(lesson);
  const real = language ? `the real ${language} code` : "the real thing, in this subject's own terms,";
  return `${PERSONA}

${student(profile)}

You are teaching "${lesson.title}" (course: ${lesson.course}). The student is on the board "${plain(board.title)}":
${board.lines.map((l) => `- ${plain(l.w)}`).join("\n")}
The board's analogy: ${plain(board.analogy ?? "")}
${board.example ? `The board's runnable example (${board.example.name}):\n\`\`\`${board.example.language}\n${board.example.code.slice(0, 2500)}\n\`\`\`\n` : ""}
Turn this analogy into a small scene the student watches step by step, with the everyday picture on the left and ${real} on the right. The two sides are drawn from the same data, so they always agree. A student should understand the idea from the scene alone.

A scene has:
- "actors": 2 to 4 holders. Each has an everyday name in the picture ("a": a child's name such as Emily or Jack, a cloakroom, a friend) and its real name ("r": ${language ? "a variable or a function, such as s1 or print_greeting" : "the real person, group, place, organ, account or quantity it stands for, such as Austria-Hungary, the left ventricle or the buyer"}).
- "things": 1 to 3 things that are held or passed on. Each has an everyday name ("a": the toy, the coat ticket, the place in the queue) and its real name ("r": ${language ? 'the value, such as "hello" on the heap' : "what really moves or changes hands, such as the blood, the promise to defend, the £10 or the turn to be served"}).
- "code": ${language ? `the real code, 3 to 8 short lines of ${language}, one statement per line, with nothing the scene does not show. It may include a line that does not compile when the lesson is about that error: say so in a comment on that line.` : "the real steps, 3 to 8 short lines in this subject's own words, one event or step per line in the order it happens, with nothing the scene does not show. Plain statements of fact, not code and not the analogy."}
- "steps": 3 to 6 steps. Each names the "line" of ${language ? "the code" : "those real steps"} it is about (1 is the first line), and gives the whole state after it:
  "holds": for every thing, the id of the actor that holds it now, or null once it is gone for good (${language ? "dropped, freed" : "used up, lost, ended"}, tidied away);
  "lent": for a thing on loan, the ids of the actors borrowing it while its holder still holds it (leave out when nothing is lent);
  "off": the ids of actors that can no longer act (${language ? "a moved-from variable" : "one that has left, been defeated or finished its part"}, a child who has gone home);
  "a": what happens in the picture, and "r": what happens for real: one short sentence each, plain words, no markup.
- "map": 3 to 5 pairs, the picture's word ("a") and what it stands for ("r"): ${language ? "toy = value, child = variable, handing over = move" : "the queue = the order of arrival, the front of the queue = first in, being served = first out"}.
- "rule": the one thing to remember, in one sentence.
- "breaks": one sentence on where the picture stops being true, so the student does not carry it too far.

Rules for a good scene:
- Everyday objects a ten-year-old knows. Keep the board's own picture; do not swap it for another.
- One idea only: the idea of this board. Leave out everything else.
- Check every step against ${language ? "the code as the compiler would: who owns each value after that line, what is borrowed, what can no longer be used" : "the facts of the subject: who has what after that step, and what has ended"}. If the picture and the real side disagree at any step, fix the picture.
- Names are short: every "a" and "r" of an actor or a thing is at most three words (Emily, the storybook, ${language ? 's1, the text "hello"' : "the heart, the treaty"}). What it is goes in the map, not in the name.
- Ids are short lower-case words. Use the same ids in every step.

Reply with only this JSON:
{"title": "the picture in a few words", "place": "where it is set", "actors": [{"id": "emily", "a": "Emily", "r": "${language ? "s1" : "the real name"}"}], "things": [{"id": "toy", "a": "the toy", "r": "${language ? '\\"hello\\" on the heap' : "what it really is"}"}], "code": "line 1\\nline 2", "steps": [{"line": 1, "holds": {"toy": "emily"}, "lent": {}, "off": [], "a": "…", "r": "…"}], "map": [{"a": "…", "r": "…"}], "rule": "…", "breaks": "…"}`;
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");

/** Keep only a scene the page can draw and that is consistent with itself; null otherwise. `language` is null for a subject without code. */
export function cleanScene(raw: unknown, language: CodeLanguage | null): Scene | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const named = (list: unknown, max: number) =>
    (Array.isArray(list) ? (list as Record<string, unknown>[]) : [])
      .map((x) => ({ id: id(x?.id), a: str(x?.a, 60), r: str(x?.r, 60) }))
      .filter((x, i, all) => x.id && x.a && x.r && all.findIndex((y) => y.id === x.id) === i)
      .slice(0, max);
  const actors = named(r.actors, 4);
  const things = named(r.things, 3);
  const code = str(r.code, 1200).replace(/\r\n/g, "\n");
  const lines = code.split("\n").length;
  if (actors.length < 2 || !things.length || !code) return null;
  const isActor = (v: unknown): v is string => typeof v === "string" && actors.some((a) => a.id === v);
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
    steps.push({ ...(Number.isInteger(line) && line >= 1 && line <= lines ? { line } : {}), holds, lent, off: [...new Set((Array.isArray(s.off) ? (s.off as unknown[]) : []).map(id).filter(isActor))], a, r: real });
    if (steps.length === 8) break;
  }
  if (steps.length < 2) return null;
  const map = (Array.isArray(r.map) ? (r.map as Record<string, unknown>[]) : []).map((m) => ({ a: str(m?.a, 60), r: str(m?.r, 80) })).filter((m) => m.a && m.r).slice(0, 6);
  const lang = LANGS.find((l) => l === str(r.language).toLowerCase()) ?? language ?? "python";
  return { title: str(r.title, 80) || "The picture", place: str(r.place, 60), actors, things, map, code, language: lang, ...(language ? {} : { plain: true }), steps, rule: str(r.rule), breaks: str(r.breaks) };
}
