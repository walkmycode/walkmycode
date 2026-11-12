// A course folder on this computer, read for the Learn room: the outline
// (every lesson, in order, by unit) and one lesson's material. A course is any
// folder of study material: Markdown, plain text, Word, PowerPoint and PDF
// (their text), and for code courses examples, exercises and solutions. The
// files are opened here and in ./learnDocs.ts and understood in
// src/learn/lib/courseFolder.ts and docText.ts; docs/COURSES.md is the guide
// for authors. Never read: .env files or keys, hidden files, build folders,
// or anything outside the folder asked for.
import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { primePdfs, readDoc } from "./learnDocs";
import { refuseHosted } from "./learnStore";
import { HttpError } from "./providers/guard";
import { brief, naturalCompare, outlineOf, readLesson, readPaper, readReadme, titleOfDir, type FolderExercise, type FolderLesson, type FolderOutline } from "@/learn/lib/courseFolder";
import { DOC_EXT, numberOf, partnerOf, roleOf, sameSubject } from "@/learn/lib/docText";
import { STARTER_COURSE } from "@/learn/lib/starterCourse";

const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "__pycache__", "venv", ".venv", "vendor", "coverage", "bin", "obj"]);
/** How deep a lesson may sit under the course folder ("01_unit/02_lesson" is 2). */
const DEPTH = 4;
const MAX_LESSONS = 400;
/** The largest code or Markdown file read from a lesson's own folders; a lesson's text is far smaller. */
const FILE_MAX = 200 * 1024;
/** What a lesson folder has besides its README. */
const PARTS = ["examples", "exercises", "solutions", "src"];
const CODE = /\.(rs|py|js|mjs|ts|sql|toml)$/i;
const README = /^readme\.(md|markdown|txt)$/i;

const entries = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));
  } catch {
    return [];
  }
};
const dirs = (dir: string) =>
  entries(dir)
    .filter((e) => e.isDirectory() && !SKIP.has(e.name))
    .map((e) => e.name)
    .sort(naturalCompare);
/** The documents in a folder that could be lessons, question papers or answer keys: every readable kind but its README. */
const docs = (dir: string) =>
  entries(dir)
    .filter((e) => e.isFile() && DOC_EXT.test(e.name) && !README.test(e.name))
    .map((e) => e.name)
    .sort(naturalCompare);

const readme = (dir: string) => ["README.md", "readme.md", "Readme.md"].map((n) => join(dir, n)).find((f) => existsSync(f)) ?? null;

function text(file: string): string | null {
  try {
    if (statSync(file).size > FILE_MAX) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** A folder with a README and something to practise with is a lesson whatever is under it. */
const hasParts = (dir: string) => !!readme(dir) && (PARTS.some((p) => existsSync(join(dir, p))) || ["Cargo.toml", "package.json", "pyproject.toml"].some((f) => existsSync(join(dir, f))));

/**
 * What the documents of one folder are to each other. Where anything in the folder is numbered, only numbered
 * documents are lessons (notes and glossaries beside them are left out); in a folder with no numbers, every document
 * is. A question paper goes with the lesson of its number or its subject, and is a lesson of its own when there is
 * none; an answer key or mark scheme goes with its paper and is never a lesson.
 */
export function sortDocs(names: string[], numberedFolder: boolean): { lessons: string[]; papers: Map<string, string[]>; keys: Map<string, string> } {
  const counts = (n: string) => !numberedFolder || numberOf(n) !== null;
  const teaching = names.filter((n) => roleOf(n) === "lesson" && counts(n));
  const questions = names.filter((n) => roleOf(n) === "questions");
  const answers = names.filter((n) => roleOf(n) === "answers");
  const papers = new Map<string, string[]>();
  const alone: string[] = [];
  for (const q of questions) {
    // Only a lesson it clearly belongs to: the same number, or the same subject.
    const n = numberOf(q);
    const owner = teaching.find((t) => (n !== null && numberOf(t) === n) || sameSubject(q, t));
    if (owner) papers.set(owner, [...(papers.get(owner) ?? []), q]);
    else if (counts(q)) alone.push(q);
  }
  const keys = new Map<string, string>();
  for (const a of answers) {
    const q = partnerOf(a, questions.filter((x) => !keys.has(x)));
    if (q) keys.set(q, a);
  }
  return { lessons: [...teaching, ...alone].sort(naturalCompare), papers, keys };
}

/** The folder as the user typed it, checked: absolute, and (unless it is about to be made) a folder that exists. */
export function courseRoot(path: unknown, mustExist = true): string {
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) throw new HttpError(400, "path: the course's folder.");
  const clean = path.trim().replace(/^["']|["']$/g, "");
  if (!isAbsolute(clean)) throw new HttpError(400, "Give the folder's full path, such as C:\\Users\\you\\rust or /home/you/rust.");
  const root = resolve(clean);
  if (!mustExist) return root;
  let ok = false;
  try {
    ok = statSync(root).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(404, "That folder could not be found on this computer.");
  return root;
}

/**
 * Every lesson under `root`, as paths inside it with forward slashes, in order. A lesson is:
 * - a folder with a README and examples, exercises, solutions, src or a project file beside it;
 * - a numbered folder with only a README ("03_causes/"), when nothing under it is a lesson;
 * - a document (Markdown, text, Word, PowerPoint, PDF) that is not a README or an answer key: the numbered ones
 *   where the folder numbers things, every one where it does not.
 */
export function findLessons(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string[], depth: number) => {
    if (out.length >= MAX_LESSONS) return;
    // A lesson's own folders (examples, src…) are not searched for more lessons.
    if (rel.length && hasParts(dir)) return void out.push(rel.join("/"));
    const at = out.length;
    const folders = depth < DEPTH ? dirs(dir) : [];
    const files = docs(dir);
    const numbered = [...folders, ...files].some((n) => numberOf(n) !== null);
    // Files and folders of one unit are taught in one order, by name.
    const here = [...sortDocs(files, numbered).lessons.map((name) => ({ name, file: true })), ...folders.map((name) => ({ name, file: false }))].sort((a, b) => naturalCompare(a.name, b.name));
    for (const e of here) {
      if (e.file) out.push([...rel, e.name].join("/"));
      else walk(join(dir, e.name), [...rel, e.name], depth + 1);
    }
    // Nothing under it is a lesson, it is numbered like one and has a README: the README is the lesson.
    if (out.length === at && rel.length && numberOf(rel[rel.length - 1]) !== null && readme(dir)) out.push(rel.join("/"));
  };
  walk(root, [], 0);
  // The folder is itself one lesson.
  if (!out.length && readme(root)) out.push("");
  return out;
}

/** Every PDF under the course, for reading ahead. */
function pdfsIn(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of entries(dir)) {
      if (e.isFile() && /\.pdf$/i.test(e.name)) out.push(join(dir, e.name));
      else if (e.isDirectory() && !SKIP.has(e.name) && depth < DEPTH + 1 && out.length < 400) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

const nameless = (n: string) => n.replace(/\.[A-Za-z0-9]+$/, "");

/** A lesson kept as one document, with the question papers and keys that go with it in its folder. */
function loadDocLesson(id: string, file: string): FolderLesson {
  const dir = dirname(file);
  const name = basename(file);
  const all = docs(dir);
  const { papers, keys } = sortDocs(all, [...dirs(dir), ...all].some((n) => numberOf(n) !== null));
  const read = (n: string) => {
    const got = readDoc(join(dir, n));
    return "text" in got ? got.text : null;
  };
  const own = readDoc(file);
  const exercises: FolderExercise[] = [];
  const paperOf = (q: string, body: string | null) => {
    if (body) exercises.push(...readPaper(q, body, keys.has(q) ? (read(keys.get(q)!) ?? undefined) : undefined));
  };
  let body: string;
  if ("unreadable" in own) body = `# ${titleOfDir(nameless(name))}\n\n${own.unreadable}\n`;
  else if (roleOf(name) === "questions") {
    // A paper with no lesson of its own: its questions are the exercises, and the professor opens with the ideas they need.
    paperOf(name, own.text);
    const title = /^#\s+(.*)$/m.exec(own.text)?.[1] ?? titleOfDir(nameless(name));
    body = `# ${title}\n\nA paper of ${exercises.length} question${exercises.length === 1 ? "" : "s"} to practise with. Before them, a short reminder of the ideas they need.\n\n## What these questions are about\n\n${exercises.map((e) => `- [ ] ${brief(e.task.replace(/\s+/g, " "), 140)}`).join("\n")}\n`;
  } else {
    body = own.text;
    for (const q of papers.get(name) ?? []) paperOf(q, read(q));
  }
  const lesson = readLesson(id.replace(DOC_EXT, ""), { "README.md": body });
  return { ...lesson, id: id.split(/[\\/]/).filter(Boolean).join("/"), exercises: [...lesson.exercises, ...exercises] };
}

/** One lesson's material. `id` is the lesson's path inside the course: a folder, or a document. A course's PDFs must have been read ahead (prime). */
export function loadLesson(root: string, id: string): FolderLesson {
  const at = resolve(root, id);
  const rel = relative(root, at);
  if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(at)) throw new HttpError(404, "That lesson is not in the course folder.");
  if (statSync(at).isFile()) {
    if (!DOC_EXT.test(at) || basename(at).startsWith(".")) throw new HttpError(404, "That lesson is not in the course folder.");
    return loadDocLesson(id, at);
  }
  const files: Record<string, string> = {};
  const rm = readme(at);
  if (rm) files["README.md"] = text(rm) ?? "";
  for (const part of PARTS) {
    const folder = join(at, part);
    const names = entries(folder)
      .filter((e) => e.isFile() && (CODE.test(e.name) || DOC_EXT.test(e.name)))
      .map((e) => e.name)
      .sort(naturalCompare)
      .slice(0, 40);
    for (const n of names) {
      // Code and Markdown as they are; a Word, PowerPoint, PDF or text exercise as its text.
      let got: string | null;
      if (CODE.test(n) || /\.(md|markdown)$/i.test(n)) got = text(join(folder, n));
      else {
        const doc = readDoc(join(folder, n));
        got = "text" in doc ? doc.text : null;
      }
      if (got !== null) files[`${part}/${n}`] = got;
    }
  }
  const lesson = readLesson(id || basename(root), files);
  return id ? lesson : { ...lesson, id: "", unit: "" };
}

/** Read the course's PDFs ahead, so the walk that follows finds their text ready. */
export const prime = (root: string) => primePdfs(pdfsIn(root));

/** The course: its name and what it says about itself, and every lesson by unit. */
export function loadOutline(root: string): FolderOutline {
  const top = readme(root);
  const lessons = findLessons(root);
  // A course that is one README is that lesson; its README is not also the course's description.
  const about = top && lessons[0] !== "" ? readReadme(text(top) ?? "") : { title: "", summary: "" };
  const units = new Map<string, FolderOutline["units"][number]>();
  for (const id of lessons) {
    const parts = id.split("/").filter(Boolean);
    const unit = parts.length > 1 ? titleOfDir(parts.slice(0, -1).join(" / ")) : "Lessons";
    if (!units.has(unit)) units.set(unit, { title: unit, lessons: [] });
    units.get(unit)!.lessons.push(outlineOf(loadLesson(root, id)));
  }
  const only = lessons.length === 1 && lessons[0] === "" ? [...units.values()][0]?.lessons[0]?.title : "";
  return { path: root, name: about.title || only || titleOfDir(basename(root)), summary: about.summary, units: [...units.values()] };
}

/**
 * A starter course written into a new folder (docs/COURSES.md shows the same one): lessons in the shapes Learn reads,
 * to copy and change. Only into a folder that does not exist yet or is empty: nothing of the user's is ever written over.
 */
export function writeStarter(root: string): string[] {
  if (existsSync(root)) {
    let found: string[] = [];
    try {
      if (!statSync(root).isDirectory()) throw new Error("not a folder");
      found = readdirSync(root);
    } catch {
      throw new HttpError(409, "That path is a file, not a folder. Name a new folder for the starter course.");
    }
    if (found.length) throw new HttpError(409, "That folder already has files in it. Name a new or empty folder, so nothing of yours is written over.");
  } else if (!existsSync(dirname(root))) throw new HttpError(404, "The folder above that one could not be found. Make it first, or name a folder inside one that exists.");
  const written: string[] = [];
  for (const [path, body] of Object.entries(STARTER_COURSE)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body, { encoding: "utf8", flag: "wx" });
    written.push(path);
  }
  return written;
}

/** POST /api/learn/course: `{path}` → the outline; `{path, lesson}` → that lesson; `{path, starter: true}` → make the starter course there, then its outline. */
export function learnCourseHandler() {
  return async (req: Request): Promise<Response> => {
    refuseHosted();
    const body = (await req.json()) as { path?: unknown; lesson?: unknown; starter?: unknown } | null;
    if (body?.starter === true) writeStarter(courseRoot(body.path, false));
    const root = courseRoot(body?.path);
    await prime(root);
    if (body?.lesson !== undefined) {
      if (typeof body.lesson !== "string" || body.lesson.length > 400 || body.lesson.includes("\0")) throw new HttpError(400, "lesson: its path inside the course.");
      return Response.json({ lesson: loadLesson(root, body.lesson) }, { headers: { "cache-control": "no-store" } });
    }
    const outline = loadOutline(root);
    if (!outline.units.length) throw new HttpError(422, "No lessons were found there. A course is a folder of documents (Markdown, text, Word, PowerPoint or PDF), or of lesson folders with a README.md. Learn can make a starter course to copy from.");
    return Response.json({ outline }, { headers: { "cache-control": "no-store" } });
  };
}
