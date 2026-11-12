// The lecturer behind one interface (docs/VOICE.md §4): whoever listens and
// answers, ElevenLabs' agent (the default) or Deepgram's, the page sees the
// same session. It connects, takes the microphone held (push-to-talk, the
// default) or open (hands-free), reports what happens as events, and closes.
// Function calls come out as events and their answers go back through
// respond(), so one dispatcher (tools.ts) serves every lecturer.
import type { FriendlyError } from "@/lib/providers/wire";
import type { InputMode, LecturerId } from "../catalogue";

export type { InputMode };

/** Why a session closed. "idle": a minute of quiet (billing is by connected time). */
export type CloseReason = "ended" | "idle" | "left" | "error" | "server";

export type LecturerEvent =
  | { type: "status"; status: "connecting" | "live" | "closed" }
  /** A line of the conversation as text: the user's words, or the lecturer's. */
  | { type: "caption"; role: "user" | "assistant"; text: string }
  /** The lecturer is working out a reply. */
  | { type: "thinking" }
  /** The lecturer's voice started (on) or stopped, ran out or was interrupted (off). */
  | { type: "speaking"; on: boolean }
  /** The service heard the user start (on) or finish (off) speaking. */
  | { type: "listening"; on: boolean }
  /** The microphone is (or is not) being sent: held down, or hands-free and not muted. */
  | { type: "mic"; open: boolean; mode: InputMode }
  /** The microphone's level, 0–1, a few dozen times a second (0 while it is not being sent). */
  | { type: "level"; level: number }
  /** A function to run in the page; answer with respond(id, name, content). */
  | { type: "functionCall"; id: string; name: string; args: Record<string, unknown> }
  /** Calls the service no longer wants (a speculative call overtaken by the user): drop them. */
  | { type: "cancelled"; ids: string[] }
  | { type: "warning"; message: string }
  | { type: "error"; error: FriendlyError; fatal: boolean }
  | { type: "close"; reason: CloseReason; seconds: number };

export type LecturerListener = (e: LecturerEvent) => void;

export interface LecturerSession {
  readonly provider: LecturerId;
  /** Open the session; resolves once the lecturer is listening, rejects with a VoiceError. */
  connect(): Promise<void>;
  setInput(mode: InputMode): void;
  /** Push-to-talk: the button or Space went down / came up. */
  press(): void;
  release(): void;
  /** Hands-free: stop or resume sending the microphone. */
  setMuted(muted: boolean): void;
  /**
   * Headphones on (true): the real microphone goes to the lecturer even while it speaks.
   * Off (the default, speakers): while it speaks the lecturer hears silence, so it never
   * hears itself, and the session cuts it off when the user is clearly louder than its echo.
   */
  setHeadphones?(on: boolean): void;
  /** The answer to a functionCall. Answers to cancelled calls are dropped. */
  respond(id: string, name: string, content: string): void;
  /** A note the lecturer should take into account from now on (the tour step on screen). False when there is no room left. */
  updateContext(note: string): boolean;
  /** Something for the lecturer to say while a slow function runs, if the service supports it. */
  inject(message: string): void;
  on(listener: LecturerListener): () => void;
  close(reason?: CloseReason): void;
}

/** A small event hub the sessions share. */
export class Emitter {
  private listeners = new Set<LecturerListener>();
  on(l: LecturerListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  emit(e: LecturerEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        // A listener's failure is its own.
      }
    }
  }
}

/** Idle sessions cost money: close after this long with nothing said by anyone. */
export const IDLE_CLOSE_MS = 60_000;
