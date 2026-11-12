"use client";
// The fly-through's narrator: the one chosen in Settings → Voice, through the
// same narrators the tour player and "Read aloud" use (ElevenLabs or Deepgram
// with their key, else the browser's own voice; always the browser's in WalkMyCode
// Lite). Each hop's line is cached under the map, so a replay costs nothing.
// Loaded the first time a hop is read aloud.
import type { FlyVoice } from "./flythrough";
import { getNarrator, type Narrator } from "./voice/narrate";
import { loadVoiceView, narratorInForce } from "./voice/view";

export function flyVoice(): FlyVoice {
  let current: Narrator | null = null;
  return {
    async say(text, scope) {
      const view = await loadVoiceView();
      const { narrator } = narratorInForce(view);
      current = getNarrator({ narrator, voiceId: narrator === view.narrator ? view.voiceId : null, speed: view.speed });
      return current.speak(text, { scope });
    },
    pause: () => current?.pause(),
    resume: () => current?.resume(),
    stop: () => current?.stop(),
  };
}
