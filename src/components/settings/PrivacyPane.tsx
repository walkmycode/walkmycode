"use client";
// Settings → Privacy (docs/design/home-redesign.html, screen 3): where code can
// go, provider by provider, with a badge each; what is never read; and why the
// map can be trusted. When the viewer's Claude answers, Claude's rows instead.
import { MCP } from "@/lib/adapters/target";
import { useAiName, useStandalone } from "@/lib/aiName";
import { APP_PRIVACY, BUILT_BY_PARSER, CLAUDE_PRIVACY, mcpPrivacy, NEVER_READ, YOUR_KEYS } from "@/lib/privacyRows";
import { Box, Cols } from "./parts";

export function PrivacyTable({ claude }: { claude: boolean }) {
  // WalkMyCode's MCP page names the AI app connected to it, and can hear you through a speech-to-text key; Lite has no microphone.
  const who = useAiName();
  const standalone = useStandalone();
  const rows = !claude ? APP_PRIVACY : MCP ? mcpPrivacy(who, standalone) : CLAUDE_PRIVACY;
  return (
    <table className="pv-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.who}>
            <td>{r.who}</td>
            <td className="pv-muted">{r.what}</td>
            <td>
              <span className={`pv-r ${r.tone}`}>{r.say}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PrivacyPane({ claude }: { claude: boolean }) {
  return (
    <Cols>
      <div>
        <Box label="Where your code can go">
          <PrivacyTable claude={claude} />
        </Box>
      </div>
      <div>
        <Box label="Never read">
          <p className="sv-text">{NEVER_READ}</p>
        </Box>
        <Box label="Built by a parser">
          <p className="sv-text">{BUILT_BY_PARSER}</p>
        </Box>
        {!claude && (
          <Box label="Your keys">
            <p className="sv-text">{YOUR_KEYS}</p>
          </Box>
        )}
      </div>
    </Cols>
  );
}
