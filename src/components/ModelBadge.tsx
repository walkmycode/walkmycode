"use client";
// The header pill that says which model answers right now, with a dot for
// whether it can: green when readiness passes, red with the reason in the
// title otherwise. Clicking it opens Settings. Re-reads after every save.
import { useEffect, useState } from "react";
import { pickSettings } from "@/lib/adapters/select";
import { TARGET } from "@/lib/adapters/target";
import { useAiRoute } from "@/lib/adapters/useAiRoute";
import { labelOf } from "@/lib/providers/catalogue";
import { loadConfig } from "@/lib/aiConfig";
import { useAiName, useStandalone } from "@/lib/aiName";
import { FALLBACK_CLIENT } from "@/lib/bridge/clientName";

const SETTINGS = pickSettings(TARGET);

/** "Anthropic (Claude)" → "Anthropic": the header has little room. */
const shortLabel = (id: string) => labelOf(id).replace(/\s*\(.*\)$/, "");

interface Shown {
  text: string;
  ok: boolean;
  title: string;
}

export default function ModelBadge({ onOpen }: { onOpen: () => void }) {
  return SETTINGS.providers ? <ProviderBadge onOpen={onOpen} /> : <ClaudeBadge onOpen={onOpen} />;
}

/** WalkMyCode Lite: the viewer's own Claude answers; the dot says whether it can on this page. */
function ClaudeBadge({ onOpen }: { onOpen: () => void }) {
  const route = useAiRoute();
  // WalkMyCode's MCP page: the AI app connected to it (Claude, Antigravity, Cursor…), by name.
  const who = useAiName();
  // Started from a terminal with no AI app: the page's own provider answers, so the badge names it.
  const standalone = useStandalone();
  if (route === "bridge" && standalone) return <ProviderBadge onOpen={onOpen} />;
  const title =
    route === "sample"
      ? "Answers come from your own Claude plan."
      : route === "bridge"
        ? `Answers come from ${who}, the AI app that opened this page.`
        : route === "none"
          ? "Not open inside Claude, so asking is off here. Click to read more."
          : "Checking whether Claude can answer here…";
  return (
    <button type="button" className="badge" onClick={onOpen} title={title}>
      <span className={`dot${route === "sample" || route === "bridge" ? " ok" : route === "none" ? " bad" : ""}`} aria-hidden />
      {route === "bridge" ? (who === FALLBACK_CLIENT ? "Your AI" : `Your AI: ${who}`) : "Your Claude"}
    </button>
  );
}

function ProviderBadge({ onOpen }: { onOpen: () => void }) {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      loadConfig()
        .then((d) => {
          if (!live) return;
          const llm = d.readiness.llm;
          setShown({
            text: `${shortLabel(d.saved.provider)} · ${d.saved.model || "no model"}`,
            ok: llm === null,
            title: llm ? `${llm.title}. ${llm.message}` : "Ready on your key. Click to change the model or keys.",
          });
        })
        .catch(() => live && setShown(null));
    load();
    window.addEventListener("settings-saved", load);
    return () => {
      live = false;
      window.removeEventListener("settings-saved", load);
    };
  }, []);

  return (
    <button type="button" className="badge" onClick={onOpen} title={shown?.title ?? "Open Settings"}>
      <span className={`dot${shown ? (shown.ok ? " ok" : " bad") : ""}`} aria-hidden />
      {shown ? <BadgeText text={shown.text} /> : "Model & keys"}
    </button>
  );
}

/** "Anthropic · claude-opus-5-5": the model part is the first thing a narrow bar drops. */
function BadgeText({ text }: { text: string }) {
  const i = text.indexOf(" · ");
  if (i < 0) return <>{text}</>;
  return (
    <>
      <span className="badge-provider">{text.slice(0, i)}</span>
      <span className="badge-model"> · {text.slice(i + 3)}</span>
    </>
  );
}
