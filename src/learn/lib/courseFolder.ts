/**
 * A course kept as a folder of lessons (the shape of the owner's Rust course):
 * each lesson is a folder with a README.md, and may have examples/,
 * exercises/, solutions/ and src/; a lesson of any subject can also be a
 * README alone, or a single Markdown file. This file is the reading of one lesson's
 * text: its title, sections, 💡 analogies, checklist, and each exercise with
 * the solution that answers it. Plain functions with no Node imports, so the
 * page and the tests share them; the folder is walked in src/lib/learnCourse.ts.
 */
import type { Board, CodeLanguage, Course, RoadmapStage } from "./types";

export type FolderFile = { name: string; code: string };

export type FolderExercise = {
  /** The file's name ("ex01_fix_move.rs"), or "Exercise 2" for one written in the lesson's own text. */
  name: string;
  /** Code to write and run, or a question answered in words (any subject). Code when absent. */
  kind?: "written";
  title: string;
  /** What to do, from the comment at the top of the file. */
  task: string;
  starter: string;
  solution?: string;
  /** The starter carries its own tests. */
  tests: boolean;
  /** The language of a code exercise; a written one has none. */
  language?: CodeLanguage;
};

export type FolderLesson = {
  /** The lesson's path inside the course folder, with forward slashes. */
  id: string;
  title: string;
  /** The folder the lesson sits in ("01_foundations"), as a title. */
  unit: string;
  readme: string;
  sections: string[];
  analogies: string[];
  checklist: string[];
  examples: (FolderFile & { language: CodeLanguage })[];
  exercises: FolderExercise[];
  /** The lesson's small project (src/main.*), when it has one. */
  project?: FolderFile;
};

export type OutlineLesson = { id: string; title: string; summary: string; sections: number; analogies: number; examples: number; exercises: number };
export type FolderOutline = { path: string; name: string; summary: string; units: { title: string; lessons: OutlineLesson[] }[] };

const EXT: Record<string, CodeLanguage> = { ".rs": "rust", ".py": "python", ".js": "javascript", ".mjs": "javascript", ".ts": "typescript", ".sql": "sql" };

/** The language of a file the lesson editor can hold, from its ending. */
export function languageOfFile(name: string): CodeLanguage | null {
  const m = /(\.[A-Za-z0-9]+)$/.exec(name);
  return (m && EXT[m[1].toLowerCase()]) || null;
}

/** "06_ownership" → "Ownership"; "02_core_types_and_errors" → "Core types and errors". */
export function titleOfDir(dir: string): string {
  const words = dir.replace(/^[\d._-]+/, "").replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : dir;
}

/** Folder names in the order a person numbers them: "2_x" before "10_x". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** The first sentences of `text` that fit in `max` characters; a long first sentence is cut at a word, with an ellipsis. */
export function brief(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (stop > max * 0.4) return head.slice(0, stop + 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > 0 ? space : max).replace(/[,;:(]$/, "")}…`;
}

const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
const stripMd = (s: string) => stripLinks(s).replace(/[*_`]/g, "").trim();

/** What a lesson's README says about itself. */
export function readReadme(readme: string): { title: string; summary: string; sections: string[]; analogies: string[]; checklist: string[] } {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  let summary = "";
  const sections: string[] = [];
  const analogies: string[] = [];
  const checklist: string[] = [];
  let fence = false;
  let quote: string[] | null = null;
  const endQuote = () => {
    if (quote && quote.some((l) => l.includes("💡"))) analogies.push(stripLinks(quote.join(" ")).replace(/\s+/g, " ").trim());
    quote = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      endQuote();
      continue;
    }
    if (fence) continue;
    if (/^\s*>/.test(line)) {
      (quote ??= []).push(line.replace(/^\s*>\s?/, ""));
      continue;
    }
    endQuote();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1].length === 1 && !title) title = stripMd(h[2]);
      else if (h[1].length === 2) sections.push(stripMd(h[2]));
      continue;
    }
    const box = /^\s*[-*]\s+\[[ xX]\]\s+(.*)$/.exec(line);
    if (box) {
      checklist.push(stripMd(box[1]));
      continue;
    }
    // The first ordinary paragraph says what the lesson is about.
    if (!summary && title && line.trim() && !/^[<|!\-*#·]/.test(line.trim()) && !/^\*\*.*\*\*\s*:?\s*\[/.test(line.trim()) && !/^(Run|Test) it:/i.test(line.trim())) summary = brief(stripMd(line), 260);
  }
  endQuote();
  return { title, summary, sections, analogies, checklist };
}

/** The comment a file opens with, without its comment marks: an exercise's own instructions. */
export function leadingComment(code: string): string {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  // A Python docstring.
  const doc = /^\s*(?:[rR]?)("""|''')(.*)$/.exec(lines[i] ?? "");
  if (doc) {
    const close = doc[1];
    let rest = doc[2];
    for (;;) {
      const end = rest.indexOf(close);
      if (end >= 0) {
        out.push(rest.slice(0, end));
        break;
      }
      out.push(rest);
      if (++i >= lines.length) break;
      rest = lines[i];
    }
    return out.join("\n").trim();
  }
  for (; i < lines.length; i++) {
    const m = /^\s*(?:\/\/[/!]?|#(?!!|\[)|--)\s?(.*)$/.exec(lines[i]);
    if (!m) break;
    out.push(m[1]);
  }
  return out.join("\n").trim();
}

/** The key that pairs "ex01_fix_move.rs" with "sol01_fix_move.rs": the number when there is one, else the name without its prefix. */
export function pairKey(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "").toLowerCase();
  const rest = base.replace(/^(exercise|solution|answer|ex|sol)[_-]?/, "");
  const n = /^(\d+)/.exec(rest);
  return n ? String(Number(n[1])) : rest;
}

const hasTests = (code: string, language: CodeLanguage) =>
  language === "rust" ? /#\[cfg\(test\)\]|#\[test\]/.test(code) : language === "python" ? /^\s*(def test_|import unittest|assert )/m.test(code) : false;

/** A document, not code: by the time it is read here its text is Markdown, whatever it was written in (docText.ts). */
const isMarkdown = (name: string) => /\.(md|markdown|txt|pdf|docx|pptx)$/i.test(name);

/**
 * A paper of questions (a worksheet, a past paper) as exercises, with its answer key or mark scheme when there is one.
 * Numbered questions are one exercise each, answered by the key's entry of the same number; a key that is not numbered
 * (a mark scheme in prose) goes with every question, for the professor to find the part that applies. A paper with no
 * numbered questions is one exercise.
 */
export function readPaper(name: string, questions: string, answers?: string): FolderExercise[] {
  const strip = (text: string) => text.replace(/\r\n/g, "\n").replace(/^#{1,3}\s+.*$/gm, "").trim();
  const title = stripMd(/^#\s+(.*)$/m.exec(questions)?.[1] ?? "") || titleOfDir(name.replace(/\.[A-Za-z0-9]+$/, ""));
  const body = strip(questions);
  if (!body) return [];
  const key = answers ? strip(answers) : "";
  const asked = numbered(body);
  const answered = numbered(key);
  const whole = key && !answered.size ? key : "";
  const one = (n: number | null, task: string): FolderExercise => {
    const solution = n !== null && answered.get(n) ? answered.get(n)! : whole || (n === null ? key : "");
    return { name: n === null ? name : `${name} · question ${n}`, kind: "written", title: n === null ? title : `${title}: question ${n}`, task, starter: "", ...(solution ? { solution } : {}), tests: false };
  };
  const list = [...asked.entries()].filter(([, q]) => q);
  return list.length ? list.slice(0, 40).map(([n, q]) => one(n, q)) : [one(null, body)];
}

/** A written exercise from its own file (exercises/ex01_causes.md): the question, with the model answer of the same number or name. */
function readWrittenFile(file: FolderFile, solutions: FolderFile[], n: number): FolderExercise | null {
  const text = file.code.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  const heading = /^#{1,3}\s+(.*)$/m.exec(text);
  const body = (heading ? text.replace(heading[0], "") : text).trim();
  const key = pairKey(file.name);
  const answer = solutions.find((s) => isMarkdown(s.name) && pairKey(s.name) === key);
  return {
    name: file.name,
    kind: "written",
    title: heading ? stripMd(heading[1]) : `Exercise ${n}`,
    task: body || (heading ? stripMd(heading[1]) : text),
    starter: "",
    ...(answer?.code.trim() ? { solution: answer.code.replace(/\r\n/g, "\n").replace(/^#{1,3}\s+.*\n+/, "").trim() } : {}),
    tests: false,
  };
}

const EXERCISES = /^(exercises?|practi[cs]e|questions|your turn|try it( yourself)?)$/i;
const ANSWERS = /^(answers?|model answers?|solutions?|answer key)$/i;

/** A numbered list's items ("1. …", "2) …"), each with the lines that continue it. */
function numbered(text: string): Map<number, string> {
  const out = new Map<number, string>();
  let at: number | null = null;
  let fence = false;
  for (const line of text.split("\n")) {
    // A numbered line inside a code block belongs to the question it is in.
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(line);
    if (m) {
      at = Number(m[1]);
      out.set(at, m[2]);
    } else if (at !== null) out.set(at, `${out.get(at)}\n${line.replace(/^\s{1,4}/, "")}`);
  }
  for (const [k, v] of out) out.set(k, v.trim());
  return out;
}

/**
 * The exercises a lesson's own text sets: a "## Exercises" section (or Practice, Questions, Your turn)
 * holding a numbered list, and optionally a "## Answers" section (or Model answers, Solutions)
 * numbered the same way. Both sections are taken out of the text that is taught, so the questions
 * are not given away on a board and the answers are never shown before a real attempt.
 */
export function readWrittenSections(readme: string): { readme: string; exercises: FolderExercise[] } {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  const found: Record<"exercises" | "answers", string[]> = { exercises: [], answers: [] };
  let into: "exercises" | "answers" | null = null;
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) {
      const name = stripMd(h[2]).replace(/[:.]$/, "");
      into = h[1].length === 2 && EXERCISES.test(name) ? "exercises" : h[1].length === 2 && ANSWERS.test(name) ? "answers" : null;
      if (into) continue;
    }
    if (into) found[into].push(line);
    else kept.push(line);
  }
  const questions = numbered(found.exercises.join("\n"));
  const answers = numbered(found.answers.join("\n"));
  const exercises: FolderExercise[] = [...questions.entries()]
    .filter(([, q]) => q)
    .map(([n, q]) => ({ name: `Exercise ${n}`, kind: "written" as const, title: `Exercise ${n}`, task: q, starter: "", ...(answers.get(n) ? { solution: answers.get(n)! } : {}), tests: false }));
  // A section with no numbered questions is ordinary text: leave the README as it was.
  return exercises.length ? { readme: kept.join("\n").replace(/\n{3,}/g, "\n\n"), exercises } : { readme: readme.replace(/\r\n/g, "\n"), exercises: [] };
}

/** An exercise from its file, with the solution of the same number or name. */
export function readExercise(file: FolderFile, solutions: FolderFile[], n: number): FolderExercise | null {
  if (isMarkdown(file.name)) return readWrittenFile(file, solutions, n);
  const language = languageOfFile(file.name);
  if (!language) return null;
  const comment = leadingComment(file.code);
  const [first = "", ...rest] = comment.split("\n");
  // "Run: cargo run -p …" lines name the folder's own commands; the lesson's editor runs the file itself.
  const task = rest.filter((l) => !/^\s*(Run|Test)\s*:/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const key = pairKey(file.name);
  const solution = solutions.find((s) => pairKey(s.name) === key && languageOfFile(s.name) === language);
  return {
    name: file.name,
    title: first.replace(/[.:]\s*$/, "").trim() || `Exercise ${n}`,
    task: task || first.trim() || "Make this file do what its comments ask.",
    starter: file.code.replace(/\r\n/g, "\n"),
    ...(solution ? { solution: solution.code.replace(/\r\n/g, "\n") } : {}),
    tests: hasTests(file.code, language),
    language,
  };
}

/** One lesson from its files. `dir` is its path inside the course, `files` its text files by path inside the lesson. */
export function readLesson(dir: string, files: Record<string, string>): FolderLesson {
  const written = readWrittenSections(files["README.md"] ?? files["readme.md"] ?? "");
  const readme = written.readme;
  const about = readReadme(readme);
  const parts = dir.split("/").filter(Boolean);
  const within = (folder: string) =>
    Object.keys(files)
      .filter((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes("/"))
      .sort(naturalCompare)
      .map((p) => ({ name: p.slice(folder.length + 1), code: files[p] }));
  const solutions = within("solutions");
  const exercises = [
    ...within("exercises")
      .map((f, i) => readExercise(f, solutions, i + 1))
      .filter((e): e is FolderExercise => !!e),
    ...written.exercises,
  ];
  const examples = within("examples")
    .map((f) => ({ ...f, code: f.code.replace(/\r\n/g, "\n"), language: languageOfFile(f.name) }))
    .filter((f): f is FolderFile & { language: CodeLanguage } => !!f.language);
  const main = Object.keys(files).find((p) => /^src\/main\.[a-z]+$/.test(p)) ?? Object.keys(files).find((p) => /^(main|index)\.[a-z]+$/.test(p) && languageOfFile(p));
  return {
    id: parts.join("/"),
    title: about.title || titleOfDir(parts.at(-1) ?? dir),
    unit: parts.length > 1 ? titleOfDir(parts.at(-2)!) : "",
    readme,
    sections: about.sections,
    analogies: about.analogies,
    checklist: about.checklist,
    examples,
    exercises,
    ...(main ? { project: { name: main, code: files[main].replace(/\r\n/g, "\n") } } : {}),
  };
}

/** A lesson's line in the course outline. */
export function outlineOf(l: FolderLesson): OutlineLesson {
  return { id: l.id, title: l.title, summary: readReadme(l.readme).summary || l.checklist.slice(0, 3).join(" · "), sections: l.sections.length, analogies: l.analogies.length, examples: l.examples.length, exercises: l.exercises.length };
}

/** The outline as a course: its units are the roadmap's stages and its lessons the modules, in folder order. */
export function courseFromOutline(o: FolderOutline, existing: Pick<Course, "id" | "createdAt"> | undefined, id: string, now: number): Course {
  const stages: RoadmapStage[] = o.units.map((u) => ({
    title: u.title,
    summary: `${u.lessons.length} lesson${u.lessons.length === 1 ? "" : "s"}`,
    modules: u.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      topics: [l.sections ? `${l.sections} sections` : "", l.examples ? `${l.examples} examples to run` : "", l.exercises ? `${l.exercises} exercises` : ""].filter(Boolean),
    })),
  }));
  return { id: existing?.id ?? id, name: o.name, goal: o.summary, stages, folder: { path: o.path }, createdAt: existing?.createdAt ?? now, updatedAt: now };
}

/** A lesson's exercises as code boards, each with the course's own solution and tests. */
export function exerciseBoards(l: FolderLesson): Board[] {
  return l.exercises.map((e): Board =>
    e.kind === "written"
      ? {
          title: e.title,
          kind: "write",
          lines: [{ w: "**Your turn.** Answer in your own words.", s: `Your turn. ${e.title}. Answer in your own words.` }],
          task: e.task,
          exercise: e.name,
          ...(e.solution ? { solution: e.solution } : {}),
        }
      : codeBoard(e),
  );
}

function codeBoard(e: FolderExercise): Board {
  return {
    title: e.title,
    kind: "code" as const,
    lines: [{ w: `**Your turn.** ${e.tests ? "Make the tests pass." : "Make it compile and run."}`, s: `Your turn. ${e.title}.` }],
    task: e.task,
    starter: e.starter,
    expect: e.tests ? "Every test passes." : "It compiles, runs and prints what the task asks.",
    ...(e.language && e.language !== "python" ? { language: e.language } : {}),
    exercise: e.name,
    ...(e.solution ? { solution: e.solution } : {}),
    ...(e.tests ? { tests: true } : {}),
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (cut)` : s);

/** What the professor is given to teach a lesson from: the README, the examples and the project, within a size the model reads comfortably. */
export function lessonMaterial(l: FolderLesson): string {
  const examples = l.examples.slice(0, 10).map((e) => `### examples/${e.name}\n\`\`\`${e.language}\n${clip(e.code, 3500)}\n\`\`\``);
  const exercises = l.exercises.map((e, i) => `${i + 1}. ${e.name}: ${e.title}`);
  return [
    `## The lesson's README\n\n${clip(l.readme, 30000)}`,
    examples.length ? `## Its runnable examples\n\n${examples.join("\n\n")}` : "",
    l.project ? `## Its small project (${l.project.name})\n\n\`\`\`\n${clip(l.project.code, 5000)}\n\`\`\`` : "",
    exercises.length ? `## Its exercises (added to the lesson for you, after your boards; do not write them)\n\n${exercises.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
