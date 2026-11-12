"use client";
/** The timetable: every course and lesson, a way to start a new one, and
 *  what the professor knows about the student. It fills the width like the
 *  home page: courses and their lessons as cards in columns, with the profile
 *  beside them on wide screens and below them on narrow ones (learn.css). */
import { useEffect, useState } from "react";
import { lastLine, type Chat } from "@/learn/lib/chat";
import { ago } from "@/learn/lib/notebook";
import { useNow } from "@/learn/lib/now";
import type { Store } from "@/learn/lib/store";
import type { Course, Lesson, Profile, RoadmapModule } from "@/learn/lib/types";
import Roadmap from "./Roadmap";

type Props = {
  lessons: Lesson[];
  profile: Profile;
  canWrite: boolean;
  /** Where the work is kept; the "carry on" card reads the last conversation from it. */
  store: Store;
  /** Recall cards due now. */
  due: number;
  onRecall: () => void;
  onOpen: (l: Lesson) => void;
  onNew: (course?: string) => void;
  onDelete: (l: Lesson) => void;
  onProfile: (p: Profile) => void;
  roadmaps: Course[];
  /** Plan a road to mastery for a course that has none yet. */
  onPlan: (courseName: string) => Promise<void>;
  onStartModule: (courseName: string, stage: string, module: RoadmapModule) => void;
};

export default function Library({ lessons, profile, canWrite, store, due, onRecall, onOpen, onNew, onDelete, onProfile, roadmaps, onPlan, onStartModule }: Props) {
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

  const courses = new Map<string, Lesson[]>();
  for (const l of [...lessons].sort((a, b) => a.number - b.number)) {
    courses.set(l.course, [...(courses.get(l.course) ?? []), l]);
  }
  // A course with a roadmap and no lesson yet (one just added from a folder) is listed too, newest first.
  for (const c of [...roadmaps].sort((a, b) => b.updatedAt - a.updatedAt)) if (!courses.has(c.name)) courses.set(c.name, []);
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

  return (
    <div className="hall library">
      <div className="lib-main">
        {recent && (
          <button className="resume" type="button" onClick={() => onOpen(recent)}>
            <span className="eyebrow">Carry on where you stopped</span>
            <span className="t">Lesson {recent.number} · {recent.title}</span>
            <span className="m">{recent.course} · board {Math.min(recent.at + 1, recent.boards.length)} of {recent.boards.length} · {ago(recent.updatedAt, now)}</span>
            {said && <span className="said">{said}</span>}
          </button>
        )}

        <div className="lib-courses">
          {[...courses.entries()].map(([course, list]) => (
            <section className={`course${roadmaps.some((c) => c.name === course) && (showRoad[course] ?? list.length === 0) ? " wide" : ""}`} key={course}>
              <div className="course-head">
                <h2>{course}</h2>
                {(() => {
                  const road = roadmaps.find((c) => c.name === course);
                  if (road) {
                    const shown = showRoad[course] ?? list.length === 0;
                    return (
                      <span className="row">
                        {road.folder && <span className="pill" title={road.folder.path}>From a folder</span>}
                        <button className="link" type="button" aria-expanded={shown} onClick={() => setShowRoad((s) => ({ ...s, [course]: !shown }))}>
                          {shown ? (road.folder ? "Hide the outline" : "Hide the roadmap") : road.folder ? "Course outline →" : "Road to mastery →"}
                        </button>
                      </span>
                    );
                  }
                  return canWrite ? (
                    <span className="row">
                      <button className="link" type="button" disabled={planning === course} onClick={() => void plan(course)}>
                        {planning === course ? "Planning the road to mastery…" : "Plan the road to mastery"}
                      </button>
                      <button className="link" type="button" onClick={() => onNew(course)}>Next lesson in this course →</button>
                    </span>
                  ) : null;
                })()}
              </div>
              {(() => {
                const road = roadmaps.find((c) => c.name === course);
                return road && (showRoad[course] ?? list.length === 0) ? (
                  <Roadmap course={road} lessons={lessons} canWrite={canWrite} onOpen={onOpen} onStart={(stage, m) => onStartModule(course, stage, m)} />
                ) : null;
              })()}
              <ol className="lessons">
                {list.map((l) => {
                  const done = l.seen.length >= l.boards.length;
                  return (
                    <li key={l.id}>
                      <button className="lesson" type="button" onClick={() => onOpen(l)}>
                        <span className="n">{l.number}</span>
                        <span className="body">
                          <span className="t">{l.title}</span>
                          <span className="s">{l.summary}</span>
                        </span>
                        <span className="state">
                          {l.feedback ? <span className="pill good">{l.feedback.score}/10</span> : done ? <span className="pill">Seen</span> : <span className="pill">{l.seen.length}/{l.boards.length}</span>}
                        </span>
                      </button>
                      {canWrite && (confirm === l.id ? (
                        <span className="confirm">
                          Delete this lesson?
                          <button className="link danger" type="button" onClick={() => { setConfirm(null); onDelete(l); }}>Delete</button>
                          <button className="link" type="button" onClick={() => setConfirm(null)}>Keep</button>
                        </span>
                      ) : (
                        <button className="link quiet" type="button" aria-label={`Delete ${l.title}`} onClick={() => setConfirm(l.id)}>Delete</button>
                      ))}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>

      <section className="about">
        <div className="course-head">
          <h2>What the professor knows about you</h2>
          {canWrite && !editing && <button className="link" type="button" onClick={() => { setDraft(profile); setEditing(true); }}>Edit</button>}
        </div>
        {editing ? (
          <form
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
          <p>{profile.name ? `${profile.name}: ` : ""}{profile.about}</p>
        )}
        <p className="note">
          {store.kind === "account"
            ? "Your lessons and answers are saved to your account, visible only to you."
            : store.kind === "computer"
              ? "Your lessons, conversations, notebook and recall cards are saved on this computer, so they are here after a restart and in any browser."
              : "Your lessons are saved in this browser only."}
        </p>
        {store.kind === "computer" && store.where && <p className="note"><code>{store.where}</code></p>}
        {store.imported ? <p className="note">{store.imported} lesson{store.imported === 1 ? " was" : "s were"} copied here from this browser.</p> : null}
        <div className="recall-card">
          <div className="course-head"><h2>Recall</h2></div>
          <p>{due > 0 ? `${due} idea${due === 1 ? " is" : "s are"} due to be remembered today.` : "Nothing is due. Each lesson's key ideas come back here just before you would forget them."}</p>
          {due > 0 && <button className="ctl primary" type="button" onClick={onRecall}>Review {due} card{due === 1 ? "" : "s"}</button>}
        </div>
      </section>
    </div>
  );
}
