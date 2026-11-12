"use client";
// "Set up this project" on the page: the plan the server made
// (src/lib/localrun/setup.ts), and every run of its steps, as one store the
// top bar's pill and the sheet both read. A service's steps run one after the
// other; "Set up all" queues the services and runs them one at a time, so the
// output (and the light that follows it) is always about one thing. Progress
// is read from the output as it streams (./progress.ts), handed on at most
// every 60 ms so a chatty installer can't flood React.
import type { SetupService, SetupStep } from "@/lib/localrun/setupTypes";
import type { NewProjectAsk, StarterView } from "@/lib/localrun/protocol";
import { saveMade, STARTER_LANGUAGE } from "@/lib/projectStack";
import { cleanBrief } from "@/lib/starterGuide";
import { newOpen, newPlan, setupRoot, setupRun, setupScan, stopLocal, type NewPlanAnswer } from "../client";
import { failureExcerpt, readChunk, startProgress, type Progress } from "./progress";

export type StepStatus = "waiting" | "running" | "done" | "failed" | "stopped";
export interface StepRun {
  status: StepStatus;
  startedAt: number | null;
  ms: number;
  progress: Progress;
  log: string;
}

export type ServiceStatus = "idle" | "queued" | "running" | "done" | "failed";
export interface ServiceRun {
  status: ServiceStatus;
  /** The steps as planned when it started (a fresh look afterwards plans none for a service that's ready). */
  meta: SetupStep[];
  steps: Record<string, StepRun>;
  current: string | null;
  startedAt: number | null;
  ms: number;
  error?: { lines: string[]; hot: number; step: string };
  /** The folder the last step ran in ("Fix with guide" runs its command there). */
  cwd?: string;
  /** Steps that landed in an earlier round (a tool installed before the project's own setup), shown above the feed. */
  history?: { shown: string; summary: string; ms: number }[];
}

export type SetupPhase = "idle" | "scanning" | "needs-folder" | "ready" | "error";

export interface SetupSnap {
  phase: SetupPhase;
  services: SetupService[];
  runs: Record<string, ServiceRun>;
  open: boolean;
  message: string | null;
  /** Services waiting their turn ("Set up all"), in order. */
  queue: string[];
  /** One "Set up all" (or one service) from its first step to its last: for the summary. */
  batch: { startedAt: number; ids: string[]; finishedAt: number | null; rounds?: number } | null;
  /** "New project" in progress (or its form), else null. */
  creating: Creating | null;
}

const LOG_CAP = 200_000;
let workspace: string | undefined;
let snap: SetupSnap = { phase: "idle", services: [], runs: {}, open: false, message: null, queue: [], batch: null, creating: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (next: Partial<SetupSnap>) => {
  snap = { ...snap, ...next };
  emit();
};
let activeRun: string | null = null;

export const setupStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  get: () => snap,
};

/** What still needs doing: services that need setup or a tool, and haven't just been set up. */
export function toDo(s: SetupSnap = snap): SetupService[] {
  return s.services.filter((x) => x.state !== "ready" && s.runs[x.id]?.status !== "done");
}

/** The whole job's progress, 0–1, while something runs: finished steps, plus the running step's own fraction. */
export function overall(s: SetupSnap = snap): number | null {
  if (!s.batch) return null;
  let total = 0;
  let done = 0;
  for (const id of s.batch.ids) {
    const run = s.runs[id];
    if (!run) continue;
    for (const st of run.meta) {
      total += 1;
      const r = run?.steps[st.id];
      if (r?.status === "done") done += 1;
      else if (r?.status === "running") done += r.progress.fraction ?? 0.35;
    }
  }
  return total ? done / total : null;
}

export function setWorkspace(name: string | undefined) {
  workspace = name;
}

export async function scan(): Promise<void> {
  set({ phase: snap.phase === "idle" || snap.phase === "error" ? "scanning" : snap.phase, message: null });
  try {
    const r = await setupScan(workspace);
    set({ phase: r.located ? "ready" : "needs-folder", services: r.services });
  } catch (e) {
    set({ phase: "error", message: (e as Error).message });
  }
}

export async function chooseFolder(path: string): Promise<string | null> {
  if (!workspace) return "This workspace has no name to remember the folder by.";
  const r = await setupRoot(workspace, path);
  if (!r.ok) return r.message ?? "That folder can't be used.";
  await scan();
  return null;
}

export function setOpen(open: boolean) {
  set({ open });
}

function patchRun(id: string, f: (r: ServiceRun) => ServiceRun) {
  const prev = snap.runs[id];
  if (!prev) return;
  set({ runs: { ...snap.runs, [id]: f(prev) } });
}

function freshRun(svc: SetupService, status: ServiceStatus): ServiceRun {
  const steps: Record<string, StepRun> = {};
  for (const st of svc.steps) steps[st.id] = { status: "waiting", startedAt: null, ms: 0, progress: startProgress(st.progress, st.expect), log: "" };
  return { status, meta: svc.steps, steps, current: null, startedAt: null, ms: 0 };
}

/** Set up these services, one after the other (the ones already queued or running keep their turn). */
export function setUp(ids: string[]) {
  const wanted = ids.filter((id) => {
    const svc = snap.services.find((s) => s.id === id);
    const st = snap.runs[id]?.status;
    return svc && runnable(svc) && st !== "running" && st !== "queued";
  });
  if (!wanted.length) return;
  const runs = { ...snap.runs };
  for (const id of wanted) runs[id] = freshRun(snap.services.find((s) => s.id === id)!, "queued");
  const busy = !!activeRun || snap.queue.length > 0;
  const batch = busy && snap.batch && !snap.batch.finishedAt ? { ...snap.batch, ids: [...snap.batch.ids, ...wanted] } : { startedAt: Date.now(), ids: wanted, finishedAt: null };
  set({ runs, queue: [...snap.queue, ...wanted], batch });
  if (!busy) next();
}

/** Stop what is running, and everything queued after it. */
export function stopAll() {
  const queued = snap.queue;
  const runs = { ...snap.runs };
  for (const id of queued) if (runs[id]) runs[id] = { ...runs[id], status: "idle" };
  set({ queue: [], runs });
  if (activeRun) stopLocal(activeRun);
}

/** Something WalkMyCode can run for it now: its own setup, or a tool it can install. */
export function runnable(svc: SetupService): boolean {
  return svc.steps.length > 0 && (svc.state === "needs-setup" || svc.state === "needs-tool");
}

/** At most this many rounds per job: a tool, the next tool, the project's own setup. */
const MAX_ROUNDS = 4;

function next() {
  const [id, ...rest] = snap.queue;
  if (!id) {
    // What the files say now (a .env made, node_modules there, a tool on PATH), without losing the runs on screen;
    // a service that just got its tool carries straight on with what the fresh look plans for it.
    void scan().then(() => {
      const b = snap.batch;
      if (!b || b.finishedAt) return;
      const more = (b.rounds ?? 0) < MAX_ROUNDS ? b.ids.filter((x) => snap.runs[x]?.status === "done" && snap.services.some((svc) => svc.id === x && runnable(svc))) : [];
      if (!more.length) return set({ batch: { ...b, finishedAt: Date.now() } });
      const runs = { ...snap.runs };
      for (const x of more) {
        const old = runs[x];
        const history = [...(old.history ?? []), ...old.meta.map((st) => ({ shown: st.shown, summary: old.steps[st.id]?.progress.summary ?? st.label, ms: old.steps[st.id]?.ms ?? 0 }))];
        runs[x] = { ...freshRun(snap.services.find((svc) => svc.id === x)!, "queued"), history };
      }
      set({ runs, queue: more, batch: { ...b, rounds: (b.rounds ?? 0) + 1 } });
      next();
    });
    return;
  }
  set({ queue: rest });
  patchRun(id, (r) => ({ ...r, status: "running", startedAt: Date.now() }));
  runStep(id, 0);
}

/** Run a service's steps from `i`; at the end `onEnd` (a new project's round) or the next service in the queue. */
function runStep(id: string, i: number, onEnd?: (ok: boolean) => void, create?: NewProjectAsk) {
  const step = snap.runs[id]?.meta[i];
  if (!step) {
    patchRun(id, (r) => ({ ...r, status: "done", current: null, ms: Date.now() - (r.startedAt ?? Date.now()) }));
    return onEnd ? onEnd(true) : next();
  }
  patchRun(id, (r) => ({ ...r, current: step.id, steps: { ...r.steps, [step.id]: { ...r.steps[step.id], status: "running", startedAt: Date.now() } } }));
  // Output is gathered and handed on at most every 60 ms.
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const text = pending;
    pending = "";
    patchRun(id, (r) => {
      const s = r.steps[step.id];
      const log = (s.log + text).slice(-LOG_CAP);
      return { ...r, steps: { ...r.steps, [step.id]: { ...s, log, progress: readChunk(step.progress, s.progress, text) } } };
    });
  };
  const fail = (message: string | null, stopped = false) => {
    flush();
    patchRun(id, (r) => {
      const s = r.steps[step.id];
      const log = message ? `${s.log}\n${message}\n` : s.log;
      return {
        ...r,
        status: stopped ? "idle" : "failed",
        current: null,
        ms: Date.now() - (r.startedAt ?? Date.now()),
        steps: { ...r.steps, [step.id]: { ...s, log, status: stopped ? "stopped" : "failed", ms: Date.now() - (s.startedAt ?? Date.now()) } },
        ...(stopped ? {} : { error: { ...failureExcerpt(log), step: step.id } }),
      };
    });
    activeRun = null;
    if (onEnd) return onEnd(false);
    // A failed service doesn't stop the others in "Set up all"; a stop does.
    if (stopped) {
      set({ queue: [] });
      if (snap.batch && !snap.batch.finishedAt) set({ batch: { ...snap.batch, finishedAt: Date.now() } });
    } else next();
  };
  activeRun = setupRun(id, step.id, workspace, {
    start: (cwd) => patchRun(id, (r) => ({ ...r, cwd })),
    out: (_stream, text) => {
      pending += text;
      timer ??= setTimeout(flush, 60);
    },
    exit: (e) => {
      if (timer) clearTimeout(timer);
      flush();
      if (e.code === 0) {
        patchRun(id, (r) => {
          const s = r.steps[step.id];
          // The last line may not end in a newline: read it too.
          const progress = { ...readChunk(step.progress, s.progress, "\n"), fraction: 1 };
          return { ...r, steps: { ...r.steps, [step.id]: { ...s, status: "done", ms: e.ms, progress } } };
        });
        activeRun = null;
        runStep(id, i + 1, onEnd, create);
      } else fail(e.timedOut ? "Stopped: it took longer than 20 minutes." : e.stopped ? null : `It ended with code ${e.code ?? "?"}.`, e.stopped);
    },
    fail: (message) => {
      if (timer) clearTimeout(timer);
      fail(message);
    },
  }, create);
}

// ── a new project from scratch ──

/** The row a new project has in the sheet while it is being made. */
export const NEW_ID = "+new";

export interface Creating {
  ask: NewProjectAsk;
  phase: "form" | "making" | "opening" | "done" | "error";
  starters: StarterView[];
  /** Where new projects go unless the user picks another folder. */
  parent: string;
  root?: string;
  /** The full app: the indexed workspace's name, to open on the map. */
  workspace?: string;
  message?: string;
  /** "What should it do?": kept in the browser with the made note, never sent to the server that makes it. */
  brief?: string;
}

/** "New project": the form, with the starters and the default folder from the server (and what it should do, when Claude passed it on). */
export async function openNewProject(ask: Partial<NewProjectAsk> & { brief?: string } = {}) {
  const brief = cleanBrief(ask.brief);
  const base: Creating = { ask: { starter: ask.starter ?? "laravel", name: ask.name ?? "", ...(ask.parent ? { parent: ask.parent } : {}) }, phase: "form", starters: [], parent: "", ...(brief ? { brief } : {}) };
  set({ open: true, creating: base });
  try {
    // An empty name is refused, but the answer carries the starters and the default folder.
    const p = await newPlan({ starter: base.ask.starter, name: "", ...(ask.parent ? { parent: ask.parent } : {}) });
    if (snap.creating?.phase === "form") set({ creating: { ...snap.creating, starters: p.starters, parent: p.parent } });
  } catch (e) {
    set({ creating: { ...base, phase: "error", message: (e as Error).message } });
  }
}

export function closeNewProject() {
  if (snap.creating && snap.creating.phase !== "making" && snap.creating.phase !== "opening") set({ creating: null });
}

/**
 * Make it: each round the server plans what's next (install a tool, then the
 * next, then the framework's own "create"), the row runs it as a feed, and the
 * round after picks up from there. Once the folder exists it is opened (mapped,
 * or indexed in the full app) and its own setup runs straight on, the light
 * carrying over from the new project's row to the project's.
 */
export async function createProject(ask: NewProjectAsk, briefIn?: string) {
  // "Any framework" is named by its framework (Django, Rails…).
  const starter = ask.starter === "custom" ? { label: ask.custom?.framework || "Your framework" } : snap.creating?.starters.find((x) => x.id === ask.starter);
  const brief = cleanBrief(briefIn) || undefined;
  set({ creating: { ...(snap.creating ?? { starters: [], parent: "" }), ask, brief, phase: "making", message: undefined } as Creating, batch: { startedAt: Date.now(), ids: [NEW_ID], finishedAt: null } });
  let history: NonNullable<ServiceRun["history"]> = [];
  let root = "";
  for (let round = 0; round < MAX_ROUNDS + 1; round++) {
    let p: NewPlanAnswer;
    try {
      p = await newPlan(ask);
    } catch (e) {
      return newFailed((e as Error).message);
    }
    if (p.error) return newFailed(p.error);
    root = p.root;
    if (p.made) break;
    const svc: SetupService = { id: NEW_ID, name: ask.name, stack: starter ? `${starter.label} · new` : "new project", state: p.steps[0]?.id === "tool" ? "needs-tool" : "needs-setup", checks: [], steps: p.steps };
    set({ services: [svc, ...snap.services.filter((x) => x.id !== NEW_ID)], runs: { ...snap.runs, [NEW_ID]: { ...freshRun(svc, "running"), startedAt: Date.now(), history } } });
    const ok = await new Promise<boolean>((done) => runStep(NEW_ID, 0, done, ask));
    const run = snap.runs[NEW_ID];
    history = [...history, ...run.meta.map((st) => ({ shown: st.shown, summary: run.steps[st.id]?.progress.summary ?? st.label, ms: run.steps[st.id]?.ms ?? 0 }))];
    if (!ok) {
      set({ batch: snap.batch ? { ...snap.batch, finishedAt: Date.now() } : null, creating: snap.creating ? { ...snap.creating, phase: "error", message: "A step didn't finish: see what it printed above." } : null });
      return;
    }
  }
  set({ creating: { ...snap.creating!, phase: "opening", root } });
  const o = await newOpen(root, ask.name);
  if (!o.ok) return newFailed(o.message ?? "The new project couldn't be opened.");
  // The project is the workspace now: its own setup (packages, .env, keys, database) runs on from here.
  if (o.workspace) setWorkspace(o.workspace);
  // So the guide greets it as what it is (and offers to build what it should do), and the top bar says what it's built with.
  saveMade(o.workspace ?? ask.name, { starter: ask.starter, label: starter?.label ?? ask.starter, language: STARTER_LANGUAGE[ask.starter] ?? "", at: new Date().toISOString(), ...(brief ? { brief } : {}) });
  set({ creating: { ...snap.creating!, phase: "done", root, ...(o.workspace ? { workspace: o.workspace } : {}) }, services: snap.services.filter((x) => x.id !== NEW_ID) });
  await scan();
  const ids = snap.services.filter(runnable).map((x) => x.id);
  if (!ids.length) {
    set({ batch: snap.batch ? { ...snap.batch, finishedAt: Date.now() } : null });
    return;
  }
  const runs = { ...snap.runs };
  // The journey so far shows on the project's first row, so nothing seems to vanish.
  ids.forEach((x, k) => (runs[x] = { ...freshRun(snap.services.find((svc) => svc.id === x)!, "queued"), ...(k === 0 ? { history } : {}) }));
  set({ runs, queue: ids, batch: { startedAt: snap.batch?.startedAt ?? Date.now(), ids, finishedAt: null } });
  next();
}

function newFailed(message: string) {
  set({ batch: snap.batch ? { ...snap.batch, finishedAt: Date.now() } : null, creating: snap.creating ? { ...snap.creating, phase: "error", message } : null });
}
