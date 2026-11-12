"use client";
/**
 * The lesson studio: the lesson's outline on the left, the chalkboard in the
 * middle (written line by line while the professor speaks), and the professor
 * on the right (the conversation, the notebook, the recall cards). The student
 * can pause, move between boards, run a board's example, work an exercise with
 * hints before the answer, answer the quiz, and hand in an explain-back.
 *
 * Keys: ← → move between boards, Space plays or pauses, / starts a question.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { actionOf, HINTS, hintsUsed, solutionOpen, speakable } from "@/learn/lib/chat";
import { sampleMessage, type Sample } from "@/learn/lib/claude";
import { testsIn, testVerdict } from "@/learn/lib/exercise";
import { Chalk, plain } from "@/learn/lib/markup";
import type { Note } from "@/learn/lib/notebook";
import { cleanFeedback, cleanPoints, gradePrompt, writtenCheckPrompt } from "@/learn/lib/professor";
import { cleanScene, sceneLanguage, scenePrompt } from "@/learn/lib/scene";
import type { Card } from "@/learn/lib/recall";
import type { Store } from "@/learn/lib/store";
import type { Board, CodeLanguage, Lesson, Profile } from "@/learn/lib/types";
import { useChat } from "@/learn/lib/useChat";
import { useVoice } from "@/learn/lib/voice";
import { openSettings } from "@/lib/settingsNav";
import AnalogyScene from "./AnalogyScene";
import CodePanel from "./CodePanel";
import Diagram from "./Diagram";
import Markdown from "./Markdown";
import Professor, { type ProfessorTab } from "./Professor";
import ProfessorFace, { useFaceOn, useFaceSize } from "./ProfessorFace";
import { captionParts, type WordSpan } from "@/learn/lib/caption";
import { faceSize as savedFaceSize, faceState, setFaceSize, stepFaceSize } from "@/learn/lib/face";
import TaxiLab from "./TaxiLab";

type Props = {
  lesson: Lesson;
  profile: Profile;
  sample: Sample | null;
  store: Store | null;
  save: (l: Lesson) => void;
  onNext: (l: Lesson) => void;
  notes: Note[];
  onNote: (text: string, from: Note["from"], lesson: Lesson) => void;
  onDropNote: (id: string) => void;
  cards: Card[];
  onReview: (card: Card, knew: boolean) => void;
};

const PAD_STARTS: Record<string, string> = {
  python: `# Your scratchpad for this lesson. Try things out here.\n# Ctrl+Enter runs the code.\n\nprint("Hello from Python")\n`,
  javascript: `// Your scratchpad for this lesson. Ctrl+Enter runs the code.\n\nconsole.log("Hello from JavaScript");\n`,
  typescript: `// Your scratchpad for this lesson. Ctrl+Enter runs the code.\n\nconst greeting: string = "Hello from TypeScript";\nconsole.log(greeting);\n`,
  sql: `-- Your scratchpad for this lesson. Ctrl+Enter runs the SQL.\n\nCREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT);\nINSERT INTO notes (text) VALUES ('Hello from SQL');\nSELECT * FROM notes;\n`,
  rust: `// Your scratchpad for this lesson. Ctrl+Enter compiles and runs it on your laptop.\n\nfn main() {\n    println!("Hello from Rust");\n}\n`,
};
const padStart = (language: string) => PAD_STARTS[language] ?? PAD_STARTS.python;

/** Code open beside the board that is not the board's own exercise: the scratchpad, a board's example, or code from an answer. */
type Pad = { key: string; language: CodeLanguage; starter: string; label: string };

const LANGS: CodeLanguage[] = ["python", "javascript", "typescript", "sql", "rust"];
const asLanguage = (lang: string, fallback: CodeLanguage): CodeLanguage =>
  LANGS.find((l) => l === lang) ?? (lang === "rs" ? "rust" : lang === "py" ? "python" : lang === "js" ? "javascript" : lang === "ts" ? "typescript" : fallback);

/** Whether the outline and the professor stay beside an analogy being watched; kept in this browser. */
const SCENE_PANELS = "walkmycode:learn-scene-panels";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const interactive = (b: Board) => b.kind !== "talk";
/** What a board shows one step at a time: its lines, then its analogy. */
const steps = (b: Board) => b.lines.length + (b.analogy ? 1 : 0);
/** The talk boards have all been seen: the lesson's recall cards open. */
export const boardsSeen = (l: Lesson) => l.boards.every((b, i) => b.kind !== "talk" || l.seen.includes(i));

export default function Player({ lesson, profile, sample, store, save, onNext, notes, onNote, onDropNote, cards, onReview }: Props) {
  const voice = useVoice();
  const first = Math.min(lesson.at || 0, lesson.boards.length - 1);
  const [idx, setIdx] = useState(first);
  const [shown, setShown] = useState(() => steps(lesson.boards[first]));
  const [playing, setPlaying] = useState(false);
  const [caption, setCaption] = useState("");
  const [pad, setPad] = useState<Pad | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<ProfessorTab>("chat");
  const [outline, setOutline] = useState(true);
  const [listening, setListening] = useState(false);
  /** Just passed an exercise or the quiz's last question: the professor smiles for a few seconds. */
  const [pleased, setPleased] = useState(false);
  const pleasedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smile = useCallback(() => {
    setPleased(true);
    if (pleasedTimer.current) clearTimeout(pleasedTimer.current);
    pleasedTimer.current = setTimeout(() => setPleased(false), 5000);
  }, []);
  useEffect(() => () => void (pleasedTimer.current && clearTimeout(pleasedTimer.current)), []);
  const showFace = useFaceOn();
  const faceSize = useFaceSize();
  /** The analogy being watched (the board's index), and its writing. */
  const [watching, setWatching] = useState<number | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneErr, setSceneErr] = useState("");
  const [scenePanels, setScenePanels] = useState(() => {
    try {
      return localStorage.getItem(SCENE_PANELS) === "1";
    } catch {
      return false;
    }
  });
  const sceneCtl = useRef<AbortController | null>(null);
  /** What the open code last printed, for the professor to read with a question. */
  const lastOutput = useRef("");

  // The loop reads the latest values through refs, so a pause or a jump
  // cancels it cleanly (each run has a number; a stale run just stops).
  const run = useRef(0);
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
  const speakRef = useRef(voice.speak);
  speakRef.current = voice.speak;
  const stopVoice = useRef(voice.stop);
  stopVoice.current = voice.stop;
  const mutedRef = useRef(voice.muted);
  mutedRef.current = voice.muted;

  const board = lesson.boards[idx];
  const coding = board.kind === "code";
  const writing = board.kind === "write";
  const exercise = coding || writing;
  const boardKey = `b${idx}`;
  // The scratchpad speaks the lesson's language: that of its exercise, if it has one.
  const padLanguage = lesson.boards.find((b) => b.kind === "code")?.language ?? lesson.boards.find((b) => b.example)?.example?.language ?? "python";
  // The code open now: a pad when one is open, else the board's own exercise.
  const open: Pad | null = pad ?? (coding ? { key: boardKey, language: board.language ?? "python", starter: board.starter ?? "", label: board.exercise ?? "Exercise" } : null);
  const onExercise = !!open && !pad && coding;
  // An answer in words is kept with the lesson's other work, under the board's key.
  const written = writing ? drafts[boardKey] ?? lesson.code?.[boardKey] ?? "" : "";
  const writtenRef = useRef(written);
  writtenRef.current = written;
  const [marking, setMarking] = useState(false);
  const [markErr, setMarkErr] = useState("");
  const code = open ? drafts[open.key] ?? lesson.code?.[open.key] ?? open.starter : "";
  const codeRef = useRef(code);
  codeRef.current = code;

  // Code is saved a second after typing stops, not on every key.
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCode = (key: string, value: string, now = false) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    if (codeTimer.current) clearTimeout(codeTimer.current);
    const keep = () => {
      const l = lessonRef.current;
      save({ ...l, code: { ...(l.code ?? {}), [key]: value } });
    };
    if (now) keep();
    else codeTimer.current = setTimeout(keep, 1000);
  };
  const reduced = typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const here = useRef({ idx, onExercise, boardKey, writing });
  here.current = { idx, onExercise, boardKey, writing };
  const chat = useChat({
    lesson,
    profile,
    sample,
    store,
    context: () => {
      const h = here.current;
      if (h.writing) return { board: h.idx, code: writtenRef.current, passed: lessonRef.current.checks?.[h.boardKey]?.passed };
      return { board: h.idx, ...(h.onExercise ? { code: codeRef.current, output: lastOutput.current, passed: lessonRef.current.checks?.[h.boardKey]?.passed } : {}) };
    },
    onAnswer: (text) => {
      if (!mutedRef.current) void speakRef.current(speakable(text));
    },
  });

  const remember = useCallback(
    (i: number) => {
      const l = lessonRef.current;
      const seen = l.seen.includes(i) ? l.seen : [...l.seen, i].sort((a, b) => a - b);
      if (l.at !== i || seen !== l.seen) save({ ...l, at: i, seen });
    },
    [save],
  );

  const stop = useCallback(() => {
    run.current++;
    voice.stop();
    setPlaying(false);
    setCaption("");
  }, [voice]);

  const play = useCallback(
    async (from: number, fromStep: number) => {
      const my = ++run.current;
      setPlaying(true);
      let i = from;
      let step = fromStep;
      for (;;) {
        const b = lessonRef.current.boards[i];
        for (; step < steps(b); step++) {
          if (my !== run.current) return;
          const said = step < b.lines.length ? b.lines[step].s : `Here is a picture to hold on to. ${plain(b.analogy ?? "")}`;
          setShown(step + 1);
          setCaption(said);
          await speakRef.current(said);
          if (my !== run.current) return;
          await sleep(reduced ? 150 : 450);
        }
        if (my !== run.current) return;
        setCaption("");
        if (interactive(b) || i >= lessonRef.current.boards.length - 1) break;
        await sleep(900);
        if (my !== run.current) return;
        i += 1;
        step = 0;
        setIdx(i);
        setShown(0);
        setPad(null);
        remember(i);
      }
      if (my === run.current) setPlaying(false);
    },
    [reduced, remember],
  );

  const go = useCallback(
    (i: number, autoplay: boolean) => {
      const n = Math.max(0, Math.min(lessonRef.current.boards.length - 1, i));
      stop();
      setIdx(n);
      setPad(null);
      setWatching(null);
      setSceneErr("");
      lastOutput.current = "";
      remember(n);
      if (autoplay) {
        setShown(0);
        void play(n, 0);
      } else setShown(steps(lessonRef.current.boards[n]));
    },
    [play, remember, stop],
  );

  const toggle = () => {
    if (playing) return stop();
    // Resume where the board stopped, or replay a finished board.
    const from = shown >= steps(board) ? 0 : shown;
    if (from === 0) setShown(0);
    void play(idx, from);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("textarea, input, select, button, .cm-editor")) return;
      if (e.key === "ArrowRight") go(idx + 1, playing);
      if (e.key === "ArrowLeft") go(idx - 1, playing);
      // The professor, a size smaller or larger (also in Settings → Voice).
      if (e.key === "[") setFaceSize(stepFaceSize(savedFaceSize(), -1));
      if (e.key === "]") setFaceSize(stepFaceSize(savedFaceSize(), 1));
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Leaving the lesson (the top bar's "All lessons") silences the professor.
  useEffect(() => () => { run.current++; sceneCtl.current?.abort(); stopVoice.current(); }, []);

  /* ── The analogy, to watch ── */
  const watch = async () => {
    stop();
    setSceneErr("");
    if (board.scene) return setWatching(idx);
    if (!sample || sceneBusy) return;
    const at = idx;
    const ctl = new AbortController();
    sceneCtl.current = ctl;
    setSceneBusy(true);
    try {
      const scene = cleanScene(await sample.json(scenePrompt(lessonRef.current, at, profile), { signal: ctl.signal, cache: false }), sceneLanguage(lessonRef.current));
      if (!scene) throw { code: "invalid_json" };
      const l = lessonRef.current;
      save({ ...l, boards: l.boards.map((b, i) => (i === at ? { ...b, scene } : b)) });
      // Still on that board: show it.
      if (here.current.idx === at) setWatching(at);
    } catch (e) {
      setSceneErr(sampleMessage(e));
    } finally {
      setSceneBusy(false);
    }
  };
  const keepPanels = (shown: boolean) => {
    setScenePanels(shown);
    try {
      localStorage.setItem(SCENE_PANELS, shown ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  const scene = watching === idx ? board.scene : undefined;

  /* ── The professor ── */
  const ask = (text: string, action?: Parameters<typeof chat.send>[1]) => {
    stop();
    setTab("chat");
    chat.send(text, action);
  };

  /** Code from an answer, or a board's example, opened in the editor beside the board. */
  const openCode = (p: Pad, value?: string) => {
    stop();
    lastOutput.current = "";
    if (value !== undefined) setCode(p.key, value, true);
    setPad(p);
  };

  const check = lesson.checks?.[boardKey];
  const hints = hintsUsed(chat.chat.msgs, idx);
  // A real attempt: their own code (not the untouched starter) was run through the tests or checked.
  const attempted = !!check && (check.passed || (lesson.code?.[boardKey] ?? board.starter ?? "") !== (board.starter ?? ""));
  /** Hand an answer in words to the professor, who marks it against the course's model answer. */
  const markWritten = async () => {
    if (!sample || marking || written.trim().length < 12) return;
    stop();
    setMarking(true);
    setMarkErr("");
    const key = boardKey;
    try {
      const r = await sample.json<{ passed?: unknown; feedback?: unknown; points?: unknown }>(writtenCheckPrompt(lessonRef.current, board, written.trim(), profile), { cache: false });
      const points = cleanPoints(r?.points);
      const verdict = { passed: r?.passed === true, feedback: String(r?.feedback ?? ""), ...(points.length ? { points } : {}) };
      const l = lessonRef.current;
      save({ ...l, code: { ...(l.code ?? {}), [key]: writtenRef.current }, checks: { ...(l.checks ?? {}), [key]: verdict } });
      if (verdict.passed) smile();
      void voice.speak(verdict.feedback);
    } catch (e) {
      setMarkErr(sampleMessage(e));
    } finally {
      setMarking(false);
    }
  };
  const canSeeSolution = exercise && !!board.solution && solutionOpen(chat.chat.msgs, idx, attempted);
  const showSolution = () => {
    if (!board.solution) return;
    setTab("chat");
    chat.say(
      writing
        ? `Here is the course's model answer. Read it beside yours: which idea does it have that yours does not, and which did you put better?\n\n${board.solution.trim().split("\n").map((x) => `> ${x}`).join("\n")}\n\n💡 A model answer is one good road, not the only one. If yours has the same ideas in your own words, yours is right too.`
        : `Here is the course's own solution${board.exercise ? ` to \`${board.exercise}\`` : ""}. Read it beside yours: where do they differ, and why?\n\n\`\`\`${board.language ?? "python"}\n${board.solution.trimEnd()}\n\`\`\`\n\n💡 A solution is a map somebody else drew. Walking the road yourself is what makes you remember it, so try changing one line and running it again.`,
      "Show me the course's solution.",
    );
  };

  // What the professor is doing, for its face: listening, speaking, or thinking about an answer.
  const face = faceState({ listening, speaking: voice.speaking, thinking: chat.busy || sceneBusy, pleased });
  const doing = { idle: "", speaking: "speaking", thinking: "thinking…", listening: "listening…", pleased: "well done" }[face];
  const last = idx === lesson.boards.length - 1;
  const done = shown >= steps(board);
  const exercises = lesson.boards.map((b, i) => ({ b, i })).filter((x) => x.b.kind === "code" || x.b.kind === "write");
  const passed = exercises.filter((x) => lesson.checks?.[`b${x.i}`]?.passed).length;
  const mark = (b: Board, i: number) => {
    if (b.kind === "code" || b.kind === "write") return lesson.checks?.[`b${i}`]?.passed ? "✓" : "◇";
    if (b.kind === "quiz") return (b.quiz ?? []).every((_, k) => lesson.quiz?.[`${i}.${k}`] !== undefined) ? "✓" : "?";
    if (b.kind === "explain") return lesson.feedback ? "✓" : "✎";
    return lesson.seen.includes(i) ? "✓" : "○";
  };
  const firstPractice = lesson.boards.findIndex((b) => b.kind !== "talk" && b.kind !== "lab-taxi");

  return (
    <div className={`studio${outline ? "" : " no-outline"}${scene && !scenePanels ? " wide" : ""}`}>
      <nav className="outline" aria-label="This lesson's boards">
        <p className="eyebrow">This lesson</p>
        <ol>
          {lesson.boards.map((b, i) => (
            <li key={i} className={i === firstPractice ? "practice" : undefined}>
              {i === firstPractice && <p className="eyebrow">Practise</p>}
              <button
                type="button"
                className={`${i === idx ? "on " : ""}${mark(b, i) === "✓" ? "done" : ""}`}
                aria-current={i === idx ? "step" : undefined}
                onClick={() => go(i, playing && !interactive(b))}
                title={plain(b.title)}
              >
                <span className="m" aria-hidden="true">{i === idx ? "●" : mark(b, i)}</span>
                <span className="t">{plain(b.title)}</span>
                {b.kind === "code" && b.tests && <span className="tag">tests</span>}
              </button>
            </li>
          ))}
        </ol>
        <div className="meter">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={lesson.boards.length} aria-valuenow={lesson.seen.length} aria-label="Boards seen">
            <span style={{ width: `${(lesson.seen.length / lesson.boards.length) * 100}%` }} />
          </div>
          <p>
            {lesson.seen.length} of {lesson.boards.length} boards
            {exercises.length > 0 && ` · ${passed} of ${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`}
            {lesson.feedback && ` · ${lesson.feedback.score}/10`}
          </p>
        </div>
      </nav>

      <div className="studio-main">
        {/* The boards as a strip, where the outline is not shown (a narrow window, or hidden). */}
        <nav className="progress" aria-label="Boards">
          {lesson.boards.map((b, i) => (
            <button
              key={i}
              type="button"
              className={i === idx ? "on" : lesson.seen.includes(i) ? "done" : ""}
              aria-label={`Board ${i + 1}: ${plain(b.title)}`}
              aria-current={i === idx ? "step" : undefined}
              title={plain(b.title)}
              onClick={() => go(i, playing && !interactive(b))}
            />
          ))}
        </nav>
        {scene && (
          <AnalogyScene
            key={idx}
            scene={scene}
            where={`${plain(board.title)} · board ${idx + 1} of ${lesson.boards.length}`}
            panels={scenePanels}
            onPanels={keepPanels}
            onClose={() => { voice.stop(); setWatching(null); }}
            speak={voice.speak}
            stopVoice={voice.stop}
          />
        )}
        <div className="frame" hidden={!!scene}>
          <section className={`board${exercise ? " is-exercise" : ""}`} aria-live="polite">
            <p className="board-n">{idx + 1} / {lesson.boards.length}</p>
            <h2><Chalk text={board.title} /></h2>
            <div className="lines">
              {board.lines.map((l, i) => (
                <div key={`${idx}-${i}`} className={`line${i < shown ? " shown" : ""}${playing && i === shown - 1 ? " now" : ""}`}>
                  {l.w && <Chalk text={l.w} />}
                  {l.diagram && <Diagram source={l.diagram} label={plain(l.w)} />}
                  {l.table && (
                    <div className="tablebox">
                      <table className="chalk-table">
                        <thead><tr>{l.table.head.map((h, k) => <th key={k}>{h}</th>)}</tr></thead>
                        <tbody>{l.table.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
              {board.analogy && (
                <aside className={`analogy line${shown > board.lines.length ? " shown" : ""}${playing && shown === steps(board) ? " now" : ""}`} aria-label="Analogy">
                  <p className="eyebrow"><span aria-hidden="true">💡</span> Analogy</p>
                  <p><Chalk text={board.analogy} /></p>
                  {(board.scene || sample) && (
                    <p className="analogy-acts">
                      <button className="chalk-btn" type="button" disabled={sceneBusy} onClick={() => void watch()} title="The picture and the real code side by side, step by step">
                        {sceneBusy ? "Drawing the picture…" : "▶ Watch it happen"}
                      </button>
                      {sceneBusy && <button className="chalk-btn ghost" type="button" onClick={() => sceneCtl.current?.abort()}>Stop</button>}
                      {sceneErr && <span className="err" role="alert">{sceneErr}</span>}
                    </p>
                  )}
                </aside>
              )}
              {board.example && done && (
                <div className="board-acts">
                  <button
                    className="chalk-btn ghost"
                    type="button"
                    aria-pressed={pad?.key === `ex-${board.example.name}`}
                    onClick={() => openCode({ key: `ex-${board.example!.name}`, language: board.example!.language, starter: board.example!.code, label: board.example!.name })}
                    title="Open this example beside the board, run it, change it, run it again"
                  >
                    ▶ Run the example · {board.example.name}
                  </button>
                  <span className="note">Experience first: run it, then change one line and guess what happens before you run it again.</span>
                </div>
              )}
              {writing && (
                <div className="written">
                  <div className="question"><Markdown text={board.task ?? ""} /></div>
                  <label htmlFor="written-answer" className="note">Your answer, in your own words</label>
                  <textarea
                    id="written-answer"
                    value={written}
                    placeholder="Write your answer here. It is saved as you type."
                    onChange={(e) => setCode(boardKey, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void markWritten();
                      }
                    }}
                  />
                  <div className="row">
                    {sample ? (
                      <button className="chalk-btn" type="button" disabled={marking || written.trim().length < 12} onClick={() => void markWritten()}>
                        {marking ? "Marking…" : check ? "Check it again" : "✓ Check my answer"}
                      </button>
                    ) : (
                      <span className="note">Marking needs an AI provider. Choose one in Settings.</span>
                    )}
                    <span className="keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> checks it</span>
                    {markErr && <span className="err" role="alert">{markErr}</span>}
                  </div>
                </div>
              )}
              {exercise && (
                <div className="board-acts ladder">
                  {check && <p className={`verdict ${check.passed ? "pass" : "fail"}`}>{check.passed ? "✓ Passed" : "Not yet"} · {check.feedback}</p>}
                  {check?.points && (
                    <ul className="points" aria-label="Point by point">
                      {check.points.map((p, i) => (
                        <li key={i} className={p.met ? "met" : "missed"}>
                          <span className="m" aria-hidden="true">{p.met ? "✓" : "○"}</span>
                          <span><b>{p.point}</b>{p.note ? ` · ${p.note}` : ""}<span className="sr">{p.met ? " (covered)" : " (not yet)"}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sample && (
                    <button className="chalk-btn ghost" type="button" disabled={chat.busy || hints >= HINTS} onClick={() => ask(actionOf("hint")!.ask(hints), "hint")} title="A nudge first, then a pointer, then a near-answer">
                      🪜 {hints >= HINTS ? "Every hint used" : `Hint ${hints + 1} of ${HINTS}`}
                    </button>
                  )}
                  {board.solution && (
                    <button className="chalk-btn ghost" type="button" disabled={!canSeeSolution} onClick={showSolution} title={canSeeSolution ? "The course's own answer, beside yours" : "Opens after a real attempt (run the tests or check your work) or three hints"}>
                      {canSeeSolution ? (writing ? "Show the model answer" : "Show the course's solution") : writing ? "🔒 Model answer: try first" : "🔒 Solution: try first"}
                    </button>
                  )}
                  {pad && coding && <button className="chalk-btn ghost" type="button" onClick={() => setPad(null)}>Back to the exercise</button>}
                </div>
              )}
              {board.kind === "lab-taxi" && <TaxiLab />}
              {board.kind === "quiz" && <Quiz key={idx} lesson={lesson} idx={idx} save={save} speak={voice.speak} />}
              {board.kind === "explain" && (
                <ExplainBack key={idx} lesson={lesson} board={board} profile={profile} sample={sample} save={save} speak={voice.speak} onNext={() => { stop(); onNext(lesson); }} />
              )}
            </div>
          </section>
        </div>

        {open && (
          <div className="code-dock">
            {pad && (
              <p className="code-head">
                <span><b>{pad.label}</b>{pad.key.startsWith("ex-") ? " · the course's example: run it, then change it" : pad.key === "snip" ? " · from the professor's answer" : ""}</span>
                <button className="link" type="button" onClick={() => setPad(null)}>Close</button>
              </p>
            )}
            <CodePanel
              key={open.key}
              language={open.language}
              code={code}
              starter={open.starter}
              onCode={(c) => setCode(open.key, c)}
              sample={sample}
              profile={profile}
              lesson={lesson}
              board={onExercise ? board : undefined}
              check={onExercise ? check : undefined}
              onCheck={onExercise ? (c) => { if (c.passed) smile(); save({ ...lessonRef.current, checks: { ...(lessonRef.current.checks ?? {}), [boardKey]: c } }); } : undefined}
              onRan={(output, o) => {
                lastOutput.current = output;
                // The exercise's own tests are the judge: a pass is a fact.
                const verdict = onExercise && o.test ? testVerdict(output, testsIn(board.starter ?? "")) : null;
                if (verdict) {
                  if (verdict.passed) smile();
                  save({ ...lessonRef.current, checks: { ...(lessonRef.current.checks ?? {}), [boardKey]: verdict } });
                  void voice.speak(verdict.feedback);
                }
              }}
              speak={voice.speak}
            />
          </div>
        )}

        <div className="controls" role="toolbar" aria-label="Lesson controls">
          <button className="ctl icon" type="button" aria-pressed={outline} onClick={() => setOutline((v) => !v)} title={outline ? "Hide the outline" : "Show the outline"} aria-label={outline ? "Hide the outline" : "Show the outline"}>☰</button>
          <button className="ctl" type="button" disabled={idx === 0} onClick={() => go(idx - 1, playing)}>◀ Back</button>
          <button className="ctl primary" type="button" onClick={toggle}>
            {playing ? "❚❚ Pause" : lesson.seen.length <= 1 && idx === 0 && shown === 0 ? "▶ Start the lesson" : "▶ Play"}
          </button>
          <button className="ctl" type="button" disabled={last} onClick={() => go(idx + 1, playing)}>Next ▶</button>
          {last && <button className="ctl" type="button" onClick={() => { stop(); onNext(lesson); }}>Next lesson →</button>}
          {!coding && (
            <button
              className="ctl"
              type="button"
              aria-pressed={pad?.key === "pad"}
              onClick={() => setPad((p) => (p?.key === "pad" ? null : { key: "pad", language: padLanguage, starter: padStart(padLanguage), label: "Scratchpad" }))}
            >
              {pad?.key === "pad" ? "Hide code" : "</> Code"}
            </button>
          )}
          {sample && <button className="ctl" type="button" disabled={chat.busy} onClick={() => ask("Please explain this board again, in a different and simpler way, with a new example.", "again")}>Explain again</button>}
          <span className="sp" />
          {/* The narrator, its voice and speed are chosen once, in Settings → Voice. */}
          <button className="ctl" type="button" onClick={() => openSettings("voice")} title="Choose the narrator, its voice and its speed in Settings → Voice">
            Voice{voice.label ? `: ${voice.label}` : ""}
          </button>
          <label htmlFor="mute"><input id="mute" type="checkbox" checked={voice.muted} onChange={(e) => { if (e.target.checked) voice.stop(); voice.setMuted(e.target.checked); }} /> Read only</label>
        </div>

        {showFace ? (
          <div className="voice-strip">
            <ProfessorFace state={face} size={faceSize} />
            <div className="who">
              <p className="name">The professor{doing && <span> · {doing}</span>}</p>
              <Transcript saying={voice.saying} fallback={caption} />
            </div>
          </div>
        ) : (
          <Transcript saying={voice.saying} fallback={caption} />
        )}
        <p className="keys studio-keys"><kbd>←</kbd> <kbd>→</kbd> boards · <kbd>Space</kbd> play or pause · <kbd>/</kbd> ask the professor{showFace && <> · <kbd>[</kbd> <kbd>]</kbd> professor smaller or larger</>}</p>
        {voice.note && <p className="note">The voice could not speak ({voice.note}), so the lesson carries on in read-only pace. Check Settings → Voice.</p>}
      </div>

      <Professor
        lesson={lesson}
        board={board}
        boardIndex={idx}
        api={chat}
        canAsk={!!sample}
        face={showFace ? face : null}
        onListening={setListening}
        tab={tab}
        onTab={setTab}
        notes={notes}
        onNote={(text, from) => onNote(text, from, lesson)}
        onDropNote={onDropNote}
        cards={cards}
        cardsOpen={boardsSeen(lesson)}
        onReview={onReview}
        speak={voice.speak}
        onOpenCode={(snippet, lang) => openCode({ key: "snip", language: asLanguage(lang, padLanguage), starter: snippet, label: "Code from the professor" }, snippet)}
        onGoBoard={(i) => go(i, false)}
      />
    </div>
  );
}

/** What the professor is saying, with the word being spoken lit; between lines, the last thing said. */
function Transcript({ saying, fallback }: { saying: { text: string; word: WordSpan | null } | null; fallback: string }) {
  if (!saying) return <p className="caption" aria-hidden="true">{fallback}</p>;
  const { said, now, next } = captionParts(saying.text, saying.word);
  return (
    <p className="caption live" aria-hidden="true">
      <span className="said">{said}</span>
      {now && <mark>{now}</mark>}
      <span className="next">{next}</span>
    </p>
  );
}

function Quiz({ lesson, idx, save, speak }: { lesson: Lesson; idx: number; save: (l: Lesson) => void; speak: (t: string) => Promise<void> }) {
  const items = lesson.boards[idx].quiz ?? [];
  const picks = lesson.quiz ?? {};
  const choose = (k: number, o: number) => {
    if (picks[`${idx}.${k}`] !== undefined) return;
    save({ ...lesson, quiz: { ...picks, [`${idx}.${k}`]: o } });
    const it = items[k];
    void speak((o === it.answer ? "Correct. " : `Not quite. The answer is: ${plain(it.options[it.answer])}. `) + plain(it.why));
  };
  const right = items.filter((it, k) => picks[`${idx}.${k}`] === it.answer).length;
  const done = items.every((_, k) => picks[`${idx}.${k}`] !== undefined);
  return (
    <div className="quiz">
      {items.map((it, k) => {
        const pick = picks[`${idx}.${k}`];
        return (
          <fieldset key={k}>
            <legend><Chalk text={`${k + 1}. ${it.q}`} /></legend>
            <div className="opts">
              {it.options.map((o, j) => (
                <button
                  key={j}
                  type="button"
                  className={`opt${pick === undefined ? "" : j === it.answer ? " right" : j === pick ? " wrong" : " dim"}`}
                  aria-pressed={pick === j}
                  disabled={pick !== undefined}
                  onClick={() => choose(k, j)}
                >
                  <Chalk text={o} />
                </button>
              ))}
            </div>
            {pick !== undefined && <p className="why">{pick === it.answer ? "✓ " : "✗ "}<Chalk text={it.why} /></p>}
          </fieldset>
        );
      })}
      {done && <p className="hl">{right} of {items.length} right.</p>}
    </div>
  );
}

function ExplainBack({ lesson, board, profile, sample, save, speak, onNext }: {
  lesson: Lesson; board: Board; profile: Profile; sample: Sample | null;
  save: (l: Lesson) => void; speak: (t: string) => Promise<void>; onNext: () => void;
}) {
  const [text, setText] = useState(lesson.answer ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const questions = board.questions ?? [];
  const fb = lesson.feedback;

  const keep = () => {
    if (text !== (lesson.answer ?? "")) save({ ...lesson, answer: text });
  };

  const handIn = async () => {
    if (!sample || text.trim().length < 20) return;
    setBusy(true);
    setErr("");
    try {
      const raw = await sample.json(gradePrompt(lesson, questions, text.trim(), profile), { cache: false });
      const feedback = cleanFeedback(raw);
      if (!feedback) throw { code: "invalid_json" };
      save({ ...lesson, answer: text, feedback });
      void speak(`${feedback.verdict} You scored ${feedback.score} out of ten.`);
    } catch (e) {
      setErr(sampleMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="explain">
      <ol>{questions.map((q, i) => <li key={i}><Chalk text={q} /></li>)}</ol>
      <label htmlFor="answer" className="note">Your answer, in your own words</label>
      <textarea id="answer" value={text} onChange={(e) => setText(e.target.value)} onBlur={keep} placeholder="In my own words…" />
      <div className="row">
        {sample ? (
          <button className="chalk-btn" type="button" disabled={busy || text.trim().length < 20} onClick={handIn}>
            {busy ? "Marking…" : fb ? "Hand in again" : "Hand in"}
          </button>
        ) : (
          <button
            className="chalk-btn"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied("Copied. Paste it to your professor in the chat.");
              } catch {
                setCopied("Select the text and copy it, then paste it in the chat.");
              }
            }}
          >
            Copy my answer
          </button>
        )}
        {copied && <span className="note">{copied}</span>}
        {text.trim().length > 0 && text.trim().length < 20 && <span className="note">Write a little more first.</span>}
      </div>
      {err && <p className="err">{err}</p>}
      {fb && (
        <div className="feedback">
          <p className="score"><span>{fb.score}</span>/10 · {fb.verdict}</p>
          {fb.good.length > 0 && <><p className="green">What you got right</p><ul>{fb.good.map((g, i) => <li key={i}>{g}</li>)}</ul></>}
          {fb.fix.length > 0 && <><p className="pink">To fix</p><ul>{fb.fix.map((g, i) => <li key={i}>{g}</li>)}</ul></>}
          {fb.model && <><p className="blue">A model answer</p><p>{fb.model}</p></>}
          <button className="chalk-btn" type="button" onClick={onNext}>On to the next lesson →</button>
        </div>
      )}
    </div>
  );
}
