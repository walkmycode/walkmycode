// The lecturer's brief, and Deepgram's agent Settings (docs/VOICE.md §4.2).
// GET /api/voice/settings builds the Settings here on the server, so the
// browser never writes a field that sets cost or destination: the think
// models, the voice, mip_opt_out and the functions (none with an `endpoint`,
// so no call goes anywhere but back to the page). The browser adds only what
// it alone has, the map's summary and its names (withContext), and the cap on
// the prompt is applied here either way. No secrets live in any of it.
import type { CodeMap } from "@/analyzer/types";
import { LECTURERS, lecturerModelFor, lecturerStyleFor, VOICE_DEFAULT, type LecturerModelId, type LecturerStyle } from "./catalogue";
import { deepgramFunctions } from "./lecturer/functions";
import { PROFESSOR_FUNCTIONS } from "./lecturer/professorFunctions";

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
    speak: { provider: { type: "deepgram"; version: "v2"; model: string; expressivity?: number } };
    /** Deepgram's Think Live (the Learn room's talk): backchannels, check-ins in a silence, frustration noticed. */
    think_live?: { provider: ThinkLive };
    greeting: string;
  };
}

/** Think Live's settings (playground.deepgram.com, Voice Agent → LLMs → Think Live, checked 12 Nov 2026). */
export interface ThinkLive {
  type: "deepgram";
  version: "v1";
  /** How readily it says "mm-hmm" while the user speaks, 0 (never) to 1. */
  agent_backchannel_sensitivity: number;
  /** How many times it checks in during a long silence before it stays quiet; 0 turns it off. */
  presence_check_max_count: number;
  presence_check_interval_ms: number;
  /** How many frustration signals before the conversation is flagged; 0 turns it off. */
  frustration_max_count: number;
}

/** Which room the talk is in: Explore's lecturer (the map) or Learn's professor (the lesson). */
export type TalkRoom = "explore" | "learn";

export const PROFESSOR_GREETING = "I'm listening. What do you make of this board so far?";

export const PROFESSOR_PERSONA = `You are WalkMyCode's professor, talking out loud with one student about the lesson on screen, the way a good teacher talks with a student after class: warm, curious, never in a hurry.

How you talk:
- One to three short spoken sentences, then hand the turn back, usually with a question. Never lecture for long; this is a conversation.
- No lists, no markdown, no symbols, no code read out character by character: say what a thing does, in plain words. Use the student's own words back to them.
- Explain with something they already know from their own life, and vary it (sport, music, travel, nature, games, money), never the same picture every time. One picture at a time, then check it landed ("Does that picture work for you?").
- Ask them to predict or explain before you tell them. When they are right, say exactly what was right. When they are wrong, be kind and specific, and give a hint before the answer.
- If they sound unsure, stuck or frustrated, slow down, say it more simply with a new example, and tell them it is normal to find this hard.
- If they go quiet, give them time; one gentle nudge is enough.
- Stay with this lesson. If they ask something far from it, answer briefly and bring them back.

What you can do while you talk (call these, don't describe them):
- next_board, previous_board, go_to_board: move the lesson. Go on only when they are ready.
- read_board: the exact words of a board, when you need them.
- open_example: put the board's runnable example beside the board, and tell them what to try.
- start_quiz and explain_back: test what they know; explaining it back is how they find out.
- save_note: keep one sentence worth remembering in their notebook.
- draw_picture: draw on the board, the analogy as a picture to watch, a UML sequence diagram of it, or a UML class, state or flow diagram. You can draw: never say you can't. Say what to look at as it appears.
Never invent what a board says: read it. Never say a function's name out loud.`;

/** Think Live for the professor: one gentle check-in after a long silence (a student may be thinking: two read as
 * nagging, and the second sounded like a phone call, "Are you still on the line?", tried 12 Nov), frustration noticed;
 * backchannels only with headphones, where the student's microphone never hears the professor (with speakers the echo
 * guard would mute their words). */
export function professorThinkLive(headphones: boolean): ThinkLive {
  return { type: "deepgram", version: "v1", agent_backchannel_sensitivity: headphones ? 0.35 : 0, presence_check_max_count: 1, presence_check_interval_ms: 12000, frustration_max_count: 3 };
}

const MAX_KEYTERMS = 50;

/**
 * Flux's own end-of-turn detection (developers.deepgram.com, "Configure the
 * Voice Agent", checked 2 Oct 2026): a turn ends when Flux is this confident
 * (0.5-1.0, default 0.7), or this long after speech whatever its confidence
 * (default 5000 ms). Tuned for students (11 Nov): someone learning pauses to
 * think mid-question, so the lecturer waits for 0.8 and up to 4 s rather than
 * cutting in; still short of 5 s, so a hands-free turn never hangs. No eager
 * end-of-turn: it would start replies the user then talks over.
 */
export const FLUX_TURN = { eot_threshold: 0.8, eot_timeout_ms: 4000 } as const;

/** Deepgram's Settings for a Deepgram lecturer model, with the persona as the prompt. `room: "learn"`: the professor's
 * persona, functions, greeting and Think Live instead of the map lecturer's. */
export function buildAgentSettings(o: { model: LecturerModelId; style?: LecturerStyle; prompt?: string; keyterms?: string[]; room?: TalkRoom; headphones?: boolean }): AgentSettings {
  const learn = o.room === "learn";
  const lecturer = LECTURERS["deepgram-agent"];
  const m = lecturerModelFor("deepgram-agent", o.model);
  const model = m && m.phase === 1 ? m : lecturerModelFor("deepgram-agent", lecturer.defaultModel)!;
  const prompt = capPrompt(o.prompt ?? (learn ? PROFESSOR_PERSONA : LECTURER_PERSONA));
  const functions = learn ? deepgramFunctions(PROFESSOR_FUNCTIONS) : deepgramFunctions();
  const think: ThinkSettings[] = model.think.map((id) => ({ provider: { type: "anthropic", model: id }, prompt, functions }));
  const keyterms = cleanKeyterms(o.keyterms ?? []);
  const expressivity = (lecturerStyleFor(o.style ?? "") ?? lecturerStyleFor(VOICE_DEFAULT.lecturerStyle)!).expressivity;
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
      speak: { provider: { type: "deepgram", version: "v2", model: lecturer.speak!, ...(expressivity ? { expressivity } : {}) } },
      ...(learn ? { think_live: { provider: professorThinkLive(!!o.headphones) } } : {}),
      greeting: learn ? PROFESSOR_GREETING : GREETING,
    },
  };
}

/**
 * The professor's Settings with what only the browser has: the persona plus the lesson on screen (fitted under the
 * limit), and the lesson's names as keyterms. Nothing else is touched.
 */
export function withLesson(s: AgentSettings, ctx: { lesson: string; keyterms?: string[] }): AgentSettings {
  const prompt = fitPrompt(PROFESSOR_PERSONA, ctx.lesson, PROMPT_LIMIT - CONTEXT_RESERVE, LESSON_HEADING);
  const thinks = (Array.isArray(s.agent.think) ? s.agent.think : [s.agent.think]).map((t) => ({ ...t, prompt }));
  const keyterms = cleanKeyterms(ctx.keyterms ?? []);
  const provider = { ...s.agent.listen.provider };
  if (keyterms.length) provider.keyterms = keyterms;
  return { ...s, agent: { ...s.agent, listen: { provider }, think: thinks.length === 1 ? thinks[0] : thinks } };
}

const LESSON_HEADING = { head: "# The lesson on screen (read_board gives any board's exact words)", tail: "…(the lesson stops here: read_board gives the rest)" };

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
export function fitPrompt(persona: string, summary: string, limit = PROMPT_LIMIT - CONTEXT_RESERVE, heading: { head: string; tail: string } = MAP_HEADING): string {
  const base = capPrompt(persona, limit);
  if (!summary.trim()) return base;
  const head = `${base}\n\n${heading.head}\n`;
  const room = limit - head.length;
  if (room < 200) return base;
  if (summary.length <= room) return head + summary;
  const tail = `\n${heading.tail}`;
  const cut = summary.slice(0, room - tail.length);
  const nl = cut.lastIndexOf("\n");
  return head + (nl > room / 2 ? cut.slice(0, nl) : cut) + tail;
}

const MAP_HEADING = { head: "# The code you are teaching (a map built by a parser; ask query_map for more)", tail: "…(the summary stops here: ask query_map for the rest)" };

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
