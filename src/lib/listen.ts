"use client";
// Push-to-talk for the go-to bar: hold the mic, say where to go, let go, and
// the words land in the bar as text. The browser's own speech recognition
// (Chrome, Edge and Safari have it; Chrome and Edge send the audio to their
// speech service to do it). Where there is none, the mic is not offered.

/** The few members of the Web Speech API used here (TypeScript's DOM types leave it out). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Can this browser turn speech into text? */
export function canListen(): boolean {
  return !!ctor();
}

export interface Listening {
  /** Let go: stop listening; `onDone` follows with the words heard. */
  stop(): void;
  /** Throw the words away. */
  cancel(): void;
}

/** Start listening. `onText` gets the words so far while speaking; `onDone` the final words
 * (empty when nothing was heard), once, after `stop()` or a pause; `onError` why it failed. */
export function listen(o: { onText: (t: string) => void; onDone: (t: string) => void; onError?: (why: string) => void }): Listening | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = typeof navigator !== "undefined" ? navigator.language || "en-GB" : "en-GB";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;
  let text = "";
  let finished = false;
  let cancelled = false;
  r.onresult = (e) => {
    let all = "";
    for (let i = 0; i < e.results.length; i++) all += e.results[i][0]?.transcript ?? "";
    text = all.trim();
    o.onText(text);
  };
  r.onerror = (e) => {
    if (e.error === "aborted" || e.error === "no-speech") return;
    o.onError?.(e.error === "not-allowed" || e.error === "service-not-allowed" ? "The microphone is blocked for this page." : "The browser could not hear that.");
  };
  r.onend = () => {
    if (finished) return;
    finished = true;
    if (!cancelled) o.onDone(text);
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    },
    cancel: () => {
      cancelled = true;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
