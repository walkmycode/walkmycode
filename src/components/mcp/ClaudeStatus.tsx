"use client";
// Whether the user's Claude is listening, in plain words (docs/MCP.md §7): a
// pill in the top bar and on the start screen. "Waiting for Claude…" when a
// request waits and Claude is not polling; "say continue in Claude" when it
// has stopped. Started from a terminal with no AI app (standalone), it says the
// page answers here, with the provider picked in Settings → AI model, or asks
// for a key. The words come from claudeLine (src/lib/bridge/client.ts).
import { useEffect, useState } from "react";
import { useAiStatus } from "@/lib/aiStatus";
import { claudeLine, isStandalone, type OwnModel } from "@/lib/bridge/client";
import { useBridge } from "@/lib/bridge/page";
import { labelOf } from "@/lib/providers/catalogue";
import { openSettings } from "@/lib/settingsNav";

/** "Anthropic (Claude)" → "Anthropic": the pill has little room. */
const shortLabel = (id: string) => labelOf(id).replace(/\s*\(.*\)$/, "");

export default function ClaudeStatus({ quiet = false }: { quiet?: boolean }) {
  const snap = useBridge();
  return isStandalone(snap) ? <OwnStatus quiet={quiet} /> : <ClientStatus quiet={quiet} />;
}

function ClientStatus({ quiet }: { quiet: boolean }) {
  const snap = useBridge();
  // "Listening" lasts a while after the last poll: look again now and then.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return <Pill line={claudeLine(snap, now)} quiet={quiet} />;
}

/** No AI app: the page's own provider (GET /api/config, re-read after every save) answers. */
function OwnStatus({ quiet }: { quiet: boolean }) {
  const snap = useBridge();
  const status = useAiStatus();
  const own: OwnModel = status.state === "ok" ? { provider: shortLabel(status.config.saved.provider), ready: status.config.readiness.llm === null } : { provider: null, ready: null };
  // The time only matters for a client's polls: none here.
  return <Pill line={claudeLine(snap, 0, own)} quiet={quiet} settings={own.ready === false} />;
}

function Pill({ line, quiet, settings = false }: { line: ReturnType<typeof claudeLine>; quiet: boolean; settings?: boolean }) {
  if (!line || (quiet && line.tone === "ok")) return null;
  // One button: it opens Settings → AI model (who answers, and how), the fix when something
  // is missing ("Open settings") or just a look. On a phone it is only the coloured dot.
  return (
    <button type="button" className={`claude-status ${line.tone}`} data-testid="claude-status" title={settings ? line.text : `${line.text}. Click for Settings → AI model.`} onClick={() => openSettings("ai")}>
      <span className={`dot${line.tone === "ok" ? " ok" : line.tone === "bad" ? " bad" : ""}`} aria-hidden />
      <span className="claude-status-text" role="status">
        {line.text}
      </span>
      {settings && <span className="claude-status-fix">Open settings</span>}
    </button>
  );
}
