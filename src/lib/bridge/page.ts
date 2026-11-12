"use client";
// The one bridge of WalkMyCode for Claude's page (the MCP target): a BridgeClient
// on this page's own server (ws://<host>/bridge, with the cookie the page's URL
// set), started on first use, and kept for the life of the page. The user's
// clicks, keys and scrolls count as activity, which keeps Claude listening
// (docs/MCP.md §7). Only the MCP page imports this, by its own chunk.
import { useSyncExternalStore } from "react";
import { BridgeClient, bridgeUrl, type BridgeSnapshot } from "./client";

let client: BridgeClient | null = null;

/** The page's bridge, connected on first use. */
export function bridge(): BridgeClient {
  if (client) return client;
  client = new BridgeClient({ open: () => new WebSocket(bridgeUrl(window.location)) as unknown as import("./client").SocketLike }).start();
  const c = client;
  const active = () => c.activity();
  for (const ev of ["pointerdown", "keydown", "wheel"] as const) window.addEventListener(ev, active, { passive: true, capture: true });
  window.addEventListener("pagehide", () => c.close());
  // A test (or a curious user) can look at the bridge from the console.
  (window as { __lanternBridge?: BridgeClient }).__lanternBridge = c;
  return c;
}

const SERVER: BridgeSnapshot = { conn: "connecting", claude: null, workspace: null, pending: [], error: null };

/** The bridge's state for a component: connection, Claude's status, the open workspace, requests on their way. */
export function useBridge(): BridgeSnapshot {
  return useSyncExternalStore(
    (l) => bridge().subscribe(l),
    () => bridge().snapshot(),
    () => SERVER,
  );
}
