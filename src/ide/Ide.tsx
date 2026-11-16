"use client";
/**
 * WalkMyCode's one IDE panel, for both rooms: the editor (Editor.tsx) with
 * everything around it.
 *
 * - Read or edit: `mode="read"` opens read-only, with an "Edit" switch when
 *   `onChange` is given; Save (and Ctrl+S) when `onSave` is given, with an
 *   unsaved-changes marker from `dirty`. Writing the file is the host's job.
 * - Run: Python (this page's MicroPython, or the laptop's real Python, with
 *   plots and the step-through debugger), JavaScript and TypeScript (this
 *   page), SQL (SQLite in this page; results as tables) and Rust (compiled on
 *   the laptop). In the full app and WalkMyCode for Claude, also "This
 *   computer" (./localrun): the file or the selection run by the real
 *   toolchain on PATH (Python, Node, Go, Rust, Java…), output streamed, with a
 *   terminal beside the output. Never in Lite; never for the lecturer.
 * - The professor beside the code: explain an error, a hint, explain the code
 *   or the selected lines, and check an exercise (`board` with a task).
 * - Explore's reading aids pass straight through: `highlight` (a tour step)
 *   and `onSelect` (for "explain this").
 * - A splitter between the editor and the output (./split.ts): dragged, moved
 *   with the arrow keys, double-clicked back to the default, kept per user.
 *   Dragging only rewrites two CSS variables on the grid, a frame at a time,
 *   so the editor is never drawn again while it moves.
 * - The output lives in ./outputStore.ts, the one place it is kept. In
 *   Explore it can pop out into its own dock panel and dock back; a run shows
 *   in whichever place it is.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { sampleMessage, type Sample } from "@/learn/lib/claude";
import { Chalk } from "@/learn/lib/markup";
import { checkPrompt, codeHelpPrompt, type CodeContext } from "@/learn/lib/professor";
import type { Board, CodeCheck, Lesson, Profile } from "@/learn/lib/types";
import DebugPanel from "./DebugPanel";
import LiveDebug, { GetDebugger } from "./LiveDebug";
import { debugAt, useDebugAt } from "./debugAt";
import { getWorkspace } from "@/lib/store";
import Editor, { languageOf, type BlameMark, type Language, type Selection } from "./Editor";
import { JsRunner } from "./js";
import { abortLaptop, debugPython, laptopAvailable, restartPython, runPython, runRust, stopPython, type DebugRun, type Engine, type OutPart } from "./python";
import { resetSql, runSql } from "./sql";
import { outputs } from "./outputStore";
import OutputArea, { useLocalStatus } from "./localrun/OutputArea";
import { debugLocal, installDebugger, LOCAL_BUILD, loadLocalStatus, outputMode, runLocal, sendInput, stopLocal, type DebugSession } from "./localrun/client";
import { NATIVE_DEBUG_LANGS, type AdapterOffer, type FrameView, type PausedView, type VarView } from "@/lib/localrun/protocol";
import { useConsent } from "./localrun/Consent";
import { localLangFromEditor, localLangOf } from "@/lib/localrun/langs";
import { LITE } from "@/lib/adapters/target";
import { codeRoom } from "./codeRoom";
import { SPLIT_DEFAULT, SPLIT_GUTTER, clampSplit, readSplit, stepSplit, writeSplit, type SplitAxis } from "./split";
import "./ide.css";
import { readPref } from "@/lib/prefs";
import type { MdView } from "./mdView";

/** Ask about the code another way than the professor's `sample`: "explain" for the Explain
 * buttons (the file, or the selected lines), "question" for typed words. Resolves to the answer. */
export type AskVia = (
  q: { question: string; kind: "explain" | "question"; selection: Selection | null },
  o: { signal: AbortSignal; onText: (soFar: string) => void },
) => Promise<string>;

export type IdeProps = {
  /** The file's path (Explore), which sets the language and titles the panel. */
  path?: string | null;
  /** The language when there is no path (the Code room's Python). */
  language?: Language;
  value: string;
  /** Omit to make the code read-only for good. */
  onChange?: (value: string) => void;
  /** Starts read-only with an Edit switch ("read"), or ready to type ("edit", the default). */
  mode?: "read" | "edit";
  /** The original text, for "Reset code". */
  starter?: string;
  onSave?: (value: string) => void;
  /** Whether there are changes not yet saved (the host knows what is on disk). */
  dirty?: boolean;
  highlight?: [number, number] | null;
  onSelect?: (s: Selection | null) => void;
  /** The professor: the AI, and what it knows about the student. */
  sample: Sample | null;
  /** Explore in WalkMyCode for Claude: questions about the code go to the user's own Claude
   * (the bridge, like the guide's), not to `sample`, whose /api/learn that page's server lacks. */
  askVia?: AskVia;
  profile: Profile;
  /** Learn: the lesson and exercise board the code belongs to. */
  lesson?: Lesson;
  board?: Board;
  check?: CodeCheck;
  onCheck?: (c: CodeCheck) => void;
  speak?: (text: string) => Promise<void>;
  /** A run ended: what it printed, and whether it was the file's own tests (Learn marks an exercise from it). */
  onRan?: (output: string, o: { test: boolean }) => void;
  /** Side by side (editor left, output right) or stacked. */
  layout?: "side" | "stacked";
  /** More buttons for the file's header, before Edit (the Code panel's Blame and History). */
  headTools?: React.ReactNode;
  /** A Markdown file's preview (src/components/MarkdownPreview.tsx), and how it is shown beside the source. */
  preview?: React.ReactNode;
  view?: MdView;
  /** Who last changed each block of lines (git blame); hidden while the file is being edited. */
  blame?: BlameMark[] | null;
  /** No card of its own (border, padding, fixed editor height): it fills the panel it is put in, as in a dock. */
  frameless?: boolean;
  /** Explore wraps long lines for reading; code is not wrapped by default. */
  wrap?: boolean;
  fontSize?: number;
};

const ENGINE_PREF = "walkmycode:engine";
/** A switch for every code panel on the page, remembered in this browser ("on" / "off"). */
function pagePref(key: string) {
  let now: boolean | null = null;
  const listeners = new Set<() => void>();
  return {
    read: (): boolean => {
      if (now === null) {
        try {
          now = readPref(localStorage, key) === "on";
        } catch {
          now = false;
        }
      }
      return now;
    },
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    set: (on: boolean): void => {
      now = on;
      try {
        localStorage.setItem(key, on ? "on" : "off");
      } catch {
        // Storage blocked: the choice lasts until the page closes.
      }
      listeners.forEach((f) => f());
    },
  };
}
/** "Code only": the run bar, the output and the professor are hidden, and the code has the whole panel (owner, 12 Nov). */
const CODE_ONLY = pagePref("walkmycode:ide-code-only");
/** "Hide chat": the questions and answers are hidden, the code and the output (or terminal) stay (owner, 13 Nov). */
const CHAT_HIDDEN = pagePref("walkmycode:ide-chat-hidden");
const serverOff = () => false;

/** Where code runs: this page, the laptop connector (Lite's Learn), or this computer (./localrun). */
type RunOn = Engine | "local";

const outputText = (parts: OutPart[]) =>
  parts
    .map((p) =>
      p.kind === "image"
        ? "[a plot was drawn]\n"
        : p.kind === "table"
          ? [p.columns.join(" | "), ...p.rows.slice(0, 20).map((r) => r.join(" | "))].join("\n") + "\n"
          : p.kind === "value"
            ? p.text + "\n"
            : p.text,
    )
    .join("");

const RUNNABLE: Language[] = ["python", "javascript", "typescript", "jsx", "tsx", "sql", "rust"];

const HINTS: Partial<Record<Language, string>> = {
  javascript: "Runs JavaScript in this page. console.log prints; console.table shows a table. Each run starts afresh.",
  typescript: "Runs TypeScript in this page (types are removed, not checked). console.log prints. Each run starts afresh.",
  jsx: "Runs in this page. JSX becomes React.createElement calls, and React is not loaded here, so run plain code.",
  tsx: "Runs in this page. JSX becomes React.createElement calls, and React is not loaded here, so run plain code.",
  sql: "Runs SQL on a SQLite database in this page. Tables you create stay until Reset database. SELECT results show as tables.",
  rust: "Compiles and runs Rust on your laptop with its own rustc (fn main() is the start). Needs the laptop connector and Rust installed.",
};

export default function Ide({
  path = null,
  language,
  value,
  onChange,
  mode = "edit",
  starter,
  onSave,
  dirty = false,
  highlight = null,
  onSelect,
  sample,
  askVia,
  profile,
  lesson,
  board,
  check,
  onCheck,
  speak,
  onRan,
  layout = "side",
  headTools,
  preview,
  view = "preview",
  blame = null,
  frameless = false,
  wrap = false,
  fontSize,
}: IdeProps) {
  const lang = language ?? languageOf(path);
  // "This computer": the language by the file's ending (Go, Java… too), else by the editor's.
  const localStatus = useLocalStatus();
  /** Code the page can't run itself (Rust, C#…) waits for "This computer" to answer before Run: pressed sooner,
   *  it fell back to the laptop engine ("Rust runs on your laptop, which is not reachable"). */
  const awaitingLocal = LOCAL_BUILD && !localStatus && !(RUNNABLE.includes(lang) && lang !== "rust");
  const localLang = localLangOf(path) ?? localLangFromEditor(lang);
  const localTool = localLang ? localStatus?.toolchains.find((t) => t.lang === localLang) : undefined;
  const localOk = !!localStatus?.available && !!localLang;
  /** Runs in this page (Rust only ever on a laptop or this computer). */
  const pageRunnable = RUNNABLE.includes(lang) && lang !== "rust";
  const runnable = RUNNABLE.includes(lang) || localOk;
  const isPython = lang === "python";
  const isJs = lang === "javascript" || lang === "typescript" || lang === "jsx" || lang === "tsx";
  const debuggable = isPython || isJs;
  const uid = useId();
  const dbKey = `${path ?? "room"}:${uid}`;
  const js = useRef<JsRunner | null>(null);
  const [editing, setEditing] = useState(mode === "edit" && !!onChange);
  // Editing a Markdown file from its preview shows the source beside it, to see each change as it reads.
  const shownView: MdView = editing && view === "preview" ? "split" : view;
  // The run's output, in the shared store (one entry per IDE), so the
  // popped-out Output panel shows the very same thing.
  const outId = `ide:${uid}`;
  const outState = useSyncExternalStore(outputs.subscribe, () => outputs.get(outId), () => outputs.get(outId));
  const dock = useSyncExternalStore(outputs.subscribe, outputs.dock, outputs.dock);
  const { parts: out, running, ran } = outState;
  const setOut = useCallback((parts: OutPart[]) => outputs.update(outId, { parts }), [outId]);
  const setStatus = useCallback((status: string) => outputs.update(outId, { status }), [outId]);
  const setRunning = useCallback((running: boolean) => outputs.update(outId, { running }), [outId]);
  const setRan = useCallback((ran: boolean) => outputs.update(outId, { ran }), [outId]);
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [dbg, setDbg] = useState<{ run: DebugRun; index: number } | null>(null);
  // A live debug on this computer (./LiveDebug.tsx): stopped at `paused`, or running when that is null.
  const [liveDbg, setLive] = useState<{ session: DebugSession; paused: PausedView | null; frame: number; vars: VarView[]; prev: VarView[]; adapter: string } | null>(null);
  // Its language's debugger isn't here yet: the offer, and how fetching it goes.
  const [need, setNeed] = useState<{ offer: AdapterOffer; progress: { got: number; total: number; phase: string } | null; error: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [q, setQ] = useState("");
  const [help, setHelp] = useState<{ text: string; busy: boolean; err: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  // What the user (or the laptop's answer) chose; null until then, when the default below applies.
  const [picked, setEngine] = useState<RunOn | null>(null);
  const [laptop, setLaptop] = useState(false);
  const [prefLocal, setPrefLocal] = useState(false);
  const localRun = useRef<string | null>(null);
  const { ask: askConsent, dialog: consentDialog } = useConsent();
  // This computer by default when it is allowed, has the toolchain and was the user's last choice, and
  // always for a language this page cannot run; "This computer" falls back to the page where it is gone.
  const localReady = localOk && !!localStatus?.allowed && !!localTool?.path;
  const engine: RunOn =
    picked === "local" && !localOk ? "page" : (picked ?? (localOk && (!pageRunnable || (localReady && prefLocal)) ? "local" : "page"));
  // The engine the page's own runners and the debugger use ("This computer" has neither).
  const pageEngine: Engine = engine === "local" ? "page" : engine;
  /** A live debugger on this computer for this language (Rust so far): breakpoints, steps, variables. */
  const nativeDebug = engine === "local" && !!localLang && NATIVE_DEBUG_LANGS.includes(localLang);
  useEffect(() => {
    let live = true;
    void loadLocalStatus().then(() => {
      try {
        if (live) setPrefLocal(readPref(localStorage, ENGINE_PREF) === "local");
      } catch {}
    });
    return () => {
      live = false;
    };
  }, []);

  // Use the laptop's full Python when it answers, unless the user chose otherwise.
  useEffect(() => {
    if (!isPython && lang !== "rust") return;
    let live = true;
    void laptopAvailable().then((ok) => {
      if (!live) return;
      setLaptop(ok);
      let pick: string | null = null;
      try {
        pick = readPref(localStorage, ENGINE_PREF);
      } catch {}
      if (ok && pick !== "page") setEngine("laptop");
    });
    return () => {
      live = false;
    };
  }, [isPython, lang]);
  const chooseEngine = async (e: RunOn) => {
    // The first time: the user says yes to running code on this computer, or it stays where it was.
    if (e === "local" && !localStatus?.allowed && !(await askConsent())) return;
    setEngine(e);
    setOut([]);
    setRan(false);
    try {
      localStorage.setItem(ENGINE_PREF, e);
    } catch {}
  };

  useEffect(() => () => ctl.current?.abort(), []);

  // What the output says before a run, and after one that printed nothing:
  // kept with the output, so the popped-out panel says it too.
  const hint = !runnable
    ? ""
    : engine === "local"
      ? localHint(localTool, localStatus?.allowed ?? false, localStatus?.timeout_s ?? 60)
    : !isPython
      ? HINTS[lang] ?? ""
      : engine === "laptop"
        ? "Runs in your laptop's own Python, with numpy, pandas, scipy, scikit-learn and matplotlib."
        : "Runs MicroPython in this page: plain Python, plus ulab for arrays (from ulab import numpy as np). For pandas, scikit-learn or plots, run on your laptop.";
  const empty = `The code ran and printed nothing. ${lang === "rust" ? "Use println!() to see values." : isPython ? "Use print() to see values." : engine === "local" && !pageRunnable ? "Print something to see it here." : "Use console.log() to see values."}`;
  const tip = debuggable && breakpoints.length === 0 ? "Tip: click beside a line number to set a breakpoint, then press Debug." : "";
  const label = path ? (path.split("/").pop() ?? path) : lesson ? lesson.title : "Code room";
  useEffect(() => {
    outputs.update(outId, { hint, empty, tip, label });
  }, [outId, hint, empty, tip, label]);
  // This IDE's output goes when it does; while the output is popped out, a
  // newly opened IDE is what the panel shows until another one is used.
  useEffect(() => {
    if (outputs.dock().popped && !outputs.dock().owner) outputs.setOwner(outId);
    return () => outputs.remove(outId);
  }, [outId]);
  const own = () => {
    codeRoom.use(outId);
    if (outputs.dock().popped && outputs.dock().owner !== outId) outputs.setOwner(outId);
  };

  const listener = (onDebug?: (r: DebugRun) => void, onDone?: () => void) => ({
    // Printed lines arrive one at a time: the store joins them into one block per kind.
    onPart: (p: OutPart) => outputs.append(outId, p),
    onStatus: setStatus,
    onDebug,
    done: () => {
      setRunning(false);
      setStatus("");
      outputs.update(outId, { stdin: null });
      onDone?.();
    },
  });
  /** While a program runs on this computer: what the user types in the Output goes to its input, echoed as a terminal would. */
  const typeInto = (id: string) =>
    outputs.update(outId, {
      stdin: {
        send: (text) => {
          sendInput(id, text);
          outputs.append(outId, { kind: "out", text });
        },
        end: () => sendInput(id, "", true),
      },
    });

  /** Run the code. `sandbox`: only in the page (Python's MicroPython worker, never the laptop), for the lecturer. */
  const start = (o: { onDone?: () => void; sandbox?: boolean; test?: boolean } = {}) => {
    if (!runnable || running || dbg || liveDbg) return false;
    // The lecturer's run_code never leaves the page's sandbox.
    if (o.sandbox && !pageRunnable) return false;
    own();
    setOut([]);
    setRunning(true);
    setRan(true);
    const l = listener(undefined, () => {
      o.onDone?.();
      if (!o.sandbox) onRan?.(outputText(outputs.get(outId).parts), { test: !!o.test });
    });
    if (engine === "local" && !o.sandbox && localLang) {
      outputMode.set("output");
      // The selection when there is one, else the whole file; the server knows the file's folder when it is on disk.
      const code = selection?.text.trim() && !o.test ? selection.text : value;
      localRun.current = runLocal({ lang: localLang, code, path: selection?.text.trim() ? null : path, test: o.test }, l);
      typeInto(localRun.current);
    } else if (isPython) runPython(value, l, o.sandbox ? "page" : pageEngine);
    else if (lang === "sql") void runSql(value, l, dbKey);
    else if (lang === "rust") runRust(value, l);
    else void (js.current ??= new JsRunner()).run(value, l, { typescript: lang === "typescript" || lang === "tsx", jsx: lang === "jsx" || lang === "tsx" });
    return true;
  };
  const run = () => {
    // Nothing runs on this computer before the user has said yes once.
    if (engine === "local" && !localStatus?.allowed) {
      void askConsent().then((ok) => ok && start());
      return;
    }
    start();
  };
  /** The exercise's own tests, on this computer (Rust: rustc --test). */
  const canTest = !!board?.tests && lang === "rust" && localOk && !!localLang;
  const runTests = async () => {
    if (!localStatus?.allowed && !(await askConsent())) return;
    if (engine !== "local") setEngine("local");
    // The engine is read when the run starts: start on the next turn, once "This computer" is chosen.
    setTimeout(() => testNow.current(), 0);
  };
  const testNow = useRef(() => {});
  useEffect(() => {
    testNow.current = () => void start({ test: true });
  });
  const stop = (sandboxed = false) => {
    if (liveDbg && !sandboxed) return liveDbg.session.stop();
    if (engine === "local" && !sandboxed) stopLocal(localRun.current);
    else if (isPython) stopPython(sandboxed ? "page" : pageEngine);
    else if (lang === "rust") abortLaptop();
    else js.current?.stop();
  };

  // "Run this code" from outside (the voice lecturer's run_code, ./codeRoom.ts):
  // registered once; it reads this render's code and state through a ref.
  const live = useRef({ start, stop, runnable, pageRunnable, lang, running, dbg: !!dbg, label: "" });
  useEffect(() => {
    live.current = { start, stop, runnable, pageRunnable, lang, running, dbg: !!dbg, label };
  });
  useEffect(
    () =>
      codeRoom.register(outId, {
        get language() {
          return live.current.lang;
        },
        get label() {
          return live.current.label;
        },
        blocked: () => {
          const c = live.current;
          if (!c.runnable) return `${c.label} is not code this page can run.`;
          if (c.lang === "rust") return "Rust runs on the laptop, which run_code never uses. Ask them to press Run themselves.";
          if (!c.pageRunnable) return "This code runs only on the user's computer, which run_code never uses. Ask them to press Run themselves.";
          if (c.running) return "Code is already running there.";
          if (c.dbg) return "The debugger is open there; it must be closed first.";
          return null;
        },
        run: () =>
          new Promise<OutPart[]>((resolve, reject) => {
            if (!live.current.start({ sandbox: true, onDone: () => resolve(outputs.get(outId).parts) })) reject(new Error("The code could not be started."));
          }),
        stop: () => live.current.stop(true),
      }),
    [outId],
  );

  /** Record the run, then step through it, starting at the first breakpoint if any. */
  const debug = () => {
    if (!debuggable || running) return;
    own();
    setOut([]);
    setDbg(null);
    setRunning(true);
    setRan(true);
    const l = listener((r) => {
      const first = r.steps.findIndex((st) => st.event === "line" && breakpoints.includes(st.line));
      setDbg({ run: r, index: first >= 0 ? first : 0 });
    });
    if (isPython) debugPython(value, l, pageEngine);
    else void (js.current ??= new JsRunner()).debug(value, l, { typescript: lang === "typescript" || lang === "tsx", jsx: lang === "jsx" || lang === "tsx" });
  };
  const toggleBreakpoint = (line: number) => setBreakpoints((b) => (b.includes(line) ? b.filter((x) => x !== line) : [...b, line]));

  /** Debug on this computer: build with debug info, run under the language's debugger, stop at the breakpoints. */
  const debugNative = async () => {
    if (running || liveDbg || !localLang) return;
    if (!localStatus?.allowed && !(await askConsent())) return;
    own();
    outputMode.set("output");
    setOut([]);
    setNeed(null);
    setRunning(true);
    setRan(true);
    const session = debugLocal(
      // The workspace's name: the full app finds its folder (as Source Control does), so other files' frames are the project's.
      { lang: localLang, code: value, path, breakpoints, workspace: getWorkspace()?.name },
      {
        onPart: (p) => outputs.append(outId, p),
        onStatus: setStatus,
        onNeed: (offer) => setNeed({ offer, progress: null, error: "" }),
        onStart: (adapter) => setLive((l) => (l ? { ...l, adapter } : l)),
        onPaused: (v) => {
          setLive((l) => (l ? { ...l, paused: v, frame: v.frame, prev: l.vars, vars: v.vars } : l));
          stoppedIn(v.frames[v.frame]);
        },
        onRunning: () => {
          setLive((l) => (l ? { ...l, paused: null } : l));
          debugAt.clear(outId);
        },
        done: () => {
          setRunning(false);
          setStatus("");
          setLive(null);
          debugAt.clear(outId);
          outputs.update(outId, { stdin: null });
        },
      },
    );
    typeInto(session.id);
    setLive({ session, paused: null, frame: 0, vars: [], prev: [], adapter: "" });
  };
  /** The user said yes: fetch the debugger, then debug. */
  const getDebugger = () => {
    if (!need) return;
    const { offer } = need;
    setNeed({ offer, progress: { got: 0, total: offer.bytes, phase: "download" }, error: "" });
    installDebugger(offer.id, (progress) => setNeed({ offer, progress, error: "" })).then(
      () => {
        setNeed(null);
        void debugNative();
      },
      (e: Error) => setNeed({ offer, progress: null, error: e.message }),
    );
  };
  // Breakpoints set or cleared while debugging reach the debugger at once.
  const liveSession = liveDbg?.session;
  useEffect(() => {
    liveSession?.breakpoints(breakpoints);
  }, [liveSession, breakpoints]);
  /** Where it stopped, for every panel (./debugAt.ts): Explore opens that file at that line, and Files follows it. */
  const stoppedIn = (f: FrameView | undefined) => {
    if (f?.mine && f.file) debugAt.set({ path: f.file, line: f.line, owner: outId });
    else debugAt.clear(outId);
  };
  /** Another frame of the call stack: its variables, and its file opened at its line. */
  const showFrame = (index: number) => {
    if (!liveDbg) return;
    stoppedIn(liveDbg.paused?.frames[index]);
    void liveDbg.session.frame(index).then((vars) => setLive((l) => (l ? { ...l, frame: index, prev: vars, vars } : l)));
  };
  // A debug that goes (its panel closed) lets go of the stopped line.
  useEffect(() => () => debugAt.clear(outId), [outId]);

  const select = (s: Selection | null) => {
    setSelection(s);
    onSelect?.(s);
  };

  const context = (): CodeContext => ({ lesson, board, code: value, output: ran ? outputText(out) : "", engine: isPython ? pageEngine : undefined, language: lang });

  const ask = async (question: string, kind: "explain" | "question" = "question") => {
    if (!(sample || askVia) || !question.trim()) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setHelp({ text: "", busy: true, err: "" });
    const where = path ? `The file is ${path}. ` : "";
    const focus = selection ? `They have selected lines ${selection.start}–${selection.end}:\n${selection.text.slice(0, 4000)}\n` : "";
    try {
      const text = askVia
        ? await askVia({ question: hasError && kind === "question" ? `${question}\n\nThe run's output:\n${outputText(out).slice(-4000)}` : question, kind, selection }, { signal: c.signal, onText: (t) => setHelp({ text: t, busy: true, err: "" }) })
        : (
            await sample!(codeHelpPrompt(context(), `${where}${focus}${question}`, profile), {
              signal: c.signal,
              cache: false,
              onText: ({ text }) => setHelp({ text, busy: true, err: "" }),
            })
          ).text;
      setHelp({ text, busy: false, err: "" });
    } catch (e) {
      // The bridge's errors (AskError) carry their own plain words; the professor's are codes.
      const said = askVia ? (c.signal.aborted ? "" : (e as Error).message || "Claude could not answer.") : sampleMessage(e);
      setHelp({ text: (e as { text?: string }).text ?? "", busy: false, err: said });
    }
  };

  const checkWork = async () => {
    if (!sample || !onCheck) return;
    setChecking(true);
    try {
      const r = await sample.json<{ passed?: unknown; feedback?: unknown }>(checkPrompt(context(), profile), { cache: false });
      const c = { passed: r?.passed === true, feedback: String(r?.feedback ?? "") };
      onCheck(c);
      void speak?.(c.feedback);
    } catch (e) {
      setHelp({ text: "", busy: false, err: sampleMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  // ── The splitter ──
  // The split is two CSS variables on the grid (--ide-a, --ide-b), written a
  // frame at a time while dragging: no React state, so nothing is re-rendered.
  const narrow = useNarrow();
  const gridRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const split = useRef(SPLIT_DEFAULT.rows);
  const splitAxis: SplitAxis = layout === "stacked" || narrow ? "rows" : "cols";
  const codeOnly = useSyncExternalStore(CODE_ONLY.subscribe, CODE_ONLY.read, serverOff);
  const toggleCodeOnly = () => CODE_ONLY.set(!codeOnly);
  const chatHidden = useSyncExternalStore(CHAT_HIDDEN.subscribe, CHAT_HIDDEN.read, serverOff);
  const hasChat = !!sample || !!askVia;
  const chatShown = hasChat && !chatHidden;
  // The panels exist at all (what there is to hide), and are shown (unless "Code only" is on, or all that is
  // left beside the code is the hidden chat).
  const outputSide = (runnable && (!(dock.popped && dock.canPop) || !!dbg)) || !!check;
  const hasSide = outputSide || !!help || hasChat;
  const splitShown = !codeOnly && (outputSide || chatShown);
  const applySplit = useCallback((f: number) => {
    split.current = f;
    const g = gridRef.current;
    if (!g) return;
    g.style.setProperty("--ide-a", `${(f * 100).toFixed(2)}fr`);
    g.style.setProperty("--ide-b", `${((1 - f) * 100).toFixed(2)}fr`);
    handleRef.current?.setAttribute("aria-valuenow", String(Math.round(f * 100)));
  }, []);
  const splitSize = useCallback(() => {
    const r = gridRef.current?.getBoundingClientRect();
    return r ? (splitAxis === "rows" ? r.height : r.width) : 0;
  }, [splitAxis]);
  useLayoutEffect(() => {
    if (splitShown) applySplit(clampSplit(readSplit(storage(), splitAxis), splitAxis, splitSize()));
  }, [splitAxis, splitShown, applySplit, splitSize]);
  const onSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gridRef.current;
    if (e.button !== 0 || !g) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = g.getBoundingClientRect();
    const total = splitAxis === "rows" ? rect.height : rect.width;
    const start = splitAxis === "rows" ? rect.top : rect.left;
    g.classList.add("dragging");
    let frame = 0;
    let next = split.current;
    let done = false;
    const move = (ev: PointerEvent) => {
      const at = (splitAxis === "rows" ? ev.clientY : ev.clientX) - start - SPLIT_GUTTER / 2;
      next = clampSplit(at / (total - SPLIT_GUTTER), splitAxis, total);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          applySplit(next);
        });
      }
    };
    const up = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      applySplit(next);
      g.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.removeEventListener("lostpointercapture", up);
      writeSplit(storage(), splitAxis, next);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    handle.addEventListener("lostpointercapture", up);
  };
  const onSplitKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const f = stepSplit(split.current, e.key, splitAxis, splitSize(), e.shiftKey);
    if (f === null) return;
    e.preventDefault();
    applySplit(f);
    writeSplit(storage(), splitAxis, f);
  };
  const onSplitReset = () => {
    applySplit(clampSplit(SPLIT_DEFAULT[splitAxis], splitAxis, splitSize()));
    writeSplit(storage(), splitAxis, null);
  };

  const hasError = out.some((p) => p.kind === "error");
  const readOnly = !editing || !!dbg || !!liveDbg;
  // The line the live debugger stopped at, when the frame on show is in this file.
  const liveFrame = liveDbg?.paused?.frames[liveDbg.frame];
  const liveLine = liveFrame?.mine && (!path || liveFrame.file === path || (!!liveFrame.file && path.endsWith("/" + liveFrame.file))) ? liveFrame.line : null;
  // Another panel's debug stopped in this file: its line is marked here too.
  const at = useDebugAt();
  const atLine = at && path && at.path === path ? at.line : null;
  // Popped out (Explore only): the dock's Output panel draws the output, and
  // the space under the editor keeps the debugger, the check and the professor.
  const popped = dock.popped && dock.canPop;
  const showOutput = runnable && !popped;
  const showSide = splitShown;
  const axis = splitAxis;
  // The run section in Explore's Run panel (src/shell/panels/OutputPanel.tsx): the run bar, the debugger, the
  // program's input and the Output or Terminal move there together, the editor keeps the whole height, and the
  // panel docks in either sidebar like any other. This IDE draws them there (a portal) while it owns the panel.
  const docked = !!(popped && dock.slot && dock.owner === outId && runnable);
  const codeBar = (
    <div className="code-bar">
    <button className="ctl primary" type="button" onClick={run} disabled={running || !!dbg || !!liveDbg || awaitingLocal} title={awaitingLocal ? "Checking this computer…" : engine === "local" ? "Run on this computer (the selected lines, when some are selected)" : undefined}>
      ▶ {engine === "local" && selection?.text.trim() ? "Run selection" : "Run"} <kbd>Ctrl ↵</kbd>
    </button>
    {nativeDebug ? (
      <button className="ctl" type="button" onClick={() => void debugNative()} disabled={running || !!dbg || !!liveDbg} title="Build with debug info and run it under a debugger on this computer: it stops at your breakpoints">
        🐞 Debug
      </button>
    ) : (
      debuggable && pageRunnable && <button className="ctl" type="button" onClick={debug} disabled={running || !!dbg} title="Run once while recording every line, then step through it">🐞 Debug</button>
    )}
    {canTest && <button className="ctl" type="button" onClick={() => void runTests()} disabled={running || !!dbg} title="Compile this file with its own tests and run them on this computer">🧪 Run the tests</button>}
    {running && <button className="ctl" type="button" onClick={() => stop()}>■ Stop</button>}
    {isPython && engine !== "local" && <button className="ctl" type="button" disabled={running} onClick={() => { void restartPython(pageEngine); setOut([]); setRan(false); }} title="Forget all variables and start Python afresh">Restart Python</button>}
    {lang === "sql" && engine !== "local" && <button className="ctl" type="button" disabled={running} onClick={() => { resetSql(dbKey); setOut([]); setRan(false); }} title="Drop every table and start with an empty database">Reset database</button>}
    {starter !== undefined && onChange && (
      <button className="ctl" type="button" disabled={value === starter || !editing} onClick={() => onChange(starter)}>Reset code</button>
    )}
    {(isPython || localOk) && (
      <label className="engine" htmlFor={`engine-${uid}`}>
        Run on
        <select id={`engine-${uid}`} value={engine} disabled={running} onChange={(e) => void chooseEngine(e.target.value as RunOn)}>
          {pageRunnable && <option value="page">{isPython ? "This page (MicroPython)" : "This page"}</option>}
          {localOk && <option value="local">{localLabel(localTool, localStatus?.allowed ?? false)}</option>}
          {/* Lecture Hall's laptop connector: Lite's Learn, or wherever it is actually connected. */}
          {(isPython || lang === "rust") && (LITE || laptop || !localOk) && (
            <option value="laptop">My laptop ({isPython ? "full Python" : "Rust"}){laptop ? "" : " · not connected"}</option>
          )}
        </select>
      </label>
    )}
    {popped && !docked && (
      <button className="ctl" type="button" onClick={() => outputs.dockBack()} title="The output is in its own panel: put it back under the editor">
        ⧈ Dock output back
      </button>
    )}
    {lang === "rust" && !laptop && engine !== "local" && <span className="hint">Your laptop isn&rsquo;t connected, so Rust can&rsquo;t run here.</span>}
    {onCheck && sample && (
      <button className="ctl" type="button" disabled={checking || running} onClick={checkWork}>{checking ? "Checking…" : "✓ Check my work"}</button>
    )}
</div>
  );
  const debugParts = (
    <>
      {need && <GetDebugger offer={need.offer} progress={need.progress} error={need.error} onGet={getDebugger} onCancel={() => setNeed(null)} />}
      {liveDbg && (
        <LiveDebug
          paused={liveDbg.paused}
          frame={liveDbg.frame}
          vars={liveDbg.vars}
          prev={liveDbg.prev}
          adapter={liveDbg.adapter}
          onCmd={(c) => liveDbg.session.cmd(c)}
          onStop={() => liveDbg.session.stop()}
          onFrame={showFrame}
          loadVars={(ref) => liveDbg.session.vars(ref)}
        />
      )}
    </>
  );

  const editorEl = (
    <Editor
      path={path}
      language={lang}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      onRun={runnable ? run : undefined}
      onSave={onSave && editing ? () => onSave(value) : undefined}
      highlight={highlight}
      onSelect={select}
      breakpoints={breakpoints}
      onToggleBreakpoint={debuggable || nativeDebug ? toggleBreakpoint : undefined}
      debugLine={dbg ? dbg.run.steps[dbg.index]?.line ?? null : (liveLine ?? atLine)}
      wrap={wrap}
      blame={editing || dirty ? null : blame}
      fontSize={fontSize}
      label={path ? `Code: ${path}` : "Code"}
    />
  );

  return (
    <div className={`ide ${layout}${frameless ? " frameless" : ""}`} onPointerDownCapture={own} onFocusCapture={own}>
      {board?.task && (
        <div className="task">
          <p className="eyebrow">Your task</p>
          <p><Chalk text={board.task} /></p>
          {board.expect && <p className="expect">A correct run prints something like: <code>{board.expect}</code></p>}
        </div>
      )}

      {(path || onSave || (onChange && mode === "read") || hasSide || runnable) && (
        <div className="ide-head">
          {path && <span className="ide-path" title={path}>{path}</span>}
          {dirty && <span className="pill warn">Unsaved changes</span>}
          <span className="sp" />
          {headTools}
          {/* Icon buttons, to keep the head short: their names are the tooltip and the label. */}
          {hasChat && !codeOnly && (
            <button
              className={`ctl code-only icon${chatHidden ? " on" : ""}`}
              type="button"
              aria-pressed={chatHidden}
              aria-label={chatHidden ? "Show chat" : "Hide chat"}
              onClick={() => CHAT_HIDDEN.set(!chatHidden)}
              title={chatHidden ? "Show chat: the questions and answers" : "Hide chat: the code and the output keep the panel"}
              data-testid="ide-chat-toggle"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                {chatHidden ? (
                  <path d="M1.5 14.5l13-13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                ) : (
                  <path d="M5 6h6M5 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                )}
              </svg>
            </button>
          )}
          {(hasSide || runnable) && (
            <button
              className={`ctl code-only icon${codeOnly ? " on" : ""}`}
              type="button"
              aria-pressed={codeOnly}
              aria-label={codeOnly ? "Show panels" : "Code only"}
              onClick={toggleCodeOnly}
              title={codeOnly ? "Show panels: the run bar, the output and the chat" : "Code only: hide the run bar, the output and the chat"}
              data-testid="ide-code-only"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2" y="2.5" width="12" height="11" fill="none" stroke="currentColor" strokeWidth="1.3" />
                {codeOnly ? (
                  <path d="M6 6.2L4.2 8 6 9.8M10 6.2L11.8 8 10 9.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <>
                    <path d="M2 9.5h12" stroke="currentColor" strokeWidth="1.3" />
                    <rect x="2.6" y="10.1" width="10.8" height="2.8" fill="currentColor" opacity=".35" />
                  </>
                )}
              </svg>
            </button>
          )}
          {onChange && mode === "read" && (
            <button className="ctl" type="button" aria-pressed={editing} onClick={() => setEditing((e) => !e)} disabled={!!dbg}>
              {editing ? "Done editing" : "✎ Edit"}
            </button>
          )}
          {onSave && (
            <button className="ctl primary" type="button" disabled={!dirty} onClick={() => onSave(value)} title="Save (Ctrl+S)">
              Save <kbd>Ctrl S</kbd>
            </button>
          )}
        </div>
      )}

      <div ref={gridRef} className={`ide-grid ${showSide ? `split ${axis}` : "single"}`}>
        <div className="ide-left">
          {preview ? (
            // A Markdown file: as it reads, its source, or both (src/ide/mdView.ts). Editing shows the source beside it.
            <div className={`md-view md-${shownView}`}>
              {editorEl}
              {shownView !== "source" && <div className="md-pane">{preview}</div>}
            </div>
          ) : (
            editorEl
          )}
          {runnable && !codeOnly && !docked && codeBar}
        </div>

        {showSide && (
          <div
            ref={handleRef}
            className="ide-split"
            role="separator"
            aria-orientation={axis === "rows" ? "horizontal" : "vertical"}
            aria-label="Resize the editor and the output"
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            title="Drag to resize · arrow keys move it · double-click resets it"
            onPointerDown={onSplitDown}
            onKeyDown={onSplitKey}
            onDoubleClick={onSplitReset}
          />
        )}

        {showSide && (
          <div className="ide-right">
            {!docked && debugParts}
            {runnable &&
              (dbg ? (
                <DebugPanel
                  run={dbg.run}
                  index={dbg.index}
                  onIndex={(i) => setDbg((d) => (d ? { ...d, index: i } : d))}
                  breakpoints={breakpoints}
                  onExit={() => setDbg(null)}
                  code={value}
                  engine={isPython ? pageEngine : "laptop"}
                  sample={sample}
                  profile={profile}
                />
              ) : (
                showOutput && (
                  <OutputArea
                    state={outState}
                    action={
                      dock.canPop ? (
                        <button className="ctl" type="button" onClick={() => outputs.popOut(outId)} title="Move the output into its own panel, to move, tab, float or resize like any other">
                          ↗ Pop out
                        </button>
                      ) : undefined
                    }
                  />
                )
              ))}

            {check && <p className={`check ${check.passed ? "ok" : "no"}`}>{check.passed ? "✓ Well done. " : "Not yet. "}{check.feedback}</p>}

            {chatShown && (
              <div className="ask">
                <div className="row">
                  {hasError && <button className="ctl" type="button" onClick={() => ask("What does this error mean, and how do I fix it?")}>Explain this error</button>}
                  {selection ? (
                    <button className="ctl" type="button" onClick={() => ask("Explain the selected lines: what they do, and how they fit into the rest of the code.", "explain")}>
                      Explain lines {selection.start}–{selection.end}
                    </button>
                  ) : (
                    <button className="ctl" type="button" onClick={() => ask("Walk me through what this code does, section by section.", "explain")}>Explain this code</button>
                  )}
                  {editing && <button className="ctl" type="button" onClick={() => ask("Give me a hint for the next step.")}>Give me a hint</button>}
                </div>
                <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(q); setQ(""); }}>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this code…" aria-label="Ask the professor about this code" />
                  <button className="ctl primary" type="submit" disabled={!q.trim()}>Ask</button>
                </form>
                {help && (
                  <div className="help">
                    <Answer text={help.text || (help.busy ? "The professor is reading the code…" : "")} />
                    {help.err && <p className="err">{help.err}</p>}
                    {help.busy && <button className="link" type="button" onClick={() => ctl.current?.abort()}>Stop</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {consentDialog}
      {docked &&
        dock.slot &&
        createPortal(
          <div className="ide frameless run-dock" onPointerDownCapture={own} onFocusCapture={own}>
            {codeBar}
            {debugParts}
            <OutputArea state={outState} />
          </div>,
          dock.slot,
        )}
    </div>
  );
}

/** "This computer (Python 3.12.4)", or why it cannot run yet. */
function localLabel(t: { label: string; version: string | null; path: string | null; cmd: string | null } | undefined, allowed: boolean): string {
  if (!allowed) return "This computer · ask first";
  if (!t?.path) return `This computer · ${t?.label ?? "it"} not installed`;
  return `This computer (${t.version ?? t.cmd})`;
}

/** What a run on this computer does, before the first one. */
function localHint(t: { label: string; version: string | null; path: string | null; install: string; note?: string } | undefined, allowed: boolean, timeoutS: number): string {
  if (!allowed) return "Runs on this computer with its own toolchain, once you allow it: pick This computer again, or Settings → This computer.";
  if (!t?.path) return `${t?.label ?? "This language"} is not installed here. ${t?.note ? `${t.note} ` : ""}${t?.install ?? ""}`;
  return `Runs on this computer: ${t.version ?? t.label} (${t.path}). Output streams here; Stop kills it; it stops by itself after ${timeoutS} s. Select lines to run only those.`;
}

/** The answer's markdown, simply: ``` blocks as code; paragraphs, - and 1. lists, **bold** and `code` between them. */
function Answer({ text }: { text: string }) {
  const parts = text.split(/```[a-z]*\n?/);
  return (
    <div className="answer">
      {parts.map((p, i) =>
        i % 2 ? (
          <pre key={i} className="snippet">{p.replace(/\n$/, "")}</pre>
        ) : (
          p
            .split(/\n\s*\n/)
            .map((b) => b.trim())
            .filter(Boolean)
            .map((b, j) => {
              const lines = b.split("\n");
              if (lines.length > 1 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) {
                const cells = (l: string) => l.trim().slice(1, -1).split("|").map((c) => c.trim());
                const [head, ...rest] = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(cells);
                return (
                  <div key={`${i}-${j}`} className="answer-table">
                    <table>
                      <thead>
                        <tr>{head.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rest.map((r, m) => (
                          <tr key={m}>{r.map((c, n) => <td key={n}>{inline(c)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))) {
                const items = lines.map((l, n) => <li key={n}>{inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>);
                return /^\s*\d/.test(lines[0]) ? <ol key={`${i}-${j}`}>{items}</ol> : <ul key={`${i}-${j}`}>{items}</ul>;
              }
              return <p key={`${i}-${j}`}>{inline(b)}</p>;
            })
        ),
      )}
    </div>
  );
}

/** **bold** and `code` inside a line; everything else as it is. */
function inline(s: string): React.ReactNode[] {
  return s
    .split(/(\*\*[^*]+?\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((p, k) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={k}>{inline(p.slice(2, -2))}</b> : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={k}>{p.slice(1, -1)}</code> : p));
}

/** localStorage, or null where it is blocked. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Narrow windows stack the editor over the output (the 900 px of ide.css). */
const NARROW = "(max-width: 900px)";
function useNarrow() {
  return useSyncExternalStore(
    (f) => {
      const m = window.matchMedia(NARROW);
      m.addEventListener("change", f);
      return () => m.removeEventListener("change", f);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}
