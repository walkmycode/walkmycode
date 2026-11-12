// The voice choice (docs/VOICE.md §3): which narrator reads aloud, in which
// voice and at what speed, and which lecturer listens. It lives in
// .walkmycode/config.json under "voice", next to the model choice, which a save
// here never touches (and a save there never touches this). Readiness says
// what is missing (a key) before anything is spent. Keys stay in keys.ts.
import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configPath } from "@/lib/providers/config";
import { HttpError } from "@/lib/providers/guard";
import { envStatus, keyForEnv, type EnvStanding } from "@/lib/providers/keys";
import type { FriendlyError } from "@/lib/providers/wire";
import {
  builtModels,
  lecturerFor,
  lecturerModelFor,
  LECTURERS,
  NARRATORS,
  narratorFor,
  SPEED,
  STT_KEY_ENVS,
  sttFor,
  VOICE_DEFAULT,
  type LecturerId,
  type InputMode,
  type LecturerModelId,
  type NarratorId,
  type SttId,
  type SttKeyEnv,
  type VoiceKeyEnv,
} from "./catalogue";
import { voiceFriendly, type VoiceVendor } from "./errors";

/** The agent WalkMyCode made in the user's ElevenLabs account, and what it was last given. */
export interface ElevenAgentRecord {
  /** Absent while only the tools exist (the agent is made right after them). */
  agent_id?: string;
  /** Tool name → the id ElevenLabs gave it. */
  tool_ids: Record<string, string>;
  /** Which version of WalkMyCode's tool list the tools were made from. */
  tools_version: string;
  /** Hash of the prompt last written to the agent (when per-session overrides are off). */
  prompt_hash?: string;
  voice_id?: string;
}

export interface VoiceSaved {
  narrator?: NarratorId;
  voiceId?: string;
  speed?: number;
  lecturer?: LecturerId;
  lecturerModel?: LecturerModelId;
  /** How Talk listens: hands-free (the default) or hold to talk (noisy rooms). */
  input?: InputMode;
  /** The user wears headphones: the real microphone goes to the lecturer even while it speaks (the best barge-in). */
  headphones?: boolean;
  /** How a spoken question becomes text where no lecturer listens (Settings → Voice → Speech to text). */
  stt?: SttId;
  /** What speech to text was before "On this computer" was picked: used where Parakeet can't hear (another language, the model not there). */
  sttBefore?: SttId;
  elevenagents?: ElevenAgentRecord;
}

/** The choice in force, every field filled. `voiceId` null = found at run time (ElevenLabs, the browser). */
export interface VoiceChoice {
  narrator: NarratorId;
  voiceId: string | null;
  speed: number;
  lecturer: LecturerId;
  lecturerModel: LecturerModelId;
  input: InputMode;
  headphones: boolean;
  stt: SttId;
  /** The choice Parakeet falls back to. Never "parakeet". */
  sttBefore: SttId;
}

export interface VoiceReadiness {
  narrator: FriendlyError | null;
  lecturer: FriendlyError | null;
}

const PRINTABLE = /^[^\u0000-\u001f\u007f]{1,200}$/;
const ELEVEN_ID = /^[A-Za-z0-9]{8,64}$/;

/** The whole config.json object (the model choice and the voice block), or {} when missing or unreadable. */
function readAll(): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Temp file + rename, as the model choice is saved. */
function writeAll(cfg: Record<string, unknown>): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** The saved voice block as-is, or {} when there is none. */
export function loadVoice(): VoiceSaved {
  const v = readAll().voice;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as VoiceSaved) : {};
}

/** Whether a voice id can belong to a narrator (fixed list, ElevenLabs' id shape, a browser voice name). */
export function voiceFits(narrator: NarratorId, id: string): boolean {
  const def = NARRATORS[narrator];
  if (def.voices.length) return def.voices.some((v) => v.id === id);
  return narrator === "elevenlabs" ? ELEVEN_ID.test(id) : PRINTABLE.test(id);
}

/**
 * Check a patch the way POST /api/voice/config does. Throws HttpError(400);
 * returns the cleaned patch. A voice is checked against the narrator the
 * patch sets, else the saved one. `voiceId: ""` means "back to the default".
 */
export function validateVoice(patch: VoiceSaved, current: VoiceSaved = loadVoice()): VoiceSaved {
  const out: VoiceSaved = {};
  if (patch.narrator !== undefined) {
    const n = narratorFor(String(patch.narrator));
    if (!n) throw new HttpError(400, `Unknown narrator: ${String(patch.narrator)}`);
    out.narrator = n.id;
  }
  const narrator = out.narrator ?? narratorFor(current.narrator ?? "")?.id ?? VOICE_DEFAULT.narrator;
  if (patch.voiceId !== undefined) {
    const id = String(patch.voiceId).trim();
    if (id && !voiceFits(narrator, id)) throw new HttpError(400, `Unknown voice for ${NARRATORS[narrator].label}: ${id.slice(0, 80)}`);
    out.voiceId = id;
  }
  if (patch.speed !== undefined) {
    const s = Number(patch.speed);
    if (!Number.isFinite(s) || s < SPEED.min || s > SPEED.max) throw new HttpError(400, `Speed must be between ${SPEED.min} and ${SPEED.max}.`);
    out.speed = Math.round(s * 100) / 100;
  }
  if (patch.lecturer !== undefined) {
    const l = lecturerFor(String(patch.lecturer));
    if (!l) throw new HttpError(400, `Unknown lecturer: ${String(patch.lecturer)}`);
    out.lecturer = l.id;
  }
  if (patch.lecturerModel !== undefined) {
    const lecturer = out.lecturer ?? lecturerFor(current.lecturer ?? "")?.id ?? VOICE_DEFAULT.lecturer;
    const m = lecturerModelFor(lecturer, String(patch.lecturerModel));
    if (!m) throw new HttpError(400, `Unknown model for ${LECTURERS[lecturer].label}: ${String(patch.lecturerModel)}`);
    if (m.phase !== 1) throw new HttpError(400, `${m.label} needs the voice relay, which is not built yet. Pick ${builtModels(lecturer).map((x) => x.label).join(" or ")}.`);
    out.lecturerModel = m.id;
  }
  if (patch.input !== undefined) {
    if (patch.input !== "hands-free" && patch.input !== "push-to-talk") throw new HttpError(400, `Talk listens hands-free or push-to-talk, not ${String(patch.input).slice(0, 40)}.`);
    out.input = patch.input;
  }
  if (patch.headphones !== undefined) out.headphones = patch.headphones === true;
  if (patch.stt !== undefined) {
    const d = sttFor(String(patch.stt));
    if (!d) throw new HttpError(400, `Unknown speech to text: ${String(patch.stt).slice(0, 40)}`);
    out.stt = d.id;
  }
  return out;
}

/**
 * Merge a patch into the voice block and save, keeping the rest of
 * config.json. Another narrator's voice means nothing to this one, so a
 * change of narrator without a voice drops the saved voice; a change of
 * lecturer without a model drops the saved model.
 */
export function saveVoice(patch: VoiceSaved): VoiceSaved {
  const all = readAll();
  const current = loadVoice();
  const clean = validateVoice(patch, current);
  const next: VoiceSaved = { ...current, ...clean };
  if (clean.narrator && clean.narrator !== (current.narrator ?? VOICE_DEFAULT.narrator) && clean.voiceId === undefined) delete next.voiceId;
  if (clean.lecturer && clean.lecturer !== (current.lecturer ?? VOICE_DEFAULT.lecturer) && clean.lecturerModel === undefined) delete next.lecturerModel;
  if (next.voiceId === "") delete next.voiceId;
  // Picking "On this computer" remembers what was chosen before, for where it can't hear.
  const was = sttFor(current.stt ?? "")?.id ?? VOICE_DEFAULT.stt;
  if (clean.stt === "parakeet" && was !== "parakeet") next.sttBefore = was;
  writeAll({ ...all, voice: next });
  return next;
}

/** Keep what WalkMyCode knows about the agent it made in the user's ElevenLabs account (or forget it). */
export function saveAgentRecord(rec: ElevenAgentRecord | null): void {
  const all = readAll();
  const voice: VoiceSaved = { ...loadVoice() };
  if (rec) voice.elevenagents = rec;
  else delete voice.elevenagents;
  writeAll({ ...all, voice });
}

const clampSpeed = (s: unknown): number => {
  const n = Number(s);
  return Number.isFinite(n) && n >= SPEED.min && n <= SPEED.max ? n : VOICE_DEFAULT.speed;
};

/** The choice in force: what is saved where it still makes sense, else the defaults. */
export function resolveVoice(saved: VoiceSaved = loadVoice()): VoiceChoice {
  const narrator = narratorFor(saved.narrator ?? "")?.id ?? VOICE_DEFAULT.narrator;
  const lecturer = lecturerFor(saved.lecturer ?? "")?.id ?? VOICE_DEFAULT.lecturer;
  const model = lecturerModelFor(lecturer, saved.lecturerModel ?? "");
  const lecturerModel = model && model.phase === 1 ? model.id : LECTURERS[lecturer].defaultModel;
  const voiceId = typeof saved.voiceId === "string" && saved.voiceId && voiceFits(narrator, saved.voiceId) ? saved.voiceId : NARRATORS[narrator].defaultVoice;
  const input: InputMode = saved.input === "push-to-talk" || saved.input === "hands-free" ? saved.input : VOICE_DEFAULT.input;
  const stt = sttFor(saved.stt ?? "")?.id ?? VOICE_DEFAULT.stt;
  const before = sttFor(saved.sttBefore ?? "")?.id;
  const sttBefore = before && before !== "parakeet" ? before : VOICE_DEFAULT.stt;
  return { narrator, voiceId, speed: clampSpeed(saved.speed), lecturer, lecturerModel, input, headphones: saved.headphones === true, stt, sttBefore };
}

const vendorOf = (env: VoiceKeyEnv): VoiceVendor => (env === "ELEVENLABS_API_KEY" ? "elevenlabs" : "deepgram");

/** null when the chosen narrator and lecturer can run, else what is missing. */
export function voiceReadiness(c: VoiceChoice = resolveVoice()): VoiceReadiness {
  const n = NARRATORS[c.narrator];
  const l = LECTURERS[c.lecturer];
  return {
    narrator: n.env && !keyForEnv(n.env) ? voiceFriendly("missing_key", vendorOf(n.env), { feature: "narrator" }) : null,
    lecturer: !keyForEnv(l.env) ? voiceFriendly("missing_key", vendorOf(l.env), { feature: "lecturer" }) : null,
  };
}

/** Whether each voice key (and the Groq key, for speech to text) is set, and where it came from. Values never leave keys.ts. */
export function voiceKeys(): Record<SttKeyEnv, EnvStanding> {
  const out = {} as Record<SttKeyEnv, EnvStanding>;
  for (const env of STT_KEY_ENVS) out[env] = envStatus(env);
  return out;
}
