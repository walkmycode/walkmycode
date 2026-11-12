"use client";
// A dictation heard on this computer (the Learn professor's mic button, with
// "On this computer" chosen in Settings → Voice): the microphone streams to
// the local server until stop(), the words show as they come, and stop()
// waits for the rest to be written down (push-to-talk's drain). The same
// shape as the browser's listener (src/lib/listen.ts), so a caller swaps one
// for the other.
import { openMic, type MicHandle } from "../handsfree/ear";
import { ParakeetStream, type ParakeetLike } from "./client";

export interface Dictation {
  /** Stop listening; `onDone` follows with every word heard. */
  stop(): void;
  /** Throw the words away. */
  cancel(): void;
}

export interface DictationEvents {
  /** The words so far. */
  onText(text: string): void;
  /** Every word, once, after stop(). */
  onDone(text: string): void;
  onError?(why: string): void;
  /** Something to tell the user that stops nothing. */
  onNotice?(message: string): void;
}

export interface DictationDeps {
  /** Start the microphone (tests hand over a fake). */
  mic?: (onFrame: (frame: Int16Array) => void) => Promise<MicHandle>;
  stream?: (on: ConstructorParameters<typeof ParakeetStream>[0]) => ParakeetLike;
}

const tidy = (parts: string[]) => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/** Start a dictation. Call inside a click, so the browser lets the audio run. Null when this browser has no microphone API. */
export function dictate(o: DictationEvents, deps: DictationDeps = {}): Dictation | null {
  let micOf = deps.mic;
  if (!micOf) {
    if (typeof AudioContext === "undefined") return null;
    const ctx = new AudioContext();
    micOf = (cb) => openMic(ctx, cb);
  }
  const done: string[] = [];
  let partial = "";
  let over = false;
  let mic: MicHandle | null = null;
  const text = () => tidy([...done, partial]);
  const stream = (deps.stream ?? ((on) => new ParakeetStream(on)))({
    partial: (t) => {
      if (over) return;
      partial = t;
      o.onText(text());
    },
    final: (t) => {
      partial = "";
      if (t) done.push(t);
      if (!over) o.onText(text());
    },
    notice: (m) => !over && o.onNotice?.(m),
    error: (m) => {
      if (over) return;
      over = true;
      mic?.close();
      stream.close();
      o.onError?.(m);
    },
  });
  micOf((f) => !over && stream.push(f)).then(
    (m) => {
      if (over) m.close();
      else mic = m;
    },
    () => {
      if (over) return;
      over = true;
      stream.close();
      o.onError?.("The microphone is blocked for this page.");
    },
  );
  return {
    stop() {
      if (over) return;
      over = true;
      mic?.close();
      // What was said since the last pause is still on its way.
      void stream.flush().then(() => {
        stream.close();
        o.onDone(tidy(done));
      });
    },
    cancel() {
      if (over) return;
      over = true;
      mic?.close();
      stream.close();
    },
  };
}
