"use client";
// Everything WalkMyCode for Claude's page does whatever room is on screen
// (docs/MCP.md §2): it connects the bridge, loads the workspace the local
// server has open (and again whenever Claude opens another: the `workspace`
// command), plays Claude's narration, and says so plainly when another tab has
// taken over or the page is out of date. The rooms themselves are the app's.
import { useEffect, useState } from "react";
import { goLite } from "@/lib/adapters/nav";
import { loadServerWorkspace } from "@/lib/adapters/serverStorage";
import { setAiName, setStandalone } from "@/lib/aiName";
import { aiName, isStandalone } from "@/lib/bridge/client";
import { capName } from "@/lib/bridge/clientName";
import { bridge, useBridge } from "@/lib/bridge/page";
import { setWorkspace } from "@/lib/store";
import { startVoice } from "@/lib/voice/mcp";

export interface HostState {
  loading: string | null;
  error: string | null;
}

export default function McpHost({ children }: { children: (s: HostState) => React.ReactNode }) {
  const snap = useBridge();
  // The workspace last loaded (by its key), and what went wrong loading it.
  const [loaded, setLoaded] = useState<{ key: string; error: string | null } | null>(null);

  // The bridge, and the page's voice (Claude's narration and the voice modes), from the start.
  useEffect(() => {
    const b = bridge();
    const offWorkspace = b.handle("workspace", (c) => `Loading ${c.workspace.name} on the page.`);
    const offVoice = startVoice(b);
    return () => {
      offWorkspace();
      offVoice();
    };
  }, []);

  // The connected AI app's name, for every component that names it.
  const who = aiName(snap);
  useEffect(() => setAiName(who), [who]);
  // No AI app at all (terminal mode): the page answers with its own key, and says so.
  const alone = isStandalone(snap);
  useEffect(() => setStandalone(alone), [alone]);

  // The open workspace: when the page connects, and every time Claude maps a folder.
  const ws = snap.workspace;
  const wsKey = ws ? `${ws.id}@${ws.mappedAt}` : null;
  useEffect(() => {
    if (!wsKey) return;
    let live = true;
    loadServerWorkspace()
      .then((w) => {
        if (!live) return;
        if (w) {
          setWorkspace(w);
          goLite("/map");
        }
        setLoaded({ key: wsKey, error: null });
      })
      .catch((e: unknown) => live && setLoaded({ key: wsKey, error: `The map could not be loaded: ${(e as Error).message} Reload the page.` }));
    return () => {
      live = false;
    };
  }, [wsKey]);
  const loading = ws && loaded?.key !== wsKey ? `Loading the map of ${ws.name}…` : null;
  const error = loaded?.key === wsKey ? loaded.error : null;

  return (
    <>
      {children({ loading, error })}
      {(snap.conn === "replaced" || snap.conn === "outdated") && (
        <div className="mcp-gone" role="alertdialog" aria-modal="true" aria-label="WalkMyCode is open elsewhere">
          <div className="panel card">
            <h3>{snap.conn === "replaced" ? "WalkMyCode is open in another tab" : "This page is out of date"}</h3>
            <p>
              {snap.conn === "replaced"
                ? `${alone ? "The newest WalkMyCode tab now has the map" : `${capName(who)} now drives the newest WalkMyCode tab`}, so this one no longer gets answers or narration. Close it, or reload it to take over again.`
                : "WalkMyCode was updated since this page loaded. Reload it to carry on."}
            </p>
            <button type="button" className="ctl primary" onClick={() => window.location.reload()}>
              Reload this tab
            </button>
          </div>
        </div>
      )}
    </>
  );
}
