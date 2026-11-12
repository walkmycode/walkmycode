// The voice catalogue (docs/VOICE.md §2): who reads aloud, who listens and
// answers, what each costs, and where the audio and text go. Shared by the
// server and the browser, so nothing secret lives here. Prices are the
// vendors' pay-as-you-go list prices as read on 2026-10-01.

export type NarratorId = "elevenlabs" | "deepgram" | "browser";
export type LecturerId = "elevenagents" | "deepgram-agent";
/** A lecturer's thinking model, named per lecturer (Deepgram: fast / smarter / your-claude; ElevenLabs: haiku). */
export type LecturerModelId = "haiku" | "fast" | "smarter" | "your-claude";
/** How the microphone is used while talking: held (the default) or always open. */
export type InputMode = "push-to-talk" | "hands-free";

export const VOICE_KEY_ENVS = ["ELEVENLABS_API_KEY", "DEEPGRAM_API_KEY"] as const;
export type VoiceKeyEnv = (typeof VOICE_KEY_ENVS)[number];
/** The keys speech to text can use: the voice keys, and the Groq key the model providers already have. */
export const STT_KEY_ENVS = [...VOICE_KEY_ENVS, "GROQ_API_KEY"] as const;
export type SttKeyEnv = (typeof STT_KEY_ENVS)[number];

export interface VoiceOption {
  id: string;
  label: string;
}

export interface NarratorDef {
  id: NarratorId;
  label: string;
  /** Key env var; null = no key (the browser's own voice). */
  env: VoiceKeyEnv | null;
  /** The vendor's model id, sent as-is; null for the browser. */
  model: string | null;
  /** Fixed voices to pick from. ElevenLabs lists the account's voices at run time, the browser its own. */
  voices: VoiceOption[];
  /** The voice used when none is saved; null = found at run time (ElevenLabs: Eldrin, else the
   * account's first voice; the browser: a British English voice first). */
  defaultVoice: string | null;
  /** ElevenLabs: the voice name looked for in GET /v1/voices. */
  preferredVoice?: string;
  /** $ per 1,000 characters read aloud. */
  pricePer1k: number;
  latency: string;
  /** Character timings come back with the audio, so the spoken word can be lit. */
  timings: boolean;
  /** Longest text per request; longer text is split by sentence. */
  maxChars: number | null;
  /** Offered in WalkMyCode Lite (no outside network there). */
  lite: boolean;
  url: string | null;
  hint: string;
  privacy: string;
}

export const NARRATORS: Record<NarratorId, NarratorDef> = {
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs",
    env: "ELEVENLABS_API_KEY",
    model: "eleven_flash_v2_5",
    voices: [],
    defaultVoice: null,
    preferredVoice: "Eldrin",
    pricePer1k: 0.04,
    latency: "~75 ms",
    timings: true,
    maxChars: 40_000,
    lite: false,
    url: "https://elevenlabs.io/app/settings/api-keys",
    hint: "Flash v2.5, ElevenLabs' fastest model. The default voice is Eldrin, a British baritone (the official replacement for George); without it, your account's first voice. ElevenLabs' default voices end on 31 Dec 2026.",
    privacy: "The text read aloud, which can name your files and functions, goes to ElevenLabs on your key.",
  },
  deepgram: {
    id: "deepgram",
    label: "Deepgram Aura-2",
    env: "DEEPGRAM_API_KEY",
    model: "aura-2",
    voices: [
      { id: "aura-2-draco-en", label: "Draco: British, male" },
      { id: "aura-2-pandora-en", label: "Pandora: British, female" },
    ],
    defaultVoice: "aura-2-draco-en",
    pricePer1k: 0.03,
    latency: "streamed",
    timings: false,
    maxChars: 2000,
    lite: false,
    url: "https://console.deepgram.com",
    hint: "Up to 2,000 characters per request, so longer text is sent a few sentences at a time. No word timings: the step lights up, not each word.",
    privacy: "The text read aloud goes to Deepgram on your key, sent with mip_opt_out so Deepgram does not use it to improve its models.",
  },
  browser: {
    id: "browser",
    label: "Your browser's voice",
    env: null,
    model: null,
    voices: [],
    defaultVoice: null,
    pricePer1k: 0,
    latency: "instant",
    timings: false,
    maxChars: null,
    lite: true,
    url: null,
    hint: "Free and instant, no key. A British English voice is picked first when your system has one.",
    privacy: "Your browser's built-in voice reads the text. Voices marked online or natural may be run by your browser's maker on its servers.",
  },
};

/** One way a lecturer thinks: a model chain (first choice first) and the price per connected minute. */
export interface LecturerModelDef {
  id: LecturerModelId;
  label: string;
  detail: string;
  /** Deepgram: managed Claude models, first choice first (the agent moves on when one fails).
   * ElevenLabs: the agent's LLM id. */
  think: string[];
  /** $ per connected minute. */
  pricePerMin: number;
  /** What the price includes. */
  tier: string;
  /** The model's own tokens are billed on top (ElevenAgents), so the meter's figure is a floor. */
  plusModel?: boolean;
  /** 1 = built; 2 = needs the voice relay (docs/VOICE.md §5). */
  phase: 1 | 2;
  /** Needs a session with a real key before it is offered. */
  untested?: boolean;
}

export interface LecturerDef {
  id: LecturerId;
  label: string;
  /** One line beside the choice in Settings. */
  blurb: string;
  env: VoiceKeyEnv;
  models: LecturerModelDef[];
  defaultModel: LecturerModelId;
  /** Deepgram's agent in phase 1: how it listens and speaks. */
  listen?: string;
  speak?: string;
  hint: string;
  privacy: string;
}

export const LECTURERS: Record<LecturerId, LecturerDef> = {
  elevenagents: {
    id: "elevenagents",
    label: "ElevenLabs",
    blurb: "One voice through tours and talk",
    env: "ELEVENLABS_API_KEY",
    defaultModel: "haiku",
    models: [
      {
        id: "haiku",
        label: "Claude Haiku 4.5",
        detail: "ElevenAgents with Claude Haiku 4.5 (fast replies), speaking in your narration voice",
        think: ["claude-haiku-4-5"],
        pricePerMin: 0.08,
        tier: "per connected minute, plus the model's tokens on your ElevenLabs plan",
        plusModel: true,
        phase: 1,
      },
    ],
    hint: "WalkMyCode sets up one private agent in your ElevenLabs account on first use (its prompt is the lecturer plus this map; its tools drive the screen) and asks the server for a signed link each time, so your key stays on this computer.",
    privacy:
      "Talk sends your microphone audio and the conversation, which can include code names and the lines the lecturer reads, to ElevenLabs, which runs Claude (Anthropic) for the replies. The agent's prompt, with this map's summary, is kept in your ElevenLabs account.",
  },
  "deepgram-agent": {
    id: "deepgram-agent",
    label: "Deepgram",
    blurb: "Cheaper: the model is included in the minute",
    env: "DEEPGRAM_API_KEY",
    defaultModel: "fast",
    listen: "flux-general-en",
    speak: "flux-colin-en",
    models: [
      {
        id: "fast",
        label: "Fast",
        detail: "Claude Haiku 4.5 managed by Deepgram, falling back to Claude Sonnet 5",
        think: ["claude-haiku-4-5", "claude-sonnet-5"],
        pricePerMin: 0.075,
        tier: "Standard: the model is included",
        phase: 1,
      },
      {
        id: "smarter",
        label: "Smarter",
        detail: "Claude Sonnet 5 managed by Deepgram",
        think: ["claude-sonnet-5"],
        pricePerMin: 0.163,
        tier: "Advanced: the model is included",
        phase: 1,
      },
      {
        id: "your-claude",
        label: "Your Claude",
        detail: "Claude Opus 5.5 or Sonnet 5.5 on your Anthropic key, through the voice relay",
        think: ["claude-opus-5-5"],
        pricePerMin: 0.059,
        tier: "bring-your-own model, plus tokens on your Anthropic key",
        phase: 2,
        untested: true,
      },
    ],
    hint: "Listens with Flux, thinks with a Claude model Deepgram runs, and speaks with Flux Colin (British). Billed by connected minute.",
    privacy:
      "Talk sends your microphone audio and the conversation, which can include code names and the lines the lecturer reads, to Deepgram, which runs Claude (Anthropic) for the replies. WalkMyCode sends mip_opt_out, so Deepgram does not use it to improve its models.",
  },
};

// ── Speech to text (Settings → Voice → "Speech to text") ──
// How a spoken question becomes text where no lecturer listens (Talk through
// Claude, hands-free or held): the browser's own recognition, or a recorded
// clip the local server sends to a vendor on the user's key, or the speech
// model on this computer (Parakeet, src/lib/voice/parakeet: free, private,
// English). Prices are per hour of audio, pay as you go, read on 2026-10-02.

export type SttId = "browser" | "parakeet" | "groq-turbo" | "groq-large" | "deepgram" | "elevenlabs";
/** The transcribers a recorded clip is sent to, on the user's key. */
export type VendorSttId = Exclude<SttId, "browser" | "parakeet">;
export type SttVendor = "groq" | "deepgram" | "elevenlabs";

/** Groq's Whisper models (console.groq.com/docs/speech-to-text, checked 2 Oct 2026). */
export const GROQ_STT_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"] as const;
export type GroqSttModel = (typeof GROQ_STT_MODELS)[number];

export interface SttDef {
  id: SttId;
  label: string;
  /** The vendor the clip goes to; null = the browser, or this computer (Parakeet). */
  vendor: SttVendor | null;
  env: SttKeyEnv | null;
  /** The vendor's model id, sent as-is; null for the browser. */
  model: string | null;
  /** $ per hour of audio. */
  pricePerHour: number;
  /** Shorter clips are billed as this many seconds. */
  minBilledSec?: number;
  url: string | null;
  hint: string;
  privacy: string;
}

const GROQ_PRIVACY = "Your recorded question goes to Groq on your key. Groq keeps no inference data by default (abuse logs up to 30 days; Zero Data Retention in Groq's Data Controls stops even that).";

export const STTS: Record<SttId, SttDef> = {
  browser: {
    id: "browser",
    label: "Browser",
    vendor: null,
    env: null,
    model: null,
    pricePerHour: 0,
    url: null,
    hint: "Free, no key, and the words appear as you speak. Chrome, Edge and Safari have it; Firefox does not.",
    privacy: "Your browser's own speech recognition hears you; Chrome and Edge do it on Google's or Microsoft's servers.",
  },
  parakeet: {
    id: "parakeet",
    label: "On this computer (Parakeet)",
    vendor: null,
    env: null,
    model: "parakeet-tdt-0.6b-v2",
    pricePerHour: 0,
    url: null,
    hint: "Free, private, English, about 630 MB. NVIDIA's Parakeet speech model runs on this computer's processor: no key, no account, and the words appear as you speak.",
    privacy: "Your voice is turned into text on this computer. The audio never leaves it.",
  },
  "groq-turbo": {
    id: "groq-turbo",
    label: "Groq Whisper turbo",
    vendor: "groq",
    env: "GROQ_API_KEY",
    model: "whisper-large-v3-turbo",
    pricePerHour: 0.04,
    minBilledSec: 10,
    url: "https://console.groq.com/keys",
    hint: "Whisper large-v3 turbo on Groq: fast and the cheapest. Each clip is billed as at least 10 seconds.",
    privacy: GROQ_PRIVACY,
  },
  "groq-large": {
    id: "groq-large",
    label: "Groq Whisper large-v3",
    vendor: "groq",
    env: "GROQ_API_KEY",
    model: "whisper-large-v3",
    pricePerHour: 0.111,
    minBilledSec: 10,
    url: "https://console.groq.com/keys",
    hint: "Whisper large-v3 on Groq: the most accurate Whisper, a little slower. Each clip is billed as at least 10 seconds.",
    privacy: GROQ_PRIVACY,
  },
  deepgram: {
    id: "deepgram",
    label: "Deepgram Nova-3",
    vendor: "deepgram",
    env: "DEEPGRAM_API_KEY",
    model: "nova-3",
    pricePerHour: 0.258,
    url: "https://console.deepgram.com",
    hint: "Deepgram's pre-recorded Nova-3 ($0.0043 a minute), with smart formatting.",
    privacy: "Your recorded question goes to Deepgram on your key, sent with mip_opt_out so Deepgram does not use it to improve its models.",
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs Scribe",
    vendor: "elevenlabs",
    env: "ELEVENLABS_API_KEY",
    model: "scribe_v2",
    pricePerHour: 0.22,
    url: "https://elevenlabs.io/app/settings/api-keys",
    hint: "ElevenLabs' Scribe v2 (batch). Your plan's included hours are used first.",
    privacy: "Your recorded question goes to ElevenLabs on your key.",
  },
};

export const STT_IDS = Object.keys(STTS) as SttId[];
/** With the browser chosen but unable to hear: the first of these whose key is set. */
export const STT_FALLBACK: SttId[] = ["groq-turbo", "deepgram", "elevenlabs"];

export function sttFor(id: string): SttDef | undefined {
  return Object.prototype.hasOwnProperty.call(STTS, id) ? STTS[id as SttId] : undefined;
}

/** "$0.04 / hour", or "free". */
export function sttPrice(d: SttDef): string {
  return d.pricePerHour ? `$${trim(d.pricePerHour)} / hour` : "free";
}

/** What POST /api/voice/transcribe is told for a choice: the vendor, and Groq's model. */
export function transcribeTarget(id: VendorSttId): { vendor: SttVendor; model?: GroqSttModel } {
  const d = STTS[id];
  if (d.vendor === "groq") return { vendor: "groq", model: d.model as GroqSttModel };
  return { vendor: d.vendor ?? "deepgram" };
}

export const SPEED = { min: 0.7, max: 1.2, step: 0.05, default: 1 } as const;

export const VOICE_DEFAULT = {
  narrator: "elevenlabs" as NarratorId,
  /** WalkMyCode Lite has no outside network: the browser's voice only. */
  liteNarrator: "browser" as NarratorId,
  lecturer: "elevenagents" as LecturerId,
  speed: SPEED.default as number,
  /** Hands-free: one tap starts a conversation (owner, 2 Oct). Hold to talk is the option for noisy rooms. */
  input: "hands-free" as InputMode,
  /** The browser hears first; when it can't, the first transcriber with a key (STT_FALLBACK). */
  stt: "browser" as SttId,
};

export const NARRATOR_IDS = Object.keys(NARRATORS) as NarratorId[];
export const LECTURER_IDS = Object.keys(LECTURERS) as LecturerId[];

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function narratorFor(id: string): NarratorDef | undefined {
  return own(NARRATORS, id) ? NARRATORS[id as NarratorId] : undefined;
}

export function lecturerFor(id: string): LecturerDef | undefined {
  return own(LECTURERS, id) ? LECTURERS[id as LecturerId] : undefined;
}

export function lecturerModelFor(lecturer: LecturerId, id: string): LecturerModelDef | undefined {
  return LECTURERS[lecturer]?.models.find((m) => m.id === id);
}

/** The models a lecturer offers today (the relay's are listed in the catalogue, not in Settings). */
export function builtModels(lecturer: LecturerId): LecturerModelDef[] {
  return LECTURERS[lecturer].models.filter((m) => m.phase === 1);
}

/** What reading `chars` characters aloud costs, in $. */
export function narrationCost(narrator: NarratorId, chars: number): number {
  return (Math.max(0, chars) / 1000) * (narratorFor(narrator)?.pricePer1k ?? 0);
}

/** What `seconds` of a connected lecture cost, in $ (ElevenAgents: before the model's tokens). */
export function lectureCost(lecturer: LecturerId, model: LecturerModelId, seconds: number): number {
  const m = lecturerModelFor(lecturer, model) ?? LECTURERS[lecturer]?.models[0];
  return ((Math.max(0, seconds) / 60) * (m?.pricePerMin ?? 0));
}

/** "$0.04 / 1K characters", or "free". */
export function narratorPrice(n: NarratorDef): string {
  return n.pricePer1k ? `$${trim(n.pricePer1k)} / 1K characters` : "free";
}

/** "$0.075 / min", "$0.08 / min + the model". */
export function lecturerPrice(m: LecturerModelDef): string {
  return `$${trim(m.pricePerMin)} / min${m.plusModel ? " + the model" : ""}`;
}

const trim = (n: number) => String(Number(n.toFixed(3)));

/** Where audio and text go for this choice: the narrator's sentence, the lecturer's, then speech to text's. */
export function voicePrivacy(narrator: NarratorId, lecturer: LecturerId | null, stt?: SttId): string {
  const parts = [narratorFor(narrator)?.privacy ?? ""];
  if (lecturer) {
    parts.push(LECTURERS[lecturer].privacy);
    parts.push("Questions the lecturer hands to deep_answer go to the model chosen under Language model, as typed questions do.");
  }
  if (stt && stt !== "browser") parts.push(`Speech to text: ${sttFor(stt)?.privacy ?? ""}`);
  return parts.filter(Boolean).join(" ");
}

/** The credit the speech model's licence (CC-BY-4.0) asks for, with where each name links. */
export const PARAKEET_CREDIT = {
  text: "Speech model: NVIDIA Parakeet-TDT 0.6B v2, used under the CC-BY-4.0 licence, run with sherpa-onnx.",
  model: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2",
  licence: "https://creativecommons.org/licenses/by/4.0/",
  engine: "https://github.com/k2-fsa/sherpa-onnx",
} as const;

/** Parakeet hears English only: whether a browser language (navigator.language) is English. Unknown counts as English. */
export function isEnglish(lang: string | null | undefined): boolean {
  return !lang || /^en(?:[-_]|$)/i.test(lang.trim());
}
