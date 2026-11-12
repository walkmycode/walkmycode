"use client";
/**
 * A course's road from beginner to mastery: five stages of modules, each
 * marked done, started or still ahead, with the way on to the next one.
 */
import { useState } from "react";
import { moduleStates, nextModule, progress, PASS_MARK } from "@/learn/lib/roadmap";
import type { Course, Lesson, RoadmapModule } from "@/learn/lib/types";

type Props = {
  course: Course;
  lessons: Lesson[];
  canWrite: boolean;
  onStart: (stage: string, module: RoadmapModule) => void;
  onOpen: (l: Lesson) => void;
};

export default function Roadmap({ course, lessons, canWrite, onStart, onOpen }: Props) {
  const states = moduleStates(course, lessons);
  const next = nextModule(course, lessons);
  const { done, total, pct } = progress(course, lessons);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="roadmap">
      <div className="road-head">
        <p className="goal">{course.goal}</p>
        <div className="road-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to mastery">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="note">{done} of {total} modules done · a module is done when you pass a lesson on it ({PASS_MARK}/10 or more in the explain-back)</p>
        {canWrite && next && (
          <button className="ctl primary" type="button" onClick={() => onStart(next.stage, next.module)}>
            Continue: {next.module.title} →
          </button>
        )}
        {!next && <p className="hl">You have reached the end of the road. Mastery.</p>}
      </div>

      <ol className="stages">
        {course.stages.map((s, si) => {
          const stageDone = s.modules.every((m) => states.get(m.id) === "done");
          return (
            <li key={si} className={`stage${stageDone ? " done" : ""}`}>
              <p className="stage-title"><span className="n">{si + 1}</span> {s.title}</p>
              {s.summary && <p className="note">{s.summary}</p>}
              <ul className="modules">
                {s.modules.map((m) => {
                  const st = states.get(m.id) ?? "todo";
                  const on = lessons.filter((l) => l.course === course.name && l.moduleId === m.id);
                  const isNext = next?.module.id === m.id;
                  return (
                    <li key={m.id} className={`module ${st}${isNext ? " next" : ""}`}>
                      <button type="button" className="module-btn" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                        <span className="mark" aria-hidden="true">{st === "done" ? "✓" : st === "started" ? "◐" : "○"}</span>
                        <span className="t">{m.title}</span>
                        <span className="sr">{st === "done" ? " (done)" : st === "started" ? " (started)" : ""}</span>
                      </button>
                      {open === m.id && (
                        <div className="module-body">
                          {m.summary && <p>{m.summary}</p>}
                          {m.topics.length > 0 && <p className="note">Topics: {m.topics.join(" · ")}</p>}
                          {on.map((l) => (
                            <button key={l.id} type="button" className="link" onClick={() => onOpen(l)}>
                              Lesson {l.number}: {l.title}{l.feedback ? ` · ${l.feedback.score}/10` : ""} →
                            </button>
                          ))}
                          {canWrite && (
                            <button className="ctl" type="button" onClick={() => onStart(s.title, m)}>
                              {on.length ? "Another lesson on this" : "Learn this now"}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
