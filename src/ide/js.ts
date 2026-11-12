/**
 * JavaScript and TypeScript in the page. TypeScript's types are stripped by
 * Sucrase (which keeps every line where it was, so error lines still match
 * the editor); the code then runs as a module worker built from a Blob: a
 * small harness that captures console output, followed by the student's
 * code. No eval, so it works in the artifact too. Each run starts afresh;
 * Stop ends the worker.
 */
import { DEBUG_END, DEBUG_HARNESS, instrument } from "./jsdebug";
import type { DebugRun, OutPart } from "./python";

type Listener = { onPart: (p: OutPart) => void; onStatus: (s: string) => void; done: () => void; onDebug?: (d: DebugRun) => void };

// Everything the student's code can print, turned into messages. Kept to one
// line per statement so the line count below stays exact.
const HARNESS = [
  `const __post = (kind, text) => self.postMessage({ type: kind, text });`,
  `const __fmt = (v, d = 0) => { if (typeof v === "string") return d ? JSON.stringify(v) : v; if (typeof v === "function") return "[Function " + (v.name || "anonymous") + "]"; if (typeof v === "bigint") return v + "n"; if (v === undefined) return "undefined"; if (v instanceof Error) return v.name + ": " + v.message; if (v instanceof Map) return "Map(" + v.size + ") {" + [...v].map(([k, x]) => __fmt(k, 1) + " => " + __fmt(x, 1)).join(", ") + "}"; if (v instanceof Set) return "Set(" + v.size + ") {" + [...v].map((x) => __fmt(x, 1)).join(", ") + "}"; if (Array.isArray(v)) return d > 3 ? "[Array]" : "[" + v.map((x) => __fmt(x, d + 1)).join(", ") + "]"; if (v && typeof v === "object") { if (d > 3) return "[Object]"; const n = v.constructor && v.constructor.name !== "Object" ? v.constructor.name + " " : ""; return n + "{" + Object.entries(v).map(([k, x]) => k + ": " + __fmt(x, d + 1)).join(", ") + "}"; } return String(v); };`,
  `const __line = (args) => args.map((a) => __fmt(a)).join(" ") + "\\n";`,
  `console.log = console.info = console.debug = (...a) => __post("out", __line(a)); console.warn = console.error = (...a) => __post("err", __line(a));`,
  `console.table = (data) => { const rows = Array.isArray(data) ? data : Object.values(data || {}); const cols = [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : ["value"])))]; self.postMessage({ type: "table", columns: cols, rows: rows.map((r) => cols.map((c) => (r && typeof r === "object" ? __fmt(r[c], 1) : __fmt(r, 1)))) }); };`,
  `self.addEventListener("unhandledrejection", (e) => { e.preventDefault(); self.postMessage({ type: "rejection", text: e.reason && e.reason.stack ? String(e.reason.stack) : __fmt(e.reason) }); });`,
];
const HARNESS_LINES = HARNESS.length;
const END = `\n;self.postMessage({ type: "done" });\n`;

/** An error message pointing at the student's own line. */
function located(message: string, line: number | undefined) {
  const own = line && line > HARNESS_LINES ? line - HARNESS_LINES : 0;
  return own ? `Line ${own}: ${message}` : message;
}

async function toJavaScript(code: string, typescript: boolean, jsx: boolean) {
  if (!typescript && !jsx) return code;
  const { transform } = await import("sucrase");
  const transforms: ("typescript" | "jsx")[] = [];
  if (typescript) transforms.push("typescript");
  if (jsx) transforms.push("jsx");
  return transform(code, { transforms, disableESTransforms: true, keepUnusedImports: true }).code;
}

/** One run of JavaScript/TypeScript. Each editor has its own, so two panels never stop each other. */
export class JsRunner {
  private worker: Worker | null = null;
  private current: Listener | null = null;
  private url = "";

  private finish() {
    const l = this.current;
    this.current = null;
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    l?.onStatus("");
    l?.done();
  }

  async run(code: string, l: Listener, opts: { typescript: boolean; jsx: boolean }) {
    if (this.current) this.finish();
    this.current = l;
    let js: string;
    try {
      js = await toJavaScript(code, opts.typescript, opts.jsx);
    } catch (e) {
      // Sucrase reports "…(line:col)" for code it cannot read.
      l.onPart({ kind: "error", text: `This code could not be read: ${String((e as Error)?.message ?? e)}` });
      return this.finish();
    }
    this.url = URL.createObjectURL(new Blob([HARNESS.join("\n") + "\n" + js + END], { type: "text/javascript" }));
    const w = new Worker(this.url, { type: "module" });
    this.worker = w;
    l.onStatus("Running…");
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; text?: string; columns?: string[]; rows?: string[][] };
      const cur = this.current;
      if (!cur) return;
      if (m.type === "done") return this.finish();
      if (m.type === "table") return cur.onPart({ kind: "table", columns: m.columns ?? [], rows: m.rows ?? [] });
      if (m.type === "rejection") {
        cur.onPart({ kind: "error", text: `Uncaught (in promise): ${m.text ?? ""}` });
        return this.finish();
      }
      cur.onPart({ kind: m.type === "err" ? "err" : "out", text: m.text ?? "" });
    };
    w.onerror = (e) => {
      e.preventDefault();
      this.current?.onPart({ kind: "error", text: located(e.message || "The code stopped with an error.", e.lineno) });
      this.finish();
    };
  }

  /** Record a run of the code, step by step, for the debugger (see jsdebug.ts). */
  async debug(code: string, l: Listener, opts: { typescript: boolean; jsx: boolean }) {
    if (this.current) this.finish();
    this.current = l;
    let src: string;
    try {
      src = instrument(await toJavaScript(code, opts.typescript, opts.jsx));
    } catch (e) {
      const err = e as { message?: string; loc?: { line: number } };
      l.onPart({ kind: "error", text: `${err.loc ? `Line ${err.loc.line}: ` : ""}This code could not be read: ${String(err.message ?? e).replace(/ \(\d+:\d+\)$/, "")}` });
      return this.finish();
    }
    const header = DEBUG_HARNESS.map((line) => line.replaceAll("__LH_HEADER", String(DEBUG_HARNESS.length))).join("\n");
    this.url = URL.createObjectURL(new Blob([header + "\n" + src + DEBUG_END], { type: "text/javascript" }));
    const w = new Worker(this.url, { type: "module" });
    this.worker = w;
    l.onStatus("Recording the run…");
    // A loop that swallows the step limit could run for ever: stop it.
    const watchdog = setTimeout(() => {
      if (this.worker !== w) return;
      this.current?.onPart({ kind: "error", text: "The run was stopped after 20 seconds. Is there a loop that never ends?" });
      this.finish();
    }, 20_000);
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; data?: DebugRun };
      if (m.type === "debug" && m.data) this.current?.onDebug?.(m.data);
      if (m.type === "done") {
        clearTimeout(watchdog);
        this.finish();
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      clearTimeout(watchdog);
      this.current?.onPart({ kind: "error", text: e.message || "The debugger stopped with an error." });
      this.finish();
    };
  }

  stop() {
    if (!this.current) return;
    this.current.onPart({ kind: "err", text: "Stopped.\n" });
    this.finish();
  }
}
