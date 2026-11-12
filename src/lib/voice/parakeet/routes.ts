// On-device speech to text's endpoints (docs/VOICE.md §4d), as Request →
// Response bodies both servers mount (the app's /api/voice/parakeet routes
// and the MCP page's server), each behind guarded(): this computer and
// WalkMyCode's own page only. A hosted WalkMyCode refuses all of it: the
// microphone's audio would otherwise go to someone else's computer.
//
//  GET  /api/voice/parakeet          where the model stands (installed? downloading?) and the engine
//  POST /api/voice/parakeet          { action: "install" | "cancel" | "remove" | "preload" }
//  POST /api/voice/parakeet/stream   the microphone, in pieces: { session, pcm_base64?, flush?, reset?, close? }
//                                    → { events } (speech, partial, decoding, final, discard, notice, error)
//
// The stream is a run of small JSON posts (about five a second, sent one
// after another by the page), not a socket: every piece passes the same guard
// as any other local route, and the words heard since the last piece come
// back in its answer. Audio is 16 kHz mono 16-bit PCM on the wire and float32
// from here on; none of it is written to disk or sent anywhere.
import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/providers/guard";
import { int16ToFloat32 } from "./detect";
import { decode, engineAvailable, engineStatus, preload, unload } from "./engine";
import { findModel, installModel, InstallError, MODEL, modelDirs, removeOwnModel, type InstallProgress } from "./model";
import { SttSession, type SttEvent } from "./session";
import type { ParakeetStatus } from "./status";

const NO_STORE = { "cache-control": "no-store" };

export const HOSTED_STT_REFUSAL = "On-device speech to text runs on your own computer: this hosted WalkMyCode can't offer it.";

/** Why this server must not hear a microphone (hosted mode), or null. */
export function hostedSttRefusal(env: Record<string, string | undefined> = process.env): string | null {
  return (env.WALKMYCODE_MODE ?? env.LANTERN_MODE)?.trim().toLowerCase() === "hosted" ? HOSTED_STT_REFUSAL : null;
}

interface Live {
  session: SttSession;
  seen: number;
}

interface Global {
  install: InstallProgress;
  abort: AbortController | null;
  sessions: Map<string, Live>;
  available: boolean | null;
}

const KEY = Symbol.for("walkmycode.parakeet.routes");

function g(): Global {
  const all = globalThis as unknown as Record<symbol, Global | undefined>;
  all[KEY] ??= { install: { phase: "idle", received: 0, total: MODEL.bytes, error: null }, abort: null, sessions: new Map(), available: null };
  return all[KEY]!;
}

/** Where the model and the engine stand. Cheap: a few stat calls. */
export async function parakeetStatus(): Promise<ParakeetStatus> {
  const s = g();
  const refusal = hostedSttRefusal();
  s.available ??= await engineAvailable();
  const found = findModel();
  const dirs = modelDirs();
  const own = findModel({ own: dirs.own, ireliabee: "" });
  const busy = s.install.phase === "downloading" || s.install.phase === "verifying" || s.install.phase === "unpacking";
  return {
    state: busy ? "installing" : found ? "installed" : "missing",
    source: found?.source ?? null,
    removable: !!own,
    install: { ...s.install },
    engine: engineStatus(),
    available: s.available,
    refusal: refusal ?? (s.available ? null : "On-device speech to text isn't part of this build of WalkMyCode: run WalkMyCode from its folder (npm install) to use it."),
    bytes: MODEL.unpackedBytes,
  };
}

export function statusHandler() {
  return async (): Promise<Response> => Response.json(await parakeetStatus(), { headers: NO_STORE });
}

const ActionBody = z.object({ action: z.enum(["install", "cancel", "remove", "preload"]) });

export interface ActionDeps {
  /** Tests stand in for the download. */
  install?: typeof installModel;
  preload?: typeof preload;
}

export function actionHandler(deps: ActionDeps = {}) {
  return async (req: Request): Promise<Response> => {
    const parsed = ActionBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "action: install, cancel, remove or preload.");
    const refusal = hostedSttRefusal();
    if (refusal) throw new HttpError(403, refusal);
    const s = g();
    const busy = s.install.phase === "downloading" || s.install.phase === "verifying" || s.install.phase === "unpacking";
    switch (parsed.data.action) {
      case "install": {
        if (busy || findModel()) break;
        const abort = new AbortController();
        s.abort = abort;
        s.install = { phase: "downloading", received: 0, total: MODEL.bytes, error: null };
        void (deps.install ?? installModel)({ signal: abort.signal, onProgress: (p) => (s.install = p) }).then(
          () => {
            s.install = { phase: "idle", received: 0, total: MODEL.bytes, error: null };
            s.abort = null;
          },
          (e: Error) => {
            const cancelled = abort.signal.aborted;
            s.install = { phase: cancelled ? "idle" : "failed", received: 0, total: MODEL.bytes, error: cancelled ? null : e instanceof InstallError ? e.message : "The speech model couldn't be set up. Try again." };
            s.abort = null;
          },
        );
        break;
      }
      case "cancel":
        s.abort?.abort();
        break;
      case "remove": {
        if (busy) throw new HttpError(409, "The speech model is still being set up: cancel that first.");
        try {
          removeOwnModel();
        } catch (e) {
          throw new HttpError(409, e instanceof InstallError ? e.message : "The speech model couldn't be removed.");
        }
        // The loaded model may be the copy just removed: the next talk loads whichever is left.
        if (!findModel() || engineStatus().state !== "cold") unload();
        s.sessions.clear();
        break;
      }
      case "preload":
        // A mic panel opened: have the model in memory before the first word. Never an error here; the status says why not.
        if (findModel()) void (deps.preload ?? preload)().catch(() => {});
        break;
    }
    return Response.json(await parakeetStatus(), { headers: NO_STORE });
  };
}

/** One piece: at most 10 s of 16 kHz 16-bit audio (the page sends about 0.2 s at a time). */
export const MAX_PIECE_BYTES = 10 * 16000 * 2;
/** A session nobody has fed for this long is forgotten. */
const IDLE_MS = 2 * 60_000;
const MAX_SESSIONS = 8;

const StreamBody = z.object({
  session: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  pcm_base64: z.string().max(Math.ceil((MAX_PIECE_BYTES * 4) / 3) + 8).optional(),
  /** Stop, or push-to-talk let go: decode what is left before answering. */
  flush: z.boolean().optional(),
  /** Forget what is being heard. */
  reset: z.boolean().optional(),
  /** The talk is over. */
  close: z.boolean().optional(),
});

export interface StreamDeps {
  /** Tests stand in for the engine. */
  decode?: (samples: Float32Array) => Promise<string>;
  now?: () => number;
  /** Tests: whether the model is there. */
  installed?: () => boolean;
}

export function streamHandler(deps: StreamDeps = {}) {
  return async (req: Request): Promise<Response> => {
    const parsed = StreamBody.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "A piece of the microphone needs a session id and 16 kHz 16-bit audio as base64.");
    const refusal = hostedSttRefusal();
    if (refusal) throw new HttpError(403, refusal);
    const b = parsed.data;
    const s = g();
    const now = (deps.now ?? Date.now)();
    for (const [id, live] of s.sessions) if (now - live.seen > IDLE_MS) s.sessions.delete(id);
    if (b.close) {
      s.sessions.delete(b.session);
      return Response.json({ events: [] }, { headers: NO_STORE });
    }
    if (!(deps.installed ?? (() => !!findModel()))()) throw new HttpError(409, "The speech model isn't on this computer yet. Get it under Settings → Voice → Speech to text.");
    let live = s.sessions.get(b.session);
    if (!live) {
      if (s.sessions.size >= MAX_SESSIONS) throw new HttpError(429, "Too many pages are listening at once. Close one and try again.");
      live = { session: new SttSession({ decode: deps.decode ?? decode, now: deps.now }), seen: now };
      s.sessions.set(b.session, live);
    }
    live.seen = now;
    if (b.reset) live.session.reset();
    if (b.pcm_base64) {
      const bytes = new Uint8Array(Buffer.from(b.pcm_base64, "base64"));
      if (bytes.length > MAX_PIECE_BYTES) throw new HttpError(413, "That piece of audio is too long.");
      live.session.push(int16ToFloat32(bytes));
    }
    if (b.flush) await live.session.flush();
    const events: SttEvent[] = live.session.take();
    return Response.json({ events }, { headers: NO_STORE });
  };
}

/** Tests: forget every session and any install in progress. */
export function resetParakeetRoutes(): void {
  const s = g();
  s.abort?.abort();
  s.abort = null;
  s.install = { phase: "idle", received: 0, total: MODEL.bytes, error: null };
  s.sessions.clear();
  s.available = null;
}
