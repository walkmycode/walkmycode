// The rules behind the "Who should answer your questions?" sheet
// (src/components/SetupAI.tsx, docs/design/home-redesign.html screen 2): which
// option starts selected, the provider chips, what an explanation costs, whether a
// pasted key looks like the provider's, and what Continue does. Plain code, no
// React; only the sheet (loaded when it opens) imports it.
import { costOf, priceFor } from "@/lib/cost";
import { PROVIDER_IDS, PROVIDERS, type Effort, type ProviderId } from "@/lib/providers/catalogue";
import type { Usage } from "@/lib/providers/wire";
import type { AiConfig } from "./aiPill";

export type SetupOption = "claude" | "key" | "local";

/** Brand letter and colour for each keyed provider's chip; a provider added to the catalogue
 * later still gets a chip, with its first letter. */
const MARKS: Partial<Record<ProviderId, { name: string; mark: string; color: string }>> = {
  anthropic: { name: "Claude", mark: "A", color: "#d97757" },
  openai: { name: "OpenAI", mark: "O", color: "#e8e8e8" },
  gemini: { name: "Gemini", mark: "G", color: "#8ab4f8" },
  groq: { name: "Groq", mark: "Q", color: "#f55036" },
  deepseek: { name: "DeepSeek", mark: "D", color: "#4d6bfe" },
  xai: { name: "xAI", mark: "X", color: "#cfcfcf" },
};

export interface KeyChip {
  id: ProviderId;
  name: string;
  mark: string;
  color: string;
  env: string;
  url: string;
}

/** Every provider that takes a key, in catalogue order. */
export function keyChips(): KeyChip[] {
  return PROVIDER_IDS.flatMap((id) => {
    const p = PROVIDERS[id];
    if (p.env === null) return [];
    const m = MARKS[id] ?? { name: p.label.replace(/\s*\(.*\)$/, ""), mark: p.label[0].toUpperCase(), color: "#cfcfcf" };
    return [{ id, ...m, env: p.env, url: p.url }];
  });
}

/** The option and provider the sheet opens on: what is already chosen, else the recommended
 * option (the user's Claude subscription) with Claude ready under "Paste an API key". */
/** The apps that answer on the user's own subscription, in the order the sheet offers them. */
export const PLANS: { id: "claude-code" | "codex" | "gemini-cli"; name: string; mark: string; color: string }[] = [
  { id: "claude-code", name: "Claude", mark: "A", color: "#d97757" },
  { id: "codex", name: "ChatGPT", mark: "O", color: "#e8e8e8" },
  { id: "gemini-cli", name: "Gemini", mark: "G", color: "#8ab4f8" },
];

/** The subscription app the sheet starts on: the saved one if it is one, else Claude. */
export function firstPlan(cfg: Pick<AiConfig, "saved"> | null): (typeof PLANS)[number]["id"] {
  return PLANS.find((p) => p.id === cfg?.saved.provider)?.id ?? "claude-code";
}

export function firstChoice(cfg: Pick<AiConfig, "saved" | "source"> | null): { option: SetupOption; provider: ProviderId } {
  const saved = cfg?.saved.provider;
  const keyed = keyChips().map((c) => c.id as string);
  if (!cfg || cfg.source === "default" || !saved) return { option: "claude", provider: "anthropic" };
  if (saved === "local") return { option: "local", provider: "anthropic" };
  if (keyed.includes(saved)) return { option: "key", provider: saved as ProviderId };
  return { option: "claude", provider: "anthropic" };
}

/** The model a provider starts on: the saved one when it is the saved provider, else its default. */
export function startModel(cfg: Pick<AiConfig, "saved"> | null, provider: ProviderId): string {
  if (cfg && cfg.saved.provider === provider && cfg.saved.model) return cfg.saved.model;
  return PROVIDERS[provider].default_model;
}

/** "claude-opus-5-5" → "Claude Opus 5.5", from the catalogue's label; an id it does not list as it is. */
export function catalogueName(provider: ProviderId, model: string): string {
  const m = PROVIDERS[provider]?.models.find((x) => x.id === model);
  return m ? m.label.split(" — ")[0].trim() : model;
}

/** The effort the sheet starts on. */
export function startEffort(cfg: Pick<AiConfig, "saved"> | null): Effort {
  return cfg?.saved.effort ?? "medium";
}

/** One explanation of a highlight: about 6k tokens in, 600 out.
 * Claude models from 4.7 on count about 30% more tokens for the same text. */
const EXPLAIN: Usage = { input_tokens: 6000, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0, known: true };
const CLAUDE_TOKENS = 1.3;

/** What one explanation costs on a model, in US dollars; null when it has no published price (local). */
export function explainCost(provider: ProviderId, model: string): number | null {
  const { price } = priceFor(provider, model);
  if (!price) return null;
  return costOf(price, EXPLAIN) * (provider === "anthropic" ? CLAUDE_TOKENS : 1);
}

/** "about $0.05 an explanation", "under a cent an explanation", or "free" for a local model. */
export function aboutCost(usd: number | null): string {
  if (usd === null) return "free";
  if (usd < 0.01) return "under a cent an explanation";
  return `about $${usd.toFixed(2)} an explanation`;
}

/** The line a working key earns: "✓ Key works · Claude Opus 5.5 · about $0.05 an explanation". */
export function keyWorksLine(model: string, usd: number | null): string {
  return `✓ Key works · ${model} · ${aboutCost(usd)}`;
}

/** How each provider's keys start, most distinctive first (OpenAI and DeepSeek share "sk-"). */
const SHAPES: { id: ProviderId; re: RegExp; start: string }[] = [
  { id: "anthropic", re: /^sk-ant-/, start: "sk-ant-" },
  { id: "groq", re: /^gsk_/, start: "gsk_" },
  { id: "xai", re: /^xai-/, start: "xai-" },
  { id: "gemini", re: /^AIza/, start: "AIza" },
  { id: "openai", re: /^sk-(?!ant-)/, start: "sk-" },
  { id: "deepseek", re: /^sk-(?!ant-)/, start: "sk-" },
];

/** "an OpenAI", "an xAI", "a Claude". */
const article = (s: string) => (/^[aeiou]/i.test(s) || /^x[A-Z]/.test(s) ? "an" : "a");

/** The key field's placeholder: "sk-ant-…". */
export function keyPlaceholder(provider: ProviderId): string {
  const s = SHAPES.find((x) => x.id === provider);
  return s ? `${s.start}…` : "Paste your key…";
}

/** A gentle word when a pasted key does not look like the provider's (it is still saved:
 * the provider has the last word); null when it looks right. */
export function keyWarning(provider: ProviderId, key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (/\s/.test(k)) return "Paste just the key: this has a space or a line break in it.";
  const mine = SHAPES.find((x) => x.id === provider);
  if (!mine || mine.re.test(k)) return null;
  const name = (id: ProviderId) => MARKS[id]?.name ?? PROVIDERS[id].label;
  // Keys that start alike belong to either provider: "an OpenAI or DeepSeek key".
  const others = SHAPES.filter((x) => x.id !== provider && x.start !== mine.start && x.re.test(k)).map((x) => name(x.id));
  if (others.length) return `That looks like ${article(others[0])} ${others.join(" or ")} key, not ${article(name(provider))} ${name(provider)} one.`;
  return `${name(provider)} keys usually start with ${mine.start}`;
}

/** The badge on "Run a model on this computer" once the local server answered with its models. */
export function localBadge(baseUrl: string, models: string[]): string | null {
  if (!models.length) return null;
  if (/:1234(\/|$)/.test(baseUrl)) return "LM Studio found";
  if (/:11434(\/|$)/.test(baseUrl)) return "Ollama found";
  return "Local server found";
}

/** What Continue does: close the sheet, save the choice first, or nothing yet (and why). */
export function continueStep(s: { option: SetupOption; keyTyped: boolean; hasKey: boolean; model: string }): { step: "close" | "save" } | { step: "blocked"; why: string } {
  if (s.option === "claude") return { step: "save" }; // answers here through Claude Code (provider "claude-code")
  if (s.option === "key") return s.keyTyped || s.hasKey ? { step: "save" } : { step: "blocked", why: "Paste a key first, or pick another way to answer." };
  return s.model.trim() ? { step: "save" } : { step: "blocked", why: "Pick a model your local server has." };
}
