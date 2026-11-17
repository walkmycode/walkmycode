"use client";
/** Know your codebase (docs/LEARNING.md): questions written by the AI from the project open in
 *  Explore, its map and its code, so a new teammate learns how this code behaves. Each answer
 *  shows the lines it comes from, and "Show it on the map" opens Explore on them. Questions come
 *  back like recall cards: right later, wrong tomorrow. One whose lines changed is never asked
 *  until it is rewritten or dropped. The rules and the checks are src/learn/lib/repoQuiz.ts.
 *  Keys: A–D (or 1–4) answer, Enter goes on. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "@/lib/store";
import { openSetup, pillState } from "@/lib/aiPill";
import { useAiStatus } from "@/lib/aiStatus";
import { LITE } from "@/lib/adapters/target";
import { highlight } from "@/learn/lib/highlight";
import { sampleMessage, type Sample, type SampleError } from "@/learn/lib/claude";
import { mapHref } from "@/learn/links";
import { useNow } from "@/learn/lib/now";
import { INTERVALS } from "@/learn/lib/recall";
import { now as stamp, type Store } from "@/learn/lib/store";
import {
  answerQuestion,
  boxCounts,
  checkQuestions,
  dueQuestions,
  LETTERS,
  mergeQuestions,
  quizKey,
  quizPrompt,
  refreshQuestions,
  rewritePrompt,
  topicsOf,
  whyNotPrompt,
  type QuizQuestion,
  type RepoQuiz as Quiz,
  type Shown,
} from "@/learn/lib/repoQuiz";
import Markdown from "./Markdown";

type Props = { store: Store; sample: Sample | null; workspace: Workspace };
type Round = { ids: string[]; at: number; results: Record<string, boolean>; topic?: string };
type Why = { option: number; text: string; busy: boolean; err?: string };

/** The most questions in one round. */
const ROUND_MAX = 15;

/** "now", "1 day", "3 days", "1 week", "16 days", "5 weeks": when each box comes back. */
const boxLabel = (days: number) => (days === 0 ? "now" : days % 7 === 0 ? `${days / 7} week${days === 7 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"}`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const LANG: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", py: "py", rs: "rust", sql: "sql" };
const langOf = (path: string) => LANG[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "";
const notReady = (e: unknown) => (e as SampleError)?.code === "not_configured";

/** One cited excerpt, as the editor draws it, the cited lines marked. */
function Excerpt({ shown }: { shown: Shown }) {
  const rows = highlight(shown.lines.join("\n"), langOf(shown.path));
  const marked = (n: number) => shown.marks.some(([a, b]) => n >= a && n <= b);
  const to = shown.from + shown.lines.length - 1;
  return (
    <div className="bc rq-code" role="figure" aria-label={`${shown.path}, lines ${shown.from} to ${to}`}>
      <span className="bc-bar">
        <span>{shown.path}</span>
      </span>
      <div className="rq-rows">
        {rows.map((line, i) => (
          <div key={i} className={`rq-row${marked(shown.from + i) ? " hl" : ""}`}>
            <span className="rq-ln" aria-hidden="true">{shown.from + i}</span>
            <code>{line.length ? line.map((s, j) => (s.cls ? <span key={j} className={s.cls}>{s.text}</span> : s.text)) : " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RepoQuiz({ store, sample, workspace }: Props) {
  const name = workspace.name;
  const files = workspace.files;
  const key = quizKey(name);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [why, setWhy] = useState<Why | null>(null);
  const [busy, setBusy] = useState<"write" | "rewrite" | null>(null);
  const [err, setErr] = useState("");
  const [needAi, setNeedAi] = useState(false);
  const [note, setNote] = useState("");
  const stop = useRef<AbortController | null>(null);
  const whyStop = useRef<AbortController | null>(null);
  const now = useNow();
  const pill = pillState(useAiStatus());
  // Lite answers with the viewer's own Claude; the app with the provider chosen in Settings.
  const aiReady = LITE ? !!sample : pill.kind === "ready" && !!sample;
  const aiUnknown = !LITE && pill.kind === "loading";

  const save = useCallback(
    (questions: QuizQuestion[]) => {
      const next: Quiz = { project: name, questions, updatedAt: stamp() };
      setQuiz(next);
      store.saveExtra(key, next).catch(() => setErr("The questions could not be saved. They stay on this page until you reload."));
      return next;
    },
    [store, key, name],
  );

  const begin = useCallback((questions: QuizQuestion[], topic?: string) => {
    const due = dueQuestions(questions, stamp(), topic);
    // Nothing due in a topic picked by hand: go through all of it again, for practice.
    const pick = due.length ? due : topic ? questions.filter((q) => !q.stale && q.topic === topic) : [];
    setRound(pick.length ? { ids: pick.slice(0, ROUND_MAX).map((q) => q.id), at: 0, results: {}, ...(topic ? { topic } : {}) } : null);
    setChosen(null);
    setWhy(null);
  }, []);

  // Open: the saved questions, checked against the code as it is now.
  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await store.loadExtra<Quiz>(key).catch(() => null);
      if (!live) return;
      const had = Array.isArray(saved?.questions) ? saved.questions : [];
      const r = refreshQuestions(had, files);
      const q = r.moved || r.stale ? save(r.questions) : { project: name, questions: had, updatedAt: saved?.updatedAt ?? 0 };
      // A question whose lines changed waits in the side panel, to be rewritten or dropped.
      setQuiz(q);
      begin(q.questions);
    })();
    return () => {
      live = false;
      stop.current?.abort();
      whyStop.current?.abort();
    };
    // Once per project: the code is read again when the room is opened again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const stale = questions.filter((q) => q.stale);
  const current = round ? byId.get(round.ids[round.at]) : undefined;
  const done = !!round && round.at >= round.ids.length;

  /** Ask the AI: new questions, or the stale ones written again. */
  const write = async (kind: "write" | "rewrite") => {
    if (!sample || !quiz) return;
    const ctl = new AbortController();
    stop.current = ctl;
    setBusy(kind);
    setErr("");
    setNote("");
    try {
      const prompt = kind === "write" ? quizPrompt(workspace.map, files, questions.filter((q) => !q.stale)) : rewritePrompt(workspace.map, files, stale);
      const raw = await sample.json(prompt, { cache: false, maxOutput: 16_000, signal: ctl.signal });
      const { kept, dropped } = checkQuestions(raw, files, stamp());
      const base = kind === "rewrite" ? questions.filter((q) => !q.stale) : questions;
      const next = save(mergeQuestions(base, kept));
      const thrown = dropped.length ? ` ${plural(dropped.length, "other")} ${dropped.length === 1 ? "was" : "were"} thrown away: ${dropped[0].why}${dropped.length > 1 ? ", and more like it" : ""}.` : "";
      setNote(
        kept.length
          ? `${plural(kept.length, kind === "rewrite" ? "question" : "new question")} from the code, each checked against its lines.${thrown}`
          : kind === "rewrite"
            ? `The changed ${stale.length === 1 ? "question" : "questions"} could not be written again from the code, so ${stale.length === 1 ? "it was" : "they were"} dropped.${thrown}`
            : `No question held up against the code.${thrown} Try again.`,
      );
      if (kept.length) begin(next.questions);
    } catch (e) {
      if (notReady(e)) setNeedAi(true);
      setErr(sampleMessage(e));
    } finally {
      setBusy(null);
      stop.current = null;
    }
  };

  const answer = (i: number) => {
    if (!current || chosen !== null || !round) return;
    setChosen(i);
    setRound({ ...round, results: { ...round.results, [current.id]: i === current.answer } });
    save(questions.map((q) => (q.id === current.id ? answerQuestion(q, i, stamp()) : q)));
  };

  const next = () => {
    if (!round) return;
    setRound({ ...round, at: round.at + 1 });
    setChosen(null);
    whyStop.current?.abort();
    setWhy(null);
  };

  /** "Why not A?": the follow-up, asked through the Learn room's AI with the question's own lines. */
  const askWhy = async (option: number) => {
    if (!current || !sample) return;
    const ctl = new AbortController();
    whyStop.current?.abort();
    whyStop.current = ctl;
    setWhy({ option, text: "", busy: true });
    try {
      await sample(whyNotPrompt(current, option), { signal: ctl.signal, cache: false, onText: ({ text }) => setWhy({ option, text, busy: true }) });
      setWhy((w) => (w ? { ...w, busy: false } : w));
    } catch (e) {
      if (notReady(e)) setNeedAi(true);
      const msg = sampleMessage(e);
      setWhy((w) => (msg ? { option, text: w?.text ?? "", busy: false, err: msg } : null));
    }
  };

  // A–D or 1–4 answers; Enter goes on to the next question.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("textarea, input, select, [contenteditable], .cm-editor")) return;
      const k = e.key.toLowerCase();
      const i = "abcd".indexOf(k) >= 0 && k.length === 1 ? "abcd".indexOf(k) : "1234".indexOf(k) >= 0 && k.length === 1 ? "1234".indexOf(k) : -1;
      if (chosen === null && i >= 0) {
        e.preventDefault();
        answer(i);
      } else if (chosen !== null && e.key === "Enter" && !(e.target as HTMLElement).closest("button, a")) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!quiz) {
    return (
      <div className="hall rq">
        <section className="rq-board"><p className="rq-label">Reading {name}…</p></section>
      </div>
    );
  }

  const topics = topicsOf(questions, now);
  const boxes = boxCounts(questions, INTERVALS.length);
  const dueNow = dueQuestions(questions, now).length;
  const setup = (needAi || (!aiReady && !aiUnknown)) && (
    <div className="rq-setup" role="status">
      <p>
        <b>Writing questions needs an AI.</b> {LITE ? "Allow Claude for this page, then try again." : `Set one up, and WalkMyCode writes them from the code of ${name}.`}
      </p>
      {!LITE && (
        <button type="button" className="ctl primary" onClick={() => openSetup()}>
          Set up AI
        </button>
      )}
    </div>
  );
  const writing = busy && (
    <div className="rq-busy" role="status">
      <span>{busy === "write" ? `Reading the map and code of ${name}, and writing questions. This can take a minute or two.` : "Writing the changed questions again from the code as it is now."}</span>
      <button type="button" className="ctl" onClick={() => stop.current?.abort()}>Stop</button>
    </div>
  );

  const files0 = current ? [...new Set(current.cites.map((c) => c.path))] : [];
  const right = current && chosen !== null ? chosen === current.answer : null;
  // Why not…: the option they picked when it was wrong, else the first wrong one.
  const whyOption = current ? (chosen !== null && chosen !== current.answer ? chosen : [0, 1, 2, 3].find((i) => i !== current.answer) ?? 0) : 0;
  const shownPos = round ? Math.min(round.at, round.ids.length - 1) : 0;
  // "Show it on the map": the first cited place that has a card of its own, so Explore selects it.
  const onMap = current ? (current.cites.find((c) => workspace.map.nodes.some((n) => n.file === c.path)) ?? current.cites[0]) : null;

  return (
    <div className="hall rq">
      <aside className="rq-side" aria-label="Your quiz">
        <p className="rq-label">Know your codebase</p>
        <p className="rq-dim">Questions written from {name} itself: its map and its code. Each answer points at the lines.</p>
        {topics.length > 0 && (
          <ul className="rq-topics">
            {topics.map((t) => (
              <li key={t.topic}>
                <button type="button" className={current?.topic === t.topic ? "on" : undefined} onClick={() => begin(questions, t.topic)} title={t.due ? `Ask the ${t.due} due now` : "Go through this topic again"}>
                  <span>{t.topic}</span>
                  <span className="rq-faint">
                    {plural(t.total, "question")}
                    {t.right ? ` · ${t.right} right` : ""}
                    {current?.topic === t.topic ? " · now" : t.due ? ` · ${t.due} due` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {questions.length > 0 && (
          <>
            <p className="rq-label">Comes back</p>
            <div className="rq-boxes" role="list" aria-label="When questions come back">
              {INTERVALS.map((d, i) => (
                <span key={i} role="listitem" className={current?.box === i ? "on" : undefined} title={`${plural(boxes[i], "question")} ${d === 0 ? "to ask now" : `come back after ${boxLabel(d)}`}`}>
                  {boxLabel(d)}
                  <b>{boxes[i]}</b>
                </span>
              ))}
            </div>
            <p className="rq-dim rq-small">Right answers come back later, wrong ones tomorrow. A question whose code has changed is rewritten first.</p>
          </>
        )}
        {stale.length > 0 && (
          <div className="rq-stale">
            <p>
              The code behind {plural(stale.length, "question")} has changed. {stale.length === 1 ? "It is" : "They are"} not asked until rewritten.
            </p>
            <div className="rq-row-btns">
              <button type="button" className="ctl" disabled={!!busy || !aiReady} onClick={() => void write("rewrite")}>Rewrite {stale.length === 1 ? "it" : "them"}</button>
              <button type="button" className="ctl" disabled={!!busy} onClick={() => save(questions.filter((q) => !q.stale))}>Drop {stale.length === 1 ? "it" : "them"}</button>
            </div>
          </div>
        )}
        {questions.length > 0 && (
          <div className="rq-side-end">
            <button type="button" className="ctl" disabled={!!busy || !aiReady} onClick={() => void write("write")}>Write more questions</button>
          </div>
        )}
      </aside>

      <section className="rq-board" aria-live="polite">
        {err && !needAi && <p className="rq-err" role="alert">{err}</p>}
        {note && <p className="rq-note">{note}</p>}
        {writing}
        {current && round && !done ? (
          <>
            <div className="rq-head">
              <p className="rq-label">
                {current.topic} · question {shownPos + 1} of {round.ids.length}
              </p>
              <span className="rq-faint">from {files0.join(" and ")}</span>
            </div>
            <div className="rq-prog" aria-hidden="true">
              {round.ids.map((id, i) => (
                <i key={id} className={i === round.at ? "c" : round.results[id] === true ? "d" : round.results[id] === false ? "x" : undefined} />
              ))}
            </div>
            <p className="rq-q">{current.q}</p>
            <div className="rq-opts" role="group" aria-label="Options">
              {current.options.map((o, i) => {
                const cls = chosen === null ? "" : i === current.answer ? " right" : i === chosen ? " wrong" : " no";
                return (
                  <button key={i} type="button" className={`rq-opt${cls}`} disabled={chosen !== null} aria-pressed={chosen === i} onClick={() => answer(i)}>
                    <b>{LETTERS[i]}</b>
                    <span>{o}</span>
                  </button>
                );
              })}
            </div>
            {chosen !== null && (
              <>
                <div className={`rq-why${right ? " right" : " wrong"}`}>
                  <div className="rq-why-text">
                    <p className="rq-label">{right ? `Right · ${LETTERS[current.answer]}` : `Not quite · the answer is ${LETTERS[current.answer]}`}</p>
                    <p>{current.explain}</p>
                    {!right && current.wrong[chosen] && (
                      <p className="rq-dim">
                        Why not {LETTERS[chosen]}: {current.wrong[chosen]}
                      </p>
                    )}
                    {why && (
                      <div className="rq-follow">
                        <p className="rq-label">Why not {LETTERS[why.option]}?</p>
                        {why.text ? <Markdown text={why.text} /> : why.busy ? <p className="rq-dim">Asking…</p> : null}
                        {why.err && <p className="rq-err">{why.err}</p>}
                      </div>
                    )}
                  </div>
                  <div className="rq-why-code">
                    {current.shown.map((s) => (
                      <Excerpt key={`${s.path}:${s.from}`} shown={s} />
                    ))}
                  </div>
                </div>
                <div className="rq-acts">
                  {onMap && (
                    <a className="ctl" href={mapHref(onMap.path, { start: onMap.start, end: onMap.end })} title={`Open Explore on ${onMap.path}:${onMap.start}-${onMap.end}`}>
                      Show it on the map
                    </a>
                  )}
                  <button type="button" className="ctl" disabled={!aiReady || why?.busy} onClick={() => void askWhy(whyOption)}>
                    Why not {LETTERS[whyOption]}?
                  </button>
                  <span className="grow" />
                  <button type="button" className="ctl primary" onClick={next}>
                    {round.at + 1 < round.ids.length ? "Next question ›" : "Finish ›"}
                  </button>
                </div>
              </>
            )}
            {needAi && setup}
          </>
        ) : (
          <div className="rq-empty">
            {done && round ? (
              <>
                <p className="rq-big">
                  {Object.values(round.results).filter(Boolean).length} of {round.ids.length} right.
                </p>
                <p className="rq-dim">The ones you missed come back tomorrow; the rest later. {dueNow ? `${dueNow} more ${dueNow === 1 ? "is" : "are"} due now.` : ""}</p>
                <div className="rq-row-btns">
                  {dueNow > 0 && <button type="button" className="ctl primary" onClick={() => begin(questions)}>Keep going</button>}
                  <button type="button" className="ctl" disabled={!!busy || !aiReady} onClick={() => void write("write")}>Write more questions</button>
                </div>
              </>
            ) : questions.length ? (
              <>
                <p className="rq-big">Nothing due. Well remembered.</p>
                <p className="rq-dim">Pick a topic to go through it again, or have more questions written.</p>
                <div className="rq-row-btns">
                  <button type="button" className="ctl" disabled={!!busy || !aiReady} onClick={() => void write("write")}>Write more questions</button>
                </div>
              </>
            ) : (
              <>
                <p className="rq-label">Quiz from your code</p>
                <p className="rq-big">How well do you know {name}?</p>
                <p className="rq-dim">
                  The AI reads the map and code of {name} and writes questions about how it behaves: what happens when something is added, fails or is missing. Every answer points at the lines that prove it, and a question whose lines don&apos;t hold up is thrown away.
                </p>
                <div className="rq-row-btns">
                  <button type="button" className="ctl primary" disabled={!!busy || !aiReady} onClick={() => void write("write")}>
                    Write questions from {name}
                  </button>
                </div>
              </>
            )}
            {setup}
          </div>
        )}
      </section>
    </div>
  );
}
