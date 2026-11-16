/**
 * A lesson taught from the student's own codebase (src/learn/lib/codebaseAsk.ts finds what was asked
 * for, src/lib/learnCodebase.ts reads the folder), written in steps.
 *
 * Asked for whole, with the files in one prompt, a model that thinks first spent 16,847 of its 20,000
 * output tokens thinking and the lesson was cut off inside a class diagram (the owner's kola v2
 * request, 15 Nov). So: one short call plans the boards from an outline of the files (their
 * declarations and calls, not their code); then the boards are written two at a time, in parallel,
 * each call with only the files its boards draw on and room for thinking plus its JSON; then one
 * call writes the quiz, the explain-back and the recall cards from the boards. A step whose boards
 * leave out a diagram the plan gave them (the UML the student asked for), or carry one Mermaid cannot
 * read (`check`: the board's own Mermaid, in the page), is asked once more, told what was wrong.
 */
import type { Sample, SampleOptions } from "./claude";
import { MERMAID, type CodebaseDigest, type CodebaseFile, type DiagramAsk, type DiagramKind } from "./codebaseAsk";
import { plain } from "./markup";
import { ANALOGY_RULES, cleanBoards, DIAGRAM_RULES, MARKUP_GUIDE, PERSONA, student, type StepProgress } from "./professor";
import type { Board, Lesson, Profile } from "./types";
import { usedPictures, varietyNote } from "./worlds";

/** Room for each step's reply: what a model that thinks first needs, plus the JSON (two boards with diagrams are ~2,500 tokens). */
export const PLAN_OUTPUT = 8_000;
export const BOARDS_OUTPUT = 12_000;
export const END_OUTPUT = 6_000;
/** The most of the codebase's text one step of boards is given. */
export const STEP_FILES_MAX = 14_000;
/** Talk boards written per step. */
export const PER_STEP = 2;

const KINDS: DiagramKind[] = ["sequence", "class", "state", "er", "flowchart", "activity", "component", "usecase", "mindmap"];

export type CodePlanBoard = { title: string; idea: string; files: string[]; diagram: DiagramKind | null };
export type CodePlan = { title: string; picture: string; boards: CodePlanBoard[] };
export type CodeLessonRequest = { request: string; course: string; level: string; talks: number; earlier: Lesson[]; diagrams: DiagramAsk | null };
/** Where the writing is, for the page: StepProgress plus what this step does. */
export type CodeStepProgress = StepProgress & { doing: string };

/** A declaration or a call worth naming in a file's outline: what is defined, and what goes out (fetch, axios, an API call). */
const DECL = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?|const|let|class|interface|type|enum|abstract\s+class)\s+[A-Za-z_$]|^\s*(public|private|protected|static|async)?\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$|^\s*(def|class|fn|pub fn|func|struct|impl|message|service|rpc)\s/;
const CALL = /\b(fetch|axios|useQuery|useMutation|mutate|mutateAsync)\s*[.(<]|\.(post|get|put|patch|delete)\s*[<(]|['"`]\/[a-z][\w/-]*['"`]/;
const HEADING = /^#{1,3}\s/;

/** A file in a few lines: its declarations, its calls out and (for a document) its headings, with line numbers. */
export function outlineOf(f: CodebaseFile, most = 24): string {
  const doc = /\.(md|mdx|markdown|txt)$/i.test(f.path);
  const out: string[] = [];
  f.content.split("\n").forEach((line, i) => {
    if (out.length >= most) return;
    if (doc ? HEADING.test(line) : DECL.test(line) || CALL.test(line)) out.push(`${f.from + i}| ${line.trim().slice(0, 140)}`);
  });
  return `--- ${f.path} (${f.lines} lines)\n${out.join("\n") || "(nothing to outline)"}`;
}

const earlierLine = (earlier: Lesson[]) => (earlier.length ? `Lessons already taught in this course (build on them, do not repeat them): ${earlier.map((l) => `${l.number}. ${l.title}`).join("; ")}.` : "This is the first lesson of the course.");

/** Step one: the plan, from the outline of the files that matter. */
export function codePlanPrompt(d: CodebaseDigest, r: CodeLessonRequest, profile: Profile): string {
  const asked = r.diagrams;
  const need = asked ? Math.max(asked.kinds.length, Math.ceil(r.talks / 2)) : 0;
  return `${PERSONA}

${student(profile)}

The student asked: "${r.request.slice(0, 600)}"
Level: ${r.level}. Course: ${r.course}. ${earlierLine(r.earlier)}

Their own codebase, ${d.name} (${d.files} code files), was found on their computer. Below is an outline of the files that matter most for this subject: what each declares and calls, with line numbers. It is not the whole code; the boards will be written later from the files themselves.
Folders that matter (files in each): ${d.folders.slice(0, 16).join("; ")}

${d.picked.map((f) => outlineOf(f)).join("\n\n")}

Plan a lesson of exactly ${r.talks} chalkboard "talk" boards that teaches the subject through this codebase's real flow, in the order a beginner should meet it. For each board: a short "title", the "idea" (one or two sentences: what it teaches, with the real names it uses), "files": one to three paths from the outline that board draws on, and "diagram": ${asked ? "the kind of diagram it carries" : "a diagram kind only where a picture of structure or flow teaches best"}, one of ${KINDS.join(", ")}, or null.
- Board 1 opens: what we will learn and why it matters, and the big picture of the flow in ${d.name}. The last board recaps the flow with the real names.
${asked ? `- The student asked for ${asked.uml ? "UML" : "diagrams"}${asked.kinds.length ? ` (${asked.kinds.join(", ")})` : ""}: at least ${need} boards carry one${asked.kinds.length ? `, each of ${asked.kinds.join(" and ")} at least once, on the board where it teaches best (a sequence where the flow runs from the page to the server and back, a class where the types are)` : ""}.\n` : ""}- "picture": one everyday picture for the whole lesson that a ten-year-old knows, which every board will extend. ${ANALOGY_RULES.split("\n")[1]?.trim() ?? ""}
${varietyNote(`${r.course}#${r.earlier.length + 1}:${r.request}`, usedPictures(r.earlier), "lesson")}
- Plan only what the outline shows: real names, nothing invented. When part of the flow happens outside this code (a backend, a payment provider), plan to say so.

Reply with only this JSON:
{"title": "the lesson's title", "picture": "…", "boards": [{"title": "…", "idea": "…", "files": ["…"], "diagram": null}]}`;
}

/** The plan as the steps use it: the right number of boards, files that exist, and every diagram kind asked for given a board. */
export function cleanPlan(raw: unknown, d: CodebaseDigest, talks: number, asked: DiagramAsk | null): CodePlan | null {
  const r = raw as { title?: unknown; picture?: unknown; boards?: unknown } | null;
  if (!r || !Array.isArray(r.boards)) return null;
  const known = new Map(d.picked.map((f) => [f.path.toLowerCase(), f.path]));
  const boards: CodePlanBoard[] = (r.boards as Record<string, unknown>[])
    .filter((b) => b && typeof b === "object" && typeof b.title === "string" && b.title.trim())
    .slice(0, talks)
    .map((b) => ({
      title: String(b.title).trim().slice(0, 120),
      idea: typeof b.idea === "string" ? b.idea.trim().slice(0, 600) : "",
      files: (Array.isArray(b.files) ? b.files : []).map((p) => known.get(String(p).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase())).filter((p): p is string => !!p).slice(0, 3),
      diagram: KINDS.includes(b.diagram as DiagramKind) ? (b.diagram as DiagramKind) : null,
    }));
  if (boards.length < 2) return null;
  // A kind the student asked for that the plan left out goes on a middle board that has none (never the opening one).
  for (const k of asked?.kinds ?? []) {
    if (boards.some((b) => b.diagram === k)) continue;
    const free = boards.findIndex((b, i) => i > 0 && !b.diagram);
    boards[free > 0 ? free : Math.min(1, boards.length - 1)].diagram = k;
  }
  return { title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 140) : "", picture: typeof r.picture === "string" ? r.picture.trim().slice(0, 500) : "", boards };
}

/** A file cut to `max` characters at a line end, its line numbers kept. */
function cut(f: CodebaseFile, max: number): CodebaseFile {
  if (f.content.length <= max) return f;
  const lines = f.content.split("\n");
  const kept: string[] = [];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > max) break;
    kept.push(l);
    size += l.length + 1;
  }
  return { ...f, content: kept.join("\n"), to: f.from + kept.length - 1 };
}

/** The files one step's boards draw on, shared out within `max` characters (the subject's top files when the plan named none). */
export function filesFor(d: CodebaseDigest, paths: string[], max = STEP_FILES_MAX): CodebaseFile[] {
  const named = [...new Set(paths)].map((p) => d.picked.find((f) => f.path === p)).filter((f): f is CodebaseFile => !!f);
  const files = named.length ? named : d.picked.filter((f) => !/^(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/.test(f.path)).slice(0, 2);
  const each = Math.floor(max / Math.max(1, files.length));
  return files.map((f) => cut(f, each));
}

const numbered = (f: CodebaseFile) =>
  f.content
    .split("\n")
    .map((l, i) => `${f.from + i}| ${l}`)
    .join("\n");

/** A step of boards: these boards of the plan, from their files alone. */
export function codeBoardsPrompt(d: CodebaseDigest, plan: CodePlan, at: number[], r: CodeLessonRequest, profile: Profile, missed = ""): string {
  const n = plan.boards.length;
  const mine = at.map((i) => ({ i, b: plan.boards[i] }));
  const files = filesFor(d, mine.flatMap(({ b }) => b.files));
  const kinds = [...new Set(mine.map(({ b }) => b.diagram).filter((k): k is DiagramKind => !!k))];
  return `${PERSONA}

${student(profile)}

You are writing the lesson "${plan.title}" (course: ${r.course}, level: ${r.level}) for a student who asked: "${r.request.slice(0, 600)}"
It is taught from their own codebase, ${d.name}, read from their disk just now. The lesson has ${n} talk boards, written a few at a time from this plan:
${plan.boards.map((b, i) => `${i + 1}. ${b.title}: ${b.idea}${b.diagram ? ` [diagram: ${b.diagram}]` : ""}`).join("\n")}
The lesson's one everyday picture, which every board extends: ${plan.picture || "choose one a ten-year-old knows, and keep it"}

Write boards ${mine.map(({ i }) => i + 1).join(" and ")} only, as planned. Each board: its "title", "kind": "talk", 3 to 5 "lines" ("w": what is written in chalk, at most 90 characters; "s": what you say aloud, one to three natural sentences, no markup), and an "analogy": one to three plain sentences extending the lesson's picture to this board's idea.${mine.some(({ i }) => i === 0) ? " Board 1 says what we will learn and why, and gives the big picture of the flow." : ""}${mine.some(({ i }) => i === n - 1) ? ` Board ${n} is the recap with the real names; its analogy is the whole lesson in one sentence for a child.` : ""}
- Teach through the code below and only it: real file paths, components, hooks, functions, types, API calls and endpoints, exactly as written. Name where things are as \`file:line\` in the chalk or the file aloud. Never invent code, names or behaviour these files do not show; when a step happens outside this code (a backend, a payment provider), say so and name what the code calls.
- ${ANALOGY_RULES}
${kinds.length ? `- A board with a planned diagram carries it on one of its lines, as "diagram": Mermaid source of that kind, and that board's lines and what you say aloud walk through it in order.
${kinds.map((k) => `  - ${MERMAID[k]}.`).join("\n")}
  - Every participant, message, class, field and state is a real name from the code below; the analogy's word may only be a box's short second line after <br/>. ${r.diagrams?.uml ? "Follow UML's notation as Mermaid writes it. " : ""}A title first (---, title: what it shows, ---), up to 14 nodes or participants, short plain labels, no styling, newlines written as \\n in the JSON string.
- ${DIAGRAM_RULES}` : `- A line may carry a "diagram" (Mermaid source, real names, newlines as \\n) where a picture of structure or flow teaches best. ${DIAGRAM_RULES}`}
${missed ? `- ${missed}\n` : ""}
${MARKUP_GUIDE}

The code these boards draw on (line numbers on the left):
${files.map((f) => `=== ${f.path} (lines ${f.from}-${f.to} of ${f.lines}) ===\n${numbered(f)}`).join("\n\n")}
=== end ===

Reply with only this JSON:
{"boards": [{"title": "…", "kind": "talk", "analogy": "…", "lines": [{"w": "…", "s": "…"}, {"w": "…", "s": "…", "diagram": "only on the line that shows it"}]}]}`;
}

/** The last step: the quiz, the explain-back, the recall cards and the summary, from the boards written. */
export function codeEndPrompt(title: string, d: CodebaseDigest, boards: Board[], profile: Profile): string {
  return `${PERSONA}

${student(profile)}

You have just taught "${title}", from the student's own codebase ${d.name}, on these boards:
${boards.map((b, i) => `${i + 1}. "${plain(b.title)}": ${b.lines.map((x) => plain(x.w)).join(" / ")}`).join("\n")}

Write its close, about this code: which file does what, what is called next, what a type holds. Reply with only this JSON:
{"summary": "two sentences: what the student can now do", "quiz": [{"q": "…", "options": ["…", "…", "…"], "answer": 0, "why": "one sentence"}], "questions": ["…"], "cards": [{"q": "…", "a": "…"}]}
- "quiz": 3 multiple-choice questions of 3 or 4 options, testing understanding of these boards, not memory.
- "questions": 3 questions the student answers in their own words (the explain-back).
- "cards": 5 to 8 recall cards, a short question and its one-sentence answer.
${MARKUP_GUIDE}`;
}

/** The Mermaid word each kind starts with. */
const HEAD: Record<DiagramKind, RegExp> = {
  sequence: /\bsequenceDiagram\b/,
  class: /\bclassDiagram\b/,
  state: /\bstateDiagram/,
  er: /\berDiagram\b/,
  flowchart: /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/,
  activity: /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/,
  component: /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/,
  usecase: /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/,
  mindmap: /\bmindmap\b/,
};

/** The planned diagram kinds a step's boards left out. */
export function missingKinds(boards: Record<string, unknown>[], planned: DiagramKind[]): DiagramKind[] {
  const drawn = boards.flatMap((b) => (Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : []).map((l) => (typeof l?.diagram === "string" ? l.diagram : "")));
  return planned.filter((k) => !drawn.some((src) => HEAD[k].test(src)));
}

/** The talk boards in steps of PER_STEP: [[0, 1], [2, 3], …]. */
export const stepsOf = (n: number) => Array.from({ length: Math.ceil(n / PER_STEP) }, (_, s) => Array.from({ length: Math.min(PER_STEP, n - s * PER_STEP) }, (_, j) => s * PER_STEP + j));

/**
 * The whole lesson, in steps: plan, boards (in parallel), close. A reply cut short is asked for once more
 * with half again the room; a provider's per-minute limit is waited out a few times, as for folder lessons.
 */
export async function writeCodebaseLessonInSteps(
  sample: Sample,
  d: CodebaseDigest,
  r: CodeLessonRequest,
  profile: Profile,
  onProgress: (p: CodeStepProgress) => void,
  signal: AbortSignal,
  o: {
    pause?: (ms: number) => Promise<void>;
    waits?: number[];
    onStep?: (name: string, ms: number) => void;
    /** Why Mermaid cannot read a diagram, or null when it can (the page passes Diagram.tsx's diagramError). */
    check?: (source: string) => Promise<string | null>;
  } = {},
) {
  const pause = o.pause ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const waits = o.waits ?? [20, 35, 60];
  let done = 0;
  let steps = 2 + Math.ceil(r.talks / PER_STEP);
  let written = 0;
  const tell = (doing: string, waiting?: number) => onProgress({ step: Math.min(done + 1, steps), steps, boards: written, doing, ...(waiting ? { waiting } : {}) });
  const ask = async (name: string, prompt: string, maxOutput: number): Promise<Record<string, unknown>> => {
    const t0 = Date.now();
    let roomier = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const opts: SampleOptions = { signal, cache: false, modelTier: "default", maxOutput: roomier ? Math.round(maxOutput * 1.5) : maxOutput };
        const got = (await sample.json<Record<string, unknown>>(prompt, opts)) ?? {};
        o.onStep?.(name, Date.now() - t0);
        return got;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "invalid_json" && !roomier && !signal.aborted) {
          roomier = true;
          continue;
        }
        if (code !== "rate_limited" || attempt >= waits.length || signal.aborted) throw e;
        tell(name, waits[attempt]);
        await pause(waits[attempt] * 1000);
        if (signal.aborted) throw { code: "cancelled", message: "Stopped." };
      }
    }
  };

  tell("Planning the boards from the files' outline");
  const plan = cleanPlan(await ask("plan", codePlanPrompt(d, r, profile), PLAN_OUTPUT), d, r.talks, r.diagrams);
  if (!plan) return null;
  plan.title ||= `${d.name}: ${r.request.slice(0, 60)}`;
  done = 1;
  const groups = stepsOf(plan.boards.length);
  steps = 2 + groups.length;
  tell(`Writing boards 1 to ${plan.boards.length}, ${PER_STEP} at a time`);

  const written_: Record<string, unknown>[][] = await Promise.all(
    groups.map(async (at) => {
      const planned = at.map((i) => plan.boards[i].diagram).filter((k): k is DiagramKind => !!k);
      const boardsOf = (got: Record<string, unknown>) => (Array.isArray(got.boards) ? (got.boards as Record<string, unknown>[]) : []).filter((b) => b && typeof b === "object");
      /** What is wrong with a step's boards: a planned diagram left out, or one Mermaid cannot read. */
      const problems = async (boards: Record<string, unknown>[]) => {
        const out = missingKinds(boards, planned).map((k) => `it left out the planned ${MERMAID[k].split(":")[0]}`);
        for (const [j, b] of boards.entries()) {
          for (const l of Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : []) {
            const err = typeof l?.diagram === "string" && o.check ? await o.check(l.diagram) : null;
            if (err) out.push(`the diagram on board ${(at[j] ?? at[0]) + 1} would not draw (Mermaid said: ${err.slice(0, 240)})`);
          }
        }
        return out;
      };
      const name = `boards ${at.map((i) => i + 1).join("+")}`;
      let boards = boardsOf(await ask(name, codeBoardsPrompt(d, plan, at, r, profile), BOARDS_OUTPUT));
      const wrong = await problems(boards);
      // The diagram the student asked for is the point of the board: ask once more when it is missing or cannot be drawn.
      if (wrong.length) {
        const missed = `Your last reply for these boards had problems: ${wrong.join("; ")}. Write them again; every planned diagram must be there, in Mermaid that draws.`;
        const again = boardsOf(await ask(`${name} (again)`, codeBoardsPrompt(d, plan, at, r, profile, missed), BOARDS_OUTPUT));
        if (again.length && (await problems(again)).length <= wrong.length) boards = again;
      }
      done++;
      written += boards.length;
      tell(`Writing boards 1 to ${plan.boards.length}, ${PER_STEP} at a time`);
      return boards.map((b) => ({ ...b, kind: "talk" }));
    }),
  );
  const raw = written_.flat();
  const talks = cleanBoards({ title: plan.title, boards: [...raw, ...raw.slice(0, raw.length < 2 ? 1 : 0)] })?.boards.slice(0, raw.length) ?? [];
  if (!talks.length) return null;
  tell("Writing the quiz, the explain-back and the recall cards");
  const end = await ask("close", codeEndPrompt(plan.title, d, talks, profile), END_OUTPUT);
  done = steps;
  return cleanBoards({
    title: plan.title,
    summary: end.summary,
    cards: end.cards,
    boards: [
      ...raw,
      { title: "Quick quiz", kind: "quiz", lines: [{ w: "Check what stuck: three questions.", s: "Let us check what stuck. Three quick questions." }], quiz: end.quiz },
      { title: "Explain it back", kind: "explain", lines: [{ w: "Now you teach it, in your own words.", s: "Now you teach it back to me, in your own words." }], questions: end.questions },
    ],
  });
}
