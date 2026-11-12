"use client";
// What the page knows about the voice choice, cheaply: the narrator, voice and
// speed saved in Settings → Voice (GET /api/voice/config in the app; this
// browser's storage in Lite, where the browser's own voice is the only one),
// whether each key is set, and what is not ready. Small on purpose: the guide
// imports it, and every heavier piece of voice code loads on first use.
import { useEffect, useState } from "react";
import { TARGET } from "@/lib/adapters/target";
import type { FriendlyError } from "@/lib/providers/wire";
import { readPref } from "../prefs";
import { NARRATORS, SPEED, sttFor, VOICE_DEFAULT, type InputMode, type LecturerId, type LecturerModelId, type NarratorId, type SttId, type SttKeyEnv } from "./catalogue";

export interface VoiceView {
  narrator: NarratorId;
  voiceId: string | null;
  speed: number;
  lecturer: LecturerId;
  lecturerModel: LecturerModelId;
  /** How Talk listens (Settings → Voice): hands-free, or hold to talk. */
  input: InputMode;
  /** Headphones on: the lecturer hears the real microphone even while it speaks. */
  headphones: boolean;
  /** How a spoken question becomes text where no lecturer listens (Settings → Voice). */
  stt: SttId;
  /** What "On this computer" falls back to where it can't hear. */
  sttBefore?: SttId;
  /** On-device speech to text can run here: the model is on this computer and the server has the engine. */
  parakeet?: boolean;
  keys: Partial<Record<SttKeyEnv, { has_key: boolean; source: "settings" | "env" | null }>>;
  readiness: { narrator: FriendlyError | null; lecturer: FriendlyError | null };
}

/** Fired on window after a voice save, so the guide and the tour player re-read the choice. */
export const VOICE_SAVED = "voice-saved";
const LITE_PREF = "walkmycode:voice";

const clampSpeed = (s: unknown) => {
  const n = Number(s);
  return Number.isFinite(n) && n >= SPEED.min && n <= SPEED.max ? n : VOICE_DEFAULT.speed;
};

const UNREACHABLE: FriendlyError = { code: "network", title: "Can't reach the WalkMyCode server", message: "Is `npm run dev` still running? Check the terminal and try again.", action: "retry" };

/** WalkMyCode Lite: the browser's voice, with the voice and speed this viewer picked. */
function liteView(): VoiceView {
  let saved: { voiceId?: unknown; speed?: unknown } = {};
  try {
    saved = JSON.parse(readPref(localStorage, LITE_PREF) ?? "{}") as typeof saved;
  } catch {
    saved = {};
  }
  return {
    narrator: VOICE_DEFAULT.liteNarrator,
    voiceId: typeof saved.voiceId === "string" && saved.voiceId ? saved.voiceId : null,
    speed: clampSpeed(saved.speed),
    lecturer: VOICE_DEFAULT.lecturer,
    lecturerModel: "haiku",
    input: VOICE_DEFAULT.input,
    headphones: false,
    stt: VOICE_DEFAULT.stt,
    keys: {},
    readiness: { narrator: null, lecturer: null },
  };
}

/** Lite keeps the browser voice's settings in this browser (a per-viewer convenience). */
export function saveLiteVoice(patch: { voiceId?: string | null; speed?: number }): void {
  const cur = liteView();
  const next = { voiceId: patch.voiceId !== undefined ? patch.voiceId : cur.voiceId, speed: patch.speed !== undefined ? clampSpeed(patch.speed) : cur.speed };
  try {
    localStorage.setItem(LITE_PREF, JSON.stringify(next));
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  announceVoiceSaved();
}

export function announceVoiceSaved(): void {
  cached = null;
  window.dispatchEvent(new CustomEvent(VOICE_SAVED));
}

let cached: Promise<VoiceView> | null = null;

/** The voice choice in force (asked once per page, again after a save). */
export function loadVoiceView(): Promise<VoiceView> {
  if (TARGET === "lite") return Promise.resolve(liteView());
  cached ??= fetch("/api/voice/config")
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { saved: Omit<VoiceView, "keys" | "readiness" | "parakeet">; keys: VoiceView["keys"]; readiness: VoiceView["readiness"]; parakeet?: { ready?: boolean } };
      const input: InputMode = d.saved.input === "push-to-talk" ? "push-to-talk" : "hands-free";
      return { ...d.saved, input, headphones: d.saved.headphones === true, stt: sttFor(d.saved.stt ?? "")?.id ?? VOICE_DEFAULT.stt, parakeet: d.parakeet?.ready === true, keys: d.keys, readiness: d.readiness };
    })
    .catch((): VoiceView => {
      cached = null; // ask again next time
      return { narrator: "browser", voiceId: null, speed: VOICE_DEFAULT.speed, lecturer: VOICE_DEFAULT.lecturer, lecturerModel: "haiku", input: VOICE_DEFAULT.input, headphones: false, stt: VOICE_DEFAULT.stt, keys: {}, readiness: { narrator: null, lecturer: UNREACHABLE } };
    });
  return cached;
}

/**
 * The voice choice for a component, re-read after every voice save. null until
 * it is known. `idle`: ask only once the page has nothing better to do, so a
 * button that is always on screen (Talk) never competes with the map's first paint.
 */
export function useVoiceView(o: { idle?: boolean } = {}): VoiceView | null {
  const [view, setView] = useState<VoiceView | null>(null);
  const idle = !!o.idle;
  useEffect(() => {
    let live = true;
    const load = () => void loadVoiceView().then((v) => live && setView(v));
    let cancel = () => {};
    if (idle && typeof window !== "undefined" && "requestIdleCallback" in window) {
      const h = window.requestIdleCallback(load, { timeout: 4000 });
      cancel = () => window.cancelIdleCallback(h);
    } else if (idle) {
      const t = setTimeout(load, 1500);
      cancel = () => clearTimeout(t);
    } else load();
    window.addEventListener(VOICE_SAVED, load);
    return () => {
      live = false;
      cancel();
      window.removeEventListener(VOICE_SAVED, load);
    };
  }, [idle]);
  return view;
}

/** WalkMyCode for Claude's "Free voice" mode (docs/MCP.md §4): the browser reads everything aloud, whatever is saved. */
let browserOnly = false;

/** Read everything with the browser's own voice (true), or with the narrator saved in Settings → Voice. */
export function setBrowserOnly(on: boolean): void {
  if (browserOnly === on) return;
  browserOnly = on;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VOICE_SAVED));
}

/**
 * Who actually reads aloud: the chosen narrator when its key is set, else the
 * browser's voice, with the reason to show once.
 */
export function narratorInForce(view: VoiceView): { narrator: NarratorId; note: FriendlyError | null } {
  if (browserOnly) return { narrator: "browser", note: null };
  if (TARGET === "lite" && !NARRATORS[view.narrator].lite) return { narrator: VOICE_DEFAULT.liteNarrator, note: null };
  if (view.narrator !== "browser" && view.readiness.narrator) return { narrator: "browser", note: view.readiness.narrator };
  return { narrator: view.narrator, note: null };
}

// ── One audio element for every narration ──

let shared: HTMLAudioElement | null = null;
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export function sharedAudio(): HTMLAudioElement {
  shared ??= new Audio();
  return shared;
}

/**
 * Call inside a click: lets the first play() through on browsers that want a
 * gesture for it, even when the audio arrives after the voice code loads.
 */
export function unlockAudio(): void {
  const a = sharedAudio();
  if (a.dataset.unlocked) return;
  a.dataset.unlocked = "1";
  a.src = SILENCE;
  void a.play().catch(() => {});
}
