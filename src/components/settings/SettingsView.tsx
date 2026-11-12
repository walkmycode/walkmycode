"use client";
// Settings (docs/design/home-redesign.html, screen 3): a side menu (AI model,
// Voice, Privacy, Motion & look, About) and the pane it opens, filling the
// width right of the menu. Below about 760 px of width the menu becomes a strip
// of tabs over the pane. Two places use it: the home page, full screen under
// the top bar ("page"), and the dock's Settings tab, more compact ("dock").
// Which pane is shown belongs to whoever hosts it (the URL hash on the home
// page, state in the dock).
//
// Who answers depends on the build: the app's providers and keys, or the
// viewer's Claude (WalkMyCode Lite; WalkMyCode for Claude, the "mcp" target), where
// the AI pane shows no provider form and no keys. That is `answers`, worked out
// from the build target by default (src/lib/settingsNav.ts answersFor); a host
// can pass it to say so.
import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MCP, TARGET } from "@/lib/adapters/target";
import { useAiRoute } from "@/lib/adapters/useAiRoute";
import { useAiName, useStandalone } from "@/lib/aiName";
import { pillState } from "@/lib/aiPill";
import { useAiStatus } from "@/lib/aiStatus";
import { answersFor, panesFor, type Answers, type PaneId } from "@/lib/settingsNav";
import { loadVoiceView, VOICE_SAVED } from "@/lib/voice/view";
import AboutPane from "./AboutPane";
import AiPane from "./AiPane";
import ComputerPane from "./ComputerPane";
import MotionPane from "./MotionPane";
import PrivacyPane from "./PrivacyPane";

// The voice pane brings the narrators with it (for "Test voice"): loaded when it opens.
const VoicePane = dynamic(() => import("@/components/voice/VoiceSettings"), {
  ssr: false,
  loading: () => <p className="sv-loading">Loading the voice settings…</p>,
});
// WalkMyCode for Claude: how a spoken question is answered, at the top of the Voice pane (its build alone has it).
const TalkModes = MCP ? dynamic(() => import("@/components/mcp/TalkModeSettings"), { ssr: false }) : () => null;

const LEADS: Record<PaneId, { claude?: string; providers: string }> = {
  ai: { providers: "Who answers when you ask, explain or take a tour.", claude: "Who answers when you ask, explain or take a tour: your own Claude." },
  voice: { providers: "Who reads tours aloud, and who answers when you talk." },
  computer: { providers: "Run code with the toolchains installed here, and open a terminal: off until you allow it." },
  privacy: { providers: "The map is drawn on this computer by a parser, not an AI. Only the lines a question needs leave it — to the provider you chose.", claude: "The map is drawn in this browser by a parser, not an AI. Only the lines a question needs leave it — to Claude, inside Claude." },
  motion: { providers: "How much things move, and the map's shortcuts." },
  about: { providers: "Which WalkMyCode this is, its licence, and where its docs are." },
};

interface Props {
  variant: "page" | "dock";
  pane: PaneId;
  onPane: (p: PaneId) => void;
  /** Who answers; by default from the build target (the mcp target passes "claude" or is found by answersFor). */
  answers?: Answers;
}

/** The status dot beside "AI model": green when a question can be asked, amber when not. */
function AiDot() {
  const p = pillState(useAiStatus());
  if (p.kind === "loading") return null;
  return <span className={`setv-dot${p.kind === "ready" ? "" : " warn"}`} title={p.kind === "ready" ? "Ready" : "Not set up"} aria-hidden />;
}

/** The dot beside "Voice": amber when the chosen narrator cannot read (a key is missing). */
function VoiceDot() {
  const [warn, setWarn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void loadVoiceView().then((v) => live && setWarn(!!v.readiness.narrator));
    read();
    window.addEventListener(VOICE_SAVED, read);
    return () => {
      live = false;
      window.removeEventListener(VOICE_SAVED, read);
    };
  }, []);
  if (warn === null) return null;
  return <span className={`setv-dot${warn ? " warn" : ""}`} title={warn ? "The narrator needs a key" : "Ready"} aria-hidden />;
}

export default function SettingsView({ variant, pane, onPane, answers = answersFor(TARGET) }: Props) {
  const id = useId();
  const nav = useRef<HTMLDivElement>(null);
  const route = useAiRoute();
  const claude = answers === "claude";
  const panes = panesFor(TARGET);
  const here = panes.find((p) => p.id === pane) ?? panes[0];
  const lead = LEADS[here.id];
  // WalkMyCode's MCP page: the AI app connected to it answers, by name.
  const who = useAiName();
  // Started from a terminal with no AI app: the provider picked here answers.
  const standalone = useStandalone();
  const mcpLead =
    MCP && claude
      ? here.id === "ai"
        ? standalone
          ? "Who answers when you ask, explain or take a tour: the model you pick here, with your own key (no AI app is connected)."
          : `Who answers when you ask, explain or take a tour: ${who}, the AI app WalkMyCode is connected to.`
        : here.id === "privacy"
          ? `The map is drawn on this computer by a parser, not an AI. Only the lines a question needs leave it — to ${standalone ? "the AI provider you pick in Settings → AI model" : who}.`
          : null
      : null;

  // The pane in view keeps its tab in view (the strip of tabs scrolls sideways on a phone).
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pane]);

  // Arrow keys move through the menu, as in any list of tabs.
  const keys = (e: React.KeyboardEvent) => {
    const i = panes.findIndex((p) => p.id === pane);
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? panes.length - 1 : step ? (i + step + panes.length) % panes.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onPane(panes[to].id);
    nav.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };

  return (
    <div className={`setv ${variant}`}>
      <div className="setv-in">
        <div className="setv-nav">
          <h2 className="setv-title">Settings</h2>
          <div ref={nav} className="setv-tabs" role="tablist" aria-label="Settings" aria-orientation="vertical" onKeyDown={keys}>
            {panes.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                id={`${id}-tab-${p.id}`}
                aria-selected={p.id === pane}
                aria-controls={`${id}-pane`}
                tabIndex={p.id === pane ? 0 : -1}
                className={p.id === pane ? "on" : undefined}
                onClick={() => onPane(p.id)}
              >
                {p.label}
                {p.id === "ai" && !claude && <AiDot />}
                {p.id === "voice" && !claude && <VoiceDot />}
              </button>
            ))}
          </div>
        </div>
        <section className="setv-pane" id={`${id}-pane`} role="tabpanel" aria-labelledby={`${id}-tab-${here.id}`}>
          <header className="setv-head">
            <h2>{here.label}</h2>
            <p>{mcpLead ?? ((claude && lead.claude) || lead.providers)}</p>
          </header>
          {/* Keyed by pane, so each one rises in as it opens. */}
          <div key={here.id} className="setv-body">
            {here.id === "ai" && <AiPane answers={answers} route={route} />}
            {here.id === "voice" && (
              <>
                <TalkModes />
                <VoicePane />
              </>
            )}
            {here.id === "privacy" && <PrivacyPane claude={claude} />}
            {here.id === "computer" && <ComputerPane />}
            {here.id === "motion" && <MotionPane />}
            {here.id === "about" && <AboutPane target={TARGET} />}
          </div>
        </section>
      </div>
    </div>
  );
}
