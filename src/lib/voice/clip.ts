"use client";
// A shared tour's own voice (src/lib/walkTour.ts): its maker can record the narration, one
// clip per step, with the microphone the app already uses for Talk; when the tour is opened
// again each recorded step plays its clip, and the others are read aloud by the narrator
// chosen in Settings → Voice. The clip plays through the same <audio> as the narrators, so a
// click that unlocked sound for them unlocks it for this too. Loaded with the tour player and
// the save dialog only.
import type { Clip } from "@/lib/walkTour";
import { MAX_CLIP_BYTES } from "@/lib/walkTour";
import type { FriendlyError } from "@/lib/providers/wire";
import { VoiceError } from "./errors";
import { recordMicrophone, toBase64 } from "./listen";
import type { SpeakEnd, SpeakOptions } from "./narrate";
import { sharedAudio } from "./view";

/** The part of a narrator the tour player uses: a clip stands in for one. */
export interface StepVoice {
  speak(text: string, o?: SpeakOptions): Promise<SpeakEnd>;
  prefetch(text: string): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

const BLOCKED: FriendlyError = { code: "unknown", title: "The browser held the sound back", message: "Press play again: browsers start sound only after a click on the page.", action: "retry" };
const UNPLAYABLE: FriendlyError = { code: "unknown", title: "The recording could not be played", message: "This browser can't play the voice recorded for this step. Turn on Explore's mute to have the text read instead.", action: "retry" };

function bytesOf(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A blob: URL for a clip (revoke it when done). */
export function clipUrl(c: Clip): string {
  return URL.createObjectURL(new Blob([bytesOf(c.base64)], { type: c.type.split(";")[0] }));
}

/** A step's recorded narration, as the tour player's voice for that step. */
export function clipVoice(c: Clip): StepVoice {
  let url: string | null = null;
  let settle: ((e: SpeakEnd) => void) | null = null;
  const done = (e: SpeakEnd) => {
    settle?.(e);
    settle = null;
  };
  const stop = () => {
    const a = sharedAudio();
    if (url && a.src === url) {
      a.pause();
      a.removeAttribute("src");
    }
    if (url) URL.revokeObjectURL(url);
    url = null;
    done("stopped");
  };
  return {
    speak(_text, o = {}) {
      stop();
      const a = sharedAudio();
      url = clipUrl(c);
      const mine = url;
      return new Promise<SpeakEnd>((resolve, reject) => {
        settle = resolve;
        let started = false;
        a.onplaying = () => {
          if (a.src !== mine || started) return;
          started = true;
          o.onStart?.();
        };
        a.onended = () => a.src === mine && done("ended");
        a.onpause = null;
        a.onerror = () => {
          if (a.src !== mine) return;
          settle = null;
          reject(new VoiceError(UNPLAYABLE));
        };
        a.src = mine;
        a.play().catch((e: unknown) => {
          if (a.src !== mine) return;
          settle = null;
          reject(new VoiceError((e as { name?: string })?.name === "NotAllowedError" ? BLOCKED : UNPLAYABLE));
        });
      });
    },
    prefetch: () => Promise.resolve(),
    pause: () => sharedAudio().pause(),
    resume: () => void sharedAudio().play().catch(() => {}),
    stop,
  };
}

/** Recording more than this per step stops by itself. */
export const MAX_STEP_RECORDING_MS = 180_000;

/** The microphone and a recorder are there (a secure page in a browser that records). */
export function canRecord(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface StepRecording {
  /** Stop: the clip, how long it is, or null when nothing was heard. */
  stop(): Promise<(Clip & { ms: number }) | null>;
  cancel(): void;
}

/** Record one step's narration. Throws a HearError with plain words when the microphone can't be used. */
export async function recordStep(): Promise<StepRecording> {
  const began = Date.now();
  const rec = await recordMicrophone(MAX_STEP_RECORDING_MS, {
    unsupported: "This browser can't record the microphone, so the tour will be read aloud instead.",
    denied: "The browser didn't let WalkMyCode use the microphone. Allow it in the address bar, or leave the tour to be read aloud.",
  });
  return {
    stop: async () => {
      const blob = await rec.stop();
      if (!blob.size) return null;
      if (blob.size > MAX_CLIP_BYTES) throw new Error("That recording is too long to keep. Record this step again, a little shorter.");
      return { type: blob.type || "audio/webm", base64: toBase64(new Uint8Array(await blob.arrayBuffer())), ms: Date.now() - began };
    },
    cancel: () => rec.cancel(),
  };
}
