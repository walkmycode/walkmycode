// The on-device recognizer (docs/VOICE.md §4d): sherpa-onnx-node's
// OfflineRecognizer running Parakeet-TDT as a NeMo transducer, on the CPU.
// Loaded lazily and once per server process (about 3 s; kept on globalThis so
// a dev reload does not load a second 630 MB model), and decodes are run one
// at a time. sherpa-onnx-node is a native module: it is loaded at run time
// from node_modules, never bundled (next.config.ts, mcp/build.mjs), and a
// build without it says so instead of failing.
import "server-only";
import { cpus } from "node:os";
import { join } from "node:path";
import { findModel, type ModelSource } from "./model";

export type EngineState = "cold" | "loading" | "ready" | "failed";

export interface EngineStatus {
  state: EngineState;
  /** How long the model took to load, once it has. */
  loadMs: number | null;
  threads: number;
  /** Why it could not load, in words for the user. */
  error: string | null;
}

interface Loaded {
  dir: string;
  source: ModelSource;
  decode(samples: Float32Array): Promise<string>;
}

interface Global {
  state: EngineState;
  loading: Promise<Loaded> | null;
  loadMs: number | null;
  error: string | null;
  /** The tail of the decode queue. */
  lock: Promise<unknown>;
}

const KEY = Symbol.for("walkmycode.parakeet");

function g(): Global {
  const all = globalThis as unknown as Record<symbol, Global | undefined>;
  all[KEY] ??= { state: "cold", loading: null, loadMs: null, error: null, lock: Promise.resolve() };
  return all[KEY]!;
}

/** Threads for the recognizer: most of a small machine, never more than 4, always one core left. */
export function threadCount(cores: number = cpus().length): number {
  return Math.max(1, Math.min(4, cores - 1));
}

export function engineStatus(): EngineStatus {
  const s = g();
  return { state: s.state, loadMs: s.loadMs, threads: threadCount(), error: s.error };
}

/** Whether the recognizer's package can be found by this server (it is absent from the packaged MCP server). */
export async function engineAvailable(): Promise<boolean> {
  try {
    await import("sherpa-onnx-node");
    return true;
  } catch {
    return false;
  }
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

async function load(): Promise<Loaded> {
  const found = findModel();
  if (!found) throw new EngineError("The speech model isn't on this computer yet. Get it under Settings → Voice → Speech to text.");
  let sherpa: typeof import("sherpa-onnx-node");
  try {
    const m = await import("sherpa-onnx-node");
    sherpa = (m as unknown as { default?: typeof import("sherpa-onnx-node") }).default ?? m;
  } catch (e) {
    throw new EngineError(`On-device speech to text isn't part of this build of WalkMyCode (${(e as Error).message.split("\n")[0]}).`);
  }
  const t = Date.now();
  const { dir } = found;
  let rec: import("sherpa-onnx-node").OfflineRecognizer;
  try {
    rec = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: join(dir, "encoder.int8.onnx"), decoder: join(dir, "decoder.int8.onnx"), joiner: join(dir, "joiner.int8.onnx") },
        tokens: join(dir, "tokens.txt"),
        numThreads: threadCount(),
        provider: "cpu",
        debug: 0,
        modelType: "nemo_transducer",
      },
    });
  } catch (e) {
    throw new EngineError(`The speech model couldn't be loaded (${(e as Error).message.split("\n")[0]}).`);
  }
  g().loadMs = Date.now() - t;
  return {
    ...found,
    async decode(samples) {
      const stream = rec.createStream();
      stream.acceptWaveform({ samples, sampleRate: 16000 });
      const r = await rec.decodeAsync(stream);
      return typeof r?.text === "string" ? r.text.trim() : "";
    },
  };
}

/** Load the model now if it is not loaded (a mic panel opened): resolves when it is ready. */
export function preload(): Promise<void> {
  const s = g();
  if (!s.loading) {
    s.state = "loading";
    s.error = null;
    s.loading = load().then(
      (l) => {
        s.state = "ready";
        return l;
      },
      (e: Error) => {
        s.state = "failed";
        s.error = e instanceof EngineError ? e.message : "The speech model couldn't be loaded.";
        s.loading = null; // a later try may work (the model was installed since)
        throw e;
      },
    );
  }
  return s.loading.then(() => {});
}

/** 16 kHz mono float32 to text. Loads the model on first use; one decode at a time, in the order asked. */
export function decode(samples: Float32Array): Promise<string> {
  const s = g();
  const run = s.lock.then(async () => {
    await preload();
    return (await s.loading!).decode(samples);
  });
  s.lock = run.catch(() => {});
  return run;
}

/** Forget the loaded model (it was removed from disk). The native memory goes when it is collected. */
export function unload(): void {
  const s = g();
  s.loading = null;
  s.state = "cold";
  s.loadMs = null;
  s.error = null;
}
