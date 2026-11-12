"use client";
/** Ask the professor for a lesson: any subject, a new course or the next
 *  step in one already running. */
import { useEffect, useRef, useState } from "react";
import { sampleMessage, type Sample } from "@/learn/lib/claude";
import { exerciseBoards, type FolderLesson } from "@/learn/lib/courseFolder";
import { folderBoards, folderLessonPrompt, folderTalkBoards, lessonPrompt, writeFolderLessonInSteps, writeLesson, type StepProgress } from "@/learn/lib/professor";
import { newId, now as clock } from "@/learn/lib/store";
import type { Course, Lesson, Profile, RoadmapModule } from "@/learn/lib/types";
import { nextModule, nextUntaught } from "@/learn/lib/roadmap";
import type { TeachRequest } from "@/learn/links";

type Props = {
  sample: Sample | null;
  profile: Profile;
  lessons: Lesson[];
  course?: string;
  /** From the Explore room: teach this concept using the student's own code. */
  teach?: TeachRequest;
  /** A roadmap module to teach (from the roadmap's "Learn this now"). */
  module?: { stage: string; module: RoadmapModule };
  roadmap?: Course;
  onRoadmap: (c: Course) => void;
  planRoadmap: (name: string, goal: string, level: string) => Promise<Course>;
  /** The finished lesson, and the recall cards the professor wrote for it. */
  onDone: (l: Lesson, cards?: unknown) => void;
};

/** One lesson's files from the course folder (src/lib/learnCourse.ts). */
async function readFolderLesson(path: string, lesson: string): Promise<FolderLesson> {
  const res = await fetch("/api/learn/course", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, lesson }) });
  const body = (await res.json().catch(() => null)) as { lesson?: FolderLesson; error?: unknown } | null;
  if (!res.ok || !body?.lesson) throw { code: "folder", message: typeof body?.error === "string" ? body.error : "The lesson's folder could not be read." };
  return body.lesson;
}

/** A lesson whose text is longer than this is written in steps, so all of it is read. */
const LONG_LESSON = 24000;

const LEVELS = ["Complete beginner", "Some basics", "Intermediate", "Advanced"];
const NEW = "__new__";

const FROM_CODE = "From my code";

function teachNotes(t: TeachRequest) {
  const where = t.file ? ` (${t.file}${t.start ? `, lines ${t.start}${t.end && t.end !== t.start ? `–${t.end}` : ""}` : ""})` : "";
  return t.snippet
    ? `I met this in my own project${where}. Use this code as the running example, and explain it line by line near the end:

${t.snippet}`
    : `I met this in my own project${where}. Use examples like the code I am working on.`;
}

export default function NewLesson({ sample, profile, lessons, course, teach, module, roadmap, planRoadmap, onDone }: Props) {
  const courses = [...new Set(lessons.map((l) => l.course))];
  const [pick, setPick] = useState(teach ? (courses.includes(FROM_CODE) ? FROM_CODE : NEW) : course ?? (courses.length ? courses[0] : NEW));
  const [newCourse, setNewCourse] = useState(teach ? FROM_CODE : "");
  const [topic, setTopic] = useState(teach?.topic ?? module?.module.title ?? "");
  const [planRoad, setPlanRoad] = useState(!teach);
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState<"road" | "lesson">("lesson");
  const [level, setLevel] = useState(LEVELS[0]);
  const [boards, setBoards] = useState(10);
  const [notes, setNotes] = useState(teach ? teachNotes(teach) : "");
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState(0);
  const [err, setErr] = useState("");
  const ctl = useRef<AbortController | null>(null);
  // Leaving (the top bar's "All lessons") stops a lesson still being written.
  useEffect(() => () => ctl.current?.abort(), []);

  const courseName = pick === NEW ? newCourse.trim() : pick;
  const earlier = lessons.filter((l) => l.course === courseName).sort((a, b) => a.number - b.number);
  const canGuess = earlier.length > 0 || !!roadmap;
  const isNewCourse = pick === NEW;
  const ready = !!sample && !!courseName && (topic.trim().length > 1 || canGuess);
  // A course taught from a folder: the lesson is the roadmap's module, written from that folder's files.
  const fromFolder = roadmap?.folder ? (module ?? nextUntaught(roadmap, lessons) ?? nextModule(roadmap, lessons)) : null;
  const [planned, setPlanned] = useState(0);
  /** A long lesson being written in steps, for a provider that refused it whole. */
  const [stepping, setStepping] = useState<StepProgress | null>(null);

  const write = async () => {
    if (!sample || !ready) return;
    ctl.current = new AbortController();
    setBusy(true);
    setErr("");
    setWritten(0);
    try {
      if (roadmap?.folder && fromFolder) {
        setPhase("lesson");
        const material = await readFolderLesson(roadmap.folder.path, fromFolder.module.id);
        setPlanned(folderTalkBoards(material) + 2);
        setStepping(null);
        let out: Awaited<ReturnType<typeof writeLesson>>;
        try {
          // A long document (a textbook chapter, a deck of a hundred slides) is written part by part from the start:
          // asked for whole, its end would be cut off before the professor read it.
          if (material.readme.length > LONG_LESSON) throw { code: "prompt_too_large" };
          out = await writeLesson(sample, folderLessonPrompt(material, courseName, profile, earlier), setWritten, ctl.current.signal);
        } catch (e) {
          // Too much for this provider in one request (a free plan's per-minute limit): write it in steps.
          const code = (e as { code?: string })?.code;
          if (code !== "prompt_too_large" && code !== "rate_limited") throw e;
          out = await writeFolderLessonInSteps(sample, material, courseName, profile, setStepping, ctl.current.signal);
        }
        if (!out) throw { code: "invalid_json" };
        const now = clock();
        onDone(
          {
            id: newId(),
            course: courseName,
            number: (earlier.at(-1)?.number ?? 0) + 1,
            title: out.title || material.title,
            subject: material.title,
            summary: out.summary,
            boards: folderBoards(out.boards, material, exerciseBoards(material)),
            createdAt: now,
            updatedAt: now,
            at: 0,
            seen: [0],
            moduleId: fromFolder.module.id,
            folder: material.id,
          },
          out.cards,
        );
        return;
      }
      // A new course can start with its road to mastery; the first lesson is then its first module.
      let road = roadmap;
      if (!road && isNewCourse && planRoad) {
        setPhase("road");
        road = await planRoadmap(courseName, goal.trim(), level);
      }
      setPhase("lesson");
      const target = module ?? (road && !topic.trim() ? nextModule(road, lessons) : null);
      const t = topic.trim() || target?.module.title || "the natural next step after the lessons already taught, chosen by you";
      const prompt = lessonPrompt(
        {
          topic: t,
          course: courseName,
          level,
          boards,
          notes: notes.trim(),
          ...(road ? { roadmap: road } : {}),
          ...(target ? { module: { stage: target.stage, title: target.module.title, summary: target.module.summary, topics: target.module.topics } } : {}),
        },
        profile,
        earlier,
      );
      const out = await writeLesson(sample, prompt, setWritten, ctl.current.signal);
      if (!out) throw { code: "invalid_json" };
      const now = clock();
      onDone({
        id: newId(),
        course: courseName,
        number: (earlier.at(-1)?.number ?? 0) + 1,
        title: out.title,
        subject: topic.trim() || courseName,
        summary: out.summary,
        boards: out.boards,
        createdAt: now,
        updatedAt: now,
        at: 0,
        seen: [0],
        ...(target ? { moduleId: target.module.id } : {}),
        ...(teach?.file ? { source: { file: teach.file, ...(teach.start ? { start: teach.start } : {}), ...(teach.end ? { end: teach.end } : {}) } } : {}),
      }, out.cards);
    } catch (e) {
      setErr((e as { code?: string }).code === "folder" ? (e as { message: string }).message : sampleMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="hall">
      <div className="frame">
        <section className="board">
          {busy ? (
            <div className="writing" role="status">
              <h2>{phase === "road" ? "The professor is planning your road to mastery…" : "The professor is preparing the boards…"}</h2>
              <p className="lines">
                {stepping
                  ? stepping.waiting
                    ? `Part ${stepping.step} of ${stepping.steps}: waiting ${stepping.waiting} seconds for the provider's per-minute limit, then carrying on.`
                    : `This lesson is long for the provider in use, so it is being written in ${stepping.steps} smaller parts. Part ${stepping.step} of ${stepping.steps}; ${stepping.boards} board${stepping.boards === 1 ? "" : "s"} so far.`
                  : phase === "road"
                  ? "Five stages, from the foundations to expert work. Then the first lesson."
                  : written > 0
                    ? `Board ${Math.min(written, planned || boards)} of ${planned || boards} written.`
                    : "Thinking about how to teach it. This takes up to a couple of minutes."}
              </p>
              <div className="chalk-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, stepping ? ((stepping.step - 1) / stepping.steps) * 100 : (written / (planned || boards)) * 100)}%` }} /></div>
              <button className="chalk-btn ghost" type="button" onClick={() => { ctl.current?.abort(); setBusy(false); }}>Stop</button>
            </div>
          ) : roadmap?.folder && !fromFolder ? (
            <div className="writing">
              <h2>You have reached the end of {roadmap.name}.</h2>
              <p className="lines">Every lesson in the folder has been passed. Add more lessons to the folder, then choose &ldquo;Course from a folder&rdquo; to read it again.</p>
            </div>
          ) : roadmap?.folder && fromFolder ? (
            <form className="form from-folder" onSubmit={(e) => { e.preventDefault(); void write(); }}>
              <p className="eyebrow">{roadmap.name} · {fromFolder.stage}</p>
              <h2>{fromFolder.module.title}</h2>
              {fromFolder.module.summary && <p className="lines">{fromFolder.module.summary}</p>}
              <p className="note">Taught from <code>{roadmap.folder.path}</code> · <code>{fromFolder.module.id}</code>{fromFolder.module.topics.length ? ` · ${fromFolder.module.topics.join(" · ")}` : ""}</p>
              <p className="note">The professor reads the lesson&rsquo;s README, examples and exercises, then teaches it in the author&rsquo;s order, with an analogy on every board. The exercises are the folder&rsquo;s own, checked against its solutions.</p>
              {err && <p className="err">{err}</p>}
              {!sample && <p className="err">Writing new lessons needs an AI provider. Choose one in Settings.</p>}
              <div className="row">
                <button className="chalk-btn" type="submit" disabled={!sample}>Prepare the lesson</button>
              </div>
            </form>
          ) : (
            <form className="form" onSubmit={(e) => { e.preventDefault(); void write(); }}>
              <label htmlFor="course">Course</label>
              <select id="course" value={pick} onChange={(e) => setPick(e.target.value)}>
                {courses.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={NEW}>A new course…</option>
              </select>
              {pick === NEW && (
                <>
                  <label htmlFor="new-course">Name of the new course</label>
                  <input id="new-course" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} placeholder="e.g. Software engineering, Calculus, Phonetics" />
                  <label className="check-row" htmlFor="plan-road">
                    <input id="plan-road" type="checkbox" checked={planRoad} onChange={(e) => setPlanRoad(e.target.checked)} />
                    Plan the road from beginner to mastery first (five stages of modules), then start at the first module
                  </label>
                  {planRoad && (
                    <>
                      <label htmlFor="goal">Where do you want this to take you? (optional)</label>
                      <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. build and ship production web apps; pass a PhD qualifying exam" />
                    </>
                  )}
                </>
              )}
              {module && <p className="note">From the roadmap: {module.stage} · <b>{module.module.title}</b>{module.module.topics.length ? ` (${module.module.topics.join(", ")})` : ""}</p>}

              <label htmlFor="topic">What should this lesson teach?</label>
              <input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={canGuess ? "Leave empty and the professor picks the next step" : "e.g. What is a formant?"}
              />
              {canGuess && <p className="note">Lesson {(earlier.at(-1)?.number ?? 0) + 1} of this course. The professor builds on the {earlier.length} before it, and on your explain-back marks.</p>}

              <div className="grid2">
                <div>
                  <label htmlFor="level">Your level in this</label>
                  <select id="level" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {LEVELS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="boards">Length</label>
                  <select id="boards" value={boards} onChange={(e) => setBoards(+e.target.value)}>
                    <option value={7}>Short · 7 boards</option>
                    <option value={10}>Normal · 10 boards</option>
                    <option value={13}>Long · 13 boards</option>
                  </select>
                </div>
              </div>

              <label htmlFor="notes">Anything else? (optional)</label>
              <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Use examples from speech, I keep mixing up F1 and F2." />

              {err && <p className="err">{err}</p>}
              {!sample && <p className="err">Writing new lessons needs Claude. Open this page in Claude and allow it when asked.</p>}
              <div className="row">
                <button className="chalk-btn" type="submit" disabled={!ready}>Write the lesson</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
