// "Walk an error" (docs/SHELL.md §4): the user pastes an error or a stack trace,
// or takes the last one from the Run panel, and WalkMyCode walks the path it
// took through their code. This file reads the trace: it finds the error's own
// line and each frame (JavaScript and TypeScript, Python, Java and Kotlin, C#,
// Go, Rust), matches every frame's path to a file of the mapped project, drops
// the frames that are not the user's code (node_modules, the runtime, Next.js's
// own build output), and orders them from where it threw outwards. From that it
// makes what the room shows: the map's lights, a tour of the path, and the
// question that asks the AI for the likely cause.
//
// No React and no DOM here, so the tests read it directly.
import type { CodeMap } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import type { Tour } from "@/lib/claude/tools";
import { nodeAt, nodeById } from "@/lib/store";

/** One frame as the trace wrote it. */
export interface RawFrame {
  /** The function, when the trace names one. */
  fn: string | null;
  /** The path as written (cleaned of webpack:// and file:// and the like). */
  path: string;
  line: number;
  col: number | null;
  /** Java and Kotlin name only the file: the folders are made from the package, a guess. */
  guessed?: boolean;
}

/** A frame in the user's code: its path is a file of the project. */
export interface WalkFrame {
  fn: string | null;
  file: string;
  line: number;
  col: number | null;
}

export interface ErrorWalk {
  /** The error's own line ("TypeError: fetch failed"), or "" when the trace has none. */
  message: string;
  /** The frames in the project, from where it threw outwards. */
  frames: WalkFrame[];
  /** Frames left out: not in the project (libraries, the runtime) or not matched to a file. */
  outside: number;
}

const MAX_FRAMES = 30;

// ── Reading the lines ──

const PY_FILE = /^\s*File "(.+?)", line (\d+)(?:, in (.+?))?\s*$/;
const CS_AT = /^\s*at (.+?) in (.+?):line (\d+)\s*$/;
// Java and Kotlin: `at com.acme.Foo.bar(Foo.java:12)`, maybe with a module (`java.base/…`); no slash in the file.
const JAVA_AT = /^\s*at\s+(?:[\w.$@-]+\/)?([\w$.<>-]+)\(([^()/\\:]+\.\w+):(\d+)\)\s*$/;
const GO_AT = /^\s+(\S.*?\.go):(\d+)(?:\s+\+0x[0-9a-f]+)?\s*$/;
const GO_FN = /^(\S+)\((?:[^()]*)\)$/;
const RUST_PANIC = /panicked at (?:'((?:[^'\\]|\\.)*)', )?(\S+?\.rs):(\d+):(\d+)/;
const RUST_FN = /^\s*\d+:\s+(?:0x[0-9a-f]+ - )?(\S+)\s*$/;
// V8 (Node, Chrome, Edge): `at fn (file:line:col)`, `at async fn (…)`, `at file:line:col`; Rust's backtraces too.
// Node ends the last frame with " {" when the error carries more fields.
const V8_AT = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+)(?::(\d+))?\)?(?:\s*\{)?\s*$/;
// Firefox and Safari: `fn@file:line:col`.
const GECKO_AT = /^\s*([^\s@]*)@(.+?):(\d+):(\d+)\s*$/;
const PY_HEADER = /^\s*Traceback \(most recent call last\):/;

/** "Ns.Class.Method(String id)" → "Ns.Class.Method"; nothing for an anonymous function. */
const bareFn = (fn: string | null | undefined): string | null => {
  const s = (fn ?? "").trim().replace(/\([^()]*\)$/, "").trim();
  return !s || s === "<anonymous>" || s === "Object.<anonymous>" ? null : s;
};

/** The frame a line names, if it names one. `prevFn` is the function the line before named (Go, Rust). */
function frameOf(line: string, prevFn: string | null): RawFrame | null {
  let m = PY_FILE.exec(line);
  if (m) return { fn: bareFn(m[3]), path: m[1], line: +m[2], col: null };
  m = CS_AT.exec(line);
  if (m) return { fn: bareFn(m[1]), path: m[2], line: +m[3], col: null };
  m = JAVA_AT.exec(line);
  if (m) {
    // The package's folders, then the file: com.acme.Foo.bar → com/acme/Foo.java.
    const parts = m[1].split(".");
    const pkg = parts.slice(0, -2).filter((p) => /^[a-z_][\w]*$/.test(p));
    return { fn: m[1], path: [...pkg, m[2]].join("/"), line: +m[3], col: null, guessed: true };
  }
  m = GO_AT.exec(line);
  if (m) return { fn: prevFn, path: m[1], line: +m[2], col: null };
  m = RUST_PANIC.exec(line);
  if (m) return { fn: null, path: m[2], line: +m[3], col: +m[4] };
  m = V8_AT.exec(line);
  if (m) return { fn: bareFn(m[1]) ?? prevFn, path: m[2], line: +m[3], col: m[4] ? +m[4] : null };
  m = GECKO_AT.exec(line);
  if (m) return { fn: bareFn(m[1]), path: m[2], line: +m[3], col: +m[4] };
  return null;
}

const isFrame = (line: string) => frameOf(line, null) !== null;

/** Lines that belong to a trace without naming a frame: a header, a Go or Rust function name, "… 3 more". */
const isTraceTalk = (line: string) =>
  /^\s*(?:Caused by:|goroutine \d+|stack backtrace:|created by |\.\.\. \d+ more|--- End of|note: run with)/.test(line) || RUST_FN.test(line) || GO_FN.test(line.trim());

/** The error's line, written plainly: Next.js's "⨯ " and the like go. */
const cleanMessage = (s: string) => s.replace(/^\s*(?:[⨯✖×]\s*)+/, "").replace(/^Uncaught\s+/, "").trim().slice(0, 300);

/** The last error in a longer output (a run's whole log): from its message to its last frame.
 * Null when the text names no frame at all. */
export function lastError(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isFrame(lines[i])) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;
  // Python writes the frames first and the error last.
  let header = -1;
  for (let i = last; i >= 0; i--) {
    if (PY_HEADER.test(lines[i])) {
      header = i;
      break;
    }
  }
  if (header >= 0) {
    let end = last + 1;
    while (end < lines.length && (/^\s/.test(lines[end]) || !lines[end].trim())) end++;
    return lines.slice(header, Math.min(end + 1, lines.length)).join("\n").trimEnd();
  }
  // The others: back from the last frame over the trace's own lines, then the message: the nearest
  // line above them (Go and Rust leave a blank line between).
  let start = last;
  while (start > 0) {
    const prev = lines[start - 1];
    // Indented by two or more (a [cause], an error's fields); a log line indented by one (" GET /x 200") is not the trace's.
    if (prev.trim() && (isFrame(prev) || /^(?: {2,}|\t)\S/.test(prev) || isTraceTalk(prev))) start--;
    else break;
  }
  let m = start - 1;
  // Go puts "[signal SIGSEGV: …]" under its "panic:" line.
  while (m >= 0 && (!lines[m].trim() || (/^\[signal /.test(lines[m]) && m > 0))) m--;
  if (m >= 0) start = m;
  // Rust: the message sits under "panicked at file:line:col:", or is the next line when the panic is all there is.
  if (start > 0 && RUST_PANIC.test(lines[start - 1])) start--;
  let end = last + 1;
  if (RUST_PANIC.test(lines[last]) && /:\s*$/.test(lines[last]) && end < lines.length) end++;
  return lines.slice(start, end).join("\n").trim();
}

/** The error's line and its frames as written, innermost first (Python's order is turned round). */
export function parseTrace(text: string): { message: string; frames: RawFrame[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let frames: RawFrame[] = [];
  let message = "";
  let pyMessage = "";
  let python = false;
  let prevFn: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (PY_HEADER.test(raw)) {
      // A chained exception starts another traceback: the last one is the one that ended the program.
      python = true;
      frames = [];
      continue;
    }
    const f = frameOf(raw, prevFn);
    if (f) {
      frames.push(f);
      prevFn = null;
      const panic = RUST_PANIC.exec(raw);
      if (panic && !message) {
        // Old Rust: panicked at 'msg', file; new Rust: the message is the next line.
        const next = lines.slice(i + 1).find((l) => l.trim());
        message = cleanMessage(panic[1] ?? (/:\s*$/.test(raw) && next && !isFrame(next) ? next : raw.replace(/^.*?(panicked)/, "$1")));
      }
      continue;
    }
    const rust = RUST_FN.exec(raw);
    if (rust) {
      prevFn = rust[1].replace(/::h[0-9a-f]{16}$/, "");
      continue;
    }
    const go = GO_FN.exec(line);
    if (go && i + 1 < lines.length && GO_AT.test(lines[i + 1])) {
      prevFn = go[1];
      continue;
    }
    if (python && !/^\s/.test(raw) && /^[A-Za-z_][\w.]*(?::\s.*)?$/.test(line)) pyMessage = line;
    if (!message && !python && !isTraceTalk(raw) && !/^\s*\[cause\]/.test(raw)) message = cleanMessage(line);
  }
  if (python) frames.reverse();
  return { message: python ? cleanMessage(pyMessage || message) : message, frames };
}

// ── Matching paths to the project's files ──

/** Frames that are never the user's code, even when their path ends like a file of theirs. */
const OUTSIDE = /(?:^|\/)(?:node_modules|\.next|_next|site-packages|dist-packages|\.cargo|\.rustup)\/|^node:|^internal\/|^\/rustc\/|^<|\/usr\/local\/go\/|\/lib\/python\d/;

/** The path as a file path: no webpack:// or file:// or address, forward slashes, no "./". */
export function cleanPath(p: string): string {
  let s = p.trim();
  s = s.replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, "").replace(/^webpack:\/\/[^/]*\//, "");
  if (/^file:\/\//.test(s)) s = s.replace(/^file:\/\/(?:localhost)?/, "").replace(/^\/([A-Za-z]:)/, "$1");
  s = s.replace(/^https?:\/\/[^/]+\//, "");
  s = s.replace(/[?#].*$/, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // a stray % stays as written
  }
  s = s.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}

/** The project's file a frame's path names, or null when it is not the user's code. */
export function matchFile(path: string, files: readonly string[], guessed = false): string | null {
  const p = cleanPath(path);
  if (!p || OUTSIDE.test(p)) return null;
  if (files.includes(p)) return p;
  const lp = p.toLowerCase();
  let best: string | null = null;
  // An absolute (or longer) path that ends with a file of the project: the longest such file.
  for (const f of files) {
    const lf = f.toLowerCase();
    if ((lp === lf || lp.endsWith(`/${lf}`)) && (!best || f.length > best.length)) best = f;
  }
  if (best) return best;
  // A shorter path (a Rust crate's src/main.rs in a workspace of several folders): the shortest file that ends with it.
  for (const f of files) {
    if (f.toLowerCase().endsWith(`/${lp}`) && (!best || f.length < best.length)) best = f;
  }
  if (best || !guessed) return best;
  // Java and Kotlin: the folders were a guess from the package; the file's name alone, when only one file has it.
  const name = lp.slice(lp.lastIndexOf("/") + 1);
  const same = files.filter((f) => f.toLowerCase() === name || f.toLowerCase().endsWith(`/${name}`));
  return same.length === 1 ? same[0] : null;
}

/** Read a pasted error: its line, and the frames in the project from where it threw outwards. */
export function walkTrace(text: string, files: readonly string[]): ErrorWalk {
  const { message, frames } = parseTrace(lastError(text) ?? text);
  const out: WalkFrame[] = [];
  let outside = 0;
  for (const f of frames) {
    const file = matchFile(f.path, files, f.guessed);
    if (!file) {
      outside++;
      continue;
    }
    const prev = out[out.length - 1];
    // The same line twice in a row (a panic's line and its first backtrace frame, an async hop): one step.
    if (prev && prev.file === file && prev.line === f.line) {
      prev.fn ??= f.fn;
      continue;
    }
    if (out.length < MAX_FRAMES) out.push({ fn: f.fn, file, line: f.line, col: f.col });
  }
  return { message, frames: out, outside };
}

// ── What the room shows ──

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
/** "createTask", or the file's name when the frame names no function. */
export const frameName = (f: WalkFrame) => (f.fn && f.fn !== "<module>" ? f.fn : base(f.file));

/** The map's lights for a walk: the card at each frame and the arrows between them, as a trace lights. */
export function walkLit(map: CodeMap, frames: readonly WalkFrame[]): Lit {
  const ids: string[] = [];
  for (const f of frames) {
    const n = nodeAt(map, f.file, f.line);
    if (n && !ids.includes(n.id)) ids.push(n.id);
  }
  const nodes = new Set(ids);
  const edges = new Set(map.edges.filter((e) => e.from !== e.to && nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id));
  const services = new Set<string>();
  for (const id of ids) {
    const s = nodeById(map, id)?.service;
    if (s) services.add(s);
  }
  // The light flies first to where it threw.
  return { nodes, edges, services, ...(ids[0] ? { origin: ids[0] } : {}) };
}

/** "Tour the path": the frames in the order the code ran them, ending where it broke. */
export function walkTour(map: CodeMap, walk: ErrorWalk): Tour {
  const ran = [...walk.frames].reverse();
  const steps = ran.map((f, i) => {
    const next = ran[i + 1];
    const where = `${base(f.file)}, line ${f.line}`;
    const say = next
      ? `${f.fn ? `${f.fn} runs` : "The code runs"} here (${where}) and calls ${frameName(next)}.`
      : `This is where it broke${f.fn ? `, in ${f.fn}` : ""} (${where})${walk.message ? `: ${walk.message}` : "."}`;
    const n = nodeAt(map, f.file, f.line);
    return { say, file: f.file, start_line: f.line, end_line: f.line, node_ids: n ? [n.id] : [] };
  });
  return { title: walk.message ? `The path to “${walk.message.slice(0, 60)}${walk.message.length > 60 ? "…" : ""}”` : "The path the error took", steps };
}

/** The lines around a frame, numbered, its own line marked with ">". */
function around(text: string, line: number, pad = 6): string {
  const lines = text.split("\n");
  const from = Math.max(1, line - pad);
  const to = Math.min(lines.length, line + pad);
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${i === line ? ">" : " "}${String(i).padStart(4)}| ${lines[i - 1]}`);
  return out.join("\n");
}

/** The question for "Likely cause": the error, its frames and the code around each, asked to cite. */
export function causeQuestion(walk: ErrorWalk, files: Record<string, string>, maxFrames = 8): string {
  const shown = walk.frames.slice(0, maxFrames);
  const lines = [
    "I got this error. Walk me through why it most likely happened.",
    "",
    `The error: ${walk.message || "(the trace has no message line)"}`,
    "",
    "The path it took through my code, from where it broke outwards:",
    ...shown.map((f, i) => `${i + 1}. ${frameName(f)} at ${f.file}:${f.line}`),
  ];
  if (walk.frames.length > shown.length) lines.push(`…and ${walk.frames.length - shown.length} more steps further out.`);
  lines.push("", "The code at each step:");
  for (const [i, f] of shown.entries()) {
    const text = files[f.file];
    if (text === undefined) continue;
    lines.push("", `${i + 1}. ${f.file}:${f.line}`, around(text, f.line));
  }
  lines.push(
    "",
    "In a few short sentences: what most likely caused it, and why it reached the user this way. Cite path:line for every claim. Read more of the code if you need to, and say so when you are not sure.",
  );
  return lines.join("\n");
}

/** A walk on screen: what was pasted, what was read from it, and its number (its answer carries it too). */
export interface WalkState {
  id: number;
  text: string;
  result: ErrorWalk;
}
