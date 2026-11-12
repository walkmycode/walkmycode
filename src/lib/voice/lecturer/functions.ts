// The lecturer's functions (docs/VOICE.md §4.3): one list for every lecturer.
// Deepgram's agent gets them in Settings without an `endpoint`, so each call
// comes back to the browser; ElevenAgents gets them as client tools. Either
// way they run in the page (tools.ts), against the map and the code held
// there. Pure data: the server builds Settings and agents from it.

export interface FunctionParam {
  type: "string" | "integer";
  description: string;
}

export interface LecturerFunction {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, FunctionParam>; required?: string[] };
  /** Hold the call until the user's turn is over: no speculative runs (Deepgram). */
  defer_until_eot?: boolean;
  /** How long the agent waits for the answer, in seconds (ElevenAgents; 1–120). */
  timeout?: number;
  /** Ask the agent to say something before the call (ElevenAgents' pre_tool_speech). */
  speakFirst?: boolean;
}

const path: FunctionParam = { type: "string", description: "Repo-relative file path, e.g. src/app/api/orders/route.ts" };

export const LECTURER_FUNCTIONS: LecturerFunction[] = [
  {
    name: "highlight_lines",
    description: "Show lines of a file: opens it in the code panel and lights the lines. Use it whenever you talk about specific code.",
    parameters: {
      type: "object",
      properties: { path, from: { type: "integer", description: "First line to light (1-based)" }, to: { type: "integer", description: "Last line to light" } },
      required: ["path", "from", "to"],
    },
  },
  {
    name: "open_file",
    description: "Open a file in the code panel, optionally scrolled to a line.",
    parameters: { type: "object", properties: { path, line: { type: "integer", description: "Line to show (1-based), optional" } }, required: ["path"] },
  },
  {
    name: "focus_map_node",
    description: "Point at a card on the map: switches to the level it is drawn on, selects it and centres the map on it. Give a node id from query_map, a file path, or a name.",
    parameters: { type: "object", properties: { id: { type: "string", description: "Node id (e.g. file:src/cart.ts, route:…), file path or name" } }, required: ["id"] },
  },
  {
    name: "trace_path",
    description: "Light the way on the map from one part of the code to another, e.g. from a page to the table it ends up writing. Give node ids, file paths or names.",
    parameters: {
      type: "object",
      properties: { from: { type: "string", description: "Where the path starts: node id, file path or name" }, to: { type: "string", description: "Where it ends: node id, file path or name" } },
      required: ["from", "to"],
    },
  },
  {
    name: "next_step",
    description: "Move the open guided tour on to its next step; the narrator reads it. Only when a tour is open.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "continue_tour",
    description: "Carry on with the guided tour after a question: the narrator picks up where it paused. Call it when the user agrees to carry on.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "run_code",
    description: "Run the code open now (the file on screen, or the Code room) in the page's sandbox, and get a short summary of its output or error.",
    parameters: { type: "object", properties: {} },
    defer_until_eot: true,
    timeout: 60,
  },
  {
    name: "deep_answer",
    description:
      "Answer a how, why or trace question about this code: a stronger model reads the real code with the map's tools and returns a short grounded answer with file:line citations, and the cited lines light up as it works. It takes several seconds, so first say one short natural line, like \"Let me trace that through the checkout code.\"",
    parameters: { type: "object", properties: { question: { type: "string", description: "The user's question, complete on its own, using the names they used" } }, required: ["question"] },
    defer_until_eot: true,
    timeout: 120,
    speakFirst: true,
  },
  {
    name: "read_file",
    description: "Read part of a file, with line numbers (up to 250 lines a call).",
    parameters: {
      type: "object",
      properties: { path, start_line: { type: "integer", description: "First line (default 1)" }, end_line: { type: "integer", description: "Last line (default start_line + 199)" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Find lines containing some text across the repo (case-insensitive): up to 30 hits as path:line: text.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Text to look for" }, path_prefix: { type: "string", description: "Only search under this folder, optional" } }, required: ["query"] },
  },
  {
    name: "query_map",
    description: "Look up the code map: what a route, file, table or outside service connects to, with file:line evidence. Give a node id, a file path or a name (e.g. 'signin', 'users table').",
    parameters: { type: "object", properties: { query: { type: "string", description: "Node id, file path or name" } }, required: ["query"] },
  },
];

export const FUNCTION_NAMES = LECTURER_FUNCTIONS.map((f) => f.name);

/** Bumped whenever the list changes, so an ElevenLabs agent made from an older list gets the new tools. */
export const FUNCTIONS_VERSION = "2026-10-01.1";

/** The functions as Deepgram's Settings want them: name, description, parameters, and no endpoint. */
export function deepgramFunctions(): { name: string; description: string; parameters: LecturerFunction["parameters"]; defer_until_eot?: true }[] {
  return LECTURER_FUNCTIONS.map((f) => ({
    name: f.name,
    description: f.description,
    parameters: { type: "object", properties: { ...f.parameters.properties }, ...(f.parameters.required ? { required: [...f.parameters.required] } : {}) },
    ...(f.defer_until_eot ? { defer_until_eot: true as const } : {}),
  }));
}

/** One function as an ElevenAgents client tool (POST /v1/convai/tools). */
export function elevenToolConfig(f: LecturerFunction): Record<string, unknown> {
  const props = Object.keys(f.parameters.properties);
  return {
    type: "client",
    name: f.name,
    description: f.description,
    ...(props.length ? { parameters: { type: "object", properties: { ...f.parameters.properties }, required: [...(f.parameters.required ?? [])] } } : {}),
    expects_response: true,
    response_timeout_secs: f.timeout ?? 20,
    ...(f.speakFirst ? { pre_tool_speech: "force" } : {}),
  };
}
