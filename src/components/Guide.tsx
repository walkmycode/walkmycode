"use client";
// The guide's chalkboard: answers with clickable citations, a question box,
// the tour player and, in the app, Talk (the voice lecturer). Tours and
// answers are read aloud by the narrator chosen in Settings → Voice (in
// WalkMyCode Lite, the browser's own voice). The voice code loads only when a
// tour is on screen, "read aloud" is pressed or a talk opens. On WalkMyCode for
// Claude's page the answers are the user's own Claude's, over the bridge: the
// board says plainly when Claude is not listening, shows what Claude says
// unasked, and Talk sends a spoken question to Claude (or opens the Lightning
// lecturer, as chosen in Settings → Voice).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReadAloud from "./voice/ReadAloud";
import TalkButton from "./voice/Talk";
import { afterSettingsSaved, ask, AskError, emptyConversation, type Conversation } from "@/lib/claude/client";
import type { RepoView, Tour } from "@/lib/claude/tools";
import type { PageRequest } from "@/lib/bridge/protocol";
import { labelOf, type ProviderId } from "@/lib/providers/catalogue";
import type { FriendlyError } from "@/lib/providers/wire";
import { light } from "@/lib/light";
import { flyThrough } from "@/lib/flythrough";
import { pickVoice } from "@/lib/adapters/select";
import { MCP, TARGET } from "@/lib/adapters/target";
import { useAiRoute } from "@/lib/adapters/useAiRoute";
import { useTalkMode } from "@/lib/voice/talkMode";
import { useAiName, useStandalone } from "@/lib/aiName";
import { capName } from "@/lib/bridge/clientName";
import { addLooked, lookedLabel, lookedLine, stripToolTalk } from "@/lib/claude/looked";
import { useWorkspace } from "@/lib/store";
import { segments, tableRuns } from "@/lib/chalkSegments";
import { mapLanes, type Lane } from "@/lib/diagramStyle";
import { madeNote, stackOf } from "@/lib/projectStack";
import { buildItAsk, STARTER_GUIDE } from "@/lib/starterGuide";

/** "just now", "5 minutes ago", "on 2 Oct". */
function sinceMade(at: string): string {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (!Number.isFinite(m) || m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} hour${m < 120 ? "" : "s"} ago`;
  return `on ${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
import { MAX_IMAGES, type AskImage } from "@/lib/bridge/protocol";
import { attachImage, imageSrc } from "@/lib/imageAttach";
import AddFolder, { CODE_MISSING } from "./AddFolder";

// WalkMyCode for Claude's own parts of the board: only its build loads them.
const ClaudeStatus = MCP ? dynamic(() => import("./mcp/ClaudeStatus"), { ssr: false }) : () => null;
// A diagram in an answer (a ```mermaid block) is drawn in chalk by the Learn room's Diagram; Mermaid loads only then.
const Diagram = dynamic(() => import("@/learn/components/Diagram"), { ssr: false, loading: () => <p className="note">Drawing…</p> });
const ClaudeTalk = MCP ? dynamic(() => import("./mcp/ClaudeTalk"), { ssr: false }) : () => null;

// The tour player, with the narrators behind it, loads once a tour is on screen.
const TourPlayer = dynamic(() => import("./voice/TourPlayer"), {
  ssr: false,
  loading: () => (
    <button type="button" className="ctl compact" disabled>
      ▶ play
    </button>
  ),
});

// A live talk with the lecturer, and everything it needs, loads when one opens. Lite has no
// microphone, so its build leaves the lecturer out altogether (the condition is fixed at build time).
const LecturePanel =
  process.env.NEXT_PUBLIC_WALKMYCODE_TARGET === "lite"
    ? () => null
    : dynamic(() => import("./voice/LecturePanel"), {
        ssr: false,
        loading: () => (
          <section className="panel lecture connecting">
            <header>
              <i className="talk-dot live" aria-hidden />
              <span className="lecture-status">Connecting…</span>
            </header>
          </section>
        ),
      });

/** Lite reads with the browser's voice and never listens; the app has Talk. */
const VOICE = pickVoice(TARGET);
/** Images in the question box: the app's own model and WalkMyCode for Claude see them; Lite's guide can't. */
const PICS = TARGET !== "lite";
import { aiNeeded } from "@/lib/aiPill";
import { openSettings as openSettingsPane } from "@/lib/settingsNav";

export interface Job {
  id: number;
  mode: "ask" | "tour";
  /** What the user sees as their question. */
  shown: string;
  /** What the guide gets (context + question). */
  user: string;
  /** The same ask as WalkMyCode for Claude's bridge carries it (Explain, Trace it, Tour, a typed or
   * spoken question, with what is on screen). Only the MCP page's route sends it. */
  request?: PageRequest;
  /** Asked from the map's go-to bar: the answer flies the map (src/lib/flythrough.ts). */
  fly?: boolean;
  /** Images attached to the question (pasted, dropped or picked in the question box). */
  images?: AskImage[];
  /** A spoken question that carries on the unanswered one before it: it takes that turn's place on the board. */
  replaces?: boolean;
}

interface Props {
  repo: RepoView;
  job: Job | null;
  /** `from` is the clicked citation, where the light departs from. */
  onCite: (path: string, start: number, end?: number, from?: HTMLElement) => void;
  onTour: (tour: Tour | null) => void;
  tour: Tour | null;
  step: number;
  onStep: (i: number) => void;
  onAsk: (question: string, images?: AskImage[]) => void;
}

const CITE = /`?((?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|py|sql|prisma|mjs|cjs|mts|dart|php|twig))(?::(\d+)(?:\s*[-–]\s*(\d+))?)?`?/g;

/** Chalk rendering: paragraphs, lists, **bold**, `code`, path:line citations as buttons,
 * and ```mermaid blocks drawn as diagrams (other fenced code as code).
 * While the answer is still streaming (`writing`), its last block carries the chalk
 * tip; nothing else animates per token, the stream itself is the handwriting. */
export function Chalk({ text, onCite, writing = false, laneOf }: { text: string; onCite: Props["onCite"]; writing?: boolean; laneOf?: (text: string) => Lane | null }) {
  const segs = segments(text);
  return (
    <>
      {segs.map((s, i) => {
        const last = writing && i === segs.length - 1;
        if (s.kind === "prose") return <Prose key={i} text={s.body} onCite={onCite} writing={last} />;
        if (s.lang === "mermaid") {
          return s.closed && !last ? (
            <Diagram key={i} source={s.body} label="A diagram from the guide" laneOf={laneOf} />
          ) : (
            <p key={i} className="note scribing">
              Drawing a diagram…
            </p>
          );
        }
        return (
          <pre key={i} className="chalk-code">
            <code>{s.body}</code>
          </pre>
        );
      })}
    </>
  );
}

function Prose({ text, onCite, writing }: { text: string; onCite: Props["onCite"]; writing: boolean }) {
  const blocks = text.split(/\n{2,}/).flatMap((b) => tableRuns(b.split("\n")));
  return (
    <>
      {blocks.map((run, i) => {
        const tip = writing && i === blocks.length - 1 ? "scribing" : undefined;
        if (run.kind === "table") {
          return (
            <div key={i} className={`chalk-table-wrap${tip ? ` ${tip}` : ""}`}>
              <table className="chalk-table">
                <thead>
                  <tr>
                    {run.head.map((c, j) => (
                      <th key={j}>{inline(c, onCite)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.rows.map((r, j) => (
                    <tr key={j}>
                      {run.head.map((_, k) => (
                        <td key={k}>{inline(r[k] ?? "", onCite)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const lines = run.lines;
        const b = lines.join("\n");
        const isList = lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, j) => (
            <li key={j} className={j === lines.length - 1 ? tip : undefined}>
              {inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""), onCite)}
            </li>
          ));
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i} className={tip}>
            {inline(b, onCite)}
          </p>
        );
      })}
    </>
  );
}

/** How long a paragraph's chalk takes to appear: by its length, 0.6–1.6 s. */
const wipeMs = (text: string) => Math.max(600, Math.min(1600, text.length * 8));

function inline(s: string, onCite: Props["onCite"]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let k = 0;
  // Split on bold and code first, then citations inside plain runs.
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("**")) out.push(<b key={k++}>{p.slice(2, -2)}</b>);
    else if (p.startsWith("`")) {
      const inner = p.slice(1, -1);
      const m = new RegExp(CITE.source).exec(inner);
      if (m && m[0] === inner && m[2]) out.push(cite(m, k++, onCite));
      else if (m && m[0] === inner) out.push(cite(m, k++, onCite));
      else out.push(<code key={k++}>{inner}</code>);
    } else {
      let last = 0;
      const re = new RegExp(CITE.source, "g");
      for (let m = re.exec(p); m; m = re.exec(p)) {
        if (m.index > last) out.push(<span key={k++}>{p.slice(last, m.index)}</span>);
        out.push(cite(m, k++, onCite));
        last = m.index + m[0].length;
      }
      if (last < p.length) out.push(<span key={k++}>{p.slice(last)}</span>);
    }
  }
  return out;
}
function cite(m: RegExpExecArray, key: number, onCite: Props["onCite"]) {
  const path = m[1];
  const start = m[2] ? Number(m[2]) : 1;
  const end = m[3] ? Number(m[3]) : undefined;
  return (
    <button key={key} className="cite" onClick={(e) => depart(e.currentTarget, () => onCite(path, start, end, e.currentTarget))} title={`open ${path}`}>
      {path}
      {m[2] ? `:${m[2]}${m[3] ? `–${m[3]}` : ""}` : ""}
    </button>
  );
}

/** A citation is clicked: the light departs from the word (MOTION.md §4.8), then the
 * code panel takes it on to the line once the scroll has landed. */
function depart(from: HTMLElement, open: () => void) {
  light.flyTo(from, { from, land: false });
  open();
}

interface Turn {
  /** Stable key, so the oldest turn can leave without the others remounting. */
  id: number;
  q: string;
  a: string;
  /** What it looked at, in words ("NewTaskForm", "“sign in” in the code"): src/lib/claude/looked.ts. */
  tools: string[];
  err?: FriendlyError;
  /** A line from WalkMyCode itself rather than an answer, e.g. after a provider switch. */
  note?: string;
  /** Claude said it without being asked on this page (a question asked in Claude's own chat). */
  unasked?: boolean;
  /** The images the question carried, shown small under it. */
  images?: AskImage[];
}


// "Open settings" opens the pane the error is about: the model's, or the voice's.
const openSettings = () => openSettingsPane("ai");
const openVoiceSettings = () => openSettingsPane("voice");
// From the clock, so ids never repeat even if this module is loaded again (the history is restored with new ones).
let turnIds = Date.now();
const nextTurnId = () => ++turnIds;
/** The newest job the guide has run, across mounts of the panel (jobs are numbered by time). */
let handledJob = 0;
/** Whether the guide has yet to run this job; marks it run. */
function isNewJob(j: Job): boolean {
  if (j.id <= handledJob) return false;
  handledJob = j.id;
  return true;
}

// The board's history, kept per map in this browser (the latest HISTORY_MAX turns, without images),
// so what the guide said is still there after a reload. "New conversation" clears it.
const HISTORY_MAX = 60;
const historyKey = (map: string) => `walkmycode.guide.${map}`;
function loadHistory(key: string): Turn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Omit<Turn, "id"> => !!t && typeof t.q === "string" && typeof t.a === "string" && Array.isArray(t.tools))
      .map((t) => ({ ...t, id: nextTurnId() }));
  } catch {
    return [];
  }
}
function saveHistory(key: string, turns: Turn[]) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const keep = turns.slice(-HISTORY_MAX).map(({ id, images, ...t }) => t);
  try {
    if (keep.length) localStorage.setItem(key, JSON.stringify(keep));
    else localStorage.removeItem(key);
  } catch {
    // Full: the most recent few still fit.
    try {
      localStorage.setItem(key, JSON.stringify(keep.slice(-10)));
    } catch {
      // private window: this page only
    }
  }
}

export default function Guide({ repo, job, onCite, onTour, tour, step, onStep, onAsk }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  // Images for the next question: pasted, dropped on the box or picked with 📎 (not in Lite, whose guide can't see them).
  const [pics, setPics] = useState<AskImage[]>([]);
  const [picNote, setPicNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const addPics = useCallback(async (files: Iterable<File>) => {
    setPicNote(null);
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const img = await attachImage(f);
        setPics((p) => (p.length >= MAX_IMAGES ? p : [...p, img]));
      } catch (e) {
        setPicNote((e as Error).message);
      }
    }
  }, []);
  const conversation = useRef<Conversation>(emptyConversation());
  const lastJob = useRef<Job | null>(null);
  const abort = useRef<AbortController | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // "none" only in WalkMyCode Lite opened outside Claude: nothing can answer there.
  const route = useAiRoute();
  // WalkMyCode's MCP page: the AI app connected to it (Claude, Antigravity, Cursor…), by name.
  const aiName = useAiName();
  // Started from a terminal with no AI app: the page's own provider answers.
  const standalone = useStandalone();
  // A map restored without its code: the guide can only answer from the map, and says so.
  const ws = useWorkspace();
  const codeMissing = !!ws?.codeElsewhere;
  // A project WalkMyCode just made is greeted as itself (src/lib/starterGuide.ts); any other names its stack.
  const made = madeNote(ws?.name);
  const madeGuide = made ? STARTER_GUIDE[made.starter] : undefined;
  const stack = stackOf(repo.map, [], made);
  // The example app's starter tour, offered until a tour is on screen (no AI needed to play it).
  const starter = ws?.starterTour ?? null;
  // The open talk with the lecturer (a new key for each), and why Talk could not start.
  const [lecture, setLecture] = useState<number | null>(null);
  const [talkBlocked, setTalkBlocked] = useState<FriendlyError | null>(null);
  useEffect(() => {
    if (!talkBlocked) return;
    const t = setTimeout(() => setTalkBlocked(null), 9000);
    return () => clearTimeout(t);
  }, [talkBlocked]);
  // WalkMyCode for Claude: how Talk answers (Settings → Voice), what was heard, and the question box to fall back on.
  const talkMode = useTalkMode(MCP);
  const [heard, setHeard] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAsk = useCallback(() => inputRef.current?.focus(), []);

  // WalkMyCode for Claude: an answer no question here was waiting for (one asked in Claude's own chat,
  // or answered after a reload) is shown as Claude's own turn.
  useEffect(() => {
    if (!MCP) return;
    let live = true;
    let off = () => {};
    void import("@/lib/bridge/page").then(({ bridge }) => {
      if (!live) return;
      const b = bridge();
      const show = (markdown: string) => setTurns((t) => [...t, { id: nextTurnId(), q: "", a: markdown, tools: [], unasked: true }]);
      for (const a of b.unclaimed.splice(0)) show(a.markdown);
      off = b.onAnswer((a, claimed) => {
        if (claimed) return;
        const i = b.unclaimed.indexOf(a);
        if (i >= 0) b.unclaimed.splice(i, 1);
        show(a.markdown);
      });
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  // The history: restored for this map (before anything asked meanwhile), then saved as it changes,
  // once an answer is complete.
  // A diagram's boxes take the colour of what they are on the map (src/lib/diagramStyle.ts).
  const laneOf = useMemo(() => mapLanes(repo.map), [repo.map]);
  const histKey = historyKey(repo.map.name);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  // In render, as React's "adjust state when a prop changes": the guide only renders in the browser (a dock panel).
  if (historyFor !== histKey && typeof window !== "undefined") {
    const saved = loadHistory(histKey);
    setTurns(historyFor === null ? [...saved, ...turns] : saved);
    setHistoryFor(histKey);
  }
  useEffect(() => {
    if (historyFor === histKey && !busy) saveHistory(histKey, turns);
  }, [turns, busy, histKey, historyFor]);

  // Run a job against the last turn on the board (which the caller has just added or reset).
  const run = useCallback(
    (j: Job) => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setBusy(true);
      // fly_step moves the map as each hop's call runs (one handle per question).
      const fly = flyThrough.forAsk({ map: repo.map, files: repo.files, key: j.id, title: j.shown });
      ask({
        repo: { ...repo, fly },
        conversation: conversation.current,
        user: j.user,
        mode: j.mode,
        ...(j.request ? { request: j.request } : {}),
        ...(j.images?.length ? { images: j.images } : {}),
        signal: ac.signal,
        onText: (a) => setTurns((t) => [...t.slice(0, -1), { ...t[t.length - 1], a }]),
        // What it looked at, in words (src/lib/claude/looked.ts); the raw calls never reach the board.
        onTool: (name, input) => {
          const label = lookedLabel(repo.map, name, input);
          if (label) setTurns((t) => [...t.slice(0, -1), { ...t[t.length - 1], tools: addLooked(t[t.length - 1].tools, label) }]);
        },
      })
        .then((r) => {
          conversation.current = r.conversation;
          fly.done();
          setTurns((t) => [...t.slice(0, -1), { ...t[t.length - 1], a: r.text || (r.tour ? `Tour ready: ${r.tour.title}` : "(no answer)") }]);
          if (r.tour) {
            onTour(r.tour);
            onStep(0);
          }
        })
        .catch((e) => {
          if (ac.signal.aborted) return fly.done();
          const err: FriendlyError = e instanceof AskError ? e.info : { code: "unknown", title: "The guide could not answer", message: (e as Error).message, action: "retry" };
          fly.done(err.title);
          // The server refused another provider's history; the next ask starts fresh, as the copy says.
          if (err.code === "stale_history") conversation.current = emptyConversation();
          setTurns((t) => [...t.slice(0, -1), { ...t[t.length - 1], err }]);
          // No AI set up yet: the first time, the setup sheet opens by itself (the top bar's pill hosts it).
          aiNeeded(err);
        })
        // A newer job has taken over (it aborted this one): it is the one that ends the busy state.
        .finally(() => {
          if (abort.current === ac) setBusy(false);
        });
    },
    [repo, onTour, onStep],
  );

  // A new question: its turn on the board, then the answer.
  const begin = useCallback(
    (j: Job) => {
      const turn: Turn = { id: nextTurnId(), q: j.shown, a: "", tools: [], ...(j.images?.length ? { images: j.images } : {}) };
      // "think" … "all right, carry on": one question on the board, not two, while the first is unanswered.
      setTurns((t) => (j.replaces && t.length && t[t.length - 1].q.startsWith("(said) ") ? [...t.slice(0, -1), turn] : [...t, turn]));
      run(j);
    },
    [run],
  );

  useEffect(() => {
    if (!job || job.id === lastJob.current?.id) return;
    // Mounted again (the panel moved, popped out or came back) with a question already asked: it is on
    // the board and in the history, and is not asked again.
    lastJob.current = job;
    if (!isNewJob(job)) return;
    // A job is an event (a click on a card, a question asked): its turn and its answer start here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin(job);
  }, [job, begin]);

  const retry = () => {
    const j = lastJob.current;
    if (!j || busy) return;
    setTurns((t) => [...t.slice(0, -1), { id: nextTurnId(), q: j.shown, a: "", tools: [] }]);
    run(j);
  };

  // A provider change in Settings starts the context fresh; the board keeps what was said.
  useEffect(() => {
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ provider: ProviderId; model: string } | undefined>).detail;
      if (!d) return;
      const { conversation: next, switched } = afterSettingsSaved(conversation.current, d.provider);
      conversation.current = next;
      if (switched) setTurns((t) => [...t, { id: nextTurnId(), q: "", a: "", tools: [], note: `Switched to ${labelOf(d.provider)} · ${d.model}. The conversation context starts fresh.` }]);
    };
    window.addEventListener("settings-saved", onSaved);
    return () => window.removeEventListener("settings-saved", onSaved);
  }, []);

  // A new turn comes to the top of the board and its answer is written below it, so it reads from
  // the start; nothing moves while it streams, or when a diagram in it finishes drawing.
  // Asked, there is not yet enough below it to scroll that far: once the answer is in (and while a
  // diagram in it draws) it is brought up again, unless the user has moved the board meanwhile.
  const lastTurn = turns[turns.length - 1]?.id;
  const placed = useRef<{ turn: number; at: number } | null>(null);
  const userMoved = useRef(0);
  useEffect(() => {
    const b = boardRef.current;
    if (!b) return;
    const moved = () => {
      userMoved.current = Date.now();
    };
    const opts = { passive: true } as const;
    b.addEventListener("wheel", moved, opts);
    b.addEventListener("touchmove", moved, opts);
    b.addEventListener("pointerdown", moved, opts);
    b.addEventListener("keydown", moved, opts);
    return () => {
      b.removeEventListener("wheel", moved);
      b.removeEventListener("touchmove", moved);
      b.removeEventListener("pointerdown", moved);
      b.removeEventListener("keydown", moved);
    };
  }, []);
  useEffect(() => {
    const b = boardRef.current;
    const el = lastTurn === undefined ? null : b?.querySelector<HTMLElement>(`[data-turn="${lastTurn}"]`);
    if (!b || !el || lastTurn === undefined) return;
    const p = placed.current;
    if (p?.turn === lastTurn && userMoved.current > p.at) return;
    const want = () => Math.min(el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 10, b.scrollHeight - b.clientHeight);
    placed.current = { turn: lastTurn, at: p?.turn === lastTurn ? p.at : Date.now() };
    // At once: the answer is written from there.
    b.scrollTo({ top: want(), behavior: "auto" });
    if (busy) return;
    // A diagram draws a moment later, in this answer or one above it: the question is kept in place as they do.
    const since = placed.current.at;
    const ro = new ResizeObserver(() => {
      if (userMoved.current > since) return ro.disconnect();
      const top = want();
      if (Math.abs(top - b.scrollTop) > 1) b.scrollTo({ top, behavior: "auto" });
    });
    b.querySelectorAll(".turn").forEach((t) => ro.observe(t));
    const stop = setTimeout(() => ro.disconnect(), 4000);
    return () => {
      clearTimeout(stop);
      ro.disconnect();
    };
    // busy: the answer landing is the moment to bring the question up; not every streamed word.
  }, [lastTurn, busy]);

  // Start over: the board, the saved history and the model's context (Claude keeps its own chat).
  const startOver = () => {
    abort.current?.abort();
    conversation.current = emptyConversation();
    setTurns([]);
  };

  const current = tour ? tour.steps[step] : null;
  const last = turns[turns.length - 1];
  // Narration is cached per map version: mapping the folder again starts afresh.
  const scope = useMemo(() => ({ map: repo.map.name, generatedAt: repo.map.generatedAt }), [repo.map]);
  const sayEl = useCallback(() => boardRef.current?.querySelector<HTMLElement>("[data-say]") ?? null, []);
  // Before the first word the light orbits the board; then the chalk tip takes over.
  const thinking = busy && !last?.a && !last?.err;

  // The light (MOTION.md §4.6): it flies to the board and hands off to the orbiting
  // beacon while the guide thinks; when the answer lands it settles on the answer's
  // last citation, or goes home.
  const frameRef = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (thinking && frameRef.current) light.orbit(frameRef.current);
    if (wasBusy.current && !busy) {
      const cites = boardRef.current?.querySelectorAll<HTMLElement>(".cite");
      const cite = cites?.length ? cites[cites.length - 1] : null;
      if (cite) light.settleOn(cite, { at: "left", dx: -6, land: true });
      else light.park();
    }
    wasBusy.current = busy;
  }, [thinking, busy]);
  // A tour step (MOTION.md §4.7): the light hops onto its pill first; the code panel
  // then takes it on to the step's lines.
  const progressRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tour) return;
    const pill = progressRef.current?.querySelector<HTMLElement>("button.on");
    if (pill) light.settleOn(pill, { handoff: true });
  }, [tour, step]);

  return (
    <>
      <div ref={frameRef} className={`frame fill${thinking ? " thinking" : ""}`} style={{ minHeight: 0, display: "flex" }}>
        <div ref={boardRef} className="board fill" aria-busy={busy}>
          {tour && current ? (
            <>
              <h2 key={`title-${tour.title}`} className="wipe-line">
                {tour.title}
              </h2>
              <p key={`step-${step}`} className="asked rise">
                Step <span>{step + 1}</span> of {tour.steps.length} · <button className="cite" onClick={(e) => depart(e.currentTarget, () => onCite(current.file, current.start_line, current.end_line, e.currentTarget))}>{current.file}:{current.start_line}–{current.end_line}</button>
              </p>
              <p key={`say-${step}`} data-say className="wipe-para" style={{ ["--wd" as string]: "100ms", ["--wdur" as string]: `${wipeMs(current.say)}ms` }}>
                {current.say}
              </p>
            </>
          ) : turns.length === 0 ? (
            <>
              <h2 className="wipe-line">Hello.</h2>
              {made && madeGuide ? (
                <>
                  <p className="wipe-para" style={{ ["--wd" as string]: "100ms", ["--wdur" as string]: "1100ms" }}>
                    This is <b>{ws?.name}</b>, {madeGuide.what} WalkMyCode made it and set it up for you {sinceMade(made.at)}.
                  </p>
                  {/* What they said it should do comes first: one click asks whichever AI is set up to build it
                      (no AI yet, and asking already leads to setting one up). */}
                  {made.brief && (
                    <p className="wipe-para made-build" style={{ ["--wd" as string]: "140ms", ["--wdur" as string]: "800ms" }}>
                      <span>
                        What you asked for: <q>{made.brief}</q>
                      </span>
                      <button type="button" className="ctl primary" onClick={() => onAsk(buildItAsk(made.label, made.brief!))} disabled={busy}>
                        ▶ Build it
                      </button>
                    </p>
                  )}
                  <ul className="wipe-para made-where" style={{ ["--wd" as string]: "160ms", ["--wdur" as string]: "900ms" }}>
                    {madeGuide.where.map(([path, what]) => (
                      <li key={path}>
                        <code>{path}</code> {what}
                      </li>
                    ))}
                  </ul>
                  <p className="wipe-para made-asks" style={{ ["--wd" as string]: "220ms", ["--wdur" as string]: "700ms" }}>
                    {madeGuide.asks.map((q) => (
                      <button key={q} type="button" className="ctl compact" onClick={() => onAsk(q)} disabled={busy}>
                        {q}
                      </button>
                    ))}
                  </p>
                </>
              ) : (
                <p className="wipe-para" style={{ ["--wd" as string]: "100ms", ["--wdur" as string]: "1100ms" }}>
                  {stack.length > 0 && (
                    <>
                      This is <b>{ws?.name ?? "this project"}</b>, built with {stack.join(", ")}.{" "}
                    </>
                  )}
                  I’m your guide to this code. Click any card on the map, select some lines on the right, or ask me a question like <b>“how does sign-in work?”</b>
                </p>
              )}
              <p className="wipe-para" style={{ ["--wd" as string]: "200ms", ["--wdur" as string]: "900ms" }}>
                Everything I say points at real lines — click a <span className="cite">path:line</span> to see it.
              </p>
              {starter && (
                <p className="wipe-para starter" style={{ ["--wd" as string]: "300ms", ["--wdur" as string]: "700ms" }}>
                  <button
                    type="button"
                    className="ctl primary"
                    onClick={() => {
                      onTour(starter);
                      onStep(0);
                    }}
                  >
                    ▶ Take the starter tour
                  </button>{" "}
                  <span className="note">{starter.title}, in {starter.steps.length} steps.</span>
                </p>
              )}
              {codeMissing && (
                <div className="note code-missing-guide" role="status">
                  <p>{CODE_MISSING.guide}</p>
                  <AddFolder />
                </div>
              )}
              {route === "none" && (
                <p className="note" role="status">
                  Asking needs Claude: I answer with your own Claude plan, so open WalkMyCode Lite inside Claude (claude.ai or the Claude app) to ask me. The map, the code and tracing work here as they are.
                </p>
              )}
              {route === "bridge" && (
                <p className="note" role="status">
                  {standalone ? "The answers come from the AI model in Settings → AI model, with your own key." : `The answers come from ${aiName}, the AI app that opened this page.`} Press Explain, Trace it or Tour on a card, type a question below, or tap Talk and just ask out loud. <ClaudeStatus />
                </p>
              )}
            </>
          ) : (
            <>
              <div className="board-tools">
                <button type="button" className="ctl compact ghost" onClick={startOver} disabled={busy} title="Clear the board and start a fresh conversation">
                  New conversation
                </button>
              </div>
              {turns.map((t, i, shown) =>
              t.note ? (
                <p key={t.id} className="note turn" data-turn={t.id}>
                  {t.note}
                </p>
              ) : (
                <div key={t.id} className="turn" data-turn={t.id}>
                  <p className="asked">
                    {t.unasked ? (
                      <>From {capName(aiName)}:</>
                    ) : (
                      <>
                        {t.q.startsWith("(said) ") ? "You said: " : "You asked: "}
                        <span>{t.q.replace(/^\(said\) /, "")}</span>
                      </>
                    )}
                  </p>
                  {t.images && (
                    <div className="asked-pics">
                      {t.images.map((p, k) => (
                        <img key={k} src={imageSrc(p)} alt={`Image ${k + 1} with the question`} />
                      ))}
                    </div>
                  )}
                  {t.tools.length > 0 && (
                    <details className="looked">
                      <summary>What I looked at</summary>
                      <small>{lookedLine(t.tools)}</small>
                    </details>
                  )}
                  {t.err ? (
                    <div className="err">
                      <p className="err">
                        <strong>{t.err.title}</strong> {t.err.message}
                      </p>
                      {t.err.detail && (
                        <p className="note">
                          <code>{t.err.detail}</code>
                        </p>
                      )}
                      {t.err.action === "settings" && (
                        <button type="button" className="ctl compact" onClick={openSettings}>
                          Open settings
                        </button>
                      )}
                      {t.err.action === "retry" && i === shown.length - 1 && (
                        <button type="button" className="ctl compact" onClick={retry} disabled={busy}>
                          Try again
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <Chalk text={stripToolTalk(t.a)} onCite={onCite} writing={busy && i === shown.length - 1} laneOf={laneOf} />
                      {t.a && !(busy && i === shown.length - 1) && <ReadAloud text={stripToolTalk(t.a)} />}
                    </>
                  )}
                </div>
              ),
              )}
            </>
          )}
          {MCP && busy && (
            <p className="note claude-wait">
              <ClaudeStatus quiet />
            </p>
          )}
        </div>
      </div>
      {tour && (
        <div className="panel steps">
          <button className="ctl compact" onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0}>
            ‹ back
          </button>
          <div className="progress" ref={progressRef}>
            {tour.steps.map((_, i) => (
              <button key={i} className={i < step ? "done" : i === step ? "on" : ""} onClick={() => onStep(i)} aria-label={`step ${i + 1}`} />
            ))}
          </div>
          <button className="ctl compact primary" onClick={() => onStep(Math.min(tour.steps.length - 1, step + 1))} disabled={step >= tour.steps.length - 1}>
            next ›
          </button>
          <span className="sp" />
          <TourPlayer tour={tour} step={step} onStep={onStep} scope={scope} sayEl={sayEl} />
          <button className="ctl compact ghost" onClick={() => onTour(null)}>
            end tour
          </button>
        </div>
      )}
      {lecture !== null && <LecturePanel key={lecture} onDismiss={() => setLecture(null)} />}
      {PICS && (pics.length > 0 || picNote) && (
        <div className="ask-pics" aria-label="Images attached to the next question">
          {pics.map((p, i) => (
            <span key={i} className="ask-pic">
              <img src={imageSrc(p)} alt={`Attached image ${i + 1}`} />
              <button type="button" aria-label={`Remove image ${i + 1}`} title="Remove" onClick={() => setPics((all) => all.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          ))}
          {picNote && <span className="note">{picNote}</span>}
        </div>
      )}
      <form
        className={`panel ask${dragging ? " dropping" : ""}`}
        {...(PICS
          ? {
              onDragOver: (e: React.DragEvent) => {
                if (![...e.dataTransfer.types].includes("Files")) return;
                e.preventDefault();
                setDragging(true);
              },
              onDragLeave: () => setDragging(false),
              onDrop: (e: React.DragEvent) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                setDragging(false);
                void addPics(e.dataTransfer.files);
              },
            }
          : {})}
        onSubmit={(e) => {
          e.preventDefault();
          if ((!q.trim() && !pics.length) || busy) return;
          onAsk(q.trim() || (pics.length === 1 ? "What is this image showing, and where is it in the code?" : "What do these images show, and where are they in the code?"), pics.length ? pics : undefined);
          setQ("");
          setPics([]);
          setPicNote(null);
        }}
      >
        <input
          ref={inputRef}
          className="field"
          placeholder={busy ? "Thinking…" : PICS ? "Ask about this code… (paste or drop an image too)" : "Ask about this code…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPaste={
            PICS
              ? (e) => {
                  const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                  if (!files.length) return;
                  e.preventDefault();
                  void addPics(files);
                }
              : undefined
          }
          disabled={busy}
        />
        {PICS && (
          <>
            <button type="button" className="ctl ask-attach" title="Attach an image (a screenshot, an error, a diagram): you can also paste or drop one" aria-label="Attach an image" onClick={() => picker.current?.click()} disabled={busy || pics.length >= MAX_IMAGES}>
              📎
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void addPics(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
        <button className="ctl primary" disabled={busy || (!q.trim() && !pics.length)}>
          Ask
        </button>
        {busy && (
          <button type="button" className="ctl" onClick={() => abort.current?.abort()}>
            stop
          </button>
        )}
        {VOICE.microphone &&
          (VOICE.talk === "claude" && talkMode !== "lecturer" ? (
            talkMode && <ClaudeTalk mode={talkMode} onType={focusAsk} onStatus={setHeard} busy={busy} />
          ) : (
            <TalkButton open={lecture !== null} onOpen={() => setLecture((n) => (n ?? 0) + 1)} onBlocked={setTalkBlocked} />
          ))}
      </form>
      {heard && (
        <p className="note talk-why" role="status" data-testid="talk-heard">
          {heard}
        </p>
      )}
      {talkBlocked && (
        <p className="note talk-why" role="status">
          <strong>{talkBlocked.title}.</strong> {talkBlocked.message}{" "}
          {talkBlocked.action === "settings" && (
            <button type="button" className="ctl compact" onClick={openVoiceSettings}>
              Open settings
            </button>
          )}
        </p>
      )}
    </>
  );
}
