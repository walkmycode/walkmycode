"use client";
// How a spoken question is answered on WalkMyCode for Claude's page (docs/MCP.md
// §4), chosen in Settings → Voice and kept by the local server in
// ~/.walkmycode/mcp.json (the page's port, and so its storage, changes between
// launches):
//  - "claude" (the default): Talk through Claude. Tap Talk and speak; each
//    pause sends the words to the user's own Claude as a spoken request, and it
//    answers aloud (hands-free; or hold to talk, chosen in Settings → Voice).
//  - "lecturer": the Lightning lecturer. ElevenLabs' live agent answers in
//    about a second, and hands hard questions to Claude (deep_answer).
//  - "free": Free voice. The browser hears the question and reads every
//    answer aloud: nothing goes to a voice provider.
// Tours play in every mode.
import { useEffect, useState } from "react";
import { setBrowserOnly } from "./view";

export type TalkMode = "claude" | "lecturer" | "free";
export const TALK_MODES: TalkMode[] = ["claude", "lecturer", "free"];
export const DEFAULT_TALK: TalkMode = "claude";

/** The talk modes in words, naming the connected AI app (`who`: "Claude", "Antigravity"…; "your AI app" before it has said). */
export function talkLabels(who = "your AI app"): Record<TalkMode, { label: string; needs: string; hint: string }> {
  return {
    claude: {
      label: who === "your AI app" ? "Talk through your AI" : `Talk through ${who}`,
      needs: "nothing",
      hint: `Tap Talk once and just ask; when you pause, ${who} answers out loud while it shows you the code, and you can speak over it. About 2–6 seconds a reply: its own thinking time.`,
    },
    lecturer: {
      label: "Lightning lecturer",
      needs: "an ElevenLabs key",
      hint: `ElevenLabs' live voice agent answers in about a second and you can interrupt it any time. Hard questions go to ${who}, and the agent speaks its answer.`,
    },
    free: {
      label: "Free voice",
      needs: "nothing",
      hint: "Your browser hears your question and reads every answer aloud. Nothing goes to a voice provider; voices and recognition depend on your browser (Chrome and Edge hear best).",
    },
  };
}

/** The talk modes in words, before the AI app has said its name. */
export const TALK_LABEL = talkLabels();

export const TALK_SAVED = "talk-mode-saved";

export function isTalkMode(v: unknown): v is TalkMode {
  return typeof v === "string" && (TALK_MODES as string[]).includes(v);
}

let cached: Promise<TalkMode> | null = null;

/** The talk mode saved on the local server (the default when it cannot say). */
export function loadTalkMode(): Promise<TalkMode> {
  cached ??= fetch("/api/mcp/settings")
    .then(async (r) => {
      const d = (await r.json()) as { talk?: unknown };
      return isTalkMode(d.talk) ? d.talk : DEFAULT_TALK;
    })
    .catch(() => {
      cached = null;
      return DEFAULT_TALK;
    })
    .then((m) => {
      setBrowserOnly(m === "free");
      return m;
    });
  return cached;
}

export async function saveTalkMode(talk: TalkMode): Promise<void> {
  const res = await fetch("/api/mcp/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ talk }) });
  if (!res.ok) throw new Error(`WalkMyCode's server answered ${res.status}.`);
  cached = Promise.resolve(talk);
  setBrowserOnly(talk === "free");
  window.dispatchEvent(new CustomEvent(TALK_SAVED));
}

/** The talk mode for a component, read again after every save; null until known. */
export function useTalkMode(enabled = true): TalkMode | null {
  const [mode, setMode] = useState<TalkMode | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => void loadTalkMode().then((m) => live && setMode(m));
    load();
    window.addEventListener(TALK_SAVED, load);
    return () => {
      live = false;
      window.removeEventListener(TALK_SAVED, load);
    };
  }, [enabled]);
  return mode;
}
