// The top bar's AI pill (docs/design/home-redesign.html): who answers, and
// whether they can right now. "● AI · Claude Opus 5.5" when readiness passes,
// an amber "Set up AI" when it does not. Plain code, no React, so tests read it;
// the store that fetches GET /api/config is src/lib/aiStatus.ts.
import type { ErrorCode, FriendlyError } from "@/lib/providers/wire";

/** GET /api/config, as far as the pill and the setup sheet read it. Keys never appear in it. */
export interface AiConfig {
  saved: { provider: string; model: string; effort: "low" | "medium" | "high"; local_base_url: string };
  source: "config" | "env" | "default";
  llm_providers: {
    id: string;
    label: string;
    env: string | null;
    has_key: boolean;
    /** Where the key comes from: saved in Settings, or .env.local. */
    source?: "settings" | "env" | null;
    models: { id: string; label: string }[];
    models_freeform: boolean;
    default_model: string;
    url: string;
    base_url: string | null;
  }[];
  readiness: { llm: FriendlyError | null };
}

export type AiStatus = { state: "loading" } | { state: "ok"; config: AiConfig } | { state: "failed"; message: string };

export type Pill = { kind: "loading" } | { kind: "ready"; model: string; title: string } | { kind: "setup"; title: string };

/** "Claude Opus 5.5 — most capable (default)" → "Claude Opus 5.5"; a model the catalogue
 * does not list (a local one, a vendor's dated echo) by its id. */
export function modelName(cfg: Pick<AiConfig, "saved" | "llm_providers">): string {
  const { provider, model } = cfg.saved;
  const p = cfg.llm_providers.find((x) => x.id === provider);
  if (!model) return p?.label ?? provider;
  const m = p?.models.find((x) => x.id === model) ?? p?.models.filter((x) => model.startsWith(x.id)).sort((a, b) => b.id.length - a.id.length)[0];
  return m ? m.label.split(" — ")[0].trim() : model;
}

/** What the pill shows for what /api/config said. */
export function pillState(s: AiStatus): Pill {
  if (s.state === "loading") return { kind: "loading" };
  if (s.state === "failed") return { kind: "setup", title: `Can't reach the WalkMyCode server. ${s.message}` };
  const llm = s.config.readiness.llm;
  if (llm) return { kind: "setup", title: `${llm.title}. ${llm.message}` };
  const model = modelName(s.config);
  const p = s.config.llm_providers.find((x) => x.id === s.config.saved.provider);
  const who = p?.env === null ? "a model on this computer" : `your ${(p?.label ?? s.config.saved.provider).replace(/\s*\(.*\)$/, "")} key`;
  return { kind: "ready", model, title: `${model} answers, on ${who}. Click to change it in Settings.` };
}

/** The errors that mean no AI is set up yet, as readiness reports them: nothing chosen, no
 * key, a model the provider does not offer, or a local server that is not running. */
const NOT_READY: readonly ErrorCode[] = ["no_model", "missing_key", "model_unavailable"];

export function isNotReady(e: FriendlyError | null | undefined): boolean {
  if (!e) return false;
  return NOT_READY.includes(e.code) || (e.code === "network" && e.provider === "local");
}

/** The window event that opens the setup sheet; its detail is the error that asked for it. */
export const SETUP_EVENT = "setup-ai";

let asked = false;

/** Called by the guide when an ask, explain or tour fails: the first time in this page that
 * it failed because no AI is set up, the setup sheet opens by itself. True when it did. */
export function aiNeeded(e: FriendlyError, open: (e: FriendlyError) => void = dispatchSetup): boolean {
  if (asked || !isNotReady(e)) return false;
  asked = true;
  open(e);
  return true;
}

/** Open the setup sheet now (Settings → AI model → Change). The top bar's pill hosts it. */
export function openSetup(): void {
  dispatchSetup({ code: "no_model", title: "Change who answers", message: "", action: "settings" });
}

/** Tests: forget that the sheet was already offered. */
export function resetAiNeeded(): void {
  asked = false;
}

function dispatchSetup(e: FriendlyError): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SETUP_EVENT, { detail: e }));
}
