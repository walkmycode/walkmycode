/**
 * The professor's voice: the narrator chosen in Settings → Voice, the same
 * one that reads tours in Explore (src/lib/voice/speakAloud.ts). ElevenLabs
 * when its key is set, else the browser's own voice, British first; WalkMyCode
 * Lite always uses the browser's voice. "Read only" (or a voice that fails)
 * waits about as long as reading the line would take, so the board keeps its
 * pace and each line still lights up in turn.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { speakAloud, stopSpeaking } from "@/lib/voice/speakAloud";
import { narratorInForce, useVoiceView } from "@/lib/voice/view";
import { NARRATORS } from "@/lib/voice/catalogue";
import { reckonedWord, type WordSpan } from "./caption";

/** How long reading a line takes, for Read only and a voice that could not speak. */
export const readTime = (text: string) => Math.max(1400, text.length * 47);

export interface ProfessorVoiceDeps {
  speak: (text: string) => Promise<"ended" | "stopped">;
  stop: () => Promise<void> | void;
  wait: (ms: number) => Promise<void>;
  /** Told once when the narrator fails, with its message. */
  onError?: (message: string) => void;
}

/**
 * The lesson's speak/stop, apart from React so the tests can drive it. Each
 * speak resolves when the line has been heard, cut short, or timed out; a
 * stop makes every pending speak resolve and silences the narrator.
 */
export function createProfessorVoice(d: ProfessorVoiceDeps) {
  let token = 0;
  return {
    async speak(text: string, muted: boolean): Promise<void> {
      const my = ++token;
      if (muted) return d.wait(readTime(text));
      try {
        // Some engines never say they finished: never hold the lesson up for long.
        await Promise.race([d.speak(text), d.wait(Math.max(15000, text.length * 200))]);
      } catch (e) {
        if (my !== token) return;
        d.onError?.((e as Error)?.message || "The voice could not speak.");
        await d.wait(readTime(text));
      }
    },
    stop() {
      token++;
      void d.stop();
    },
    get token() {
      return token;
    },
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Saying = { text: string; word: WordSpan | null };

/**
 * Follows the line being spoken, word by word, and tells `show` (the transcript under the board). A narrator that
 * reports its words (ElevenLabs' timings, Deepgram's words measured from its audio, the browser's word boundaries) is
 * believed, also when it says no word is being heard: in a pause nothing is lit. Until it reports, and for one that
 * never does, the word is reckoned from how long the sound has been playing; nothing is lit before the narrator says
 * the sound has begun. Apart from React, so the tests can drive it.
 */
export function followWords(show: (s: Saying | null) => void, now: () => number = () => performance.now()) {
  let line: { text: string; started: number; told: boolean; timer: ReturnType<typeof setInterval> | null } | null = null;
  return {
    /** A new line is asked for. Returns what to call when it has been heard or cut short. */
    begin(text: string, speed: number): () => void {
      if (line?.timer) clearInterval(line.timer);
      const mine: NonNullable<typeof line> = { text, started: 0, told: false, timer: null };
      line = mine;
      show({ text, word: null });
      mine.timer = setInterval(() => {
        if (mine.told || line !== mine) return;
        if (mine.started) show({ text, word: reckonedWord(text, now() - mine.started, speed) });
      }, 90);
      return () => {
        if (mine.timer) clearInterval(mine.timer);
        if (line === mine) {
          line = null;
          show(null);
        }
      };
    },
    /** The narrator says the sound has begun. */
    started(text: string) {
      if (line && line.text === text && !line.started) line.started = now();
    },
    /** The narrator says which word is being heard, or (null) that none is. */
    heard(text: string, word: WordSpan | null) {
      if (!line || line.text !== text) return;
      line.told = true;
      show({ text, word });
    },
  };
}

export function useVoice() {
  const [muted, setMuted] = useState(false);
  const [note, setNote] = useState("");
  /** Being heard right now (never while "Read only" is on): the professor's face moves its mouth. */
  const [speaking, setSpeaking] = useState(false);
  const heard = useRef(0);
  const view = useVoiceView({ idle: true });
  const narrator = view ? narratorInForce(view).narrator : null;
  const label = narrator ? NARRATORS[narrator].label : "";
  /** What is being said, and the word of it being spoken now (caption.ts): the transcript under the board. */
  const [saying, setSaying] = useState<Saying | null>(null);
  const speed = useRef(1);
  useEffect(() => {
    speed.current = view?.speed ?? 1;
  }, [view?.speed]);
  // The line in the air, followed word by word; and the voice that reports to it.
  const [words] = useState(() => followWords(setSaying));
  const [voice] = useState(() => createProfessorVoice({ speak: (t) => speakAloud(t, { onStart: () => words.started(t), onWord: (w) => words.heard(t, w) }), stop: stopSpeaking, wait, onError: setNote }));
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  // Leaving the lesson silences it.
  useEffect(() => () => voice.stop(), [voice]);

  const stop = useCallback(() => voice.stop(), [voice]);
  /** Speak, resolving when done (or when stopped). */
  const speak = useCallback(
    async (text: string) => {
      if (mutedRef.current) return voice.speak(text, true);
      heard.current++;
      setSpeaking(true);
      const end = words.begin(text, speed.current);
      try {
        await voice.speak(text, false);
      } finally {
        end();
        if (--heard.current === 0) setSpeaking(false);
      }
    },
    [voice, words],
  );

  return { available: true, label, note, muted, setMuted, speak, stop, speaking, saying };
}
