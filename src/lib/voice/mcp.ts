"use client";
// The voice of WalkMyCode for Claude's page (docs/MCP.md §4), set up once by the
// page host: Claude's `narrate` chunks are read in order by the narrator in
// force (ElevenLabs when its key is set, the browser's voice otherwise, and
// always the browser's in Free voice), and the page's own instant line for a
// spoken question goes through the same queue, ahead of Claude's. A deep
// question's narration is left to the voice agent that asked it. The voice code
// itself (narrate.ts) loads with the first thing to say.
import type { BridgeClient, Pending } from "@/lib/bridge/client";
import { NarrationQueue, type QueueNarrator } from "./queue";
import { loadTalkMode } from "./talkMode";
import { loadVoiceView, narratorInForce, unlockAudio } from "./view";

async function narratorNow(): Promise<QueueNarrator> {
  const [{ getNarrator }, view] = await Promise.all([import("./narrate"), loadVoiceView()]);
  const { narrator } = narratorInForce(view);
  return getNarrator({ narrator, voiceId: narrator === view.narrator ? view.voiceId : null, speed: view.speed });
}

let speakable: ((t: string) => string) | null = null;
void import("./speech").then((m) => (speakable = m.speakable)).catch(() => {});

let queue: NarrationQueue | null = null;
const speakingListeners = new Set<(on: boolean) => void>();

/** The page's one narration queue. */
export function narration(): NarrationQueue {
  queue ??= new NarrationQueue(narratorNow, {
    prepare: (t) => (speakable ? speakable(t) : t.trim()),
    onError: (e) => console.info("WalkMyCode: narration failed:", (e as Error)?.message ?? e),
    onSpeaking: (on) => {
      for (const l of speakingListeners) l(on);
    },
  });
  return queue;
}

/** When Talk was last ended: what was asked before it is not read aloud any more. */
let hushedAt = 0;

/** Talk ended: stop speaking now, and stay quiet for whatever was asked before (Claude may still be
 * narrating it; its answer still shows on the board). A question asked afterwards is read as usual. */
export function hush(now = Date.now()): void {
  hushedAt = now;
  queue?.clear();
}

/** Whether a narration chunk is for a question asked before Talk was ended. */
export function hushedFor(pending: readonly Pending[], requestId: string | undefined): boolean {
  if (!requestId || !hushedAt) return false;
  const p = pending.find((x) => x.id === requestId);
  return !!p && p.at <= hushedAt;
}

/** Hear when the page starts and stops reading Claude's narration. */
export function onSpeaking(l: (on: boolean) => void): () => void {
  speakingListeners.add(l);
  return () => {
    speakingListeners.delete(l);
  };
}

/** Whether the page reads a narration chunk aloud: not for a deep question, whose answer the voice agent speaks. */
export function speaksFor(pending: readonly Pending[], requestId: string | undefined): boolean {
  if (!requestId) return true;
  return pending.find((p) => p.id === requestId)?.kind !== "deep";
}

/** Set the page's voice up on its bridge; returns the undoing. */
export function startVoice(b: BridgeClient): () => void {
  const off = b.handle("narrate", (c) => {
    if (!speaksFor(b.snapshot().pending, c.requestId)) return "Not read aloud: the voice agent speaks this answer.";
    if (hushedFor(b.snapshot().pending, c.requestId)) return "Not read aloud: the user ended the conversation. The answer still shows on the page.";
    const ahead = narration().push(c.text);
    return ahead ? `Queued to be spoken (${ahead} ahead).` : "Speaking now.";
  });
  // Browsers play sound only after the user has touched the page: the first touch lets it through.
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
  // The talk mode decides whether the browser reads everything (Free voice).
  void loadTalkMode();
  return () => {
    off();
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("keydown", unlock, { capture: true });
    queue?.clear();
  };
}
