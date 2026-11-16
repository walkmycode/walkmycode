// One way in for the page: the lecturer chosen in Settings → Voice, as a
// LecturerSession. The UI never knows which one it talks to.
import { addLecture } from "@/lib/cost";
import { withLesson, type AgentSettings } from "../agentSettings";
import type { LecturerId, LecturerModelId } from "../catalogue";
import { browserAudio } from "./audio";
import { DeepgramLecturer, type WebSocketCtor } from "./deepgram/session";
import { ElevenAgentsLecturer } from "./elevenagents";
import type { InputMode, LecturerSession } from "./session";

export interface LecturerOptions {
  lecturer: LecturerId;
  model: LecturerModelId;
  input: InputMode;
  /** Headphones on: no echo guard (Settings → Voice). */
  headphones?: boolean;
  /** Made in the click that started Talk, so the browser lets it play (Deepgram's speaker and microphone). */
  audioContext: () => AudioContext;
  context: () => { mapSummary: string; keyterms: string[] };
  /** The Learn room's professor (Deepgram only): his Settings, with the lesson instead of the map. */
  lesson?: () => { lesson: string; keyterms: string[] };
}

export function createLecturer(o: LecturerOptions): LecturerSession {
  // Billing is by connected minute: the meter counts them when the session closes.
  const onClosed = (seconds: number) => addLecture(o.lecturer, o.model, seconds);
  if (o.lecturer === "deepgram-agent") {
    const lesson = o.lesson;
    return new DeepgramLecturer({
      ...(lesson ? { settingsPath: "/api/voice/settings?room=learn", prepare: (s: AgentSettings) => withLesson(s, lesson()) } : {}),
      fetch: (...a) => fetch(...a),
      WebSocket: WebSocket as unknown as WebSocketCtor,
      audio: () => browserAudio(o.audioContext()),
      context: o.context,
      input: o.input,
      headphones: o.headphones,
      onClosed,
    });
  }
  return new ElevenAgentsLecturer({ fetch: (...a) => fetch(...a), context: o.context, input: o.input, headphones: o.headphones, onClosed });
}

export type { LecturerEvent, LecturerSession, InputMode, CloseReason } from "./session";
