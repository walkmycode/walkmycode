"use client";
// One call to read a text aloud with the narrator chosen in Settings → Voice,
// for any room (docs/VOICE.md §6: the Learn room's professor uses the same
// narrator setting). ElevenLabs or Deepgram when their key is set, else (and
// always in WalkMyCode Lite) the browser's own voice, British first. The voice
// code loads on the first call.
import type { Scope } from "./audioCache";
import type { Span } from "./speech";
import { loadVoiceView, narratorInForce } from "./view";

export interface SpeakAloudOptions {
  /** Cache the audio under this map (replays are free); omit for one-off text. */
  scope?: Scope;
  /** The word being heard, as offsets into the text (ElevenLabs' timings, the browser's word boundaries). */
  onWord?: (w: Span | null) => void;
  onStart?: () => void;
}

/** Read `text` aloud; resolves "ended" when heard, "stopped" when cut short; rejects with a VoiceError. */
export async function speakAloud(text: string, o: SpeakAloudOptions = {}): Promise<"ended" | "stopped"> {
  const [{ getNarrator }, view] = await Promise.all([import("./narrate"), loadVoiceView()]);
  const { narrator } = narratorInForce(view);
  return getNarrator({ narrator, voiceId: narrator === view.narrator ? view.voiceId : null, speed: view.speed }).speak(text, o);
}

/** Stop whatever is being read aloud. */
export async function stopSpeaking(): Promise<void> {
  const { stopNarration } = await import("./narrate");
  stopNarration();
}
