"use client";
// Talking to the provider settings endpoints from the page: GET /api/config (the
// catalogue, the saved choice, readiness), POST /api/config (save a choice) and
// POST / DELETE /api/config/key (a key goes up once; only `has_key` comes back).
// Saving fires `settings-saved`, so the guide starts fresh and the pill re-reads.
import type { Effort, ProviderId } from "@/lib/providers/catalogue";
import type { FriendlyError } from "@/lib/providers/wire";
import type { AiConfig } from "./aiPill";

export type KeyStanding = { has_key: boolean; source: "settings" | "env" | null; found?: string };

/** The error text a config endpoint put in its body, or the status. */
export async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string | FriendlyError };
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object") return `${body.error.title}. ${body.error.message}`;
  } catch {}
  return `The WalkMyCode server answered ${res.status}.`;
}

export async function loadConfig(signal?: AbortSignal): Promise<AiConfig> {
  const res = await fetch("/api/config", { signal });
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()) as AiConfig;
}

async function send(url: string, method: "POST" | "DELETE", body: unknown): Promise<Response> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorOf(res));
  return res;
}

/** Tell the rest of the page which model now answers. */
export function announceSaved(provider: string, model: string): void {
  window.dispatchEvent(new CustomEvent("settings-saved", { detail: { provider, model } }));
}

/** Save who answers; null when a question can be asked now, else what is still wrong. */
export async function saveChoice(body: { provider: ProviderId; model: string; effort: Effort; local_base_url?: string }): Promise<FriendlyError | null> {
  const res = await send("/api/config", "POST", body);
  // POST /api/config answers { ok, readiness: { llm } }, as GET does.
  const { readiness } = (await res.json()) as { readiness?: { llm: FriendlyError | null } };
  announceSaved(body.provider, body.model);
  return readiness?.llm ?? null;
}

/** Save a pasted key; the value goes up once and never comes back. */
export async function saveKey(envVar: string, value: string): Promise<void> {
  await send("/api/config/key", "POST", { env_var: envVar, value });
}

/** Copy the key another WalkMyCode on this computer saved (the value stays on the server). */
export async function copyFoundKey(envVar: string): Promise<void> {
  await send("/api/config/key", "POST", { env_var: envVar, use_found: true });
}

/** Remove a key saved in Settings; one in .env.local still counts, and the answer says so. */
export async function removeKey(envVar: string): Promise<{ has_key: boolean }> {
  const res = await send("/api/config/key", "DELETE", { env_var: envVar });
  return (await res.json()) as { has_key: boolean };
}
