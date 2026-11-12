"use client";
// "Who should answer your questions?" (docs/design/home-redesign.html, screen 2).
// Opened from the top bar's "Set up AI", and by itself the first time the guide
// finds no AI set up. Three ways to answer:
//   1. the user's Claude subscription: answered here through Claude Code on this computer
//      (provider "claude-code", src/lib/providers/cli.ts), or in a tab Claude opens with
//      WalkMyCode for Claude (docs/MCP.md §5);
//   2. an API key, saved through the existing POST /api/config/key, then the
//      choice through POST /api/config, whose readiness says whether it works;
//   3. a model on this computer (Ollama, LM Studio), found through
//      GET /api/config/models?provider=local.
// A key is read from its field only when it is sent, and the field is emptied
// once the server has it: it is never kept in React state, and never logged.
// Loaded only when it opens (AiPill), so no page pays for it up front.
import { AGENTS } from "@/lib/providers/agents";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import Sheet from "./Sheet";
import { LockIcon } from "./home/icons";
import type { AiStatus } from "@/lib/aiPill";
import { PROVIDERS, type Effort, type ProviderId } from "@/lib/providers/catalogue";
import { saveChoice, saveKey } from "@/lib/aiConfig";
import { aboutCost, catalogueName, continueStep, explainCost, firstChoice, firstPlan, PLANS, keyChips, keyPlaceholder, keyWarning, keyWorksLine, localBadge, startEffort, startModel, type SetupOption } from "@/lib/setupOptions";
import { linkStatus, mcpCommand, pluginCommands, type ClaudeLink } from "@/lib/claudeLink";
import { whyFailed } from "@/lib/unreachable";

const EFFORTS: Effort[] = ["low", "medium", "high"];
const OPTIONS: SetupOption[] = ["claude", "key", "local"];

/** A fetch that never reached the server throws a TypeError; the server's own refusals carry its words. */
const failure = whyFailed;


/** Arrow keys move through a radio group, as they do in a native one. */
function arrows<T>(e: React.KeyboardEvent, items: T[], current: T, pick: (t: T) => void, focusOf: (t: T) => HTMLElement | null) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = items[(items.indexOf(current) + step + items.length) % items.length];
  pick(next);
  focusOf(next)?.focus();
}

interface OptionProps {
  id: SetupOption;
  selected: boolean;
  title: string;
  desc: string;
  badge?: React.ReactNode;
  onPick: () => void;
  children?: React.ReactNode;
}

/** One way to answer: a radio row; what it needs opens under it once it is picked. */
function Option({ id, selected, title, desc, badge, onPick, children }: OptionProps) {
  return (
    <div
      className={`su-opt${selected ? " sel" : ""}`}
      onClick={(e) => {
        if (!(e.target as Element).closest(".su-more")) onPick();
      }}
    >
      <button type="button" className="su-hd" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} data-opt={id} {...(selected ? { "data-autofocus": "" } : {})}>
        <span className="su-radio" aria-hidden />
        <span className="su-txt">
          <span className="su-t">{title}</span>
          <span className="su-d">{desc}</span>
        </span>
        {badge}
      </button>
      {selected && children && <div className="su-more">{children}</div>}
    </div>
  );
}

export default function SetupAI({ status, onClose }: { status: AiStatus; onClose: () => void }) {
  const cfg = status.state === "ok" ? status.config : null;
  const chips = useMemo(() => keyChips(), []);
  const [first] = useState(() => firstChoice(cfg));
  // "Use my subscription": which app answers, Claude Code, Codex or the Gemini CLI.
  const [plan, setPlan] = useState(() => firstPlan(cfg));
  const plansRef = useRef<HTMLDivElement>(null);
  const [option, setOption] = useState<SetupOption>(first.option);
  const [provider, setProvider] = useState<ProviderId>(first.provider);
  const [model, setModel] = useState(() => startModel(cfg, first.provider));
  const [effort, setEffort] = useState<Effort>(() => startEffort(cfg));
  const [advanced, setAdvanced] = useState(false);
  const key = useRef<HTMLInputElement>(null);
  const [keyTyped, setKeyTyped] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  /** The provider whose key this sheet saved, before /api/config has been asked again. */
  const [savedKeyOf, setSavedKeyOf] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState<"test" | "continue" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [local, setLocal] = useState<{ models: string[]; asked: boolean }>({ models: [], asked: false });
  const [localTick, setLocalTick] = useState(0);
  const [localModel, setLocalModel] = useState(() => (cfg?.saved.provider === "local" ? cfg.saved.model : ""));
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<ClaudeLink | null>(null);
  const [linkTick, setLinkTick] = useState(0);
  const opts = useRef<HTMLDivElement>(null);
  const provs = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const chip = chips.find((c) => c.id === provider) ?? chips[0];
  const hasKey = !!cfg?.llm_providers.find((p) => p.id === provider)?.has_key || savedKeyOf === provider;
  const localUrl = cfg?.saved.local_base_url || PROVIDERS.local.base_url || "";
  const badge = localBadge(localUrl, local.models);

  // Is a local server running? Asked when the sheet opens, so "Ollama found" shows before
  // the option is picked, and again on "check again".
  useEffect(() => {
    let live = true;
    fetch("/api/config/models?provider=local")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .catch(() => ({ models: [] }))
      .then((d: { models?: string[] }) => {
        if (!live) return;
        const models = d.models ?? [];
        setLocal({ models, asked: true });
        setLocalModel((m) => m || models[0] || "");
      });
    return () => {
      live = false;
    };
  }, [localTick]);

  // This checkout's server bundle (for a command that works today) and whether
  // WalkMyCode for Claude is running, asked when the sheet opens and on "check again".
  useEffect(() => {
    let live = true;
    fetch("/api/claude-link")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d: ClaudeLink | null) => live && setLink(d ?? { bundle: null, running: null }));
    return () => {
      live = false;
    };
  }, [linkTick]);
  // The plugin when this checkout has its build (no permission prompt per tool); the plain MCP server otherwise.
  const plugin = pluginCommands(link);
  const command = plugin ? plugin.join("\n") : mcpCommand(link);
  const linkSaid = linkStatus(link);

  const pick = (o: SetupOption) => {
    if (o === option) return;
    setOption(o);
    setResult(null);
  };

  const pickProvider = (id: ProviderId) => {
    if (id === provider) return;
    setProvider(id);
    setModel(startModel(cfg, id));
    setResult(null);
    setWarning(keyWarning(id, key.current?.value ?? ""));
  };

  /** Save the key (when one is typed) and the choice; true when a question can be asked now. */
  async function saveKeyChoice(kind: "test" | "continue"): Promise<boolean> {
    if (busy) return false;
    const value = key.current?.value.trim() ?? "";
    if (!value && !hasKey) {
      setResult({ ok: false, text: "Paste a key first." });
      key.current?.focus();
      return false;
    }
    setBusy(kind);
    setResult(null);
    try {
      if (value) {
        await saveKey(chip.env, value);
        if (key.current) key.current.value = "";
        setKeyTyped(false);
        setWarning(null);
        setSavedKeyOf(provider);
      }
      const notReady = await saveChoice({ provider, model, effort });
      if (notReady) {
        setResult({ ok: false, text: `${notReady.title}. ${notReady.message}` });
        return false;
      }
      setResult({ ok: true, text: keyWorksLine(catalogueName(provider, model), explainCost(provider, model)) });
      return true;
    } catch (e) {
      setResult({ ok: false, text: failure(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveLocal(): Promise<boolean> {
    if (busy) return false;
    setBusy("continue");
    setResult(null);
    try {
      const notReady = await saveChoice({ provider: "local", model: localModel.trim(), effort, local_base_url: localUrl });
      if (notReady) {
        setResult({ ok: false, text: `${notReady.title}. ${notReady.message}` });
        return false;
      }
      return true;
    } catch (e) {
      setResult({ ok: false, text: failure(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveClaude(): Promise<boolean> {
    if (busy) return false;
    setBusy("continue");
    setResult(null);
    try {
      const notReady = await saveChoice({ provider: plan, model: PROVIDERS[plan].default_model, effort });
      if (notReady) {
        setResult({ ok: false, text: `${notReady.title}. ${notReady.message}` });
        return false;
      }
      return true;
    } catch (e) {
      setResult({ ok: false, text: failure(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onContinue() {
    const next = continueStep({ option, keyTyped, hasKey, model: option === "local" ? localModel : model });
    if (next.step === "close") return onClose();
    if (next.step === "blocked") {
      setResult({ ok: false, text: next.why });
      if (option === "key") key.current?.focus();
      return;
    }
    if (option === "claude" ? await saveClaude() : option === "key" ? await saveKeyChoice("continue") : await saveLocal()) onClose();
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the command is on screen to copy by hand */
    }
  };

  const said = result && (
    <p className={result.ok ? "su-ok" : "su-bad"} role="status">
      {result.text}
    </p>
  );

  return (
    <Sheet labelledBy={titleId} onClose={onClose} className="setup">
      <h2 id={titleId} className="sheet-title">
        Who should answer your questions?
      </h2>
      <p className="sheet-lead">The map is free and needs no AI. To explain code, pick who answers — once. You can change it any time in Settings.</p>

      <div
        ref={opts}
        className="su-opts"
        role="radiogroup"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if ((e.target as Element).closest(".su-hd")) arrows(e, OPTIONS, option, pick, (o) => opts.current?.querySelector<HTMLElement>(`[data-opt="${o}"]`) ?? null);
        }}
      >
        <Option id="claude" selected={option === "claude"} onPick={() => pick("claude")} title="Use my AI subscription" desc="Claude, ChatGPT or Gemini answers here, through its app on this computer. No key, no extra cost." badge={<span className="su-badge">Recommended</span>}>
          <div
            ref={plansRef}
            className="su-provs"
            role="radiogroup"
            aria-label="Subscription"
            onKeyDown={(e) => arrows(e, PLANS.map((p) => p.id), plan, (id) => setPlan(id), (id) => plansRef.current?.querySelector<HTMLElement>(`[data-plan="${id}"]`) ?? null)}
          >
            {PLANS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={p.id === plan} tabIndex={p.id === plan ? 0 : -1} data-plan={p.id} className={`su-prov${p.id === plan ? " on" : ""}`} onClick={() => setPlan(p.id)}>
                <i style={{ background: p.color }} aria-hidden>
                  {p.mark}
                </i>
                {p.name}
              </button>
            ))}
          </div>
          <p className="su-note">
            Needs{" "}
            <a href={PROVIDERS[plan].url} target="_blank" rel="noreferrer">
              {AGENTS[plan].name}
            </a>{" "}
            on this computer, signed in with {AGENTS[plan].account} (run <code>{AGENTS[plan].command}</code> once in a terminal and sign in). Continue checks it.
            {plan === "gemini-cli" && " Google no longer lets personal accounts use the Gemini CLI; a Gemini Code Assist Standard or Enterprise account still can."}
          </p>
          {option === "claude" && said}
          {plan === "claude-code" && <p className="su-note">Or let Claude open WalkMyCode in a tab of its own and answer there:</p>}
          {plan === "claude-code" && (
            <>
            <ol className="su-steps">
            <li>
              Once, in a terminal, run
              <span className="su-cmd">
                <code className={plugin ? "su-cmd-lines" : undefined}>{command}</code>
                <button type="button" className="su-copy" onClick={copy} aria-label="Copy the command">
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </span>
            </li>
            <li>
              {plugin ? (
                <>
                  In a new Claude Code session, type <code>/walkmycode</code>.
                </>
              ) : (
                <>
                  In a new Claude Code session, say <i>“open WalkMyCode on this folder”</i>.
                </>
              )}
            </li>
            <li>Claude opens WalkMyCode in its own tab and answers there, while that session keeps listening.</li>
          </ol>
          {plugin && (
            <p className="su-note">
              The plugin lets Claude use WalkMyCode without asking before each step. Without it: <code>{mcpCommand(link)}</code>, then choose “Always allow” as Claude asks. Added it that way before? Remove it (<code>claude mcp remove -s user walkmycode</code>) so Claude doesn’t load WalkMyCode twice.
            </p>
          )}
          {linkSaid && (
            <p className={linkSaid.ok ? "su-ok" : "su-note"} role="status">
              {linkSaid.text}{" "}
              {!linkSaid.ok && (
                <button type="button" className="su-linkish" onClick={() => setLinkTick((t) => t + 1)}>
                  check again
                </button>
              )}
            </p>
          )}
            </>
          )}
        </Option>

        <Option id="key" selected={option === "key"} onPick={() => pick("key")} title="Paste an API key" desc="Claude, OpenAI, Gemini, Groq, DeepSeek or xAI — pay the provider per question.">
          <div ref={provs} className="su-provs" role="radiogroup" aria-label="Provider" onKeyDown={(e) => arrows(e, chips.map((c) => c.id), provider, pickProvider, (id) => provs.current?.querySelector<HTMLElement>(`[data-prov="${id}"]`) ?? null)}>
            {chips.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={c.id === provider} tabIndex={c.id === provider ? 0 : -1} data-prov={c.id} className={`su-prov${c.id === provider ? " on" : ""}`} onClick={() => pickProvider(c.id)}>
                <i style={{ background: c.color }} aria-hidden>
                  {c.mark}
                </i>
                {c.name}
              </button>
            ))}
          </div>
          <form
            className="su-keyrow"
            onSubmit={(e) => {
              e.preventDefault();
              void saveKeyChoice("test");
            }}
          >
            <input
              ref={key}
              className="su-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasKey ? "A key is set. Paste a new one to replace it" : keyPlaceholder(provider)}
              aria-label={`${chip.name} API key`}
              onInput={(e) => {
                const v = e.currentTarget.value;
                setKeyTyped(!!v.trim());
                setWarning(keyWarning(provider, v));
              }}
            />
            <button type="submit" className="hbtn" disabled={!!busy || (!keyTyped && !hasKey)}>
              {busy === "test" ? "Testing…" : "Test"}
            </button>
          </form>
          {warning && <p className="su-warn">{warning}</p>}
          {said}
          <div className="su-adv">
            <button type="button" className="su-adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
              Advanced: model and thinking effort <span className="su-chev" aria-hidden>▾</span>
            </button>
            <span aria-hidden>·</span>
            <a href={chip.url} target="_blank" rel="noreferrer">
              Get a key ↗
            </a>
          </div>
          {advanced && (
            <div className="su-adv-body">
              <label className="su-field">
                <span>Model</span>
                <select className="su-select" value={model} onChange={(e) => setModel(e.target.value)}>
                  {PROVIDERS[provider].models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="su-field">
                <span id={`${titleId}-effort`}>Thinking effort</span>
                <div className="su-seg" role="radiogroup" aria-labelledby={`${titleId}-effort`}>
                  {EFFORTS.map((x) => (
                    <button key={x} type="button" role="radio" aria-checked={effort === x} className={effort === x ? "on" : undefined} onClick={() => setEffort(x)}>
                      {x[0].toUpperCase() + x.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="su-hint">Low is cheapest and fastest. {catalogueName(provider, model)}: {aboutCost(explainCost(provider, model))}.</p>
            </div>
          )}
        </Option>

        <Option id="local" selected={option === "local"} onPick={() => pick("local")} title="Run a model on this computer" desc="Free and fully private, with Ollama or LM Studio. Slower on tricky questions." badge={badge && <span className="su-badge y">{badge}</span>}>
          {local.models.length ? (
            <>
              <p className="su-hint">Pick the model that answers:</p>
              <div className="su-provs" role="radiogroup" aria-label="Local model">
                {local.models.slice(0, 12).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={m === localModel} className={`su-prov mono${m === localModel ? " on" : ""}`} onClick={() => setLocalModel(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="su-hint">
              {local.asked ? (
                <>
                  Nothing answered at <code>{localUrl}</code>. Start Ollama or LM Studio and pull a model (<code>ollama pull llama3.1</code>), then{" "}
                </>
              ) : (
                <>Looking for a local server… </>
              )}
              <button type="button" className="su-linkish" onClick={() => setLocalTick((t) => t + 1)}>
                check again
              </button>
              {" · "}
              <a href={PROVIDERS.local.url} target="_blank" rel="noreferrer">
                Get Ollama ↗
              </a>
            </p>
          )}
          {said}
        </Option>
      </div>

      <div className="sheet-bar">
        <p>
          <LockIcon /> Keys are saved on this computer only and sent only to the provider you pick.
        </p>
        <button type="button" className="hbtn ghost" onClick={onClose}>
          Not now
        </button>
        <button type="button" className="hbtn primary" onClick={() => void onContinue()} disabled={!!busy}>
          {busy === "continue" ? "Checking…" : "Continue"}
        </button>
      </div>
    </Sheet>
  );
}
