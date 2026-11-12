"use client";
// Settings → Voice on WalkMyCode for Claude's page: how a spoken question is
// answered (docs/MCP.md §4). Talk through Claude by default; the Lightning
// lecturer with an ElevenLabs key; Free voice in the browser alone. Tours play
// in every mode. Saved by the local server (~/.walkmycode/mcp.json). Laid out in
// the Settings view's boxes, above the narrator and the voice keys.
import { useState } from "react";
import { Box, Status } from "@/components/settings/parts";
import { useAiName } from "@/lib/aiName";
import { saveTalkMode, talkLabels, TALK_MODES, useTalkMode, type TalkMode } from "@/lib/voice/talkMode";
import { useVoiceView } from "@/lib/voice/view";
import { whyFailed } from "@/lib/unreachable";

export default function TalkModeSettings() {
  const saved = useTalkMode();
  const view = useVoiceView();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const eleven = !!view?.keys.ELEVENLABS_API_KEY?.has_key;
  const who = useAiName();
  const TALK_LABEL = talkLabels(who);

  const pick = async (m: TalkMode) => {
    setStatus(null);
    try {
      await saveTalkMode(m);
      setStatus({ ok: true, text: `${TALK_LABEL[m].label} saved` });
    } catch (e) {
      setStatus({ ok: false, text: `Save failed: ${whyFailed(e)}` });
    }
  };

  return (
    <Box label="When you ask out loud">
      <div className="chips" role="radiogroup" aria-label="Talk mode">
        {TALK_MODES.map((m) => {
          const ok = m !== "lecturer" || eleven;
          return (
            <button key={m} type="button" role="radio" aria-checked={saved === m} className={`chip${saved === m ? " on" : ""}`} onClick={() => void pick(m)} title={`Needs ${TALK_LABEL[m].needs}`} data-testid={`talk-${m}`}>
              <span className={`mark ${ok ? "ok" : "bad"}`} aria-hidden>
                {ok ? "✓" : "✕"}
              </span>
              {TALK_LABEL[m].label}
            </button>
          );
        })}
      </div>
      {saved && <p className="sv-text">{TALK_LABEL[saved].hint}</p>}
      {saved === "lecturer" && !eleven && <p className="sv-warn">The Lightning lecturer needs your ElevenLabs key: add it under the voice keys below.</p>}
      <p className="sv-text">Tours always play aloud, with the narrator below. In every mode the answers come from {who}.</p>
      <Status s={status} />
    </Box>
  );
}
