/**
 * "Watch it happen" (docs/LEARNING.md, "Use analogy"): the professor turns a
 * board's analogy into a scene, the everyday picture and the real thing
 * stepped through together. What a scene is, and what is kept of the
 * professor's reply, is in src/lib/scene/model.ts (shared with the Explore
 * guide and the MCP server, whose answers can carry a scene too); this file
 * is what the professor is asked.
 *
 * The professor writes a scene for a board when the student first asks to
 * watch it; it is then kept with the lesson. AnalogyScene.tsx draws it.
 */
import { plain } from "./markup";
import { PERSONA, student } from "./professor";
import { KINDS_GUIDE } from "../../lib/scene/kinds";
import { sceneGrounding } from "./codebaseAsk";
import type { CodeLanguage, Lesson, Profile } from "./types";
import { NOTHING_USED, pickNames, varietyNote, type Used } from "./worlds";

export { cleanScene, placeOf, sceneEvents, sceneView, sceneWords } from "../../lib/scene/model";
export type { Pair, Scene, SceneActor, SceneEvent, SceneStep, SceneThing, SceneView, SceneWord } from "../../lib/scene/model";

/** The lesson's programming language, or null for a subject taught without code. */
export function sceneLanguage(lesson: Lesson): CodeLanguage | null {
  const coded = lesson.boards.find((b) => b.kind === "code") ?? lesson.boards.find((b) => b.example);
  return coded ? (coded.kind === "code" ? (coded.language ?? "python") : (coded.example?.language ?? "python")) : null;
}

/**
 * What the professor is asked for. `drawings` is the names it may pick from (drawingNames()); `picture` is the student's
 * own picture, when they asked for one; `used` is what the course's other lessons pictured (usedPictures), not to repeat.
 */
export function scenePrompt(lesson: Lesson, boardIndex: number, profile: Profile, drawings = "", picture = "", used: Used = NOTHING_USED): string {
  const board = lesson.boards[boardIndex];
  const language = sceneLanguage(lesson);
  const real = language ? `the real ${language} code` : "the real thing, in this subject's own terms,";
  const seed = `${lesson.id}:${boardIndex}`;
  const [name] = pickNames(seed, 1, used.names);
  return `${PERSONA}

${student(profile)}

You are teaching "${lesson.title}" (course: ${lesson.course}). The student is on the board "${plain(board.title)}":
${board.lines.map((l) => `- ${plain(l.w)}`).join("\n")}
The board's analogy: ${plain(board.analogy ?? "")}
${sceneGrounding(lesson)}${picture ? `The student asked for their own picture instead: "${picture.slice(0, 200)}". Build the scene in that picture.
` : ""}${board.example ? `The board's runnable example (${board.example.name}):\n\`\`\`${board.example.language}\n${board.example.code.slice(0, 2500)}\n\`\`\`\n` : ""}
Turn this analogy into a small scene the student watches step by step, with the everyday picture on the left and ${real} on the right. The two sides are drawn from the same data, so they always agree. A student should understand the idea from the scene alone.

First choose the kind of scene that fits the board's idea (when the student asked for a diagram by name, such as a flowchart, a state machine, a UML class or ER diagram, a mind map or a sequence diagram, use that):
- a hand-over (the usual one): someone holds, passes, lends, refuses or loses something (ownership and borrowing, money changing hands, a checker refusing);
- a timeline: when, and for how long (a lifetime or scope, eras, a deadline running out);
- a flow: what happens in order, maybe round again (a cycle, a pipeline, a journey through stops);
- containers: what is inside, on top, or first out (a stack, a queue, layers);
- compare: which is bigger, or what changed (two growth rates, before and after);
- graph: a process with decisions, the states something moves through, a model of classes or tables, or a map of ideas;
- sequence: who says what to whom, in order (a handshake, a request through services).

A hand-over is described here; every other kind after it.

A hand-over scene has:
- "actors": 2 to 4 holders. Each has an everyday name in the picture ("a": a person's first name, a place, a friend) and its real name ("r": ${language ? "a variable or a function, such as s1 or print_greeting" : "the real person, group, place, organ, account or quantity it stands for, such as Austria-Hungary, the left ventricle or the buyer"}).
- "things": 1 to 3 things that are held or passed on. Each has an everyday name ("a": what is held in the picture, such as the parcel or the place in the queue) and its real name ("r": ${language ? 'the value, such as "hello" on the heap' : "what really moves or changes hands, such as the blood, the promise to defend, the £10 or the turn to be served"}).
- "code": ${language ? `the real code, 3 to 8 short lines of ${language}, one statement per line, with nothing the scene does not show. It may include a line that does not compile when the lesson is about that error: say so in a comment on that line.` : "the real steps, 3 to 8 short lines in this subject's own words, one event or step per line in the order it happens, with nothing the scene does not show. Plain statements of fact, not code and not the analogy."}
- "steps": 3 to 6 steps. Each names the "line" of ${language ? "the code" : "those real steps"} it is about (1 is the first line), and gives the whole state after it:
  "holds": for every thing, the id of the actor that holds it now, or null once it is gone for good (${language ? "dropped, freed" : "used up, lost, ended"}, tidied away);
  "lent": for a thing on loan, the ids of the actors borrowing it while its holder still holds it (leave out when nothing is lent);
  "off": the ids of actors that can no longer act (${language ? "a moved-from variable" : "one that has left, been defeated or finished its part"}, a child who has gone home);
  "a": what happens in the picture, and "r": what happens for real: one short sentence each, plain words, no markup.
- "map": 3 to 6 pairs, the picture's word ("a") and what it stands for ("r"): ${language ? "what is held = value, who holds it = variable, handing over = move" : "the queue = the order of arrival, the front of the queue = first in, being served = first out"}. Include every technical term the scene uses, so each is explained by the picture. Give each a "why": what it means, in a few plain words.
- A step that teaches one of those words names it with "word": its place in "map" (0 is the first). A step may also give "verb": the two words for what it does to a thing ({"a": "gives away", "r": "move"}), "made": the two words for a thing first appearing ({"a": "brings", "r": ${language ? '"String::from"' : '"signs"'}}), and "note": something a holder does that moves nothing ({"who": an actor's id, "a": "shows it round", "r": ${language ? '"println! reads r"' : '"reads it out"'}}). Two or three words each.
- "loan": the two words for lending ({"a": "lends", "r": ${language ? '"&s1"' : '"shares"'}}), when something is lent.
- "bin": where things go when they are gone, in the picture and for real ({"a": "where it ends up in the picture", "r": ${language ? '"freed memory"' : '"the archive"'}}).
- "watcher": only when someone checks the rules: who it is in the picture and for real ({"a": "the teacher", "r": ${language ? '"the compiler"' : '"the referee"'}}). The step where a rule is broken then carries "stop": {"who": the actor's id, "a": what the watcher says ("Stop! ${name} gave it away."), "r": ${language ? 'the real error ("error[E0382]")' : "what really happens"}}.${
    drawings
      ? `
- Every actor and thing is drawn. Give each an "ia" (its drawing in the picture) and an "ir" (its drawing for real), and the watcher and the bin too, each a name from this list and nothing else: ${drawings}. Choose the picture so that its holders and things are on the list. A thing may take a "tint" to tell it from another: yellow, blue, green, pink, purple, orange, brown or grey.
- Only when nothing on the list fits a holder or a thing in the picture, leave out its "ia" and draw it yourself with "draw": at most 12 plain shapes on a 64 by 64 square (0, 0 is the top left corner), listed back to front, big and simple enough for a child to know at a glance. Each is one of {"s": "circle", "x": 32, "y": 30, "r": 14}, {"s": "rect", "x": 10, "y": 20, "w": 44, "h": 30}, {"s": "ellipse", "x": 32, "y": 40, "rx": 20, "ry": 10}, {"s": "line", "x1": 10, "y1": 50, "x2": 54, "y2": 50} or {"s": "poly", "p": [32, 8, 54, 50, 10, 50]} (its corners in order), and each has "c", its colour: t (the thing's own tint), dark, light, white, grey, ink, yellow, pink, red, blue, green, purple, orange, brown, sky, cream or skin.`
      : ""
  }
- "rule": the one thing to remember, in one sentence.
- "breaks": one sentence on where the picture stops being true, so the student does not carry it too far.

The other kinds, when one fits better:
${KINDS_GUIDE}

Rules for a good scene, of any kind:
- Everyday objects a ten-year-old knows. ${picture ? "Use the student's picture, made concrete: real people and things they could touch." : "Keep the board's own picture; do not swap it for another."}
${varietyNote(seed, used, "scene")}
- One idea only: the idea of this board. Leave out everything else.
- Check every step against ${language ? "the code as the compiler would: who owns each value after that line, what is borrowed, what can no longer be used" : "the facts of the subject: who has what after that step, and what has ended"}. If the picture and the real side disagree at any step, fix the picture.
- Names are short: every "a" and "r" of an actor or a thing is at most three words (${name}, the parcel, ${language ? 's1, the text "hello"' : "the heart, the treaty"}). What it is goes in the map, not in the name.
- Ids are short lower-case words. Use the same ids in every step.

Reply with only the JSON. Another kind is its own JSON, as described, with its "kind". A hand-over is this:
{"title": "the picture in a few words", "place": "where it is set", "actors": [{"id": "${name.toLowerCase()}", "a": "${name}", "r": "${language ? "s1" : "the real name"}"}], "things": [{"id": "thing", "a": "what is held", "r": "${language ? '\\"hello\\" on the heap' : "what it really is"}"}], "code": "line 1\\nline 2", "steps": [{"line": 1, "holds": {"thing": "${name.toLowerCase()}"}, "lent": {}, "off": [], "a": "…", "r": "…", "word": 0, "verb": {"a": "…", "r": "…"}}], "map": [{"a": "…", "r": "…", "why": "…"}], "rule": "…", "breaks": "…"}`;
}
