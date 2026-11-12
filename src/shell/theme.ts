// The dock's look and the options we hand dockview (docs/SHELL.md §6, §10).
// The colours live in globals.css as CSS variables on `.walkmycode`; this file
// only names the theme. DOCK_OPTIONS is every dockview option we pass, kept in
// one object so tests/shell.test.ts can check none of them is enterprise-gated.
import type { DockviewTheme } from "dockview-react";

export const lanternTheme: DockviewTheme = {
  name: "lantern",
  className: "dockview-theme-abyss lantern",
  colorScheme: "dark",
  gap: 8,
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
};

export const POPOUT_URL = "/popout.html";

/** Never add keyboardNavigation, overflow.mode 'wrap', smartGuides, pinnedTabs,
 * layoutHistory, autoHideEdgeGroups, dockToEdgeGroups or dndCompass here: they
 * need a dockview-enterprise licence. The test reads the installed bundle. */
export const DOCK_OPTIONS = {
  popoutUrl: POPOUT_URL,
  // A floating panel can never be lost off-screen.
  floatingGroupBounds: "boundedWithinViewport",
  floatingGroupDragHandle: "titlebar",
  // Per-panel overrides live in the registry.
  defaultRenderer: "onlyWhenVisible",
  dndEdges: { size: { value: 80, type: "pixels" } },
} as const;

/** Pop-out windows: off in the Lite (Claude artifact) build, as policy (§11). */
export const capabilities = {
  popout: process.env.NEXT_PUBLIC_WALKMYCODE_TARGET !== "lite" && typeof window !== "undefined" && typeof window.open === "function",
};
