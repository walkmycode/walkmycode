"use client";
/**
 * A course from a folder of lessons on this computer, in any subject. The
 * folder's path goes in on the left; on the right is the guide to structuring
 * a course (docs/COURSES.md says the same in full), and then what was found,
 * unit by unit, before anything is added. Learn can also write a starter
 * course into a new folder, to copy and change. Nothing is uploaded: the
 * folder is read by WalkMyCode's own server on this computer
 * (src/lib/learnCourse.ts).
 */
import { useEffect, useRef, useState } from "react";
import { courseFromOutline, type FolderOutline } from "@/learn/lib/courseFolder";
import { newId } from "@/learn/lib/store";
import type { Course } from "@/learn/lib/types";

type Props = {
  courses: Course[];
  onAdd: (c: Course) => void;
};

const LAST = "walkmycode:learn-folder";

export async function readCourse(path: string, starter = false): Promise<FolderOutline> {
  const res = await fetch("/api/learn/course", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, ...(starter ? { starter: true } : {}) }) });
  const body = (await res.json().catch(() => null)) as { outline?: FolderOutline; error?: unknown } | null;
  if (!res.ok || !body?.outline) throw new Error(typeof body?.error === "string" ? body.error : "The folder could not be read.");
  return body.outline;
}

/** The folder, a line at a time: what is typed, and what it is. */
const TREE: [string, string][] = [
  ["my-course/", ""],
  ["  README.md", "# Course title, then one paragraph about it"],
  ["  01_first-unit/", "a unit: any folder that holds lessons"],
  ["    01_a-lesson.md", "a lesson in one file"],
  ["    02_another-lesson/", "a lesson with files of its own"],
  ["      README.md", "the lesson"],
  ["      examples/", "code to run, one idea per file"],
  ["      exercises/", "ex01_name.md or ex01_name.py …"],
  ["      solutions/", "sol01_name.md or sol01_name.py …"],
  ["  02_second-unit/", ""],
];

const LESSON = `# The lesson's title

One paragraph: what it teaches and why it matters.

> 💡 **The big picture:** one everyday picture for the whole lesson.

## First idea

Explain it in plain words.

> 💡 **Analogy:** a picture a ten-year-old would understand.

## Second idea

…

## Exercises

1. A question the student answers in their own words.
2. Another question.

## Answers

1. The model answer to question 1.
2. The model answer to question 2.`;

export default function FolderCourse({ courses, onAdd }: Props) {
  // The folder read last time, to start from (this component is only ever drawn in the browser).
  const [path, setPath] = useState(() => {
    try {
      return localStorage.getItem(LAST) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState<"" | "read" | "starter">("");
  const [err, setErr] = useState("");
  const [outline, setOutline] = useState<FolderOutline | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => input.current?.focus(), []);

  const read = async (starter = false) => {
    if (!path.trim() || busy) return;
    setBusy(starter ? "starter" : "read");
    setErr("");
    setOutline(null);
    try {
      const o = await readCourse(path.trim(), starter);
      setOutline(o);
      try {
        localStorage.setItem(LAST, o.path);
      } catch {
        /* not remembered */
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const lessons = outline?.units.flatMap((u) => u.lessons) ?? [];
  const sum = (k: "analogies" | "examples" | "exercises") => lessons.reduce((n, l) => n + l[k], 0);
  const existing = outline ? courses.find((c) => c.folder?.path === outline.path || c.name === outline.name) : undefined;

  return (
    <div className="folder-course">
      <section className="fc-ask">
        <p className="eyebrow">A course from a folder</p>
        <h2>Teach me from my own lessons</h2>
        <p className="lead">
          Point Learn at a folder of lessons, in any subject, and the professor teaches it in your order: your words and analogies on the board, your exercises to solve with hints first, and answers checked against your own model answers.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void read();
          }}
        >
          <label htmlFor="fc-path">The course&rsquo;s folder on this computer</label>
          <div className="fc-row">
            <input id="fc-path" ref={input} className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\you\my-course   or   /home/you/my-course" spellCheck={false} autoComplete="off" />
            <button className="ctl primary" type="submit" disabled={!!busy || !path.trim()}>{busy === "read" ? "Reading…" : "Read the folder"}</button>
          </div>
        </form>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="fc-starter">
          <p className="eyebrow">Starting from nothing?</p>
          <p className="note">Type the path of a folder that does not exist yet (or is empty) above, and Learn writes a small starter course there: three lessons in the shapes it reads, to copy and change.</p>
          <div className="fc-row">
            <button className="ctl" type="button" disabled={!!busy || !path.trim()} onClick={() => void read(true)}>{busy === "starter" ? "Writing it…" : "Make a starter course there"}</button>
          </div>
        </div>
        <p className="note">The folder is only read, by WalkMyCode on this computer. Build folders, hidden files and <code>.env</code> files are never opened.</p>
      </section>

      <section className="fc-found" aria-live="polite">
        {!outline ? (
          <div className="fc-guide">
            <div>
              <p className="eyebrow">{busy ? "Reading the folder…" : "How to structure a course"}</p>
              <h2>Any subject. Any folder of study material is a course.</h2>
            </div>
            <div>
              <h3>Use what you already have</h3>
              <p>Notes, a textbook&rsquo;s chapters, handouts, slides and past papers are read as they are. Folders are units, each document is a lesson, and its headings are the lesson&rsquo;s sections.</p>
              <p className="kinds"><span>.md</span><span>.txt</span><span>.docx</span><span>.pptx</span><span>.pdf</span></p>
              <table>
                <tbody>
                  <tr><td>A file named like a question paper</td><td><code>questions</code>, <code>worksheet</code>, <code>past paper</code>, <code>problems</code>, <code>quiz</code>, <code>exam</code>: its questions become exercise boards, with the lesson of the same number or subject, or as a lesson of their own.</td></tr>
                  <tr><td>A file named like an answer key</td><td><code>answers</code>, <code>solutions</code>, <code>mark scheme</code>: matched to its paper. The professor marks against it, point by point where it lists points. The student sees it only after three hints or a real attempt.</td></tr>
                  <tr><td>Numbers in names</td><td>Where a folder numbers some files, only the numbered ones are lessons. In a folder with no numbers, every document is.</td></tr>
                </tbody>
              </table>
              <p>Only text is read: pictures, scanned PDFs and files over 12 MB are left out.</p>
            </div>
            <div>
              <h3>Or write a course from scratch</h3>
            </div>
            <div className="cols">
              <div>
                <h3>The folder</h3>
                <pre>{TREE.map(([name, what]) => <span key={name}>{name.padEnd(26)}<i>{what}</i>{"\n"}</span>)}</pre>
              </div>
              <div>
                <h3>A lesson</h3>
                <pre>{LESSON}</pre>
              </div>
            </div>
            <div>
              <h3>What the professor does with each part</h3>
              <table>
                <thead><tr><th>You write</th><th>The professor</th></tr></thead>
                <tbody>
                  <tr><td>Numbers in names: <code>01_</code>, <code>02_</code></td><td>Teaches units and lessons in that order.</td></tr>
                  <tr><td><code># Title</code> and the first paragraph</td><td>The lesson&rsquo;s name and its summary in the outline.</td></tr>
                  <tr><td>Each <code>## Section</code></td><td>One or two boards, in your order. Nothing is added and nothing skipped.</td></tr>
                  <tr><td><code>&gt; 💡</code> a quote starting with the bulb</td><td>That section&rsquo;s analogy, in your words. Where you give none, the professor writes one in the same picture.</td></tr>
                  <tr><td><code>## Exercises</code>, a numbered list</td><td>One exercise board per question, answered in words, with hints first.</td></tr>
                  <tr><td><code>## Answers</code>, numbered the same</td><td>Marks the student&rsquo;s answer against yours. The student sees it only after three hints or a real attempt. It is never taught on a board.</td></tr>
                  <tr><td><code>exercises/</code> and <code>solutions/</code></td><td>The same, as files: <code>ex01_…</code> pairs with <code>sol01_…</code>. A <code>.md</code> file is a written exercise; a <code>.py</code> <code>.js</code> <code>.ts</code> <code>.sql</code> <code>.rs</code> file is code to write and run.</td></tr>
                  <tr><td><code>examples/</code></td><td>Code the student runs from the board with one click, then changes.</td></tr>
                  <tr><td><code>- [ ]</code> a checklist</td><td>What the lesson must cover. A lesson that only has a checklist is still taught: the professor writes it in your course&rsquo;s style.</td></tr>
                </tbody>
              </table>
            </div>
            <p>The full guide, with the rules for what counts as a lesson, is in <code>docs/COURSES.md</code>.</p>
          </div>
        ) : (
          <>
            <header className="fc-head">
              <div>
                <h2>{outline.name}</h2>
                {outline.summary && <p className="lead">{outline.summary}</p>}
                <p className="fc-stats">
                  <span><b>{outline.units.length}</b> unit{outline.units.length === 1 ? "" : "s"}</span>
                  <span><b>{lessons.length}</b> lesson{lessons.length === 1 ? "" : "s"}</span>
                  <span><b>{sum("analogies")}</b> analogies</span>
                  <span><b>{sum("examples")}</b> examples</span>
                  <span><b>{sum("exercises")}</b> exercises</span>
                </p>
              </div>
              <span className="fc-row">
                <button className="ctl" type="button" onClick={() => setOutline(null)} title="Back to how a course is structured">The guide</button>
                <button className="ctl primary" type="button" onClick={() => onAdd(courseFromOutline(outline, existing, newId(), Date.now()))}>
                  {existing ? "Update this course" : "Add this course"}
                </button>
              </span>
            </header>
            <ol className="fc-units">
              {outline.units.map((u, ui) => (
                <li key={u.title}>
                  <p className="fc-unit"><span className="n">{ui + 1}</span>{u.title}</p>
                  <ol>
                    {u.lessons.map((l) => (
                      <li key={l.id}>
                        <span className="t">{l.title}</span>
                        <span className="s">{l.summary}</span>
                        <span className="tags">
                          {l.analogies > 0 && <span title="Analogies in the lesson">💡 {l.analogies}</span>}
                          {l.examples > 0 && <span title="Runnable examples">▶ {l.examples}</span>}
                          {l.exercises > 0 && <span title="Exercises">◇ {l.exercises}</span>}
                          {l.sections + l.analogies + l.examples + l.exercises === 0 && <span className="dim" title="Only its title so far: the professor writes the lesson in the course's style">outline only</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
