// Runs the student's Python in a background worker, so a slow or endless
// program never freezes the lesson. This is MicroPython (with ulab, a small
// numpy-like module, and tracing for the debugger), published next to this
// file: it works anywhere the artifact opens. Full Python runs on the
// student's laptop instead, when the local connector is available (see
// src/lib/python.ts). Variables are kept between runs, like a notebook,
// until a restart.
import { loadMicroPython } from "./micropython.mjs";

const DEBUG_MARK = "LHDBG::";
let mp = null;
let booting = null;
let debugger_ = null;
let capture = null; // while debugging: where the debugger's reply goes
const post = (msg) => self.postMessage(msg);

async function boot() {
  post({ type: "status", text: "Starting Python…" });
  mp = await loadMicroPython({
    url: new URL("./micropython-settrace-ulab.wasm", import.meta.url).href,
    heapsize: 64 * 1024 * 1024,
    linebuffer: true,
    stdout: (line) => {
      if (capture && line.startsWith(DEBUG_MARK)) capture(line.slice(DEBUG_MARK.length));
      else post({ type: "out", text: line + "\n" });
    },
    stderr: (line) => post({ type: "err", text: line + "\n" }),
  });
  post({ type: "status", text: "" });
}

async function debug(id, code, maxSteps) {
  // The same debugger the laptop uses, published beside this file.
  debugger_ ??= fetch(new URL("./debugger.py", import.meta.url)).then((r) => {
    if (!r.ok) throw new Error("the debugger could not be loaded");
    return r.text();
  });
  const src = await debugger_;
  let reply = null;
  capture = (json) => (reply = json);
  try {
    await mp.runPythonAsync(`${src}\nprint(${JSON.stringify(DEBUG_MARK)} + json.dumps(_lh_debug(${JSON.stringify(code)}, ${maxSteps})))`);
  } finally {
    capture = null;
  }
  if (!reply) throw new Error("the debugger did not answer");
  post({ type: "debug", id, data: JSON.parse(reply) });
}

self.onmessage = async (e) => {
  const { id, code, mode, maxSteps } = e.data;
  try {
    booting ??= boot();
    await booting;
    if (mode === "debug") await debug(id, code, maxSteps ?? 2000);
    else await mp.runPythonAsync(code);
  } catch (err) {
    const text = String(err?.message ?? err).replace(/File "<stdin>"/g, 'File "your_code.py"').trim();
    post({ type: "error", text });
  }
  post({ type: "done", id });
};
