// The promotion gate for a provider: a real two-step tool loop (search, then
// an answer) and a tour hand-in, through the same sdk.ts calls the ask route
// makes, on the keys in .walkmycode/keys.env or the environment (.env.local is
// read too). Costs a few cents per provider. Key values are never printed.
//
//   npm run smoke                                  every cloud provider with a key
//   npm run smoke -- --provider openai             one provider (the only way to run local)
//   npm run smoke -- --provider groq --model llama-3.3-70b-versatile --effort low
//   npm run smoke -- --record                      also add the results to docs/PROVIDERS.md
//
// Exits non-zero when any check fails, so a provider's tools flip from
// "best-effort" to "confident" in the catalogue only after a clean run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { costOf, priceFor } from "../src/lib/cost";
import { TOOLS, TOUR_TOOL } from "../src/lib/claude/tools";
import { modelFor, PROVIDER_IDS, PROVIDERS, providerFor, type Effort, type ProviderId } from "../src/lib/providers/catalogue";
import { localBaseUrl, readiness, resolve } from "../src/lib/providers/config";
import { classify } from "../src/lib/providers/errors";
import { keyFor } from "../src/lib/providers/keys";
import { callOptions, makeModel, normaliseUsage, stepCountIs, streamText, systemMessages, toSdkTools } from "../src/lib/providers/sdk";
import { toModelMessages, type Finish, type HistoryEntry, type Resolved, type ToolCall, type Usage } from "../src/lib/providers/wire";
import type { AssistantModelMessage } from "ai";

const STEP_TIMEOUT_MS = 120_000;
const MAX_ROUNDS = 4;
const DOCS = join(process.cwd(), "docs", "PROVIDERS.md");
const MARKER = "<!-- smoke-results -->";

// A tiny made-up repo: the model sees this summary and canned tool results, never real code.
const SUMMARY = "# Repo: smoke-demo\nAreas (packages): app\n1 files, 1 in the map, 0 routes, 0 tables, 0 links (0 guesses).\n\nFiles: src/auth.ts (signin)";
const LOOP_QUESTION = "Where does sign-in happen? Call the search tool once with the query 'signin', then answer in one sentence citing the file.";
const TOUR_QUESTION = "Build a one-step tour of sign-in right away: call finish_tour now with file src/auth.ts, lines 12 to 14, and an empty node_ids list. Do not call any other tool.";
const CANNED: Record<string, string> = {
  search: "src/auth.ts:12: export async function signin(email: string, password: string) {",
  read_file: "src/auth.ts (lines 12-14 of 14)\n  12| export async function signin(email: string, password: string) {\n  13|   return db.users.check(email, password);\n  14| }",
  query_map: "No map node matches that query.",
  list_files: "src/\n  auth.ts (in map)",
  finish_tour: "Tour received.",
};

interface Step {
  finish: Finish;
  toolCalls: ToolCall[];
  usage: Usage;
  text: string;
  message: AssistantModelMessage;
  promptChars: number;
}

interface Outcome {
  provider: ProviderId;
  model: string;
  effort: Effort;
  failures: string[];
  notes: string[];
  usd: number | null;
}

function args(argv: string[]): { provider?: string; model?: string; effort?: string; record: boolean } {
  const out: { provider?: string; model?: string; effort?: string; record: boolean } = { record: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--record") out.record = true;
    else if (a === "--provider" || a === "--model" || a === "--effort") out[a.slice(2) as "provider" | "model" | "effort"] = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

/** One model step, exactly as src/lib/providers/ask.ts runs it. */
async function step(r: Resolved, key: string, mode: "ask" | "tour", history: HistoryEntry[]): Promise<Step> {
  const system = systemMessages(mode, SUMMARY, r.provider);
  let failed: unknown;
  const result = streamText({
    model: makeModel(r, key),
    tools: toSdkTools(mode, r.provider),
    messages: [...system, ...toModelMessages(history)],
    stopWhen: stepCountIs(1),
    abortSignal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    onError: ({ error }) => {
      failed = error;
    },
    ...callOptions(r, SUMMARY),
  });
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
    else if (part.type === "error") {
      failed = part.error;
      break;
    }
  }
  if (failed !== undefined) throw failed;
  const [response, finish, toolCalls, usage] = await Promise.all([result.response, result.finishReason, result.toolCalls, result.usage]);
  const message = response.messages[0];
  if (!message || message.role !== "assistant") throw new Error("The provider sent no assistant message.");
  const tools = [...TOOLS, ...(mode === "tour" ? [TOUR_TOOL] : [])];
  return {
    finish,
    toolCalls: toolCalls.map((t) => ({ toolCallId: t.toolCallId, toolName: t.toolName, input: (t.input ?? {}) as Record<string, unknown> })),
    usage: normaliseUsage(usage),
    text,
    message,
    promptChars: JSON.stringify(system).length + JSON.stringify(history).length + JSON.stringify(tools).length,
  };
}

function results(calls: ToolCall[]): HistoryEntry {
  return { role: "tool", content: calls.map((c) => ({ type: "tool-result", toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "text", value: CANNED[c.toolName] ?? "Unknown tool." } })) };
}

function describeStep(label: string, n: number, s: Step, r: Resolved): string {
  const calls = s.toolCalls.map((c) => `${c.toolName}(${c.toolCallId})`).join(", ") || "-";
  const u = s.usage;
  const tokens = u.known ? `in ${u.input_tokens} +${u.cache_read_input_tokens} cached +${u.cache_creation_input_tokens} written, out ${u.output_tokens} (${u.reasoning_tokens} reasoning)` : "usage not reported";
  const { price } = priceFor(r.provider, r.model);
  const cost = price && u.known ? `$${costOf(price, u).toFixed(4)}` : "unpriced";
  return `  ${label.padEnd(4)} step ${n}  ${s.finish.padEnd(10)} ${calls}  ${tokens}  ${cost}`;
}

/** Checks every step shares: usable ids and real usage. */
function checkStep(o: Outcome, label: string, n: number, s: Step): void {
  const ids = s.toolCalls.map((c) => c.toolCallId);
  if (ids.some((id) => typeof id !== "string" || id.length === 0)) o.failures.push(`${label} step ${n}: a tool call has no id`);
  if (new Set(ids).size !== ids.length) o.failures.push(`${label} step ${n}: duplicate tool call ids`);
  if (!s.usage.known || s.usage.input_tokens + s.usage.cache_read_input_tokens + s.usage.cache_creation_input_tokens === 0 || s.usage.output_tokens === 0) {
    o.failures.push(`${label} step ${n}: no usable usage reported`);
  }
}

/**
 * The catalogue cross-check: input tokens should be near the prompt's size
 * (about four characters a token), and the metered cost should never be more
 * than twice what the catalogue's uncached price predicts for those tokens.
 * Caching can only make it cheaper, so there is no lower bound on cost.
 */
function checkCost(o: Outcome, r: Resolved, steps: Step[]): void {
  const { price } = priceFor(r.provider, r.model);
  if (!price) {
    o.notes.push("unpriced");
    return;
  }
  let actual = 0;
  let estimate = 0;
  for (const s of steps) {
    if (!s.usage.known) continue;
    const metered = s.usage.input_tokens + s.usage.cache_read_input_tokens + s.usage.cache_creation_input_tokens;
    const guessed = Math.ceil(s.promptChars / 4);
    if (metered > guessed * 2 || metered < guessed / 2) o.notes.push(`input ${metered} tokens vs ~${guessed} estimated`);
    actual += costOf(price, s.usage);
    estimate += costOf(price, { ...s.usage, input_tokens: guessed, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  }
  o.usd = actual;
  if (actual > estimate * 2) o.failures.push(`cost $${actual.toFixed(4)} is more than twice the catalogue estimate $${estimate.toFixed(4)}`);
}

async function smoke(provider: ProviderId, model: string | undefined, effort: Effort): Promise<Outcome> {
  const p = PROVIDERS[provider];
  // Without --model: the saved choice when it is for this provider (the only source for local), else the default.
  const saved = resolve().resolved;
  const r: Resolved = { provider, model: model ?? (saved.provider === provider && saved.model ? saved.model : p.default_model), effort };
  if (p.base_url_editable) r.base_url = localBaseUrl();
  const o: Outcome = { provider, model: r.model, effort, failures: [], notes: [], usd: null };
  console.log(`\n${p.label} · ${r.model || "(no model)"} · effort ${effort}${r.base_url ? ` · ${r.base_url}` : ""}`);

  const notReady = await readiness(r);
  if (notReady) {
    o.failures.push(`${notReady.title}. ${notReady.message}`);
    return o;
  }
  const key = keyFor(provider);
  if (!key) {
    o.failures.push("no key");
    return o;
  }
  if (!p.models_freeform && !modelFor(p, r.model)) o.notes.push("model not in the catalogue");

  const steps: Step[] = [];
  try {
    // The loop: search first, then an answer.
    const history: HistoryEntry[] = [{ role: "user", content: LOOP_QUESTION }];
    for (let n = 1; n <= MAX_ROUNDS; n++) {
      const s = await step(r, key.value, "ask", history);
      steps.push(s);
      console.log(describeStep("loop", n, s, r));
      checkStep(o, "loop", n, s);
      if (n === 1 && (s.finish !== "tool-calls" || !s.toolCalls.some((c) => c.toolName === "search" && typeof c.input.query === "string"))) {
        o.failures.push(`loop step 1: expected a search call, got finish '${s.finish}'`);
        break;
      }
      if (s.finish !== "tool-calls") {
        if (s.finish !== "stop") o.failures.push(`loop step ${n}: finished '${s.finish}', expected 'stop'`);
        else if (!s.text.trim()) o.failures.push(`loop step ${n}: stopped with no answer`);
        if (n > 2) o.notes.push(`loop took ${n} steps`);
        break;
      }
      if (n === MAX_ROUNDS) o.failures.push(`loop: still calling tools after ${MAX_ROUNDS} steps`);
      history.push({ role: "assistant", message: s.message }, results(s.toolCalls));
    }

    // The tour: finish_tour with a schema-valid body (strict where the provider honours it).
    const tourHistory: HistoryEntry[] = [{ role: "user", content: TOUR_QUESTION }];
    for (let n = 1; n <= MAX_ROUNDS; n++) {
      const s = await step(r, key.value, "tour", tourHistory);
      steps.push(s);
      console.log(describeStep("tour", n, s, r));
      checkStep(o, "tour", n, s);
      const tour = s.toolCalls.find((c) => c.toolName === "finish_tour");
      if (tour) {
        const stepsIn = tour.input.steps;
        if (typeof tour.input.title !== "string" || !Array.isArray(stepsIn) || stepsIn.length === 0) o.failures.push("tour: finish_tour input does not match its schema");
        if (p.strict_tools) o.notes.push("finish_tour sent strict");
        break;
      }
      if (s.finish !== "tool-calls" || n === MAX_ROUNDS) {
        o.failures.push(`tour: no finish_tour call (finish '${s.finish}')`);
        break;
      }
      tourHistory.push({ role: "assistant", message: s.message }, results(s.toolCalls));
    }
  } catch (e) {
    const fe = classify(e, provider, r.base_url);
    o.failures.push(`${fe.title}. ${fe.message}${fe.detail ? ` (${fe.detail})` : ""}`);
  }
  if (steps.length > 0) checkCost(o, r, steps);
  return o;
}

function row(o: Outcome, date: string): string {
  const result = o.failures.length === 0 ? "pass" : "FAIL";
  const detail = [...o.failures, ...o.notes].join("; ").replace(/\|/g, "/") || "-";
  const usd = o.usd === null ? "-" : `$${o.usd.toFixed(4)}`;
  return `| ${date} | ${o.provider} | \`${o.model}\` | ${o.effort} | ${result} | ${usd} | ${detail} |`;
}

/** Add the rows to the top of the results table that follows the marker in docs/PROVIDERS.md, newest first. */
function record(rows: string[]): void {
  const lines = readFileSync(DOCS, "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === MARKER);
  if (at === -1 || !lines[at + 2]?.startsWith("|---")) throw new Error(`No ${MARKER} line followed by a table in docs/PROVIDERS.md.`);
  lines.splice(at + 3, 0, ...rows);
  writeFileSync(DOCS, lines.join("\n"), "utf8");
}

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const a = args(process.argv.slice(2));
  const effort = (a.effort ?? "medium") as Effort;
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`Unknown effort: ${effort}`);

  let targets: ProviderId[];
  if (a.provider) {
    const p = providerFor(a.provider);
    if (!p) throw new Error(`Unknown provider: ${a.provider}. One of: ${PROVIDER_IDS.join(", ")}`);
    targets = [p.id];
  } else {
    if (a.model) throw new Error("--model needs --provider.");
    targets = PROVIDER_IDS.filter((id) => PROVIDERS[id].env !== null && keyFor(id) !== null);
  }
  if (targets.length === 0) {
    console.log("No provider has a key. Add one in Settings or .env.local, or pass --provider local.");
    return 1;
  }

  const outcomes: Outcome[] = [];
  for (const id of targets) outcomes.push(await smoke(id, a.model, effort));

  console.log("");
  for (const o of outcomes) {
    console.log(`${o.failures.length === 0 ? "PASS" : "FAIL"}  ${o.provider} ${o.model}${o.usd === null ? "" : `  $${o.usd.toFixed(4)}`}`);
    for (const f of o.failures) console.log(`      ${f}`);
    for (const n of o.notes) console.log(`      note: ${n}`);
  }
  if (a.record) {
    const date = new Date().toISOString().slice(0, 10);
    record(outcomes.map((o) => row(o, date)));
    console.log(`\nRecorded ${outcomes.length} row(s) in docs/PROVIDERS.md.`);
  }
  return outcomes.every((o) => o.failures.length === 0) ? 0 : 1;
}

// exitCode rather than exit(): a hard exit while fetch's sockets are closing trips a libuv assertion on Windows.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
