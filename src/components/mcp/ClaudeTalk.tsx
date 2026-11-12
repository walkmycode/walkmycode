"use client";
// Talk through Claude, and Free voice (docs/MCP.md §4), on WalkMyCode for Claude's
// page: a hands-free conversation. Tap Talk once and just speak; short pauses
// keep the question going, and after about two seconds of quiet everything you
// said goes to your own Claude as one spoken request, and Claude's narration
// plays. Say more before the answer is in and the whole question, in order, is
// sent again in place of the unanswered one (conversation.ts, `continues`). Speak over it and it stops at
// once and listens (barge-in). Tap to end (or Esc); after 45 s of quiet a
// gentle "Still there?", after 60 s the conversation ends by itself, and the
// microphone is let go whenever it ends. "Hold to talk" (Settings → Voice) is
// the option for noisy rooms: hold Space or Talk, let go to send.
//
// The moment an utterance is sent the page answers by itself: a short line
// ("Let me look at sign-in.") and the cards the words name lit on the map, so
// the seconds Claude takes never feel empty. Speech becomes text on this
// computer when "On this computer" (Parakeet) is chosen in Settings → Voice
// and its model is here, else through the transcriber chosen there (Groq,
// Deepgram, ElevenLabs, on the user's key), else in the browser where it can,
// else through the first key set, else the question box takes the focus.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAiName } from "@/lib/aiName";
import { litOf } from "@/lib/bridge/commands";
import { useShell } from "@/shell/WorkspaceProvider";
import { hears, type TalkEffect } from "@/lib/voice/handsfree/conversation";
import { Ear, openMic, serverTranscriber } from "@/lib/voice/handsfree/ear";
import { ackLine, cardsNamed } from "@/lib/voice/heard";
import { STTS } from "@/lib/voice/catalogue";
import { parakeetFallback, pickListener, recognitionCtor, type ListenerFacts } from "@/lib/voice/listen";
import { ParakeetStream, preloadParakeet } from "@/lib/voice/parakeet/client";
import { hush, narration, onSpeaking } from "@/lib/voice/mcp";
import type { TalkMode } from "@/lib/voice/talkMode";
import { tourControl } from "@/lib/voice/tourBus";
import { unlockAudio, useVoiceView } from "@/lib/voice/view";
import TalkPill, { useConversation, useLevel } from "@/components/voice/TalkPill";

/** Space is the talk key (hold to talk) unless the user is typing. */
function typing(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor");
}

let said = 0;

interface Props {
  mode: Exclude<TalkMode, "lecturer">;
  /** Hearing is not possible here: the question box takes the focus. */
  onType: () => void;
  /** The words heard so far, or a note on why nothing was; null when there is nothing to show. */
  onStatus: (text: string | null) => void;
  /** Claude is working on a request (the guide is busy). */
  busy?: boolean;
}

export default function ClaudeTalk({ mode, onType, onStatus, busy = false }: Props) {
  const s = useShell();
  const shell = useRef(s);
  useEffect(() => {
    shell.current = s;
  });
  const view = useVoiceView({ idle: true });
  const who = useAiName();
  const [words, setWords] = useState("");
  /** The server transcriber has the audio; its words are on their way. */
  const [writing, setWriting] = useState(false);
  /** What the last utterance came out as, shown until you speak again. */
  const [last, setLast] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ear = useRef<Ear | null>(null);
  const level = useLevel();

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);

  const facts: ListenerFacts = {
    mode,
    browser: typeof window !== "undefined" && !!recognitionCtor(),
    stt: view?.stt,
    sttBefore: view?.sttBefore,
    keys: { deepgram: !!view?.keys.DEEPGRAM_API_KEY?.has_key, elevenlabs: !!view?.keys.ELEVENLABS_API_KEY?.has_key, groq: !!view?.keys.GROQ_API_KEY?.has_key },
    parakeet: view?.parakeet,
    lang: typeof navigator !== "undefined" ? navigator.language : null,
  };
  const via = pickListener(facts);
  /** "On this computer" is chosen but can't hear here (another language, no model yet): said once Talk is pressed. */
  const fellBack = parakeetFallback(facts);
  const input = view?.input ?? "hands-free";

  // The speech model takes about three seconds to load and about 700 MB of memory: it loads when the pointer or the
  // keyboard reaches Talk (and at the tap, if neither did), not with the page.
  const warm = useCallback(() => {
    if (via === "parakeet") preloadParakeet();
  }, [via]);

  const onEffect = useCallback((e: TalkEffect) => {
    switch (e.do) {
      case "barge-in":
        // You spoke over the answer: it stops now, and a tour waits.
        narration().clear();
        tourControl()?.pauseForQuestion();
        break;
      case "send": {
        // The page's own answer, at once: the cards the words name, and a short line (once per question).
        const { map } = shell.current;
        const cards = cardsNamed(map, e.text);
        if (cards.length) shell.current.setLit(litOf(map, cards.map((c) => c.id)));
        narration().clear();
        tourControl()?.pauseForQuestion();
        if (!e.continues) narration().push(ackLine(cards.map((c) => c.name), said++));
        setLast(e.text);
        shell.current.askSpoken(e.text, { continues: !!e.continues });
        break;
      }
      case "commit":
        ear.current?.commit();
        break;
      case "still-there":
        setNote("Still there? Say something, or tap to end. Talk ends by itself in 15 seconds.");
        break;
      case "end":
        // Ended: the voice stops too, now, and doesn't start again for what was already asked.
        hush();
        tourControl()?.pauseForQuestion();
        ear.current?.close();
        ear.current = null;
        setWords("");
        setWriting(false);
        setLast(null);
        if (e.reason === "idle") setNote("Talk ended after a minute of quiet. The microphone is off.");
        break;
    }
  }, []);
  const talk = useConversation(onEffect);
  const { dispatch, state } = talk;
  // What has been said and not sent yet (the conversation gathers it), then the words still coming.
  const gathered = state.gathered;
  useEffect(
    () => {
      const so = [gathered, words].filter(Boolean).join(" ");
      onStatus(
        words ? `“${so}”` : writing ? (gathered ? `“${gathered}” … writing down the rest…` : "Writing down what you said…") : gathered ? `“${gathered}” … go on, or pause and it's sent` : (note ?? (last ? `You said: “${last}”` : null)),
      );
    },
    [gathered, words, writing, note, last, onStatus],
  );
  const on = state.phase !== "off";

  // Speech counts only while it should (not muted; held, in hold to talk).
  const open = hears(state);
  useEffect(() => {
    // Closed, the ear says so with empty words (interim("")).
    ear.current?.setOpen(open);
  }, [open]);

  // Claude's answer is in: listening again (when it was not spoken).
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) dispatch({ type: "done", at: Date.now() });
    wasBusy.current = busy;
  }, [busy, dispatch]);

  // Claude's narration playing: the conversation is "Speaking", and the microphone listens through its echo.
  // The page's own short line ends before Claude has answered: then it is still "Thinking".
  useEffect(() => {
    if (!on) return;
    return onSpeaking((speaking) => {
      ear.current?.setPlayback(speaking);
      dispatch({ type: "speaking", on: speaking, at: Date.now() });
      if (!speaking && wasBusy.current) dispatch({ type: "thinking", at: Date.now() });
    });
  }, [on, dispatch]);

  const start = useCallback(() => {
    unlockAudio();
    warm();
    setNote(fellBack);
    if (via === "typing") {
      setNote(mode === "free" ? "This browser can't hear you: type your question." : "This browser can't hear you, and no Groq, Deepgram or ElevenLabs key is set for speech to text: type your question.");
      onType();
      return;
    }
    // Made in the click, so the browser lets it run.
    const ctx = typeof AudioContext !== "undefined" ? new AudioContext() : null;
    if (!ctx) {
      setNote("This browser can't use the microphone here. Type your question instead.");
      onType();
      return;
    }
    const e = new Ear(
      {
        via,
        mic: (cb) => openMic(ctx, cb),
        Recognition: recognitionCtor(),
        transcribe: via === "browser" || via === "parakeet" ? undefined : serverTranscriber(via),
        parakeet: via === "parakeet" ? (on) => new ParakeetStream(on) : undefined,
      },
      {
        level: (l) => level.sink.set(l),
        speechStart: () => {
          setLast(null);
          dispatch({ type: "user-start", at: Date.now() });
        },
        interim: (t) => setWords(t),
        transcribing: () => setWriting(true),
        utterance: (text) => {
          setWords("");
          setWriting(false);
          if (!text) setNote("I didn't catch that. Say it again?");
          dispatch({ type: "user-end", at: Date.now(), text });
        },
        error: (m) => {
          setWriting(false);
          setNote(m);
        },
        notice: (m) => setNote(m),
      },
    );
    ear.current = e;
    dispatch({ type: "start", at: Date.now(), input });
    e.setOpen(input === "hands-free");
    e.start().catch(() => {
      void ctx.close().catch(() => {});
      setNote("The microphone couldn't start (is it allowed for this page?). Type your question instead.");
      dispatch({ type: "end", at: Date.now(), reason: "error" });
    });
  }, [via, warm, fellBack, mode, onType, input, dispatch, level.sink]);

  const end = useCallback(() => dispatch({ type: "end", at: Date.now(), reason: "ended" }), [dispatch]);

  // The microphone is let go when the page goes.
  useEffect(
    () => () => {
      ear.current?.close();
      ear.current = null;
    },
    [],
  );

  // Esc ends; in hold to talk, Space (anywhere but a text box) is the key to hold.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && talk.current().phase !== "off") {
        end();
        return;
      }
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || input !== "push-to-talk") return;
      e.preventDefault();
      unlockAudio();
      if (talk.current().phase === "off") start();
      dispatch({ type: "press", at: Date.now() });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !talk.current().held) return;
      e.preventDefault();
      dispatch({ type: "release", at: Date.now() });
    };
    const blur = () => talk.current().held && dispatch({ type: "release", at: Date.now() });
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [input, start, end, dispatch, talk]);

  if (on) {
    return (
      <>
        <TalkPill
          state={state}
          levelRef={level.ref}
          recording
          onMute={() => dispatch({ type: "mute", muted: !state.muted, at: Date.now() })}
          onEnd={end}
          holdHint="Hold Space or Talk"
          testId="claude-talk-pill"
        />
        {input === "push-to-talk" && (
          <button
            type="button"
            className={`ctl talk${state.held ? " on" : ""}`}
            aria-pressed={state.held}
            data-testid="claude-talk"
            title={`Hold to speak; let go and ${who} answers`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              dispatch({ type: "press", at: Date.now() });
            }}
            onPointerUp={() => dispatch({ type: "release", at: Date.now() })}
            onPointerCancel={() => dispatch({ type: "release", at: Date.now() })}
            onLostPointerCapture={() => talk.current().held && dispatch({ type: "release", at: Date.now() })}
          >
            <i className={`talk-dot${state.held ? " live" : ""}`} aria-hidden />
            Hold
          </button>
        )}
      </>
    );
  }

  const title =
    via === "typing"
      ? "This browser can't turn speech into text here: type your question"
      : `Talk with ${who}: tap once and just speak; tap again or press Esc to end${via === "browser" ? "" : via === "parakeet" ? " (heard on this computer: the audio never leaves it)" : ` (heard by ${STTS[via].label} on your key)`}`;
  return (
    <button
      type="button"
      className={`ctl talk${via === "typing" ? " blocked" : ""}`}
      aria-pressed={false}
      title={title}
      data-testid="claude-talk"
      data-via={via}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={start}
    >
      <i className="talk-dot" aria-hidden />
      Talk
    </button>
  );
}
