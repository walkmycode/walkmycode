// Where a file the user opens goes (docs/SHELL.md §4): into the group of panels they chose to work in,
// wherever it is (the Map's, the Code's, the Guide's, a floating one), the way an editor opens a file
// in the group that has focus. A group is chosen by a press on its tab bar, or inside one of its code
// tabs. A press in other content (a card on the map, the file tree, the guide) is that panel being
// used, not a choice of where files go: exploring the map never sends files over it. Three rules keep
// the choice from getting in the way:
//   - a file never opens on top of the panel it was opened from (a file-tree row, a map card, a
//     citation): a press in content just before the open marks that group, and it is skipped;
//   - a file never covers the Guide, where the answers and the tour are;
//   - a pop-out window is never chosen (its clicks are another window's).
// When nothing qualifies, the caller puts the file beside the Code tab, as before.
// Pure apart from `watchFocus`, so the rules can be tested without a browser.
import type { DockviewApi } from "dockview-react";
import { isEditorId } from "./panels";

/** A press this recent (ms) is the one that opened the file. */
export const SOURCE_MS = 1500;
/** How many groups are remembered. */
const KEEP = 8;

export interface Press {
  group: string;
  t: number;
  /** "choose": on the group's tab bar or in a code tab, so files go there from now on.
   * "use": in its other content (a map card, the file tree, the guide), which chooses nothing. */
  kind: "choose" | "use";
}

/** The groups the user chose, the latest first, and the latest press anywhere. */
export interface FocusLog {
  order: string[];
  press: Press | null;
}

export const emptyLog = (): FocusLog => ({ order: [], press: null });

/** A press: a choosing one puts its group first; any press is remembered as the latest. */
export function pressed(log: FocusLog, press: Press): FocusLog {
  const order = press.kind === "choose" ? [press.group, ...log.order.filter((g) => g !== press.group)].slice(0, KEEP) : log.order;
  return { order, press };
}

/** What `pickTarget` needs to know of a group. */
export interface GroupView {
  id: string;
  location: "grid" | "floating" | "popout" | "edge";
  /** The id of the panel it is showing. */
  active?: string;
}

/** The group a file the user opens now goes to, or null for the default place (beside the Code tab). */
export function pickTarget(log: FocusLog, groups: readonly GroupView[], now: number): string | null {
  const p = log.press;
  const source = p && p.kind === "use" && now - p.t >= 0 && now - p.t < SOURCE_MS ? p.group : null;
  for (const id of log.order) {
    if (id === source) continue;
    const g = groups.find((x) => x.id === id);
    if (!g || g.location === "popout" || g.location === "edge") continue;
    if (g.active === "guide") continue;
    return id;
  }
  return null;
}

/** The dock's groups as `pickTarget` reads them. */
export function groupViews(api: Pick<DockviewApi, "groups">): GroupView[] {
  return api.groups.map((g) => ({ id: g.id, location: g.api.location.type, active: g.activePanel?.id }));
}

/** Is this panel a code tab (an open file or the Code panel)? */
export const isCodePanel = (id: string | undefined) => !!id && (id === "code:home" || isEditorId(id));

/** Log every press inside one of the dock's groups (in this window). */
export function watchFocus(getApi: () => DockviewApi | null, onPress: (p: Press) => void, doc: Document = document): () => void {
  const down = (e: PointerEvent) => {
    const api = getApi();
    const el = e.target as Element | null;
    if (!api || !el) return;
    // A panel kept alive while hidden (renderer "always": the map, the guide, the files) is drawn in
    // dockview's overlay layer, outside its group's element: its own content element says whose it is.
    const g = api.panels.find((p) => p.view.content.element.contains(el))?.group ?? api.groups.find((x) => x.element.contains(el));
    if (!g) return;
    const bar = !!el.closest?.(".dv-tabs-and-actions-container");
    onPress({ group: g.id, t: performance.now(), kind: bar || isCodePanel(g.activePanel?.id) ? "choose" : "use" });
  };
  doc.addEventListener("pointerdown", down, true);
  return () => doc.removeEventListener("pointerdown", down, true);
}
