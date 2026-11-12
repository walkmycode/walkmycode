"use client";
/**
 * The professor beside the lesson: the conversation (kept per lesson, so it is
 * there again after a reload), the notebook and the recall cards, as three
 * tabs of one panel. The conversation streams, draws code with colours, and
 * can be driven from the keyboard:
 *
 *   /            from anywhere in the lesson, start typing a question
 *   Enter        send          Shift+Enter   a new line
 *   ↑            in an empty box, bring back the last question
 *   Esc          stop the answer, or leave the box
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ACTIONS, HINTS, hintsUsed, shownText, speakable, splitWonder, starters, type ChatMsg } from "@/learn/lib/chat";
import { plain } from "@/learn/lib/markup";
import { ago, type Note } from "@/learn/lib/notebook";
import { useNow } from "@/learn/lib/now";
import { dueCards, type Card } from "@/learn/lib/recall";
import type { Board, Lesson } from "@/learn/lib/types";
import type { ChatApi } from "@/learn/lib/useChat";
import type { FaceState } from "@/learn/lib/face";
import { canListen, listen, type Listening } from "@/lib/listen";
import { parakeetFallback, pickListener } from "@/lib/voice/listen";
import { preloadParakeet } from "@/lib/voice/parakeet/client";
import { dictate } from "@/lib/voice/parakeet/hear";
import { useVoiceView } from "@/lib/voice/view";
import { openSettings } from "@/lib/settingsNav";
import Markdown from "./Markdown";
import Notebook from "./Notebook";
import Recall from "./Recall";

export type ProfessorTab = "chat" | "notebook" | "recall";

type Props = {
  lesson: Lesson;
  board: Board;
  boardIndex: number;
  api: ChatApi;
  /** No AI here (WalkMyCode Lite opened outside Claude). */
  canAsk: boolean;
  /** What the professor's face shows; null when it is switched off (Settings → Voice). */
  face: FaceState | null;
  /** The student is speaking a question. */
  onListening: (on: boolean) => void;
  tab: ProfessorTab;
  onTab: (t: ProfessorTab) => void;
  notes: Note[];
  onNote: (text: string, from: Note["from"]) => void;
  onDropNote: (id: string) => void;
  /** The deck, and whether this lesson's cards are open yet (its boards have been seen). */
  cards: Card[];
  cardsOpen: boolean;
  onReview: (card: Card, knew: boolean) => void;
  speak: (text: string) => Promise<void>;
  onOpenCode: (code: string, lang: string) => void;
  onGoBoard: (i: number) => void;
};

const DAY = 24 * 60 * 60 * 1000;

/** A divider where the conversation was picked up again after a long pause. */
function pauseBefore(msgs: ChatMsg[], i: number, now: number): string {
  if (i === 0 || msgs[i].role !== "you") return "";
  const gap = msgs[i].at - msgs[i - 1].at;
  if (gap < 6 * 60 * 60 * 1000) return "";
  const when = now - msgs[i].at < DAY ? "Today" : ago(msgs[i].at, now);
  return `${when[0].toUpperCase()}${when.slice(1)}`;
}

export default function Professor(p: Props) {
  const { board, boardIndex, lesson, tab, onTab } = p;
  const now = useNow();
  const due = dueCards(p.cardsOpen ? p.cards : [], now, lesson.id).length;
  return (
    <aside className="prof" aria-label="The professor">
      <div className="prof-tabs" role="tablist" aria-label="Beside the lesson">
        {(
          [
            ["chat", "Professor", 0],
            ["notebook", "Notebook", p.notes.length],
            ["recall", "Recall", due],
          ] as const
        ).map(([id, label, n]) => (
          <button key={id} type="button" role="tab" id={`prof-tab-${id}`} aria-selected={tab === id} aria-controls="prof-body" className={tab === id ? "on" : ""} onClick={() => onTab(id)}>
            {label}
            {n > 0 && <span className={`count${id === "recall" ? " due" : ""}`}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="prof-body" id="prof-body" role="tabpanel" aria-labelledby={`prof-tab-${tab}`}>
        {tab === "chat" ? (
          // Made again once the saved conversation has been read, so its draft starts in the box.
          <Conversation key={String(p.api.ready)} {...p} />
        ) : tab === "notebook" ? (
          <Notebook notes={p.notes} onAdd={(t) => p.onNote(t, "you")} onDrop={p.onDropNote} lessonId={lesson.id} />
        ) : p.cardsOpen ? (
          <Recall cards={p.cards} lessonId={lesson.id} onReview={p.onReview} />
        ) : (
          <div className="prof-empty">
            <p className="big">Recall comes after the boards.</p>
            <p>When you have seen every board, this lesson&rsquo;s key ideas come back here as cards: today, then after 1, 3, 7, 16 and 35 days, just before you would forget them.</p>
            <p className="note">You are on board {boardIndex + 1} of {lesson.boards.length}: {plain(board.title)}.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function Conversation({ api, board, boardIndex, lesson, canAsk, onNote, notes, speak, onOpenCode, onGoBoard, onListening }: Props) {
  const { chat, busy } = api;
  const [text, setText] = useState(chat.draft ?? "");
  const [confirmClear, setConfirmClear] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const exercise = board.kind === "code" || board.kind === "write";
  const hints = hintsUsed(chat.msgs, boardIndex);

  // A spoken question, written into the box as it is said: on this computer when "On this computer" (Parakeet)
  // is chosen in Settings → Voice and can hear (its model is here, the browser is in English), else by the
  // browser's own speech recognition.
  const [mic, setMic] = useState<{ on: boolean; err: string; note: string }>({ on: false, err: "", note: "" });
  const ear = useRef<Listening | null>(null);
  const voice = useVoiceView({ idle: true });
  const facts = { stt: voice?.stt, parakeet: voice?.parakeet, lang: typeof navigator !== "undefined" ? navigator.language : null };
  const onDevice = pickListener({ ...facts, mode: "claude", browser: false, keys: { deepgram: false, elevenlabs: false } }) === "parakeet";
  const fellBack = parakeetFallback(facts);
  const hears = canListen() || onDevice;
  // The speech model takes about three seconds to load: it loads when the pointer or the keyboard reaches the mic
  // button (and at the press, if neither did), not with the lesson.
  const warm = () => {
    if (onDevice) preloadParakeet();
  };
  const hear = () => {
    if (ear.current) return ear.current.stop();
    warm();
    const before = text.trim();
    const join = (said: string) => [before, said].filter(Boolean).join(" ");
    const end = (err = "") => {
      ear.current = null;
      setMic({ on: false, err, note: "" });
      onListening(false);
    };
    const events = {
      onText: (said: string) => setText(join(said)),
      onDone: (said: string) => {
        setText(join(said));
        api.setDraft(join(said));
        end();
        box.current?.focus();
      },
      onError: (why: string) => end(why),
    };
    ear.current = onDevice ? dictate({ ...events, onNotice: (note) => setMic((m) => ({ ...m, note })) }) : listen(events);
    if (!ear.current) return setMic({ on: false, err: "This browser cannot listen.", note: "" });
    setMic({ on: true, err: "", note: onDevice ? "" : (fellBack ?? "") });
    onListening(true);
  };
  // Leaving the conversation lets go of the microphone.
  useEffect(
    () => () => {
      ear.current?.cancel();
      onListening(false);
    },
    [onListening],
  );

  // Follow the answer as it arrives, unless the student has scrolled up to read.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.msgs, api.ready]);

  // "/" from anywhere in the lesson starts a question.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("textarea, input, select, [contenteditable], .cm-editor")) return;
      e.preventDefault();
      box.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };
  useLayoutEffect(grow, [text]);

  const send = (q: string, action?: Parameters<ChatApi["send"]>[1]) => {
    stick.current = true;
    if (api.send(q, action)) setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) {
        ear.current?.cancel();
        send(text);
      }
    } else if (e.key === "Escape") {
      if (busy) api.stop();
      else e.currentTarget.blur();
    } else if (e.key === "ArrowUp" && !text) {
      const last = chat.msgs.filter((m) => m.role === "you" && !m.action).at(-1);
      if (last) {
        e.preventDefault();
        setText(last.text);
      }
    }
  };

  const now = useNow();
  const lastId = chat.msgs.at(-1)?.id;
  const saved = (m: ChatMsg) => notes.some((n) => n.from === "prof" && n.lessonId === lesson.id && n.text === splitWonder(m.text).body);

  return (
    <>
      <div
        className="thread"
        ref={thread}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {!api.ready ? (
          <p className="note">Opening your conversation…</p>
        ) : chat.msgs.length === 0 ? (
          <div className="prof-empty">
            <p className="big">Ask anything about this board.</p>
            <p>The professor knows the lesson so far and the board you are on. Nothing is too small to ask, and this conversation is kept with the lesson.</p>
            {canAsk && (
              <div className="starters">
                {starters(board, boardIndex).map((q) => (
                  <button key={q} type="button" onClick={() => send(q)}>{q}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          chat.msgs.map((m, i) => {
            const pause = pauseBefore(chat.msgs, i, now);
            if (m.role === "you") {
              return (
                <div key={m.id} className="msg you">
                  {pause && <p className="pause"><span>{pause} · you carried on here</span></p>}
                  <p className="who">
                    You
                    {m.board !== boardIndex && lesson.boards[m.board] && (
                      <button type="button" className="at" onClick={() => onGoBoard(m.board)} title={`Go to board ${m.board + 1}: ${plain(lesson.boards[m.board].title)}`}>
                        board {m.board + 1}
                      </button>
                    )}
                  </p>
                  <p className="said">{shownText(m)}</p>
                </div>
              );
            }
            const arriving = busy && m.id === lastId;
            const { body, wonder } = splitWonder(m.text);
            return (
              <div key={m.id} className={`msg prof${arriving ? " arriving" : ""}`}>
                <p className="who"><b>Professor</b></p>
                {body ? <Markdown text={body} onOpenCode={onOpenCode} /> : arriving ? <p className="thinking" role="status"><i /><i /><i /><span className="sr">The professor is thinking</span></p> : null}
                {m.stopped && <p className="note">Stopped.</p>}
                {m.err && (
                  <div className="msg-err" role="alert">
                    <p>{m.err}</p>
                    <span className="acts">
                      {m.id === lastId && <button type="button" onClick={api.retry}>Try again</button>}
                      {/provider|Settings/i.test(m.err) && <button type="button" onClick={() => openSettings("ai")}>Open Settings</button>}
                    </span>
                  </div>
                )}
                {!arriving && body && (
                  <p className="msg-acts">
                    <CopyButton text={body} />
                    <button type="button" disabled={saved(m)} onClick={() => onNote(body, "prof")} title="Keep this answer in your notebook">{saved(m) ? "In notebook" : "Save to notebook"}</button>
                    <button type="button" onClick={() => void speak(speakable(m.text))} title="Read this answer aloud">Read aloud</button>
                    {m.id === lastId && !m.err && canAsk && <button type="button" onClick={api.retry} title="Ask for another answer to the same question">Another answer</button>}
                  </p>
                )}
                {!arriving && m.id === lastId && wonder.length > 0 && canAsk && (
                  <div className="wonder" aria-label="Wonder next">
                    {wonder.map((q) => (
                      <button key={q} type="button" onClick={() => send(q)}>{plain(q)}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {canAsk ? (
        <div className="ask">
          <div className="chips" role="toolbar" aria-label="Quick questions">
            {ACTIONS.filter((a) => !a.exercise || exercise).map((a) => {
              const isHint = a.id === "hint";
              const spent = isHint && hints >= HINTS;
              return (
                <button key={a.id} type="button" disabled={busy || spent} title={spent ? "You have had every hint: the solution is open on the board" : a.title} onClick={() => send(a.ask(hints), a.id)}>
                  <span aria-hidden="true">{a.icon}</span> {a.label}
                  {isHint && <span className="n">{Math.min(hints + 1, HINTS)}/{HINTS}</span>}
                </button>
              );
            })}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) send(text);
            }}
          >
            <label className="sr" htmlFor="prof-q">Ask the professor</label>
            <textarea
              id="prof-q"
              ref={box}
              rows={1}
              value={text}
              placeholder={exercise ? "Ask about this exercise…" : "Ask the professor anything…"}
              onChange={(e) => {
                setText(e.target.value);
                api.setDraft(e.target.value);
              }}
              onKeyDown={onKeyDown}
            />
            {hears && !busy && (
              <button className="ctl mic" type="button" aria-pressed={mic.on} onClick={hear} onPointerEnter={warm} onFocus={warm} data-via={onDevice ? "parakeet" : "browser"} title={mic.on ? "Stop listening" : onDevice ? "Say your question (heard on this computer: the audio never leaves it)" : "Say your question"} aria-label={mic.on ? "Stop listening" : "Say your question"}>
                {mic.on ? "■" : "🎤"}
              </button>
            )}
            {busy ? (
              <button className="ctl" type="button" onClick={api.stop} title="Stop the answer (Esc)">■ Stop</button>
            ) : (
              <button className="ctl primary" type="submit" disabled={!text.trim()}>Ask</button>
            )}
          </form>
          {mic.err && <p className="err" role="alert">{mic.err}</p>}
          {mic.note && <p className="note" role="status">{mic.note}</p>}
          <p className="keys">
            <span><kbd>/</kbd> ask · <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>↑</kbd> last question</span>
            {chat.msgs.length > 0 &&
              (confirmClear ? (
                <span className="confirm">
                  Clear this conversation?
                  <button type="button" onClick={() => { api.clear(); setConfirmClear(false); }}>Clear</button>
                  <button type="button" onClick={() => setConfirmClear(false)}>Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)}>Clear</button>
              ))}
          </p>
        </div>
      ) : (
        <p className="note ask">Open this page in Claude to talk with the professor.</p>
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* the clipboard is blocked: the text can still be selected */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
