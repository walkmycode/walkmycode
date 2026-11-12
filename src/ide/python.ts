/**
 * Two places code can run:
 *  - "page": MicroPython in a background worker (public/py/runner.mjs).
 *    Plain Python plus ulab (a small numpy); works wherever the page opens.
 *  - "laptop": real Python on the student's laptop, through the local
 *    connector (laptop-python/server.py, reached as host:lecture-hall-python).
 *    Full numpy, pandas, scipy, scikit-learn and matplotlib; only inside the
 *    Claude desktop app on that laptop.
 */
import { getMcp, type McpError } from "@/learn/lib/claude";

export type Engine = "page" | "laptop";
export type OutPart =
  | { kind: "out" | "err" | "error" | "value" | "meta"; text: string }
  | { kind: "image"; data: string }
  | { kind: "table"; columns: string[]; rows: string[][] };
type Listener = { onPart: (p: OutPart) => void; onStatus: (s: string) => void; done: () => void; onDebug?: (d: DebugRun) => void };

/** One recorded moment of a debug run (see public/py/debugger.py). */
export type DebugStep = {
  event: "line" | "return";
  line: number;
  stack: string[];
  /** name -> [repr, type]; null where local variables cannot be seen (the page's MicroPython). */
  locals: Record<string, [string, string]> | null;
  globals: Record<string, [string, string]>;
  /** How much of the output had been printed by this step. */
  out: number;
  ret: string | null;
};
export type DebugRun = { steps: DebugStep[]; output: string; error: string | null; truncated: boolean; maxSteps: number };

export const LAPTOP = "host:lecture-hall-python";

/* ── MicroPython in the page ── */
let worker: Worker | null = null;
let current: Listener | null = null;
let seq = 0;

function startWorker() {
  // In the artifact the files sit beside the page (its path is not the site
  // root); in the WalkMyCode app they are served from /py/.
  const inArtifact = "claude" in window;
  const w = new Worker(inArtifact ? new URL("./py/runner.mjs", document.baseURI) : new URL("/py/runner.mjs", location.origin), { type: "module" });
  w.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; text?: string };
    const l = current;
    if (!l) return;
    if (m.type === "status") l.onStatus(m.text ?? "");
    else if (m.type === "debug") l.onDebug?.((m as unknown as { data: DebugRun }).data);
    else if (m.type === "done") {
      current = null;
      l.done();
    } else l.onPart({ kind: m.type as "out", text: m.text ?? "" });
  };
  w.onerror = (e) => {
    const l = current;
    current = null;
    worker = null;
    l?.onPart({ kind: "error", text: `Python could not start: ${e.message || "the runner failed to load."}` });
    l?.done();
  };
  return w;
}

/* ── Real Python on the laptop ── */
let laptopRun: AbortController | null = null;

type LaptopResult = { stdout?: string; stderr?: string; error?: string | null; value?: string | null; images?: string[] };

function laptopMessage(e: unknown, what = "Python") {
  const code = (e as McpError)?.code;
  if (code === "server_not_connected" || code === "server_not_found")
    return what === "Python"
      ? "Your laptop's Python is not reachable. Open this page in the Claude desktop app on your laptop, with the laptop connector set up, or switch to “This page”."
      : `${what} runs on your laptop, which is not reachable. Open this page in the Claude desktop app on your laptop, with the laptop connector set up.`;
  if (code === "cancelled") return "The run was cancelled.";
  if (code === "not_in_manifest") return "Running code on your laptop is turned off for this page. Allow it in the page's connector settings, or switch to “This page”.";
  if (code === "tool_error") return `Your laptop's Python reported a problem: ${(e as McpError).message}`;
  return "Your laptop's Python could not be reached. Try again, or switch to “This page”.";
}

async function runOnLaptop(code: string, l: Listener, tool = "run_python") {
  const mcp = await getMcp();
  const what = tool === "run_rust" ? "Rust" : "Python";
  if (!mcp) {
    l.onPart({ kind: "error", text: laptopMessage({ code: "server_not_connected" }, what) });
    return l.done();
  }
  laptopRun = new AbortController();
  l.onStatus(tool === "run_rust" ? "Compiling and running on your laptop…" : "Running on your laptop…");
  try {
    const res = await mcp.callTool(LAPTOP, tool, { code }, { signal: laptopRun.signal, cache: false });
    const raw = res.payload as LaptopResult | string | undefined;
    let out: LaptopResult = {};
    if (typeof raw === "string") {
      try {
        out = JSON.parse(raw) as LaptopResult;
      } catch {
        out = { stdout: raw };
      }
    } else if (raw) out = raw;
    if (out.stdout) l.onPart({ kind: "out", text: out.stdout });
    if (out.stderr) l.onPart({ kind: "err", text: out.stderr });
    if (out.value) l.onPart({ kind: "value", text: out.value });
    if (out.error) l.onPart({ kind: "error", text: out.error });
    for (const img of out.images ?? []) l.onPart({ kind: "image", data: img });
  } catch (e) {
    l.onPart({ kind: "error", text: laptopMessage(e, what) });
  } finally {
    laptopRun = null;
    l.onStatus("");
    l.done();
  }
}

/** Whether the laptop connector answers from this view (never asks the viewer). */
export async function laptopAvailable(): Promise<boolean> {
  const mcp = await getMcp();
  if (!mcp) return false;
  try {
    const { servers } = await mcp.listTools(LAPTOP);
    return servers.some((s) => s.server === LAPTOP && s.tools.length > 0);
  } catch {
    return false;
  }
}

async function debugOnLaptop(code: string, l: Listener) {
  const mcp = await getMcp();
  if (!mcp) {
    l.onPart({ kind: "error", text: laptopMessage({ code: "server_not_connected" }) });
    return l.done();
  }
  laptopRun = new AbortController();
  l.onStatus("Recording the run on your laptop…");
  try {
    const res = await mcp.callTool(LAPTOP, "debug_python", { code }, { signal: laptopRun.signal, cache: false });
    const raw = res.payload;
    const run = (typeof raw === "string" ? JSON.parse(raw) : raw) as DebugRun;
    if (!run || !Array.isArray(run.steps)) throw { code: "tool_error", message: "the debugger's answer could not be read" };
    l.onDebug?.(run);
  } catch (e) {
    l.onPart({ kind: "error", text: laptopMessage(e) });
  } finally {
    laptopRun = null;
    l.onStatus("");
    l.done();
  }
}

/** Run the code once under the debugger, recording every step. */
export function debugPython(code: string, l: Listener, engine: Engine) {
  if (engine === "laptop") return void debugOnLaptop(code, l);
  worker ??= startWorker();
  current = l;
  worker.postMessage({ id: ++seq, code, mode: "debug", maxSteps: 2000 });
}

/** Stop a laptop run (Rust) without touching Python's variables. */
export function abortLaptop() {
  laptopRun?.abort();
}

/** Rust runs only on the laptop, compiled by its own rustc (run_rust). */
export function runRust(code: string, l: Listener) {
  void runOnLaptop(code, l, "run_rust");
}

/* ── Shared ── */
export function runPython(code: string, l: Listener, engine: Engine) {
  if (engine === "laptop") return void runOnLaptop(code, l);
  worker ??= startWorker();
  current = l;
  worker.postMessage({ id: ++seq, code });
}

/** Stop a run that is taking too long. Variables from earlier runs are lost. */
export function stopPython(engine: Engine) {
  if (engine === "laptop") {
    laptopRun?.abort();
    void restartPython("laptop");
    return;
  }
  worker?.terminate();
  worker = null;
  const l = current;
  current = null;
  l?.onPart({ kind: "err", text: "Stopped. Python will start afresh on the next run.\n" });
  l?.done();
}

/** Forget every variable: the next run starts a clean Python. */
export async function restartPython(engine: Engine) {
  if (engine === "laptop") {
    const mcp = await getMcp();
    await mcp?.callTool(LAPTOP, "restart_python", {}, { cache: false }).catch(() => {});
    return;
  }
  worker?.terminate();
  worker = null;
  current = null;
}
