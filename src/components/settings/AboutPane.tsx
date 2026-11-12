"use client";
// Settings → About: which WalkMyCode this is, its licence (GNU AGPL-3.0, the owner's
// choice on 1 Oct 2026), the open-source parts whose licences ask to be named
// (the on-device speech model; THIRD-PARTY-NOTICES.md), and where the docs are. The docs live in the repository
// (there is no public site yet), so each is named by its path, ready to copy.
import { useState } from "react";
import pkg from "../../../package.json";
import { PARAKEET_CREDIT } from "@/lib/voice/catalogue";
import { Box, Cols } from "./parts";

const { version } = pkg;

const DOCS: { path: string; what: string }[] = [
  { path: "README.md", what: "What WalkMyCode is, how to run it, what leaves your machine" },
  { path: "docs/PROVIDERS.md", what: "Every AI provider: models, prices, privacy, keys" },
  { path: "docs/VOICE.md", what: "Narration, the lecturer, voice keys and prices" },
  { path: "docs/MCP.md", what: "The WalkMyCode MCP server: your own AI app (Claude, Antigravity, Cursor…) explains" },
  { path: "docs/SERVICES.md", what: "How a system of services is mapped" },
  { path: "docs/SHELL.md", what: "The dock: panels, layouts, shortcuts" },
  { path: "docs/MOTION.md", what: "How things move, and the motion switch" },
  { path: "docs/PLAN.md", what: "The plan, the two versions, what comes next" },
];

const BUILD = { full: "WalkMyCode, on this computer", lite: "WalkMyCode Lite, inside Claude", mcp: "WalkMyCode, through your AI app (MCP)" } as const;

export default function AboutPane({ target }: { target: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (p: string) => {
    try {
      await navigator.clipboard.writeText(p);
      setCopied(p);
      setTimeout(() => setCopied((c) => (c === p ? null : c)), 1400);
    } catch {
      /* the path is on screen */
    }
  };
  return (
    <Cols>
      <div>
        <Box label="WalkMyCode">
          <div className="sv-cur">
            <span className="sv-mark lamp" aria-hidden />
            <div>
              <b>Version {version}</b>
              <span>{BUILD[target as keyof typeof BUILD] ?? BUILD.full} · early prototype</span>
            </div>
          </div>
          <p className="sv-hint">A tour guide for the code you generated: the map is drawn by a parser on your machine, and the AI only explains.</p>
        </Box>
        <Box label="Licence">
          <p className="sv-text">
            <b className="sv-badge g">GNU AGPL-3.0</b>
          </p>
          <p className="sv-hint">Open source: anyone may use, change and share it. Whoever runs a changed copy for others over a network must share their changes too (LICENSE).</p>
        </Box>
        <Box label="Open-source parts">
          <p className="sv-text">
            Speech model:{" "}
            <a href={PARAKEET_CREDIT.model} target="_blank" rel="noreferrer">
              NVIDIA Parakeet-TDT 0.6B v2
            </a>
            , used under the{" "}
            <a href={PARAKEET_CREDIT.licence} target="_blank" rel="noreferrer">
              CC-BY-4.0 licence
            </a>
            , run with{" "}
            <a href={PARAKEET_CREDIT.engine} target="_blank" rel="noreferrer">
              sherpa-onnx
            </a>
            .
          </p>
          <p className="sv-hint">On-device speech to text (Settings → Voice) runs on sherpa-onnx (Apache-2.0) and ONNX Runtime (MIT). Their notices are in THIRD-PARTY-NOTICES.md.</p>
        </Box>
      </div>
      <div>
        <Box label="Docs, in the repository">
          <ul className="sv-docs">
            {DOCS.map((d) => (
              <li key={d.path}>
                <button type="button" className="sv-doc" onClick={() => void copy(d.path)} title="Copy the path">
                  <code>{d.path}</code>
                  <span>{copied === d.path ? "Copied" : d.what}</span>
                </button>
              </li>
            ))}
          </ul>
        </Box>
      </div>
    </Cols>
  );
}
