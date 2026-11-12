"use client";
// "Read aloud" under an answer: the narrator chosen in Settings → Voice reads
// it, with the chalk markup and the paths made speakable. The voice code loads
// on the first click, so an answer on screen costs the page nothing.
import { openSettings as openSettingsPane } from "@/lib/settingsNav";
import { useEffect, useRef, useState } from "react";
import type { FriendlyError } from "@/lib/providers/wire";
import { loadVoiceView, narratorInForce, unlockAudio } from "@/lib/voice/view";

// "Open settings" opens Settings → Voice.
const openSettings = () => openSettingsPane("voice");

export default function ReadAloud({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const reading = useRef(0);
  useEffect(() => () => stop.current?.(), []);

  const click = async () => {
    unlockAudio();
    if (on) {
      reading.current++;
      stop.current?.();
      setOn(false);
      return;
    }
    const my = ++reading.current;
    setOn(true);
    setError(null);
    try {
      const [{ getNarrator, VoiceError }, { speakable }, view] = await Promise.all([import("@/lib/voice/narrate"), import("@/lib/voice/speech"), loadVoiceView()]);
      if (my !== reading.current) return;
      const { narrator } = narratorInForce(view);
      const n = getNarrator({ narrator, voiceId: narrator === view.narrator ? view.voiceId : null, speed: view.speed });
      stop.current = () => n.stop();
      try {
        await n.speak(speakable(text));
      } catch (e) {
        if (my === reading.current) setError(e instanceof VoiceError ? e.info : { code: "unknown", title: "Narration failed", message: String((e as Error)?.message ?? e), action: "retry" });
      }
    } finally {
      if (my === reading.current) setOn(false);
    }
  };

  return (
    <span className="read-aloud">
      <button type="button" className="ctl compact ghost" aria-pressed={on} onClick={() => void click()} title="Read this answer aloud">
        {on ? "■ stop reading" : "▶ read aloud"}
      </button>
      {error && (
        <button type="button" className="voice-note bad" title={error.message} onClick={() => (error.action === "settings" ? openSettings() : void click())}>
          {error.title}
        </button>
      )}
    </span>
  );
}
