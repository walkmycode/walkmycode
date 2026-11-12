/**
 * Where a student is on a course's road to mastery. A module is done once a
 * lesson on it has been passed (an explain-back of 7/10 or more), started
 * once any lesson on it exists, and otherwise still ahead.
 */
import type { Course, Lesson, RoadmapModule } from "./types";

export type ModuleState = "done" | "started" | "todo";
export const PASS_MARK = 7;

export function moduleStates(course: Course, lessons: Lesson[]): Map<string, ModuleState> {
  const out = new Map<string, ModuleState>();
  const mine = lessons.filter((l) => l.course === course.name && l.moduleId);
  for (const stage of course.stages) {
    for (const m of stage.modules) {
      const on = mine.filter((l) => l.moduleId === m.id);
      out.set(m.id, on.some((l) => (l.feedback?.score ?? 0) >= PASS_MARK) ? "done" : on.length ? "started" : "todo");
    }
  }
  return out;
}

/** The first module not yet done, with the stage it belongs to. */
export function nextModule(course: Course, lessons: Lesson[]): { stage: string; module: RoadmapModule } | null {
  const states = moduleStates(course, lessons);
  for (const stage of course.stages) {
    for (const m of stage.modules) if (states.get(m.id) !== "done") return { stage: stage.title, module: m };
  }
  return null;
}

/** The first module with no lesson yet: what a course taught from a folder teaches next. */
export function nextUntaught(course: Course, lessons: Lesson[]): { stage: string; module: RoadmapModule } | null {
  const states = moduleStates(course, lessons);
  for (const stage of course.stages) {
    for (const m of stage.modules) if (states.get(m.id) === "todo") return { stage: stage.title, module: m };
  }
  return null;
}

export function progress(course: Course, lessons: Lesson[]) {
  const states = [...moduleStates(course, lessons).values()];
  const done = states.filter((s) => s === "done").length;
  return { done, total: states.length, pct: states.length ? Math.round((done / states.length) * 100) : 0 };
}

export function findModule(course: Course | undefined, id: string | undefined) {
  if (!course || !id) return null;
  for (const stage of course.stages) {
    const m = stage.modules.find((x) => x.id === id);
    if (m) return { stage: stage.title, module: m };
  }
  return null;
}
