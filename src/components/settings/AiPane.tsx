"use client";
// Settings → AI model (docs/design/home-redesign.html, screen 3): who answers
// now and whether they can, with Change (the setup sheet, src/components/SetupAI.tsx);
// the model and thinking effort, saved as soon as they change; the keys on this
// computer; and which model to pick, priced per explanation. When the viewer's
// own Claude answers (WalkMyCode Lite, WalkMyCode for Claude) there is nothing to pick
// and no key: the pane says so.
import { useState } from "react";
import { useAiName, useStandalone } from "@/lib/aiName";
import { openSetup, modelName } from "@/lib/aiPill";
import { capName, FALLBACK_CLIENT } from "@/lib/bridge/clientName";
import { saveChoice } from "@/lib/aiConfig";
import { refreshAi, useAiStatus } from "@/lib/aiStatus";
import { PROVIDERS, providerFor, type Effort, type ProviderId } from "@/lib/providers/catalogue";
import { aboutCost, explainCost, keyChips, keyPlaceholder } from "@/lib/setupOptions";
import type { AiRoute } from "@/lib/adapters/select";
import type { Answers } from "@/lib/settingsNav";
import { Box, Cols, KeyLine, Status } from "./parts";

const EFFORTS: Effort[] = ["low", "medium", "high"];
const CHIPS = keyChips();
const LOCAL_MARK = { mark: "L", color: "#a8e0a0" };
const PLAN_MARKS: Record<string, { mark: string; color: string; plan: string }> = {
  "claude-code": { mark: "A", color: "#d97757", plan: "your Claude plan" },
  codex: { mark: "O", color: "#e8e8e8", plan: "your ChatGPT plan" },
  "gemini-cli": { mark: "G", color: "#8ab4f8", plan: "your Google account" },
};

/** "Anthropic (Claude)" → "Anthropic". */
const shortLabel = (label: string) => label.replace(/\s*\(.*\)$/, "");

export default function AiPane({ answers, route }: { answers: Answers; route?: AiRoute | null }) {
  const standalone = useStandalone();
  if (answers !== "claude") return <ProviderAnswers />;
  if (route !== "bridge") return <ClaudeAnswers route={route ?? null} />;
  // Started from a terminal with no AI app: the key here answers everything.
  if (standalone) return <StandaloneAnswers />;
  // WalkMyCode's MCP page: the AI app answers; a key of the user's own answers here when it isn't listening.
  return (
    <>
      <ClaudeAnswers route={route} />
      <OwnKeyAnswers />
    </>
  );
}

/** The MCP page's own provider and key: optional, used only when the AI app isn't listening (src/lib/bridge/fallback.ts). */
function OwnKeyAnswers() {
  const who = useAiName();
  return (
    <section className="sv-own" aria-label="Answer here with your own key">
      <h3 className="sv-own-title">When {who} isn&apos;t listening</h3>
      <p className="sv-text">
        Some AI apps stop listening to WalkMyCode after a task. Then WalkMyCode can answer here with a key of your own: pick a provider and paste its key (or use a model on this computer). Optional: without
        one, the page asks you to bring {who} back.
      </p>
      <ProviderAnswers embedded />
    </section>
  );
}

/** WalkMyCode started from a terminal (no AI app connected): a provider and key of the user's own answer every question. */
function StandaloneAnswers() {
  return (
    <section className="sv-own" aria-label="Answer here with your own key">
      <h3 className="sv-own-title">Answers come from the model you pick here</h3>
      <p className="sv-text">
        WalkMyCode was started from a terminal, so no AI app is connected: pick a provider and paste its key (or use a model on this computer) to ask questions, explain and take tours. A key set as
        ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY when WalkMyCode started counts too.
      </p>
      <ProviderAnswers embedded />
    </section>
  );
}

/** The viewer's own Claude answers: no model, no key. */
function ClaudeAnswers({ route }: { route: AiRoute | null }) {
  // WalkMyCode's MCP page: the AI app connected to it (Claude, Antigravity, Cursor…), by name.
  const who = useAiName();
  const bridge = route === "bridge";
  return (
    <Cols>
      <div>
        <Box label="Answering now">
          <div className="sv-cur">
            <span className="sv-mark" style={{ background: "#d97757" }} aria-hidden>
              {bridge ? (who === FALLBACK_CLIENT ? "AI" : who[0].toUpperCase()) : "C"}
            </span>
            <div>
              <b>{bridge ? (who === FALLBACK_CLIENT ? "Your AI app" : `Your AI: ${who}`) : "Your Claude"}</b>
              <span>{bridge ? "Answers come from the AI app WalkMyCode is connected to · no key, no extra cost" : "Answers come from your Claude plan · no key, no extra cost"}</span>
            </div>
          </div>
          {route === "none" && <p className="sv-warn">This page is not open inside Claude, so asking is off here. The map, the code and tracing work as they are.</p>}
        </Box>
      </div>
      <div>
        <Box label="How it works">
          {route === "bridge" ? (
            <p className="sv-text">
              {capName(who)} answers: the AI app that opened this page (Claude Desktop, Claude Code, Antigravity, Cursor or another MCP app), on your own plan. It reads the lines it needs through WalkMyCode&apos;s tools; WalkMyCode never sees your sign-in, and no key is needed.
            </p>
          ) : (
            <p className="sv-text">When you ask, the lines the question needs go to Claude, inside Claude, on your own plan, and nowhere else. There is no model to pick and no key to paste.</p>
          )}
        </Box>
      </div>
    </Cols>
  );
}

/** `embedded`: inside the MCP page's AI pane, where there is no setup sheet: the provider is picked right here. */
function ProviderAnswers({ embedded = false }: { embedded?: boolean }) {
  const status = useAiStatus();
  const [pending, setPending] = useState<{ model?: string; effort?: Effort; url?: string }>({});
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (status.state === "loading") return <p className="sv-loading">Loading…</p>;
  if (status.state === "failed")
    return (
      <Box label="Answering now">
        <p className="sv-warn">Can&apos;t reach the WalkMyCode server. {status.message}</p>
        <button type="button" className="hbtn small" onClick={() => void refreshAi()}>
          Try again
        </button>
      </Box>
    );

  const cfg = status.config;
  const id = cfg.saved.provider as ProviderId;
  const def = providerFor(id);
  const info = cfg.llm_providers.find((p) => p.id === id);
  const llm = cfg.readiness.llm;
  const model = pending.model ?? cfg.saved.model;
  const effort = pending.effort ?? cfg.saved.effort;
  const localUrl = pending.url ?? cfg.saved.local_base_url;
  const chip = CHIPS.find((c) => c.id === id);
  const mark = chip ?? PLAN_MARKS[id] ?? LOCAL_MARK;
  const isLocal = def?.models_freeform ?? false;
  const isCli = def?.wire === "cli";
  const keyWhere = isCli ? (PLAN_MARKS[id]?.plan ?? "your plan") : isLocal ? "on this computer" : info?.has_key ? (info.source === "env" ? "key from .env.local" : "your key") : "no key yet";

  async function save(patch: { model?: string; effort?: Effort; url?: string }) {
    if (!def) return;
    const next = { model: patch.model ?? model, effort: patch.effort ?? effort, url: patch.url ?? localUrl };
    setPending(next);
    setSaving(true);
    setSaved(null);
    try {
      const notReady = await saveChoice({ provider: id, model: next.model.trim(), effort: next.effort, ...(isLocal ? { local_base_url: next.url.trim() } : {}) });
      setSaved(notReady ? { ok: false, text: `Saved, but ${notReady.title.toLowerCase()}` } : { ok: true, text: "Saved" });
      await refreshAi();
      setPending({});
    } catch (e) {
      setSaved({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  /** Another provider, with its default model (the MCP page picks it here; the app has the setup sheet). */
  async function choose(next: ProviderId) {
    const p = providerFor(next);
    if (!p || next === id) return;
    setSaving(true);
    setSaved(null);
    try {
      // A local server has no default model: take the first one it offers, or say how to get one
      // (saving "" was refused as "Unknown model for local").
      let model = p.default_model;
      const url = (localUrl ?? "").trim() || (PROVIDERS.local.base_url ?? "");
      if (p.models_freeform && !model) {
        const found = (await fetch(`/api/config/models?provider=${next}`)
          .then((r) => (r.ok ? r.json() : { models: [] }))
          .catch(() => ({ models: [] }))) as { models?: string[] };
        model = found.models?.[0] ?? "";
        if (!model) {
          setSaved({ ok: false, text: `No model server answered at ${url}. Start Ollama or LM Studio with a model pulled, then pick ${p.label} again.` });
          return;
        }
      }
      const notReady = await saveChoice({ provider: next, model, effort, ...(p.models_freeform ? { local_base_url: url } : {}) });
      setSaved(notReady ? { ok: false, text: `Saved, but ${notReady.title.toLowerCase()}` } : { ok: true, text: "Saved" });
      await refreshAi();
      setPending({});
    } catch (e) {
      setSaved({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Cols>
      <div>
        <Box label="Answering now">
          <div className="sv-cur">
            <span className="sv-mark" style={{ background: mark.color }} aria-hidden>
              {mark.mark}
            </span>
            <div>
              <b>{modelName(cfg)}</b>
              <span>
                {shortLabel(info?.label ?? id)} · {keyWhere} · <i className={llm ? "warn" : "ok"}>{llm ? "not ready" : "ready"}</i>
              </span>
            </div>
            {embedded ? (
              <select className="sv-select" value={id} onChange={(e) => void choose(e.target.value as ProviderId)} aria-label="Provider" disabled={saving}>
                {cfg.llm_providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {shortLabel(p.label)}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="hbtn small" onClick={openSetup}>
                Change
              </button>
            )}
          </div>
          {llm && (
            <p className="sv-warn">
              <b>{llm.title}.</b> {llm.message}
            </p>
          )}
          {def && <p className="sv-hint">{def.privacy}</p>}
        </Box>
        <div className="sv-two">
          <Box label="Model">
            {isLocal ? (
              <>
                <input
                  className="sv-input mono"
                  defaultValue={model}
                  key={`m-${cfg.saved.model}`}
                  placeholder="Model id, e.g. llama3.1:8b"
                  spellCheck={false}
                  aria-label="Model id"
                  onBlur={(e) => e.currentTarget.value.trim() !== cfg.saved.model && void save({ model: e.currentTarget.value })}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <input
                  className="sv-input mono"
                  defaultValue={localUrl}
                  key={`u-${cfg.saved.local_base_url}`}
                  placeholder={PROVIDERS.local.base_url}
                  spellCheck={false}
                  aria-label="Server URL"
                  onBlur={(e) => e.currentTarget.value.trim() !== cfg.saved.local_base_url && void save({ url: e.currentTarget.value })}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </>
            ) : (
              <select className="sv-select" value={model} onChange={(e) => void save({ model: e.target.value })} aria-label="Model" disabled={saving}>
                {model && !def?.models.some((m) => m.id === model) && <option value={model}>{model} — not in the list</option>}
                {def?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label.split(" — ")[0]}
                  </option>
                ))}
              </select>
            )}
            <p className="sv-hint">
              {def?.hint} <Status s={saved} />
            </p>
          </Box>
          {!isCli && (
            <Box label="Thinking effort">
              <div className="sv-seg" role="radiogroup" aria-label="Thinking effort">
                {EFFORTS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={effort === e} className={effort === e ? "on" : undefined} disabled={saving} onClick={() => effort !== e && void save({ effort: e })}>
                    {e[0].toUpperCase() + e.slice(1)}
                  </button>
                ))}
              </div>
              <p className="sv-hint">Low is cheapest and fastest. Anthropic: thinking effort; others: reasoning effort where the model has one.</p>
            </Box>
          )}
        </div>
      </div>
      <div>
        <Box label="Keys on this computer">
          <div className="sv-keys">
            {cfg.llm_providers
              .filter((p) => p.env)
              .map((p) => (
                <KeyLine
                  key={p.id}
                  envVar={p.env!}
                  label={shortLabel(p.label)}
                  standing={{ has_key: p.has_key, source: p.source ?? null }}
                  prefix={keyPlaceholder(p.id as ProviderId).replace("…", "")}
                  url={p.url}
                  hint={`Saved to .walkmycode/keys.env on this computer, read only by the WalkMyCode server, sent only to ${p.label}.`}
                  onChanged={() => void refreshAi()}
                />
              ))}
            {isLocal && <KeyLine envVar="LOCAL_API_KEY" label="Local server token" standing={null} hint="Only for servers that ask for a bearer token, such as LM Studio with LM_API_TOKEN set. Ollama ignores it." onChanged={() => void refreshAi()} />}
          </div>
        </Box>
        <Box label="Which should I pick?">
          {isLocal ? (
            <p className="sv-text">A model on this computer is free and fully private; how well it explains depends on the model. Bigger models answer better and slower.</p>
          ) : (
            <ul className="sv-pick">
              {def?.models.map((m) => {
                const [name, why] = m.label.replace(" (default)", "").split(" — ");
                return (
                  <li key={m.id} className={m.id === model ? "on" : undefined}>
                    <b>{name}</b>
                    <span>{why}</span>
                    <em>{isCli ? "on your plan" : aboutCost(explainCost(id, m.id))}</em>
                  </li>
                );
              })}
            </ul>
          )}
          {!embedded && <p className="sv-hint">Or let Claude answer on your subscription, at no extra cost, in a tab Claude opens: Change → Use my Claude subscription shows how.</p>}
        </Box>
      </div>
    </Cols>
  );
}
