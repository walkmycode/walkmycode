"use client";
/** The Learn home (docs/design/learn-home.html): one front door ("What do you want to learn today?"),
 *  the lesson to carry on beside it, the numbers, every course as a card with its cover drawing and its
 *  next step, and a side column with what the professor knows about the student and the week's recall.
 *  It fills the width like the Explore home (learn.css, "The Learn home"). */
import Link from "next/link";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { lastLine, type Chat } from "@/learn/lib/chat";
import { ago } from "@/learn/lib/notebook";
import { useNow } from "@/learn/lib/now";
import { DAY, type Card } from "@/learn/lib/recall";
import { nextModule, nextUntaught } from "@/learn/lib/roadmap";
import type { Store } from "@/learn/lib/store";
import type { Course, Lesson, Profile, RoadmapModule } from "@/learn/lib/types";
import Roadmap from "./Roadmap";

const Cover = lazy(() => import("./LibraryArt").then((m) => ({ default: m.Cover })));
const Pic = lazy(() => import("./LibraryArt").then((m) => ({ default: m.Pic })));

/** What the front door asks for: a lesson on this, in this course (none: a new one), at this level and length. */
export type Start = { topic: string; course?: string; level: string; boards: number };

export const LEVELS = ["Complete beginner", "Some basics", "Intermediate", "Advanced"];
export const LENGTHS = [
  { boards: 7, label: "Short · 7 boards" },
  { boards: 10, label: "Normal · 10 boards" },
  { boards: 13, label: "Long · 13 boards" },
];
const NEW = "";

type Props = {
  lessons: Lesson[];
  profile: Profile;
  canWrite: boolean;
  /** Where the work is kept; the "carry on" card reads the last conversation from it. */
  store: Store;
  /** The recall cards of the lessons taught, for what is due today and this week. */
  cards: Card[];
  onRecall: () => void;
  onOpen: (l: Lesson) => void;
  /** Write a lesson now, from the front door or a course's "Next lesson". */
  onStart: (s: Start) => void;
  onDelete: (l: Lesson) => void;
  onProfile: (p: Profile) => void;
  onCode: () => void;
  /** A course from a folder on this computer (only where lessons are kept on this computer). */
  onFolder?: () => void;
  roadmaps: Course[];
  /** Plan a road to mastery for a course that has none yet. */
  onPlan: (courseName: string) => Promise<void>;
  onStartModule: (courseName: string, stage: string, module: RoadmapModule) => void;
};

/** A course's colour, the same every time: from the drawings' tints, by its name. */
const TINTS = ["#7fbfe6", "#f0a94b", "#b79cf0", "#8fd69a", "#ee8f86", "#f3d77a"];
function tintOf(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** Fresh subjects for the front door, a different two each day. */
const FRESH = [
  { t: "How HTTPS works", topic: "How HTTPS keeps a password safe on its way to a website", art: "padlock" },
  { t: "SQL joins", topic: "SQL joins: how two tables are matched up, row by row", art: "database" },
  { t: "How Git remembers", topic: "How Git remembers every change: commits, branches and merges", art: "branch" },
  { t: "Why code gets slow", topic: "Big-O: why some code gets slow as the data grows", art: "hourglass" },
  { t: "How the internet finds a site", topic: "DNS: how a name like example.com becomes an address", art: "dns" },
  { t: "How a CPU runs code", topic: "How a CPU runs a program, one instruction at a time", art: "chip" },
];

const greeting = (now: number) => {
  const h = new Date(now).getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const next = (road: Course | undefined, lessons: Lesson[]) => (road ? (nextUntaught(road, lessons) ?? nextModule(road, lessons)) : null);

function Art({ children, size }: { children: ReactNode; size?: string }) {
  return <Suspense fallback={<span className={`lh-art ${size ?? ""}`} />}><span className={`lh-art ${size ?? ""}`}>{children}</span></Suspense>;
}

export default function Library({ lessons, profile, canWrite, store, cards, onRecall, onOpen, onStart, onDelete, onProfile, onCode, onFolder, roadmaps, onPlan, onStartModule }: Props) {
  const now = useNow();
  const [planning, setPlanning] = useState<string | null>(null);
  const [showRoad, setShowRoad] = useState<Record<string, boolean>>({});
  const plan = async (name: string) => {
    setPlanning(name);
    try {
      await onPlan(name);
      setShowRoad((s) => ({ ...s, [name]: true }));
    } finally {
      setPlanning(null);
    }
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [manage, setManage] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "going" | "done">("all");

  // The front door.
  const [topic, setTopic] = useState("");
  const [course, setCourse] = useState(NEW);
  const [level, setLevel] = useState(LEVELS[0]);
  const [boards, setBoards] = useState(10);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const toDoor = (c: string, t = "") => {
    setCourse(c);
    setTopic(t);
    box.current?.focus();
    box.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  // A course with lessons can start empty: the professor picks the next step. A new course needs a subject.
  const ready = canWrite && (topic.trim().length > 1 || course !== NEW);
  const start = () => {
    if (ready) onStart({ topic: topic.trim(), ...(course ? { course } : {}), level, boards });
  };

  const courses = useMemo(() => {
    const m = new Map<string, Lesson[]>();
    for (const l of [...lessons].sort((a, b) => a.number - b.number)) m.set(l.course, [...(m.get(l.course) ?? []), l]);
    // A course with a roadmap and no lesson yet (one just added from a folder) is listed too, newest first.
    for (const c of [...roadmaps].sort((a, b) => b.updatedAt - a.updatedAt)) if (!m.has(c.name)) m.set(c.name, []);
    // The course worked on last comes first.
    const last = (list: Lesson[], name: string) => Math.max(0, ...list.map((l) => l.updatedAt), roadmaps.find((c) => c.name === name)?.updatedAt ?? 0);
    return [...m.entries()].sort((a, b) => last(b[1], b[0]) - last(a[1], a[0]));
  }, [lessons, roadmaps]);
  const finished = (list: Lesson[], road: Course | undefined) => list.length > 0 && list.every((l) => l.seen.length >= l.boards.length) && (!road || !next(road, list));
  const shown = courses.filter(([name, list]) => show === "all" || (show === "done") === finished(list, roadmaps.find((c) => c.name === name)));

  const recent = [...lessons].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  // Where the conversation stopped, for the "carry on" card.
  const recentId = recent?.id;
  const [talk, setTalk] = useState<{ id: string; line: string } | null>(null);
  useEffect(() => {
    if (!recentId) return;
    let on = true;
    void store
      .loadExtra<Chat>(`chat-${recentId}`)
      .then((c) => on && setTalk({ id: recentId, line: lastLine(c) }))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [store, recentId]);
  const said = talk && talk.id === recentId ? talk.line : "";

  // The numbers.
  const seen = lessons.reduce((n, l) => n + Math.min(l.seen.length, l.boards.length), 0);
  const total = lessons.reduce((n, l) => n + l.boards.length, 0);
  const marked = lessons.filter((l) => l.feedback);
  const mark = marked.length ? Math.round((marked.reduce((n, l) => n + (l.feedback?.score ?? 0), 0) / marked.length) * 10) / 10 : null;
  // Recall this week: today counts everything already due.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const end = today.getTime() + (i + 1) * DAY;
    return { day: new Date(today.getTime() + i * DAY).toLocaleDateString(undefined, { weekday: "short" }), n: cards.filter((c) => c.due < end && (i === 0 || c.due >= end - DAY)).length };
  });
  const due = cards.filter((c) => c.due <= now).length;
  const later = week.slice(1).find((d) => d.n > 0);

  // The front door's ideas: the next step in the courses worked on last, then two fresh subjects.
  const ideas = [
    ...courses
      .filter(([, list]) => list.length)
      .slice(0, 3)
      .map(([name, list]) => {
        const n = next(roadmaps.find((c) => c.name === name), list);
        return { key: name, t: `Next in ${name.split(/[:,]/)[0]}`, s: n?.module.title, course: name, topic: n?.module.title ?? "", art: undefined as string | undefined, words: [name, ...list.map((l) => l.title)].join(" "), tint: tintOf(name) as string | undefined };
      }),
    ...[0, 1].map((i) => {
      const f = FRESH[(Math.floor(now / DAY) + i * 3) % FRESH.length];
      return { key: f.t, t: f.t, s: undefined, course: NEW, topic: f.topic, art: f.art, words: "", tint: undefined };
    }),
  ];

  const lessonLabel = (n: number) => `${n} lesson${n === 1 ? "" : "s"}`;

  return (
    <div className="hall library lh">
      <section className={`lh-hero${recent ? "" : " solo"}`}>
        <div className="lh-door">
          <p className="lh-hello">{greeting(now)}{profile.name ? `, ${profile.name}` : ""}</p>
          <h1>What do you want to <em>learn</em> today?</h1>
          <form
            className="lh-compose"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <textarea
              ref={box}
              aria-label="What do you want to learn?"
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  start();
                }
              }}
              placeholder={course ? `The next step in ${course}, or name what you want` : "Any subject. e.g. “How does HTTPS keep my password safe?” or “Teach me SQL joins with a football league example”"}
            />
            <div className="lh-row">
              <label className="lh-pick">
                <span>In</span>
                <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Course">
                  <option value={NEW}>A new course</option>
                  {courses.map(([name]) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="lh-pick">
                <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Your level">
                  {LEVELS.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <label className="lh-pick">
                <select value={boards} onChange={(e) => setBoards(+e.target.value)} aria-label="Length">
                  {LENGTHS.map((l) => <option key={l.boards} value={l.boards}>{l.label}</option>)}
                </select>
              </label>
              <span className="sp" />
              <button className="lh-go" type="submit" disabled={!ready}>
                <span>Start the lesson</span> <kbd>Enter</kbd>
              </button>
            </div>
          </form>
          <div className="lh-ideas">
            {ideas.map((x) => (
              <button key={x.key} className="lh-idea" type="button" onClick={() => toDoor(x.course, x.topic)}>
                <Art size="sm"><Pic name={x.art} words={x.words} tint={x.tint} /></Art>
                {x.t}
                {x.s && <small>{x.s}</small>}
              </button>
            ))}
          </div>
          <div className="lh-doors">
            <Link href="/map" title="Open a project in Explore, then choose “Teach me this” on any file or card">
              <Art size="sm"><Pic name="code" tint="#9fd3f0" /></Art>Learn from my own code
            </Link>
            {onFolder && (
              <button type="button" onClick={onFolder}>
                <Art size="sm"><Pic name="folder" tint="#f3d77a" /></Art>A course from a folder
              </button>
            )}
            <button type="button" onClick={onCode}>
              <Art size="sm"><Pic name="terminal" tint="#8fd69a" /></Art>Practise in the Code room
            </button>
          </div>
        </div>

        {recent && (
          <button className="lh-resume" type="button" onClick={() => onOpen(recent)} style={{ "--c": tintOf(recent.course) } as CSSProperties}>
            <span className="lh-cover">
              <span className="lh-tag">Carry on</span>
              <Suspense fallback={null}><Cover texts={[recent.title, recent.subject ?? "", recent.course]} seed={recent.id} tint={tintOf(recent.course)} /></Suspense>
            </span>
            <span className="lh-rbody">
              <span className="lh-meta">{recent.course} · Lesson {recent.number} · {ago(recent.updatedAt, now)}</span>
              <span className="lh-title">{recent.title}</span>
              {said && <span className="lh-said">{said}</span>}
              <span className="lh-rfoot">
                <span className="lh-steps" aria-label={`Board ${Math.min(recent.at + 1, recent.boards.length)} of ${recent.boards.length}`}>
                  {recent.boards.map((_, i) => <i key={i} className={i === recent.at ? "at" : recent.seen.includes(i) ? "on" : ""} />)}
                </span>
                <span className="lh-play">▶ Board {Math.min(recent.at + 1, recent.boards.length)} of {recent.boards.length}</span>
              </span>
            </span>
          </button>
        )}
      </section>

      <section className="lh-stats">
        <div><Art size="md"><Pic name="book" tint="#f3d77a" /></Art><span><b>{courses.length}</b>{courses.length === 1 ? "course" : "courses"} · {lessonLabel(lessons.length)}</span></div>
        <div><Art size="md"><Pic name="checklist" tint="#8fd69a" /></Art><span><b>{seen} / {total}</b>boards seen</span></div>
        <div><Art size="md"><Pic name="trophy" tint="#f0a94b" /></Art><span><b>{mark === null ? "—" : `${mark}/10`}</b>{mark === null ? "no explain-back yet" : `explain-back, over ${lessonLabel(marked.length)}`}</span></div>
        <button type="button" onClick={onRecall} disabled={!due}>
          <Art size="md"><Pic name="hourglass" tint="#b79cf0" /></Art>
          <span><b>{due} due</b>{due ? "recall: review them now" : later ? `recall: next on ${later.day}` : "recall: nothing waiting"}</span>
        </button>
      </section>

      <section className="lh-below">
        <div className="lh-main">
          <div className="lh-head">
            <h2>Your courses</h2>
            <div className="lh-seg" role="group" aria-label="Show">
              {(["all", "going", "done"] as const).map((k) => (
                <button key={k} type="button" className={show === k ? "on" : ""} aria-pressed={show === k} onClick={() => setShow(k)}>
                  {k === "all" ? "All" : k === "going" ? "In progress" : "Finished"}
                </button>
              ))}
            </div>
            <span className="sp" />
            {canWrite && <button className="link" type="button" onClick={() => toDoor(NEW)}>+ New course</button>}
          </div>
          <div className="lh-grid">
            {shown.map(([name, list]) => {
              const road = roadmaps.find((c) => c.name === name);
              const roadOpen = !!road && (showRoad[name] ?? list.length === 0);
              const step = next(road, list);
              const tint = tintOf(name);
              const read = list.reduce((n, l) => n + Math.min(l.seen.length, l.boards.length), 0);
              const of = list.reduce((n, l) => n + l.boards.length, 0);
              const modules = road?.stages.reduce((n, s) => n + s.modules.length, 0);
              const pct = of ? Math.round((read / of) * 100) : 0;
              return (
                <article key={name} className={`lh-course${roadOpen ? " wide" : ""}`} style={{ "--c": tint } as CSSProperties}>
                  <div className="lh-cover small">
                    {road?.folder && <span className="lh-from" title={road.folder.path}>From a folder</span>}
                    <Suspense fallback={null}><Cover texts={[name, ...list.map((l) => l.title)]} seed={name} tint={tint} /></Suspense>
                  </div>
                  <div className="lh-cbody">
                    <h3>{name}</h3>
                    <div className="lh-cmeta">
                      <span>{lessonLabel(list.length)}{modules ? ` of ${modules}` : ""}</span>
                      <span className="lh-bar"><i style={{ width: `${pct}%` }} /></span>
                      <span className="mono">{pct}%</span>
                    </div>
                  </div>
                  {roadOpen && road && <div className="lh-road"><Roadmap course={road} lessons={lessons} canWrite={canWrite} onOpen={onOpen} onStart={(stage, m) => onStartModule(name, stage, m)} /></div>}
                  <ol className="lh-lessons">
                    {list.map((l) => (
                      <li key={l.id}>
                        <button type="button" className="lh-lesson" onClick={() => onOpen(l)}>
                          <span className="n">{l.number}</span>
                          <span className="body">
                            <span className="t">{l.title}</span>
                            <span className="s">{l.summary}</span>
                          </span>
                          {l.feedback ? (
                            <span className="lh-score" title="Your explain-back mark">{l.feedback.score}/10</span>
                          ) : (
                            <span className="lh-ring" style={{ "--p": Math.round((Math.min(l.seen.length, l.boards.length) / Math.max(1, l.boards.length)) * 100) } as CSSProperties} title={`${Math.min(l.seen.length, l.boards.length)} of ${l.boards.length} boards seen`} />
                          )}
                        </button>
                        {canWrite && manage === name && (confirm === l.id ? (
                          <span className="lh-confirm">
                            Delete this lesson?
                            <button className="link danger" type="button" onClick={() => { setConfirm(null); onDelete(l); }}>Delete</button>
                            <button className="link" type="button" onClick={() => setConfirm(null)}>Keep</button>
                          </span>
                        ) : (
                          <button className="link quiet lh-del" type="button" aria-label={`Delete ${l.title}`} onClick={() => setConfirm(l.id)}>Delete</button>
                        ))}
                      </li>
                    ))}
                    {canWrite && !finished(list, road) && !road?.folder && (
                      <li className="lh-next">
                        <span className="n">{(list.at(-1)?.number ?? 0) + 1}</span>
                        <span>Next: {step?.module.title ?? "the professor picks the next step"}</span>
                      </li>
                    )}
                  </ol>
                  {canWrite && (
                    <div className="lh-cfoot">
                      {road?.folder ? (
                        step && <button className="lh-btn pri" type="button" onClick={() => onStartModule(name, step.stage, step.module)}>Next lesson →</button>
                      ) : (
                        <button className="lh-btn pri" type="button" onClick={() => onStart({ topic: step?.module.title ?? "", course: name, level, boards })}>Next lesson →</button>
                      )}
                      {road ? (
                        <button className="lh-btn" type="button" aria-expanded={roadOpen} onClick={() => setShowRoad((s) => ({ ...s, [name]: !roadOpen }))}>
                          {roadOpen ? (road.folder ? "Hide the outline" : "Hide the road") : road.folder ? "Course outline" : "Road to mastery"}
                        </button>
                      ) : (
                        <button className="lh-btn" type="button" disabled={planning === name} onClick={() => void plan(name)}>
                          {planning === name ? "Planning the road…" : "Plan the road"}
                        </button>
                      )}
                      {list.length > 0 && (
                        <button className={`lh-btn more${manage === name ? " on" : ""}`} type="button" aria-pressed={manage === name} title="Delete lessons" onClick={() => { setConfirm(null); setManage(manage === name ? null : name); }}>
                          {manage === name ? "Done" : "⋯"}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {canWrite && show !== "done" && (
              <button className="lh-add" type="button" onClick={() => toDoor(NEW)}>
                <span className="plus">+</span>
                <b>Start a new course</b>
                <span>Any subject. Type it at the top; the professor writes the first lesson, and can plan the road to mastery.</span>
              </button>
            )}
            {!shown.length && show === "done" && <p className="note">No course is finished yet.</p>}
          </div>
        </div>

        <aside className="lh-side">
          <section className="lh-box">
            <div className="lh-bhead">
              <h2>What the professor knows about you</h2>
              {canWrite && !editing && <button className="link" type="button" onClick={() => { setDraft(profile); setEditing(true); }}>Edit</button>}
            </div>
            {editing ? (
              <form
                className="lh-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  onProfile({ name: draft.name.trim(), about: draft.about.trim() });
                  setEditing(false);
                }}
              >
                <label htmlFor="p-name">Your name</label>
                <input id="p-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <label htmlFor="p-about">About you: what you know, what you are working towards, how you like to learn</label>
                <textarea id="p-about" value={draft.about} onChange={(e) => setDraft({ ...draft, about: e.target.value })} />
                <div className="row">
                  <button className="ctl primary" type="submit">Save</button>
                  <button className="ctl" type="button" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="lh-prof">
                <span className="lh-face"><Art size="lg"><Pic name="scientist" /></Art></span>
                <p>{profile.name ? `${profile.name}: ` : ""}{profile.about}</p>
              </div>
            )}
          </section>
          <section className="lh-box">
            <div className="lh-bhead">
              <h2>Recall</h2>
              <span className="lh-faint">this week</span>
            </div>
            <p className="lh-p">{due > 0 ? `${due} idea${due === 1 ? " is" : "s are"} due to be remembered today.` : "Nothing is due today. Each lesson's key ideas come back just before you would forget them."}</p>
            <div className="lh-week">
              {week.map((d, i) => (
                <div key={i} className={i === 0 ? "today" : ""}>
                  <i className={d.n ? "has" : ""}>{d.n}</i>
                  {d.day}
                </div>
              ))}
            </div>
            {due > 0 && <button className="ctl primary" type="button" onClick={onRecall}>Review {due} card{due === 1 ? "" : "s"}</button>}
          </section>
          <p className="lh-saved" title={store.where ?? undefined}>
            <span className="dot" />
            {store.kind === "account"
              ? "Saved to your account, visible only to you"
              : store.kind === "computer"
                ? <><span className="lh-nw">Saved on this computer</span>{store.where ? <code>{store.where}</code> : null}</>
                : "Saved in this browser only"}
          </p>
          {store.imported ? <p className="lh-saved">{store.imported} lesson{store.imported === 1 ? " was" : "s were"} copied here from this browser.</p> : null}
        </aside>
      </section>
    </div>
  );
}
