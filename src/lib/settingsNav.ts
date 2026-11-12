// Settings' panes (docs/design/home-redesign.html, screen 3) and the ways to
// them: the side menu, the URL hash on the home page (#settings/voice), and
// "Open settings" from anywhere (the window event, with the pane it is about).
// Plain code, no React, so tests read it.

export type PaneId = "ai" | "voice" | "privacy" | "computer" | "motion" | "about";

export const PANES: { id: PaneId; label: string }[] = [
  { id: "ai", label: "AI model" },
  { id: "voice", label: "Voice" },
  { id: "privacy", label: "Privacy" },
  // Running code and the terminal on this computer (src/lib/localrun): not in Lite, which has no server.
  { id: "computer", label: "This computer" },
  { id: "motion", label: "Motion & look" },
  { id: "about", label: "About" },
];

/** The panes a build shows: Lite has no "This computer". */
export function panesFor(target: string): { id: PaneId; label: string }[] {
  return target === "lite" ? PANES.filter((p) => p.id !== "computer") : PANES;
}

export const isPane = (p: unknown): p is PaneId => PANES.some((x) => x.id === p);

/** Who answers, by build: the app's own providers and keys, or the viewer's Claude
 * (WalkMyCode Lite inside Claude; WalkMyCode for Claude, the "mcp" target, where Claude
 * drives the page). The AI pane shows no provider form and no keys for "claude". */
export type Answers = "providers" | "claude";
export function answersFor(target: string): Answers {
  return target === "lite" || target === "mcp" ? "claude" : "providers";
}

/** "#settings" → "ai", "#settings/voice" → "voice"; null when the hash is not Settings'. */
export function paneFromHash(hash: string): PaneId | null {
  const m = /^#settings(?:\/([\w-]+))?$/.exec(hash.trim());
  if (!m) return null;
  return isPane(m[1]) ? m[1] : "ai";
}

export const hashFor = (pane: PaneId) => `#settings/${pane}`;

/** The window event "Open settings" buttons fire (the guide's errors, the voice's); its
 * detail names the pane, when it is about one. */
export const OPEN_SETTINGS = "open-settings";

/** The pane asked for last, kept for a Settings view that opens after the ask (the dock
 * mounts its Settings tab only when it shows). */
let wanted: PaneId | null = null;

export function openSettings(pane?: PaneId): void {
  if (pane) wanted = pane;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, { detail: pane ? { pane } : undefined }));
}

/** The pane an "Open settings" event asks for, if it names one. */
export function paneOf(e: Event): PaneId | null {
  const d = (e as CustomEvent<{ pane?: unknown } | undefined>).detail;
  return d && isPane(d.pane) ? d.pane : null;
}

/** The pane asked for before this Settings view existed, once. */
export function takeWanted(): PaneId | null {
  const p = wanted;
  wanted = null;
  return p;
}
