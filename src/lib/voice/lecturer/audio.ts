"use client";
// Sound in and out for the Deepgram lecturer: the microphone (echo
// cancellation and noise suppression on) through the lantern-mic worklet as
// 16 kHz linear16 frames, and the agent's 24 kHz linear16 through the
// lantern-player worklet's queue, which a barge-in flushes at once.
import type { FriendlyError } from "@/lib/providers/wire";
import { MIC_PROCESSOR, PLAYER_PROCESSOR, WORKLET_SOURCE } from "./worklets";

export interface AudioIO {
  /** Ask for the microphone and start sending 16 kHz linear16 frames to `onFrame`. */
  startMic(onFrame: (frame: ArrayBuffer) => void): Promise<void>;
  /** Queue 24 kHz linear16 audio from the agent. The buffer is handed over. */
  play(pcm: ArrayBuffer): void;
  /** Stop playback now and drop everything queued. */
  flush(): void;
  /** Called whenever the queue runs dry after playing. */
  onDrained(cb: () => void): void;
  close(): Promise<void>;
}

/** Thrown when the microphone cannot be had, with what to tell the user. */
export class MicError extends Error {
  constructor(readonly info: FriendlyError) {
    super(info.message);
    this.name = "MicError";
  }
}

export function micError(e: unknown): FriendlyError {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return { code: "unknown", title: "WalkMyCode can't hear you", message: "The microphone is blocked for this page. Allow it (the icon at the left of the address bar), then press Talk again.", action: null };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { code: "unknown", title: "No microphone found", message: "Plug one in or pick one in your system's sound settings, then press Talk again.", action: null };
  if (name === "NotReadableError") return { code: "unknown", title: "The microphone is busy", message: "Another app is using it. Close that app's call or recording, then press Talk again.", action: null };
  return { code: "unknown", title: "The microphone did not start", message: "Press Talk again; if it keeps failing, reload the page.", action: "retry" };
}

export const INSECURE: FriendlyError = {
  code: "unknown",
  title: "The microphone needs a secure page",
  message: "Browsers only give the microphone to https pages and localhost. Open WalkMyCode at http://localhost:3000.",
  action: null,
};

/** The browser's AudioIO, on an AudioContext made in the click that started Talk. */
export async function browserAudio(ctx: AudioContext): Promise<AudioIO> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new MicError(INSECURE);
  await ctx.resume().catch(() => {});
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const player = new AudioWorkletNode(ctx, PLAYER_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  player.connect(ctx.destination);
  let drained: () => void = () => {};
  player.port.onmessage = (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === "drained") drained();
  };
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let mic: AudioWorkletNode | null = null;
  let sink: GainNode | null = null;
  return {
    async startMic(onFrame) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      } catch (e) {
        throw new MicError(micError(e));
      }
      // Talk ended while the browser was asking: give the microphone straight back.
      if (ctx.state === "closed") {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      source = ctx.createMediaStreamSource(stream);
      mic = new AudioWorkletNode(ctx, MIC_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      mic.port.onmessage = (e: MessageEvent<unknown>) => {
        if (e.data instanceof ArrayBuffer) onFrame(e.data);
      };
      // Pulled by the graph through a silent gain, so the worklet runs everywhere and nothing is heard.
      sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(mic);
      mic.connect(sink);
      sink.connect(ctx.destination);
    },
    play(pcm) {
      player.port.postMessage({ type: "pcm", data: pcm }, [pcm]);
    },
    flush() {
      player.port.postMessage({ type: "flush" });
    },
    onDrained(cb) {
      drained = cb;
    },
    async close() {
      for (const t of stream?.getTracks() ?? []) t.stop();
      source?.disconnect();
      mic?.disconnect();
      sink?.disconnect();
      player.disconnect();
      await ctx.close().catch(() => {});
    },
  };
}
