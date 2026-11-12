// The lecturer's brief, and Deepgram's agent Settings (docs/VOICE.md §4.2).
// GET /api/voice/settings builds the Settings here on the server, so the
// browser never writes a field that sets cost or destination: the think
// models, the voice, mip_opt_out and the functions (none with an `endpoint`,
// so no call goes anywhere but back to the page). The browser adds only what
// it alone has, the map's summary and its names (withContext), and the cap on
// the prompt is applied here either way. No secrets live in any of it.
import type { CodeMap } from "@/analyzer/types";
import { LECTURERS, lecturerModelFor, type LecturerModelId } from "./catalogue";
import { deepgramFunctions } from "./lecturer/functions";

export const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

/** Deepgram's limit on a managed model's prompt. */
export const PROMPT_LIMIT = 25_000;
/** Room kept free for the tour step notes added mid-session (UpdatePrompt adds to the prompt). */
export const CONTEXT_RESERVE = 3_000;
export const GREETING = "Hello! Which part of this code shall we walk through?";

export const LECTURER_PERSONA = `You are WalkMyCode's lecturer: a patient professor who walks someone through a codebase out loud. They may have built the app with an AI and not know words like "endpoint" or "schema", so say what a thing does before you name it, and name it once so they learn.

You are speaking, live:
- Keep each reply to two to four short sentences, then stop so they can ask. No lists, no markdown, no symbols, and never read code out character by character: say what it does.
- Say file names the way a person would ("the orders route file").
- Small talk and moving around (open a file, show a card, the next step) you handle yourself, straight away, with your functions.
- For how, why and "trace it" questions about the code, call deep_answer with the question. Say one short natural line first, like "Let me trace that through the checkout code." Then tell them its answer in your own words, briefly, and light the lines it cites with highlight_lines as you go.
- Ground every claim in the code. Use read_file, search or query_map to check a detail. Never invent a file, function, route or table; if you can't find something, say so.
- Show while you talk: highlight_lines or open_file for code, focus_map_node for a card on the map, trace_path to light the way from one part to another.
- During a guided tour, the latest context note tells you which step is on screen and what the narrator was saying. When you have answered a question about it, offer to carry on with the tour; if they agree, call continue_tour.
- run_code runs the code open now (the file on screen, or the Code room) in the page's own sandbox, and returns its output or its error. Tell them in a sentence or two what happened. If it says it cannot run, say why plainly.`;

/** One way the agent thinks. No temperature: Claude 4.7 and later reject a non-default one. */
export interface ThinkSettings {
  provider: { type: "anthropic"; model: string };
  prompt: string;
  functions: ReturnType<typeof deepgramFunctions>;
}

export interface AgentSettings {
  type: "Settings";
  mip_opt_out: true;
  tags: string[];
  flags: { history: boolean };
  audio: {
    input: { encoding: "linear16"; sample_rate: 16000 };
    output: { encoding: "linear16"; sample_rate: 24000; container: "none" };
  };
  agent: {
    listen: { provider: { type: "deepgram"; version: "v2"; model: string; eot_threshold?: number; eot_timeout_ms?: number; keyterms?: string[] } };
    /** One think, or an ordered fallback chain (each a full think, so a fallback keeps the prompt and functions). */
    think: ThinkSettings | ThinkSettings[];
    speak: { provider: { type: "deepgram"; version: "v2"; model: string } };
    greeting: string;
  };
}

const MAX_KEYTERMS = 50;

/**
 * Flux's own end-of-turn detection (developers.deepgram.com, "Configure the
 * Voice Agent", checked 2 Oct 2026): a turn ends when Flux is this confident
 * (0.5-1.0, default 0.7), or this long after speech whatever its confidence
 * (default 5000 ms; shorter here, so a hands-free turn never hangs). No eager
 * end-of-turn: it would start replies the user then talks over.
 */
export const FLUX_TURN = { eot_threshold: 0.7, eot_timeout_ms: 3000 } as const;

/** Deepgram's Settings for a Deepgram lecturer model, with the persona as the prompt. */
export function buildAgentSettings(o: { model: LecturerModelId; prompt?: string; keyterms?: string[] }): AgentSettings {
  const lecturer = LECTURERS["deepgram-agent"];
  const m = lecturerModelFor("deepgram-agent", o.model);
  const model = m && m.phase === 1 ? m : lecturerModelFor("deepgram-agent", lecturer.defaultModel)!;
  const prompt = capPrompt(o.prompt ?? LECTURER_PERSONA);
  const think: ThinkSettings[] = model.think.map((id) => ({ provider: { type: "anthropic", model: id }, prompt, functions: deepgramFunctions() }));
  const keyterms = cleanKeyterms(o.keyterms ?? []);
  return {
    type: "Settings",
    mip_opt_out: true,
    tags: ["walkmycode"],
    flags: { history: true },
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      listen: { provider: { type: "deepgram", version: "v2", model: lecturer.listen!, ...FLUX_TURN, ...(keyterms.length ? { keyterms } : {}) } },
      think: think.length === 1 ? think[0] : think,
      speak: { provider: { type: "deepgram", version: "v2", model: lecturer.speak! } },
      greeting: GREETING,
    },
  };
}

/**
 * The server's Settings with what only the browser has: the prompt becomes
 * the persona plus the map's summary (fitted under the limit), the listener
 * gets the repo's names as keyterms. Nothing else is touched.
 */
export function withContext(s: AgentSettings, ctx: { mapSummary?: string; keyterms?: string[] }): AgentSettings {
  const prompt = fitPrompt(LECTURER_PERSONA, ctx.mapSummary ?? "");
  const thinks = (Array.isArray(s.agent.think) ? s.agent.think : [s.agent.think]).map((t) => ({ ...t, prompt }));
  const keyterms = cleanKeyterms(ctx.keyterms ?? []);
  const provider = { ...s.agent.listen.provider };
  if (keyterms.length) provider.keyterms = keyterms;
  return { ...s, agent: { ...s.agent, listen: { provider }, think: thinks.length === 1 ? thinks[0] : thinks } };
}

/** A prompt cut to the room left once the step notes' reserve is set aside. */
function capPrompt(p: string, limit = PROMPT_LIMIT - CONTEXT_RESERVE): string {
  return p.length <= limit ? p : p.slice(0, limit);
}

/**
 * The persona, then the map's summary, under `limit` characters. A summary
 * that does not fit is cut at a line break and says so, so the lecturer
 * knows to ask query_map for the rest.
 */
export function fitPrompt(persona: string, summary: string, limit = PROMPT_LIMIT - CONTEXT_RESERVE): string {
  const base = capPrompt(persona, limit);
  if (!summary.trim()) return base;
  const head = `${base}\n\n# The code you are teaching (a map built by a parser; ask query_map for more)\n`;
  const room = limit - head.length;
  if (room < 200) return base;
  if (summary.length <= room) return head + summary;
  const tail = "\n…(the summary stops here: ask query_map for the rest)";
  const cut = summary.slice(0, room - tail.length);
  const nl = cut.lastIndexOf("\n");
  return head + (nl > room / 2 ? cut.slice(0, nl) : cut) + tail;
}

/** Keyterms Flux can use: names of 3–40 characters, no spaces or slashes, deduplicated, at most 50. */
function cleanKeyterms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = String(raw).trim();
    if (!/^[A-Za-z_$][\w$.-]{2,39}$/.test(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

// Names too common to help a listener tell this repo from any other.
const COMMON = new Set(["index", "main", "app", "page", "route", "layout", "utils", "util", "types", "type", "lib", "src", "test", "tests", "config", "constants", "helpers", "common", "default", "init", "__init__", "server", "client", "api", "styles", "globals"]);

/** The repo's top file and function names (by how connected their card is), for Flux to listen for. */
export function keytermsOf(map: CodeMap, max = MAX_KEYTERMS): string[] {
  const degree = new Map<string, number>();
  for (const e of map.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const ranked = [...map.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const terms: string[] = [];
  const stem = (p?: string) => p?.split("/").pop()?.replace(/\.[^.]+$/, "");
  for (const n of ranked) {
    // A card named after its file is already heard as the file's stem.
    const named = n.name === n.file?.split("/").pop() ? undefined : n.name;
    for (const t of [n.handler, stem(n.file), named]) if (t && !COMMON.has(t.toLowerCase())) terms.push(t);
    if (terms.length > max * 3) break;
  }
  return cleanKeyterms(terms).slice(0, max);
}
