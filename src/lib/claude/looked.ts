// What the guide looked at, in the user's words: the board shows it behind a small
// "What I looked at" disclosure ("Looked at: NewTaskForm, the tasks route, “sign in” in the
// code") rather than the raw calls (query_map("route:…"), read_file(…)). And the answer
// itself is cleaned of any call the model wrote out as text. Plain code, so tests read it.
import type { CodeMap } from "@/analyzer/types";
import { indexOf } from "@/lib/mapIndex";

const TOOL_NAMES = ["read_file", "search", "query_map", "list_files", "fly_step", "finish_tour", "trace_path"];

const base = (path: string) => path.split("/").pop()?.replace(/\.[^.]+$/, "") || path;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A node's or a service's name from its id, or a path's file name; else the text itself. */
function nameFor(map: CodeMap, ref: string): string {
  const n = indexOf(map).node.get(ref) ?? indexOf(map).node.get(`file:${ref}`);
  if (n) return n.kind === "route" ? n.name : base(n.name);
  const s = map.services?.find((x) => x.id === ref);
  if (s) return `the ${s.name} service`;
  if (/^[\w@.-]+(\/[\w@.[\]-]+)+\.\w+$/.test(ref)) return base(ref);
  // An id we do not know ("route:…", "svc:stripe"): what comes after its kind.
  const m = /^(?:file|route|table|svc|svc-int|chan|rpc):(.+)$/.exec(ref);
  return m ? base(m[1].replace(/#.*$/, "")) : ref;
}

/** One call, as a few words; null for the ones not worth showing (handing in a tour, a call still being written). */
export function lookedLabel(map: CodeMap, name: string, input?: Record<string, unknown>): string | null {
  if (!input) return null;
  switch (name) {
    case "read_file":
      return str(input.path) ? nameFor(map, str(input.path)) : null;
    case "query_map": {
      const q = str(input.query);
      if (!q) return null;
      if (q.toLowerCase() === "system") return "how the services connect";
      return nameFor(map, q);
    }
    case "search":
      return str(input.query) ? `“${str(input.query)}” in the code` : null;
    case "list_files":
      return str(input.path) ? `the files in ${str(input.path)}` : "the list of files";
    case "fly_step":
      return str(input.node) ? nameFor(map, str(input.node)) : null;
    default:
      return null;
  }
}

/** Add a call's label to the list (each label once, in order). */
export function addLooked(list: string[], label: string | null): string[] {
  return !label || list.includes(label) ? list : [...list, label];
}

/** "Looked at: A, B and 3 more". */
export function lookedLine(list: string[], max = 6): string {
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return `Looked at: ${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`;
}

const CALL = new RegExp(`\`?\\b(?:${TOOL_NAMES.join("|")})\\s*\\([^()\\n]*\\)\`?`, "g");
const CALL_LINE = new RegExp(`^\\s*[*_>-]*\\s*\`?\\b(?:${TOOL_NAMES.join("|")})\\s*\\([^\\n]*\\)\`?[.:]?\\s*$`);

/** The answer without the calls the model wrote out as text: a line that is only a call goes,
 * a call inside a sentence is taken out of it. */
export function stripToolTalk(text: string): string {
  return text
    .split("\n")
    .filter((l) => !CALL_LINE.test(l))
    .map((l) => {
      const r = l.replace(CALL, "");
      return r === l ? l : r.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
