/**
 * What the professor asks Claude. Every call is memory-less, so each prompt
 * carries the persona, the student, the lesson so far and the exact output
 * shape it needs.
 */
import type { Sample, SampleOptions } from "./claude";
import { plain } from "./markup";
import { lessonMaterial, type FolderLesson } from "./courseFolder";
import type { Board, Course, Feedback, Lesson, Profile, QuizItem, RoadmapStage } from "./types";

export const PERSONA = `You are the Professor: 40 years teaching at university level, famous for making hard ideas feel simple.
How you teach:
- Very simple, basic English. Short sentences. One idea at a time. British spelling.
- Every new term is explained the moment it appears, with an everyday example (shops, buses, cooking, football, phones).
- Examples and analogies are set in the United Kingdom: British first names (Emily, Jack, Olivia, Harry), pounds and pence, miles, a queue at a bus stop, a London bus, the corner shop, the NHS, a cup of tea, the school run. Never another country's names, money or places, unless the lesson itself is about them.
- Build from what the student already knows. Never show off. Be warm and encouraging, but honest.
- Numbers, formulas and code only when they help, and always explained in words too.
- The picture comes before the rule: an everyday analogy a child would understand, then the precise idea, so the picture sticks and the detail hangs on it.`;

/** What makes an analogy teach (docs/LEARNING.md, "Use analogy"). The Rust course's ownership lesson is the bar. */
export const ANALOGY_RULES = `A good analogy, every time:
  - Concrete everyday things a ten-year-old has touched: toys, a coat and its cloakroom ticket, a library book, plates, a football. Never another technical idea.
  - One idea per analogy. If the board has two ideas, the analogy is about the main one.
  - It says what stands for what, in the sentence itself: the toy is the value, the child is the variable, handing it over is the move.
  - It is true to the code: check it against what the code or the compiler really does, and change the picture if they disagree.
  - It does not overreach: when the picture would mislead if carried further, the words you say aloud name where it stops.`;

/** When a board gets a diagram, and what it must show. */
export const DIAGRAM_RULES = `A diagram is for a concept with structure, flow or ownership (a move, a borrow, stack and heap, a call, a state that changes, parts that connect), never for decoration and never for plain syntax or naming. When a board has both an analogy and a diagram, the diagram backs the analogy: each box's first line is the real name and its second line (after <br/>) is the analogy's word for it, such as "s1<br/>Emily" and "the text hello<br/>the toy", so one picture shows the everyday scene and the real mechanism together. It must match the code on the board exactly.`;

/** How a lesson is built (docs/LEARNING.md): the picture first, then the rule, then the student tries it. */
export const TEACHING = `- Every talk board carries an "analogy": one everyday picture a ten-year-old would understand (toys, plates, a cloakroom, a library book, a football team), in one to three plain sentences, no markup. The first board gives one big picture for the whole lesson; later boards extend that same picture wherever they can, and use a new one only when it does not fit. The last talk board's analogy is the whole lesson in one sentence for a child.
- ${ANALOGY_RULES}
- ${DIAGRAM_RULES}
- Connect ideas: when a board builds on an earlier board or an earlier lesson, say so in what you say aloud.
- Also write "cards": 5 to 8 recall cards for this lesson, each a short question ("q") and its answer in one sentence ("a"), testing the ideas, not the wording. A card whose answer is a picture may also carry "diagram": Mermaid source under the same rules as a board's.`;

export const student = (p: Profile) =>
  `The student${p.name ? `, ${p.name}` : ""}: ${p.about || "a curious beginner."}`;

export const MARKUP_GUIDE = `Board writing ("w") uses this tiny chalk markup and nothing else (no HTML, no Markdown headings or lists):
**key term** (yellow chalk), \`code\` (in a dashed box), [[boxed phrase]], {pink:text} {blue:text} {green:text} for coloured chalk,
and maths in LaTeX: $a^2 + b^2 = c^2$ inline, or $$\\frac{dy}{dx} = 2x$$ as a line of its own. Use LaTeX for real maths (fractions, powers, roots, sums, Greek letters, matrices); keep each formula short.`;

const CODE_ENV = `The student's editor runs: Python; JavaScript and TypeScript (in the page: console.log prints, console.table shows a table; no DOM, no npm packages, no network); SQL (SQLite in the page: create the tables and insert the rows in the starter, then query them; SELECT results show as tables); and Rust (compiled on the student's laptop with plain rustc: one file with fn main(), the standard library only, no crates). ${"\n"}Python details: `;
const PYTHON_ENV = "The student runs code either on their laptop (full Python 3 with numpy, pandas, scipy, scikit-learn and matplotlib; plots are shown automatically) or in the page (MicroPython: plain Python plus ulab, a small numpy imported as `from ulab import numpy as np`; no pandas, scikit-learn or plots). There is no input() and no internet, so data is made up in the code or loaded from sklearn.datasets built-ins such as load_iris. Prefer plain Python when it teaches the idea; if the exercise needs pandas, scikit-learn or plots, say in the task that it runs on the laptop.";

export type LessonRequest = {
  topic: string;
  course: string;
  level: string;
  boards: number;
  notes: string;
  /** The roadmap module this lesson teaches, and the whole roadmap for context. */
  module?: { stage: string; title: string; summary: string; topics: string[] };
  roadmap?: Course;
};

const roadmapOutline = (c: Course) =>
  c.stages.map((s, i) => `Stage ${i + 1}, ${s.title}: ${s.modules.map((m) => m.title).join("; ")}`).join("\n");

const previousLessons = (earlier: Lesson[]) =>
  earlier.length
    ? `Lessons already taught in this course, in order (build on them, do not repeat them):\n` +
      earlier
        .map(
          (l) =>
            `${l.number}. ${l.title}: ${l.summary}` +
            (l.feedback ? ` Explain-back score ${l.feedback.score}/10; still to fix: ${l.feedback.fix.join("; ") || "nothing"}.` : ""),
        )
        .join("\n")
    : "This is the first lesson of the course.";

export function lessonPrompt(req: LessonRequest, profile: Profile, earlier: Lesson[]) {
  return `${PERSONA}

${student(profile)}

Course: ${req.course}
${previousLessons(earlier)}

${req.roadmap ? `The course's road to mastery (goal: ${req.roadmap.goal}):\n${roadmapOutline(req.roadmap)}\n` : ""}${req.module ? `This lesson teaches the module "${req.module.title}" (${req.module.stage}): ${req.module.summary} Topics to cover: ${req.module.topics.join("; ")}. Stay within this module; later modules come later.\n` : ""}
Write the next lesson, on: ${req.topic}
Level: ${req.level}.${req.notes ? `\nThe student asks: ${req.notes}` : ""}

The lesson is taught on a chalkboard, one board at a time. On each board you write short lines in chalk, and you say one to three sentences aloud as you write each line.

${MARKUP_GUIDE}

Rules:
- ${req.boards} boards in total. Boards 1 to ${req.boards - 2} are "talk" boards: 3 to 5 lines each. The first board says what we will learn today and why it matters; the last talk board is a summary.
- Board ${req.boards - 1} is a "quiz" board: one line introducing it, and 3 multiple-choice questions, 3 or 4 options each, testing understanding (not memory), each with a one-sentence "why".
- Board ${req.boards} is an "explain" board: one line, and 3 or 4 "questions" the student answers in their own words.
- Each "w" line is at most 90 characters. Each "s" is what you say aloud: natural spoken English, no markup, no symbols read badly aloud (say "times", not "×").
- A line may carry a small "table" ({"head": [...], "rows": [[...]]}) when a table truly helps, at most 6 rows.
- A line may carry a "diagram": Mermaid source, when a picture explains better than words (how parts connect, a process, a sequence of messages, states, a data model, a hierarchy). Use flowchart LR/TD, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram or mindmap. At most 12 nodes, short plain labels (no styling, no colours, no click; a box may have a short second line after <br/>), a title first (---, title: what it shows, ---), and newlines written as \\n in the JSON string. At most one diagram per board.
- Use one worked example that runs through the lesson.
${TEACHING}
- If the topic can be practised in code (programming, software engineering, data, databases, statistics, machine learning, maths that can be computed), make exactly one talk board just before the quiz a "code" board instead: one line introducing it, a "language" (python, javascript, typescript, sql or rust: the one this course is about, else python), a "task" in plain words (what to write and what they should see), "starter" code in that language with helpful comments and one or two clearly marked TODOs for the student, and "expect": what a correct run roughly prints. ${CODE_ENV}${PYTHON_ENV} Otherwise, no code board.

Reply with only this JSON:
{"title": "…", "summary": "two sentences: what the student can now do", "cards": [{"q": "…", "a": "…"}], "boards": [
 {"title": "…", "kind": "talk", "analogy": "…", "lines": [{"w": "…", "s": "…"}]},
 {"title": "…", "kind": "code", "lines": [{"w": "…", "s": "…"}], "language": "python", "task": "…", "starter": "…", "expect": "…"},  (only when the topic suits code)
 {"title": "…", "kind": "quiz", "lines": [{"w": "…", "s": "…"}], "quiz": [{"q": "…", "options": ["…", "…", "…"], "answer": 0, "why": "…"}]},
 {"title": "Explain it back", "kind": "explain", "lines": [{"w": "…", "s": "…"}], "questions": ["…"]}
]}`;
}

/** Keep only what the board can show; drop anything malformed. */
export type WrittenBoard = Board & { exampleName?: string };

export function cleanBoards(raw: unknown): { title: string; summary: string; boards: WrittenBoard[]; cards: unknown } | null {
  const r = raw as { title?: unknown; summary?: unknown; boards?: unknown; cards?: unknown };
  if (!r || typeof r.title !== "string" || !Array.isArray(r.boards)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const boards: WrittenBoard[] = [];
  for (const b of r.boards as Record<string, unknown>[]) {
    if (!b || typeof b !== "object") continue;
    const kind = b.kind === "quiz" || b.kind === "explain" || b.kind === "code" ? b.kind : "talk";
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .map((l: Record<string, unknown>) => {
        const t = l?.table as { head?: unknown; rows?: unknown } | undefined;
        const table =
          t && Array.isArray(t.head) && Array.isArray(t.rows)
            ? { head: t.head.map(String).slice(0, 6), rows: (t.rows as unknown[][]).slice(0, 8).map((row) => (Array.isArray(row) ? row.map(String).slice(0, 6) : [])) }
            : undefined;
        const diagram = typeof l?.diagram === "string" && l.diagram.trim() ? l.diagram.trim().slice(0, 3000) : undefined;
        return { w: str(l?.w), s: str(l?.s) || plain(str(l?.w)), ...(table ? { table } : {}), ...(diagram ? { diagram } : {}) };
      })
      .filter((l) => l.w || l.table || l.diagram);
    const quiz: QuizItem[] | undefined =
      kind === "quiz" && Array.isArray(b.quiz)
        ? (b.quiz as Record<string, unknown>[])
            .map((q) => ({
              q: str(q?.q),
              options: Array.isArray(q?.options) ? (q.options as unknown[]).map(String).slice(0, 5) : [],
              answer: Number(q?.answer) || 0,
              why: str(q?.why),
            }))
            .filter((q) => q.q && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)
        : undefined;
    const questions = kind === "explain" && Array.isArray(b.questions) ? (b.questions as unknown[]).map(String).filter(Boolean) : undefined;
    const langs = ["python", "javascript", "typescript", "sql", "rust"] as const;
    const language = langs.find((x) => x === str(b.language).toLowerCase());
    const code = kind === "code" ? { task: str(b.task), starter: str(b.starter), expect: str(b.expect), ...(language && language !== "python" ? { language } : {}) } : undefined;
    if (kind === "code" && (!code?.task || !code.starter)) continue;
    if (kind === "quiz" && !quiz?.length) continue;
    if (kind === "explain" && !questions?.length) continue;
    if (!lines.length && kind === "talk") continue;
    const analogy = kind === "talk" ? str(b.analogy).trim().slice(0, 600) : "";
    const exampleName = kind === "talk" ? str(b.example).trim().slice(0, 120) : "";
    boards.push({ title: str(b.title) || "…", kind, lines: lines.length ? lines : [{ w: "", s: "" }], ...(analogy ? { analogy } : {}), ...(exampleName ? { exampleName } : {}), ...(quiz ? { quiz } : {}), ...(questions ? { questions } : {}), ...(code ?? {}) });
  }
  if (boards.length < 2) return null;
  return { title: r.title, summary: str(r.summary), boards, cards: r.cards };
}

/** How many talk boards a folder's lesson gets: one per README section, within what one reply can hold. */
export const folderTalkBoards = (l: FolderLesson) => Math.max(4, Math.min(10, l.sections.length || l.checklist.length + 2));

/**
 * A lesson taught from a course folder (src/learn/lib/courseFolder.ts): the
 * author's README, analogies and examples are the material, in their order.
 * The exercises are not written here: they are the folder's own files, added
 * as code boards after the talk boards (folderBoards).
 */
export function folderLessonPrompt(l: FolderLesson, course: string, profile: Profile, earlier: Lesson[]) {
  const talks = folderTalkBoards(l);
  const thin = l.readme.length < 1500;
  const language = l.examples[0]?.language ?? l.exercises[0]?.language ?? "rust";
  return `${PERSONA}

${student(profile)}

Course: ${course}. It is taught from its author's own lesson folders; you are teaching the lesson "${l.title}"${l.unit ? ` (unit: ${l.unit})` : ""}.
${previousLessons(earlier)}

Everything the author wrote for this lesson is below. ${thin ? "The author has so far only listed what the lesson must cover: teach exactly those sections, fully, in the same style as the rest of the course (one big everyday picture first, an analogy for every concept, real code and real compiler errors)." : "Teach it faithfully: the same ideas, in the same order, with the author's own analogies, examples and error messages. Do not add topics the author left out, and do not skip a section."}

${lessonMaterial(l)}

---

The lesson is taught on a chalkboard, one board at a time. On each board you write short lines in chalk, and you say one to three sentences aloud as you write each line.

${MARKUP_GUIDE}

Rules:
- ${talks} "talk" boards, 3 to 5 lines each, following the README's sections in order (join two small sections on one board when needed). The first board says what we will learn and why it matters, with the lesson's big picture; the last talk board is the recap.
- Each "w" line is at most 90 characters; short code goes in \`backticks\`. Each "s" is what you say aloud: natural spoken English, no markup, no symbols read badly aloud.
- Every talk board carries an "analogy": one to three plain sentences, no markup. Where the README has a 💡 analogy for that section, use the author's own picture, in their words, shortened only if long. Where it has none, write one in the same playful picture as the rest. The recap board's analogy is the lesson in one sentence for a child.
- ${ANALOGY_RULES}
- ${DIAGRAM_RULES}
- A line may carry a small "table" ({"head": [...], "rows": [[...]]}, at most 6 rows) or a "diagram" (Mermaid source: flowchart LR/TD, sequenceDiagram or stateDiagram-v2, at most 10 nodes, short plain labels, newlines as \\n) when the README shows a table or a picture there. At most one of each per board.
${l.examples.length ? `- When a board teaches what one of the runnable examples shows, give that board "example": the file's exact name (one of: ${l.examples.map((e) => e.name).join(", ")}). The student runs it from the board. Use each example at most once, and as many of them as fit.` : `- Show code in ${language} on the board itself where it teaches the idea.`}
- After the talk boards: one "quiz" board (one line introducing it, and 3 multiple-choice questions of 3 or 4 options testing understanding, each with a one-sentence "why"), then one "explain" board (one line, and 3 "questions" the student answers in their own words).${l.exercises.length ? ` Do not write exercises: the course's own ${l.exercises.length} come between your talk boards and the quiz.` : ""}
- Also write "cards": 5 to 8 recall cards, each a short question ("q") and its one-sentence answer ("a"), testing the ideas, not the wording. A card whose answer is a picture may also carry "diagram": Mermaid source under the same rules as a board's.

Reply with only this JSON:
{"title": ${JSON.stringify(l.title)}, "summary": "two sentences: what the student can now do", "cards": [{"q": "…", "a": "…"}], "boards": [
 {"title": "…", "kind": "talk", "analogy": "…", "example": "a file name from the list, or leave the key out", "lines": [{"w": "…", "s": "…"}]},
 {"title": "…", "kind": "quiz", "lines": [{"w": "…", "s": "…"}], "quiz": [{"q": "…", "options": ["…", "…", "…"], "answer": 0, "why": "…"}]},
 {"title": "Explain it back", "kind": "explain", "lines": [{"w": "…", "s": "…"}], "questions": ["…"]}
]}`;
}

/**
 * The finished lesson from what the professor wrote and what the folder holds:
 * each board's named example becomes code to run, and the folder's exercises
 * go in as code boards between the talk boards and the quiz.
 */
export function folderBoards(written: WrittenBoard[], l: FolderLesson, exercises: Board[]): Board[] {
  const used = new Set<string>();
  const withExamples: Board[] = written.map(({ exampleName, ...b }) => {
    const want = (exampleName ?? "").toLowerCase().replace(/^examples\//, "");
    const ex = want ? l.examples.find((e) => !used.has(e.name) && (e.name.toLowerCase() === want || e.name.toLowerCase().replace(/\.[a-z]+$/, "") === want)) : undefined;
    if (!ex) return b;
    used.add(ex.name);
    return { ...b, example: { name: ex.name, code: ex.code, language: ex.language } };
  });
  const at = withExamples.findIndex((b) => b.kind === "quiz" || b.kind === "explain");
  return at < 0 ? [...withExamples, ...exercises] : [...withExamples.slice(0, at), ...exercises, ...withExamples.slice(at)];
}

/* ── A folder's lesson written in small steps, for a provider that will not take it whole ──
   (a free plan's tokens-per-minute limit). One request per part of the README, each with only
   that part's text and a short reply, then one for the quiz, the explain-back and the cards.
   The examples' code is never sent: a board names its example file, and the page attaches it. */

export type ReadmePart = { heading: string; text: string };

/** The README cut at its ## sections into parts of at most `max` characters, small sections joined, at most `most` parts. */
export function readmeParts(readme: string, max = 3200, most = 8): ReadmePart[] {
  const sections: ReadmePart[] = [];
  let fence = false;
  for (const line of readme.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && /^##\s+(.*)$/.exec(line);
    if (h || !sections.length) sections.push({ heading: h ? h[1].replace(/[*_`]/g, "").trim() : "Introduction", text: "" });
    sections[sections.length - 1].text += `${line}\n`;
  }
  const parts: ReadmePart[] = [];
  for (const s of sections) {
    if (!s.text.trim()) continue;
    const last = parts.at(-1);
    if (last && last.text.length + s.text.length <= max) {
      last.text += s.text;
      last.heading = `${last.heading}; ${s.heading}`;
    } else parts.push({ heading: s.heading, text: s.text.length > max ? `${s.text.slice(0, max)}\n… (cut)` : s.text });
  }
  // Too many parts: the smallest neighbours are joined (and cut) until they fit.
  while (parts.length > most) {
    let at = 0;
    for (let i = 1; i < parts.length - 1; i++) if (parts[i].text.length + parts[i + 1].text.length < parts[at].text.length + parts[at + 1].text.length) at = i;
    const joined = parts[at].text + parts[at + 1].text;
    parts.splice(at, 2, { heading: `${parts[at].heading}; ${parts[at + 1].heading}`, text: joined.length > max ? `${joined.slice(0, max)}\n… (cut)` : joined });
  }
  return parts;
}

/** One part of the lesson: one or two talk boards from that part of the README alone. */
export function folderPartPrompt(l: FolderLesson, course: string, profile: Profile, part: ReadmePart, index: number, count: number, before: { title: string; analogy?: string }[]) {
  const first = index === 0;
  const last = index === count - 1;
  return `${PERSONA}

${student(profile)}

Course: ${course}, taught from its author's own lesson folders. Lesson: "${l.title}". You are writing it part by part; this is part ${index + 1} of ${count}.
${before.length ? `Boards already written: ${before.map((b) => `"${b.title}"`).join("; ")}.\nThe lesson's picture so far: ${before.map((b) => b.analogy).filter(Boolean).slice(-2).join(" ") || "none yet"}` : "This is the first part: it opens the lesson."}

This part of the author's README:
"""
${part.text.trim()}
"""

Write ${part.text.length > 1800 ? "two" : "one or two"} chalkboard "talk" boards teaching exactly this part, faithfully and in its order. Each board: a short "title", 3 to 5 "lines" ("w": what is written in chalk, at most 90 characters; "s": what you say aloud, one to three natural sentences, no markup), and an "analogy" of one to three plain sentences. ${first ? "The first board says what we will learn and why, with the lesson's big picture as its analogy. " : ""}${last ? "The last board is the recap; its analogy is the whole lesson in one sentence for a child. " : ""}Where this part has a 💡 analogy, use the author's own picture in their words; else extend the lesson's picture so far.
${ANALOGY_RULES}
${MARKUP_GUIDE}
${l.examples.length ? `A board may name one runnable example it teaches, as "example": one of ${l.examples.map((e) => e.name).join(", ")}. Do so when a file's name matches what this part teaches (the student runs it from the board); leave it out otherwise.` : ""}

Reply with only this JSON:
{"boards": [{"title": "…", "kind": "talk", "analogy": "…", "lines": [{"w": "…", "s": "…"}]}]}`;
}

/** The lesson's close: the quiz, the explain-back, the recall cards and the summary, from the boards just written. */
export function folderEndPrompt(l: FolderLesson, course: string, profile: Profile, boards: Board[]) {
  return `${PERSONA}

${student(profile)}

You have just taught the lesson "${l.title}" (course: ${course}) on these boards:
${boards.map((b, i) => `${i + 1}. "${plain(b.title)}": ${b.lines.map((x) => plain(x.w)).join(" / ")}`).join("\n")}

Write its close. Reply with only this JSON:
{"summary": "two sentences: what the student can now do",
 "quiz": [{"q": "…", "options": ["…", "…", "…"], "answer": 0, "why": "one sentence"}],
 "questions": ["…"],
 "cards": [{"q": "…", "a": "…"}]}
- "quiz": 3 multiple-choice questions of 3 or 4 options, testing understanding of these boards, not memory.
- "questions": 3 questions the student answers in their own words (the explain-back).
- "cards": 5 to 8 recall cards, a short question and its one-sentence answer, testing the ideas, not the wording.
${MARKUP_GUIDE}`;
}

/** Room for one step's reply: two boards are about 900 tokens; the rest is for a model that thinks first. */
export const STEP_OUTPUT = 3000;

export type StepProgress = { step: number; steps: number; boards: number; waiting?: number };

/**
 * Write a folder's lesson in steps. A step refused for the provider's per-minute limit is tried again
 * after a pause (told through `onProgress` as `waiting` seconds), a few times, before giving up.
 */
export async function writeFolderLessonInSteps(
  sample: Sample,
  l: FolderLesson,
  course: string,
  profile: Profile,
  onProgress: (p: StepProgress) => void,
  signal: AbortSignal,
  o: { pause?: (ms: number) => Promise<void>; waits?: number[] } = {},
) {
  const pause = o.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waits = o.waits ?? [20, 35, 60];
  const parts = readmeParts(l.readme.trim() ? l.readme : `# ${l.title}\n\n${l.checklist.map((c) => `- ${c}`).join("\n")}`);
  const steps = parts.length + 1;
  const boards: Record<string, unknown>[] = [];
  const ask = async (prompt: string, step: number, maxOutput: number): Promise<Record<string, unknown>> => {
    let cutShort = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return (await sample.json<Record<string, unknown>>(prompt, { signal, cache: false, maxOutput: cutShort ? maxOutput * 2 : maxOutput })) ?? {};
      } catch (e) {
        const code = (e as { code?: string })?.code;
        // A reply cut short (a model that thinks first can use the room up): once more, with twice the room.
        if (code === "invalid_json" && !cutShort && !signal.aborted) {
          cutShort = true;
          continue;
        }
        if (code !== "rate_limited" || attempt >= waits.length || signal.aborted) throw e;
        onProgress({ step, steps, boards: boards.length, waiting: waits[attempt] });
        await pause(waits[attempt] * 1000);
        if (signal.aborted) throw { code: "cancelled", message: "Stopped." };
      }
    }
  };
  for (let i = 0; i < parts.length; i++) {
    onProgress({ step: i + 1, steps, boards: boards.length });
    const before = boards.map((b) => ({ title: String(b.title ?? ""), analogy: typeof b.analogy === "string" ? b.analogy : undefined }));
    const got = await ask(folderPartPrompt(l, course, profile, parts[i], i, parts.length, before), i + 1, STEP_OUTPUT);
    for (const b of Array.isArray(got.boards) ? (got.boards as Record<string, unknown>[]) : []) if (b && typeof b === "object") boards.push({ ...b, kind: "talk" });
  }
  const talks = cleanBoards({ title: l.title, boards: [...boards, ...boards.slice(0, boards.length < 2 ? 1 : 0)] })?.boards.slice(0, boards.length) ?? [];
  if (!talks.length) return null;
  onProgress({ step: steps, steps, boards: talks.length });
  const end = await ask(folderEndPrompt(l, course, profile, talks), steps, STEP_OUTPUT);
  return cleanBoards({
    title: l.title,
    summary: end.summary,
    cards: end.cards,
    boards: [
      ...boards,
      { title: "Quick quiz", kind: "quiz", lines: [{ w: "Check what stuck: three questions.", s: "Let us check what stuck. Three quick questions." }], quiz: end.quiz },
      { title: "Explain it back", kind: "explain", lines: [{ w: "Now you teach it, in your own words.", s: "Now you teach it back to me, in your own words." }], questions: end.questions },
    ],
  });
}

const boardText = (b: Board) => `"${b.title}": ${b.lines.map((l) => plain(l.w)).join(" / ")}`;

/** A question from the student, asked with a raised hand during the lesson. */
export function handPrompt(lesson: Lesson, boardIndex: number, question: string, profile: Profile) {
  const b = lesson.boards[boardIndex];
  return `${PERSONA}

${student(profile)}

You are in the middle of teaching "${lesson.title}" (${lesson.subject}).
The lesson so far, board by board:
${lesson.boards.slice(0, boardIndex + 1).map((x, i) => `${i + 1}. ${boardText(x)}`).join("\n")}

The student is looking at board ${boardIndex + 1}${b ? ` ("${b.title}")` : ""} and raises a hand:
"${question}"

Answer as you would out loud in the lecture hall: warm, simple, at most 120 words, with a small example if it helps.
Plain spoken English only: no markup, no bullet points, no headings. If the question is off the topic, answer it briefly anyway and bring them back.`;
}

export function gradePrompt(lesson: Lesson, questions: string[], answer: string, profile: Profile) {
  return `${PERSONA}

${student(profile)}

You taught "${lesson.title}". What the lesson covered: ${lesson.summary}
Board by board: ${lesson.boards.filter((b) => b.kind === "talk").map(boardText).join("\n")}

You asked the student to explain it back, in their own words:
${questions.map((q, i) => `${i + 1}. ${plain(q)}`).join("\n")}

Their answer:
"""${answer}"""

Mark it kindly and honestly, judging understanding, not English or style.
Reply with only this JSON:
{"score": 0-10, "verdict": "one or two spoken sentences to the student", "good": ["what they got right"], "fix": ["what is missing or wrong, each with the correct idea in one sentence"], "model": "a model answer in simple words, 3-5 sentences"}`;
}

export function cleanFeedback(raw: unknown): Feedback | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object") return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 6) : []);
  const score = Math.max(0, Math.min(10, Math.round(Number(r.score))));
  if (!Number.isFinite(score)) return null;
  return { score, verdict: String(r.verdict ?? ""), good: list(r.good), fix: list(r.fix), model: String(r.model ?? "") };
}

/** Ask for a lesson, reporting how many boards have been written so far. */
export async function writeLesson(
  sample: Sample,
  prompt: string,
  onProgress: (boards: number) => void,
  signal: AbortSignal,
) {
  const opts: SampleOptions = {
    signal,
    modelTier: "default",
    cache: false,
    onText: ({ text }) => onProgress((text.match(/"kind"\s*:/g) ?? []).length),
  };
  return cleanBoards(await sample.json(prompt, opts));
}

export type CodeContext = { lesson?: Lesson; board?: Board; code: string; output: string; engine?: "page" | "laptop"; language?: string };

const fence = (language?: string) => (language && language !== "text" ? language.replace(/^tsx$/, "typescript").replace(/^jsx$/, "javascript") : "");

const codeBlock = (c: CodeContext) =>
  `${c.lesson ? `We are in the lesson "${c.lesson.title}" (${c.lesson.subject}).
` : ""}` +
  `${c.board?.task ? `The exercise: ${plain(c.board.task)}
${c.board.expect ? `A correct run roughly prints: ${c.board.expect}
` : ""}` : ""}` +
  `${c.board?.solution ? `The course's own solution, for your eyes only (judge against it; never show it, quote it or paste from it; another correct answer is just as good):
\`\`\`${fence(c.language) || "text"}
${c.board.solution.slice(0, 8000)}
\`\`\`
` : ""}` +
  `${c.engine === "page" ? "It ran in the page's MicroPython (plain Python plus ulab; no pandas, scikit-learn or matplotlib).\n" : c.engine === "laptop" ? "It ran in full Python on their laptop.\n" : ""}` +
  `The student's code${c.language ? ` (${fence(c.language) || c.language})` : ""}:
\`\`\`${fence(c.language) || "python"}
${c.code.slice(0, 12000)}
\`\`\`
` +
  `What it printed when run (may be empty, or an error):
\`\`\`
${c.output.slice(-4000) || "(not run yet)"}
\`\`\``;

/** The student asks about their code. Hints first; full answers only if asked. */
export function codeHelpPrompt(c: CodeContext, question: string, profile: Profile) {
  return `${PERSONA}

${student(profile)}

You are sitting beside the student while they code. ${CODE_ENV}${PYTHON_ENV}

${codeBlock(c)}

The student asks: "${question}"

Help like a patient teacher: explain what is happening in plain words, point to the exact line, and give a hint or a small nudge. Only write out a full solution if they clearly ask for it. If there is an error, say in one sentence what the error message means before the fix.
Keep it under 150 words. You may include one short code snippet in a \`\`\`python block if it helps; otherwise plain text, no headings.`;
}

/** Mark a code exercise: does the code do what the task asked? */
export function checkPrompt(c: CodeContext, profile: Profile) {
  return `${PERSONA}

${student(profile)}

${codeBlock(c)}

Decide whether the code does what the exercise asked (judge the idea and the output, not style). Be encouraging and specific.
Reply with only this JSON:
{"passed": true or false, "feedback": "two to four spoken sentences: what works, and if not passed, the one thing to fix next (a hint, not the answer)"}`;
}

/** Mark an exercise answered in words (any subject) against the course's model answer, when it has one. */
export function writtenCheckPrompt(lesson: Lesson, board: Board, answer: string, profile: Profile) {
  return `${PERSONA}

${student(profile)}

You taught "${lesson.title}" (course: ${lesson.course}). The course's own exercise${board.exercise ? ` (${board.exercise})` : ""}:
"""
${(board.task ?? "").slice(0, 4000)}
"""
${board.solution ? `The course's model answer, for your eyes only (judge against its ideas, not its wording; never show it, quote it or give it away; a different answer that is right is just as good):
"""
${board.solution.slice(0, 6000)}
"""
` : "The course gives no model answer: judge it against what the lesson taught."}
The student's answer:
"""
${answer.slice(0, 8000)}
"""

Mark it kindly and honestly, judging understanding, not English or style. It passes when the main idea is right and nothing important is wrong.
- When the model answer or mark scheme lists separate points (marks, bullet points, steps), mark each one: "points" has one entry per point, in the scheme's order, saying in a few plain words what the point is about (never the scheme's own wording), whether the student's answer has it, and one short remark.
- When the question is a calculation or a proof, check the final answer against the scheme first, then the working: a right answer with sound working passes; a wrong answer names the first step that goes wrong, without giving the right value.
- An essay or short answer is judged by the ideas it has, in any words.
Reply with only this JSON:
{"passed": true or false, "feedback": "two to four spoken sentences: what is right, and if not passed, the one thing to think about next (a hint, not the answer)", "points": [{"point": "what it is about", "met": true or false, "note": "one short remark"}]}
Leave "points" as [] when the answer is judged as a whole.`;
}

/** The mark scheme's points as the professor marked them, kept only when well formed. */
export function cleanPoints(raw: unknown): { point: string; met: boolean; note: string }[] {
  return (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [])
    .map((p) => ({ point: typeof p?.point === "string" ? p.point.trim().slice(0, 160) : "", met: p?.met === true, note: typeof p?.note === "string" ? p.note.trim().slice(0, 240) : "" }))
    .filter((p) => p.point)
    .slice(0, 12);
}

/** The student is stepping through their code and asks what this step does. */
export function stepPrompt(
  code: string,
  step: { line: number; stack: string[]; event: string; ret: string | null },
  vars: string,
  changed: string,
  output: string,
  profile: Profile,
) {
  const lines = code.split("\n");
  const at = lines[step.line - 1] ?? "";
  return `${PERSONA}

${student(profile)}

The student is stepping through their code in a debugger, one line at a time.

Their code (line numbers added):
\`\`\`
${lines.map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join("\n").slice(0, 10000)}
\`\`\`

The debugger is ${step.event === "return" ? `returning from ${step.stack.at(-1)}() on line ${step.line}, with the value ${step.ret}` : `on line ${step.line}: \`${at.trim()}\``}, inside ${step.stack.join(" → ")}.
Variables right now: ${vars || "(none yet)"}
Changed since the previous step: ${changed || "nothing"}
Printed so far: ${output.slice(-600) || "(nothing yet)"}

In at most 80 words of plain spoken English, explain what this line just did and why the variables look as they do now. If something here is surprising or a likely mistake, gently point it out. No headings, no bullet points.`;
}

/** Plan a course's road from where the student is to mastery. */
export function roadmapPrompt(course: string, goal: string, level: string, profile: Profile, earlier: Lesson[]) {
  return `${PERSONA}

${student(profile)}

Plan a course from where the student is now all the way to mastery.
Course: ${course}
${goal ? `The student's goal: ${goal}` : "Goal: become truly expert: able to do real work in this subject, explain it to others, and keep learning alone."}
Where they are now: ${level}.
${earlier.length ? `Lessons they have already had in this course: ${earlier.map((l) => l.title).join("; ")}.` : ""}

Write the roadmap in exactly five stages, in this order: Foundations, Core, Intermediate, Advanced, Mastery.
Each stage has 4 to 6 modules, in the order they should be learned; each module is one or two lessons' worth and lists 3 to 5 concrete topics.
Build each module only on what comes before it. Mastery ends with real-world, expert-level work (projects, research, teaching, trade-offs), not just harder facts.
Plain English titles, short and specific.

Reply with only this JSON:
{"goal": "one sentence: what the student can do at the end", "stages": [
 {"title": "Foundations", "summary": "one sentence", "modules": [{"title": "…", "summary": "one sentence", "topics": ["…", "…", "…"]}]}
]}`;
}

export function cleanRoadmap(raw: unknown): { goal: string; stages: RoadmapStage[] } | null {
  const r = raw as { goal?: unknown; stages?: unknown };
  if (!r || !Array.isArray(r.stages)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const stages: RoadmapStage[] = (r.stages as Record<string, unknown>[])
    .slice(0, 6)
    .map((s, si) => ({
      title: str(s?.title) || `Stage ${si + 1}`,
      summary: str(s?.summary),
      modules: (Array.isArray(s?.modules) ? (s.modules as Record<string, unknown>[]) : [])
        .slice(0, 8)
        .map((m, mi) => ({
          id: `s${si + 1}m${mi + 1}`,
          title: str(m?.title),
          summary: str(m?.summary),
          topics: (Array.isArray(m?.topics) ? (m.topics as unknown[]) : []).map(String).filter(Boolean).slice(0, 6),
        }))
        .filter((m) => m.title),
    }))
    .filter((s) => s.modules.length);
  if (stages.length < 3) return null;
  return { goal: str(r.goal), stages };
}
