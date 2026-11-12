// Claude's tools. The schemas go to the API from the server; the functions
// run in the browser against the repo in memory, so code never sits on a
// server. Shared by both sides, so no "use client" here.
import type { CodeMap } from "@/analyzer/types";
import { checkStep } from "@/lib/flyPath";
import type { FlyAsk } from "@/lib/flythrough";
import { edgesOf } from "@/lib/store";
import { describeEdge, describeService, describeSystem, findService, isSystem } from "./system";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  strict?: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read part of a file from the repo, with line numbers. Up to 250 lines per call; call again with a later start_line for more.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path, e.g. backend/routers/account.py" },
        start_line: { type: "integer", description: "1-based first line (default 1)" },
        end_line: { type: "integer", description: "1-based last line (default start_line + 199)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Find lines containing some text across the repo (case-insensitive). Returns up to 30 hits as path:line: text. Use to find where something is defined or used.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path_prefix: { type: "string", description: "Only search under this folder, e.g. frontend/src" },
      },
      required: ["query"],
    },
  },
  {
    name: "query_map",
    description:
      "Look up the code map: what a route, file, table or outside service is connected to, with the file:line evidence for every link (code lines, and the config lines that resolved them). Give a node id (from earlier results), a file path, or a name to search (e.g. 'signin', 'users table', 'Stripe'). When the workspace has several services, a service name or id ('users service', 'svc-users') gives its addresses, settings, start command, doors and links to other services, and 'system' gives every link between services.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "list_files",
    description:
      "List folders and files under a path (default: the root; with several repos open, the root lists one folder per repo). Shows which files are in the map, which were skipped (tests, generated) and which are config files (docker-compose, Dockerfile, …).",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "fly_step",
    description:
      "Move the user's map one hop along a real path, live: the camera glides to the node, the light runs along the arrow from the previous node, the code opens and your sentence is read out. Use it when the user asks to be shown or taken somewhere, or how one thing reaches another. Call it once per hop, in order, as you go: the first call names where to start, each later call a node joined to the one before by a real arrow (find them with query_map first). A made-up node or arrow is refused; two nodes the map does not join are shown as a gap: say so, never invent the link.",
    input_schema: {
      type: "object",
      properties: {
        node: { type: "string", description: "Map node id from query_map, e.g. route:api/orders.ts#POST /orders" },
        via_edge: { type: "string", description: "Optional: id of the arrow from the previous node, <kind>:<from id>-><to id> (either direction). Left out, the real arrow between the two is used." },
        say: { type: "string", description: "One short sentence for this hop, plain English, read aloud" },
        file: { type: "string", description: "Optional: file to show (default: the arrow's own line, else the node's code)" },
        lines: { type: "array", items: { type: "integer" }, description: "Optional: [start, end] lines in file (or in the node's own file)" },
      },
      required: ["node", "say"],
    },
  },
];

export const TOUR_TOOL: ToolDef = {
  name: "finish_tour",
  description:
    "Hand in the finished tour once you've read the code it covers. Each step is spoken aloud to a beginner while the given lines and map nodes light up. Keep steps to 1–3 sentences, in order of the flow (what the user does → request → logic → data).",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            say: { type: "string", description: "What to say, plain English, no code dumps" },
            file: { type: "string", description: "File to show" },
            start_line: { type: "integer" },
            end_line: { type: "integer" },
            node_ids: { type: "array", items: { type: "string" }, description: "Map node ids to light up (from query_map), e.g. route:…, svc-int:…, chan:…" },
          },
          required: ["say", "file", "start_line", "end_line", "node_ids"],
        },
      },
    },
    required: ["title", "steps"],
  },
};

export interface TourStep {
  say: string;
  file: string;
  start_line: number;
  end_line: number;
  node_ids: string[];
}
export interface Tour {
  title: string;
  steps: TourStep[];
  /** Starts reading aloud as soon as it is on screen (a tour Claude hands WalkMyCode for Claude's page). */
  autoplay?: boolean;
  /** WalkMyCode for Claude: the requests Claude was working on when it handed the tour over (their answers keep it on screen). */
  requests?: string[];
}

export interface RepoView {
  map: CodeMap;
  files: Record<string, string>;
  /** The map on screen, for fly_step (one per question, src/lib/flythrough.ts). Without
   * it, fly_step only checks the hop. */
  fly?: FlyAsk;
}

export function runTool(repo: RepoView, name: string, input: Record<string, unknown>): string {
  const { map, files } = repo;
  switch (name) {
    case "read_file": {
      const path = String(input.path ?? "");
      const content = files[path];
      if (content === undefined) {
        const near = Object.keys(files).filter((p) => p.endsWith(path) || p.includes(path)).slice(0, 5);
        return `No such file: ${path}${near.length ? `. Did you mean: ${near.join(", ")}` : ""}`;
      }
      const lines = content.split("\n");
      const start = Math.max(1, Number(input.start_line ?? 1));
      const end = Math.min(lines.length, Number(input.end_line ?? start + 199), start + 249);
      const out = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(4)}| ${l}`);
      return `${path} (lines ${start}-${end} of ${lines.length})\n${out.join("\n")}`;
    }
    case "search": {
      const q = String(input.query ?? "").toLowerCase();
      const prefix = input.path_prefix ? String(input.path_prefix) : "";
      if (!q) return "Empty query.";
      const hits: string[] = [];
      for (const [path, content] of Object.entries(files)) {
        if (prefix && !path.startsWith(prefix)) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && hits.length < 30; i++) {
          if (lines[i].toLowerCase().includes(q)) hits.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
        }
        if (hits.length >= 30) break;
      }
      return hits.length ? hits.join("\n") : `Nothing contains "${input.query}".`;
    }
    case "query_map": {
      const q = String(input.query ?? "").trim();
      const ql = q.toLowerCase();
      let nodes = map.nodes.filter((n) => n.id === q);
      // Services and the links between them exist only in a system of several services.
      if (!nodes.length && isSystem(map)) {
        if (/^(the\s+)?(whole\s+)?system$|^services$|^links$/.test(ql)) return describeSystem(map);
        const svc = findService(map, q);
        if (svc) {
          const also = map.nodes.filter((n) => n.service !== svc.id && n.name.toLowerCase().includes(svc.name.toLowerCase())).slice(0, 6);
          return describeService(map, svc) + (also.length ? `\nAlso named like it (query these ids for their links): ${also.map((n) => `${n.name} [${n.id}]`).join("; ")}` : "");
        }
      }
      if (!nodes.length) nodes = map.nodes.filter((n) => n.file === q);
      if (!nodes.length) nodes = map.nodes.filter((n) => n.name.toLowerCase().includes(ql) || n.path?.toLowerCase().includes(ql) || n.file?.toLowerCase().includes(ql));
      if (!nodes.length) return `Nothing in the map matches "${q}". Try search() for the text, or list_files().`;
      const out: string[] = [];
      for (const n of nodes.slice(0, 6)) {
        const { in: ins, out: outs } = edgesOf(map, n.id);
        const svc = isSystem(map) ? map.services.find((s) => s.id === n.service) : undefined;
        const inSvc = svc ? `, in the ${svc.name} service${svc.kind === "placeholder" ? " (its code isn't in this workspace)" : ""}` : "";
        out.push(`## ${n.name} [${n.id}] — ${n.kind} in the ${n.layer} layer${n.file ? `, ${n.file}:${n.line ?? 1}${n.endLine ? `-${n.endLine}` : ""}` : ""}${n.handler ? `, handler ${n.handler}` : ""}${inSvc}${n.note ? ` (${n.note})` : ""}`);
        if (n.columns?.length) out.push(`- columns: ${n.columns.map((c) => (c.type ? `${c.name} ${c.type}` : c.name)).join(", ")}${n.columnsAt ? ` (${n.columnsAt.file}:${n.columnsAt.line})` : ""}`);
        for (const e of outs.slice(0, 25)) out.push(`- ${describeEdge(map, e, true)}`);
        for (const e of ins.slice(0, 25)) out.push(`- ${describeEdge(map, e, false)}`);
        if (!ins.length && !outs.length) out.push("- (no links found by the parser)");
      }
      if (nodes.length > 6) out.push(`…and ${nodes.length - 6} more matches; be more specific.`);
      return out.join("\n");
    }
    case "list_files": {
      const base = String(input.path ?? "").replace(/^\/+|\/+$/g, "");
      const dirs = new Set<string>();
      const fl: string[] = [];
      const add = (path: string, note: string) => {
        if (base && !path.startsWith(base + "/")) return;
        const rest = base ? path.slice(base.length + 1) : path;
        const i = rest.indexOf("/");
        if (i >= 0) dirs.add(rest.slice(0, i) + "/");
        else fl.push(`${rest}${note}`);
      };
      for (const f of map.files) add(f.path, f.skipped ? `  (skipped: ${f.skipped})` : f.configKind ? `  (config: ${f.configKind})` : "");
      // Files read_file can open that aren't cards on the map (package.json and the other manifests):
      // listed too, or they look missing and get read some other way.
      const onMap = new Set(map.files.map((f) => f.path));
      for (const path of Object.keys(files)) if (!onMap.has(path)) add(path, "  (not on the map; read_file opens it)");
      // Several repos: the root is one folder per repo, and says so.
      const repos = map.repos?.length > 1 && !base ? map.repos : [];
      const label = (d: string) => {
        const r = repos.find((x) => `${x.label}/` === d);
        return r ? `${d}  (repo ${r.label}, ${map.files.filter((f) => f.path.startsWith(r.prefix)).length} files)` : d;
      };
      const all = [...[...dirs].sort().map(label), ...fl.sort()];
      const head = repos.length ? `/ — ${repos.length} repos in this workspace: ${repos.map((r) => r.label).join(", ")}; every path starts with its repo's name` : base || "/";
      return all.length ? `${head}\n${all.slice(0, 200).join("\n")}${all.length > 200 ? `\n…${all.length - 200} more` : ""}` : `Nothing under ${base}`;
    }
    case "fly_step": {
      // Checked against the map, and played on it when one is on screen (src/lib/flyPath.ts).
      if (repo.fly) return repo.fly.step(input);
      const r = checkStep(map, files, null, input);
      return r.ok ? `Not shown: no map is on screen here. (${r.note})` : r.error;
    }
    default:
      return `Unknown tool ${name}`;
  }
}
