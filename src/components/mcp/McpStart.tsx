"use client";
// The start screen of WalkMyCode for Claude's page (docs/MCP.md §1): before Claude
// has opened a folder there is no map to show, so it says how to get one, in
// the words to say to Claude, with a copy button. Or the folder is picked here:
// "Choose folder…" has the local server open the system's own folder dialog (a
// browser never gives a page a folder's path), and "Open it here" maps it, as
// Claude's walkmycode_open would. Either way, once a folder is open the page
// moves to the map by itself (McpHost).
import { useState } from "react";
import TopBar from "@/components/TopBar";
import { RoomLink } from "@/lib/adapters/nav";
import { copyText } from "@/lib/adapters/source";
import { aiName, isStandalone } from "@/lib/bridge/client";
import { capName } from "@/lib/bridge/clientName";
import { useBridge } from "@/lib/bridge/page";
import { whyFailed } from "@/lib/unreachable";
import ClaudeStatus from "./ClaudeStatus";

/** What to say to Claude for a folder ("~/code/app" when none is typed). */
export function openLine(folder: string): string {
  const f = folder.trim() || "~/code/my-app";
  return `Open WalkMyCode on ${f}`;
}

export default function McpStart({ loading, error }: { loading: string | null; error: string | null }) {
  const snap = useBridge();
  const [folder, setFolder] = useState("");
  const [copied, setCopied] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"pick" | "open" | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const line = openLine(folder);
  // The AI app connected to WalkMyCode (Claude, Antigravity, Cursor…), once it has said.
  const known = !!snap.claude?.client;
  const who = aiName(snap);
  // Started from a terminal with no AI app: the folder came from the command line, and the page answers itself.
  const standalone = isStandalone(snap);

  /** POST to this page's server; its words on refusal, or that it isn't running. */
  const post = async (path: string, body?: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; why: string }> => {
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return res.ok ? { ok: true, data } : { ok: false, why: typeof data.error === "string" ? data.error : `WalkMyCode's server answered ${res.status}.` };
    } catch (e) {
      return { ok: false, why: whyFailed(e) };
    }
  };

  const pick = async () => {
    setBusy("pick");
    setSaid({ ok: true, text: "The folder dialog is open: it may be behind this window." });
    const r = await post("/api/folder/pick");
    setBusy(null);
    if (!r.ok) return setSaid({ ok: false, text: r.why });
    if (typeof r.data.path !== "string") return setSaid(null);
    setFolder(r.data.path);
    setSaid(null);
  };

  const openHere = async () => {
    setBusy("open");
    setSaid({ ok: true, text: `Mapping ${folder.trim()}…` });
    const r = await post("/api/folder/open", { path: folder.trim() });
    setBusy(null);
    // Done: the server tells the page, which moves to the map (McpHost).
    setSaid(r.ok ? { ok: true, text: "Opening the map…" } : { ok: false, text: r.why });
  };

  const copy = async () => {
    setCopied(await copyText(line));
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      <TopBar title="WalkMyCode" detail="your AI explains, WalkMyCode shows" />
      <div className="hall mcp-start">
        <header>
          <h1 style={{ color: "var(--yellow)", fontSize: "var(--text)", fontWeight: 650 }}>
            Your AI explains. WalkMyCode shows you the code.
            <span className="i" data-light="home" aria-hidden="true" />
          </h1>
          <p className="note" style={{ fontSize: "var(--text)", color: "var(--ui-text)" }}>
            {standalone
              ? snap.workspace
                ? `Opening ${snap.workspace.name}, mapped from the terminal.`
                : "Started from a terminal: give it a folder, e.g. walkmycode-mcp ~/code/my-app."
              : snap.workspace
                ? `${capName(who)} opened ${snap.workspace.name}.`
                : `${capName(who)} hasn't opened a folder yet.`}
          </p>
          {/* Here from the logo with a project open: the way back to its map, not a dead end. */}
          {snap.workspace && (
            <RoomLink href="/map" className="ctl primary" style={{ alignSelf: "flex-start" }}>
              Back to the map of {snap.workspace.name}
            </RoomLink>
          )}
        </header>

        {standalone ? (
          <section className="panel card">
            <h3>Answering here</h3>
            <p>No AI app is connected: answers come from the AI model in Settings → AI model, with your own key (or a model on this computer).</p>
            <p className="note">
              <ClaudeStatus />
            </p>
          </section>
        ) : (
          <section className="panel card">
            <h3>Ask {known ? who : "your AI"}</h3>
            <p>
              {known ? `In ${who}, say this` : "In the AI app WalkMyCode is connected to (Claude Desktop, Claude Code, Antigravity, Cursor…), say this"}
              {who === "Claude" ? " (or run /walkmycode in Claude Code)" : ""}. The map draws here, and from then on it lights up the code while it explains.
            </p>
            <div className="mcp-say">
              <code className="mono" data-testid="open-line">{line}</code>
              <button type="button" className="ctl compact primary" onClick={() => void copy()}>
                {copied === null ? "Copy" : copied ? "Copied" : "Copy blocked: select it"}
              </button>
            </div>
            <label className="note" htmlFor="mcp-folder">
              Your project&apos;s folder
            </label>
            <div className="mcp-folder">
              <input id="mcp-folder" className="field" value={folder} placeholder="~/code/my-app" onChange={(e) => setFolder(e.target.value)} spellCheck={false} />
              <button type="button" className="ctl compact" onClick={() => void pick()} disabled={!!busy}>
                {busy === "pick" ? "Choosing…" : "Choose folder…"}
              </button>
              <button type="button" className="ctl compact primary" onClick={() => void openHere()} disabled={!!busy || !folder.trim()} title="Map this folder now, without asking Claude">
                {busy === "open" ? "Opening…" : "Open it here"}
              </button>
            </div>
            {said && (
              <p className={said.ok ? "note" : "err"} role="status">
                {said.text}
              </p>
            )}
            <p className="note">
              <ClaudeStatus />
            </p>
          </section>
        )}

        {(loading || error) && (
          <section className="panel card" role="status">
            {loading && <p className="note mono">{loading}</p>}
            {error && <p className="err">{error}</p>}
          </section>
        )}

        <section className="frame">
          <div className="board">
            <h2 className="wipe-line">What happens to your code</h2>
            <p className="wipe-para" style={{ ["--wd" as string]: "300ms", ["--wdur" as string]: "1400ms" }}>
              WalkMyCode reads the folder on this computer and draws the map with a parser, not an AI: every arrow points at a real line.{" "}
              {standalone
                ? "The AI model you pick in Settings → AI model answers, on your own key: only the lines a question needs go to it."
                : `Your own AI app answers (${who}), on your own plan: it reads the lines it needs through WalkMyCode's tools.`} Files that look like secrets (<code>.env</code>, keys) are never read, and WalkMyCode
              never sees your sign-in. If you add a voice key in Settings → Voice, it stays in <code>~/.walkmycode/keys.env</code> and goes only to that provider.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
