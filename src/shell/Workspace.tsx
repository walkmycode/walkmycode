"use client";
// The dock (docs/SHELL.md §5, §6): one dockview filling the space under the
// top bar. On start it restores the saved layout (or builds the default
// preset), re-adds an editor for every open file, and from then on saves the
// arrangement half a second after it last changed.
//
// Under StrictMode dockview is made twice, and the first one is thrown away
// while the saved layout is still loading; everything below checks it is
// still talking to the live instance before touching it.
import { useCallback, useEffect, useRef, useState } from "react";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type GetTabContextMenuItemsParams, type SerializedDockview } from "dockview-react";
import { light } from "@/lib/light";
import { DOCK_OPTIONS, capabilities, lanternTheme } from "./theme";
import { PANELS, editorPath, isEditorId } from "./panels";
import { buildPreset, sizePreset, fingerprint, localLayoutStorage, pickDefault, sanitise, type PresetName, type SavedLayout } from "./layout";
import { dockGroup, floatFailedPopouts, floatGroup, maximiseGroup, popoutGroup } from "./actions";
import { useShell } from "./WorkspaceProvider";
import { applyMotion, savedMotion } from "./motion";
import { guardTabClicks } from "./tabClick";
import LanternTab from "./LanternTab";
import GroupActions from "./GroupActions";
import Watermark from "./Watermark";
import ToolStrip from "./ToolStrip";
import { settleHidden } from "./stripRules";
import MapPanel from "./panels/MapPanel";
import CodeHomePanel from "./panels/CodeHomePanel";
import CodePanel from "./panels/CodePanel";
import GuidePanel from "./panels/GuidePanel";
import DetailsPanel from "./panels/DetailsPanel";
import FilesPanel from "./panels/FilesPanel";
import SettingsPanel from "./panels/SettingsPanel";
import CodeRoomPanel from "./panels/CodeRoomPanel";
import OutputPanel from "./panels/OutputPanel";
import { outputs } from "@/ide/outputStore";
import { outputHost } from "./outputDock";
import { preparePopout } from "./popout";

const components = {
  map: MapPanel,
  codeHome: CodeHomePanel,
  code: CodePanel,
  guide: GuidePanel,
  details: DetailsPanel,
  files: FilesPanel,
  settings: SettingsPanel,
  coderoom: CodeRoomPanel,
  output: OutputPanel,
};

// Only this one line changes when layouts are kept per account (§5.4).
const storage = localLayoutStorage;

export default function Workspace() {
  const { shell } = useShell();
  const shellRef = useRef(shell);
  useEffect(() => {
    shellRef.current = shell;
  }, [shell]);

  const subs = useRef<{ dispose(): void }[]>([]);
  // The tool strips need the dock's api, and the dock's box to tell left from right.
  const [dock, setDock] = useState<DockviewApi | null>(null);
  const dockBox = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const presetRef = useRef<PresetName | "custom">("explore");
  const printRef = useRef("");
  // The user's own arrangement while the window is too narrow for it (Stack shows meanwhile).
  const keptRef = useRef<SerializedDockview | null>(null);
  const hostOff = useRef<(() => void) | null>(null);

  const setPreset = useCallback((p: PresetName | "custom") => {
    presetRef.current = p;
    shellRef.current.setPresetName(p);
  }, []);

  const scheduleSave = useCallback(
    (api: DockviewApi) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const s = shellRef.current;
        if (s.api.current !== api || s.restoring.current) return;
        const layout = api.toJSON();
        if (presetRef.current !== "custom" && fingerprint(layout) !== printRef.current) setPreset("custom");
        const saved: SavedLayout = { v: 1, preset: presetRef.current, layout, savedAt: Date.now(), ...(keptRef.current ? { wide: keptRef.current } : {}) };
        void storage.save(saved);
      }, 500);
    },
    [setPreset],
  );

  const applyPreset = useCallback(
    (name: PresetName) => {
      const s = shellRef.current;
      const api = s.api.current;
      if (!api) return;
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      s.restoring.current = true;
      try {
        buildPreset(api, name, window.innerWidth);
        sizeWhenLaidOut(api, name);
        s.syncEditors(api);
        printRef.current = fingerprint(api.toJSON());
        setPreset(name);
      } finally {
        s.restoring.current = false;
      }
      scheduleSave(api);
    },
    [scheduleSave, setPreset],
  );

  const reset = useCallback(async () => {
    keptRef.current = null;
    await storage.clear();
    applyPreset(pickDefault(window.innerWidth));
  }, [applyPreset]);

  /** The user's own arrangement back, kept while the window was narrow. Pop-outs come back floating:
   * a resize is no click, so a new window would be blocked. */
  const restoreKept = useCallback(
    (api: DockviewApi, layout: SerializedDockview) => {
      const s = shellRef.current;
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      s.restoring.current = true;
      try {
        api.fromJSON(sanitise(layout, { popoutAllowed: false, viewport: { width: window.innerWidth, height: window.innerHeight } }));
        s.syncEditors(api);
        printRef.current = "";
        setPreset("custom");
      } catch {
        applyPreset(pickDefault(window.innerWidth));
      } finally {
        s.restoring.current = false;
      }
    },
    [applyPreset, setPreset],
  );

  // Crossing 900px moves between the stacked phone layout and the wide one.
  // Narrow, everything stacks: side-by-side groups would be a few words wide.
  // An arrangement of the user's own is kept meanwhile (saved too) and comes
  // back when the window is wide again.
  useEffect(() => {
    // Asked of the media query, not innerWidth: its change event can come before innerWidth catches up.
    const narrowQuery = window.matchMedia("(max-width: 899.98px)");
    const width = (): PresetName => (narrowQuery.matches ? "stack" : "explore");
    let last = width();
    const onResize = () => {
      const now = width();
      if (now === last) return;
      last = now;
      const api = shellRef.current.api.current;
      if (now === "stack") {
        if (presetRef.current === "custom" && api) keptRef.current = api.toJSON();
        applyPreset("stack");
      } else if (keptRef.current && api) {
        const kept = keptRef.current;
        keptRef.current = null;
        restoreKept(api, kept);
      } else if (presetRef.current !== "custom") applyPreset(now);
      if (api) scheduleSave(api);
    };
    // Both: a device's viewport can change without a resize event (and the other way round).
    window.addEventListener("resize", onResize);
    narrowQuery.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      narrowQuery.removeEventListener("change", onResize);
    };
  }, [applyPreset, restoreKept, scheduleSave]);

  const { setHandlers } = shell;
  useEffect(() => {
    // A preset picked from Layout ▾ replaces any arrangement kept for a wider window.
    setHandlers({
      applyPreset: (name: PresetName) => {
        keptRef.current = null;
        applyPreset(name);
      },
      reset: () => void reset(),
    });
    return () => setHandlers(null);
  }, [setHandlers, applyPreset, reset]);

  const onReady = useCallback(
    async ({ api }: DockviewReadyEvent) => {
      const s = shellRef.current;
      s.api.current = api;
      setDock(api);
      // The editors' "Pop out" opens the Output panel in this dock.
      hostOff.current?.();
      hostOff.current = outputs.setHost(outputHost(api));
      const mine = api;
      const alive = () => shellRef.current.api.current === mine;

      // Subscriptions belong to this instance; disposed on unmount.
      subs.current.forEach((d) => d.dispose());
      const seen = () => {
        if (shellRef.current.api.current === api) shellRef.current.setPresent(api.panels.map((p) => p.id));
      };
      subs.current = [
        api.onDidAddPanel(seen),
        api.onDidRemovePanel(seen),
        api.onDidLayoutChange(() => {
          if (!shellRef.current.restoring.current) scheduleSave(api);
        }),
        api.onDidRemovePanel((p) => {
          if (!shellRef.current.restoring.current && isEditorId(p.id)) shellRef.current.closeFileState(editorPath(p.id));
        }),
        // A panel brought forward (a question, a tour, a file opened) shows its group if the tool
        // strip had hidden it.
        api.onDidActivePanelChange(({ panel: p }) => {
          // Not while a saved layout comes back: its hidden groups stay hidden (settleHidden runs after).
          if (shellRef.current.restoring.current) return;
          if (p && p.group.api.location.type === "grid" && !p.group.api.isVisible) p.group.api.setVisible(true);
        }),
        // Dressed here, once /popout.html has loaded: user pop-outs and restored ones alike (popout.ts).
        api.onDidAddPopoutGroup(({ group, window: win }) => {
          if (win) preparePopout(win, group.activePanel?.title ?? "WalkMyCode", shellRef.current.commands, { popout: capabilities.popout });
        }),
        api.onDidOpenPopoutWindowFail(() => floatFailedPopouts(api, "Pop-ups are blocked here, so the panel is floating instead.")),
        // React Flow sizes itself from the main window's resize event.
        api.onDidPopoutGroupSizeChange(() => window.dispatchEvent(new Event("resize"))),
        // The light (docs/SHELL.md §8): its targets move while a group or tab is
        // dragged, so it hides; once dropped it goes home, and an undocked group
        // gets its beacon on its tab bar.
        api.onWillDragGroup(() => light.hide()),
        api.onWillDragPanel(() => light.hide()),
        api.onDidDrop(() => light.park()),
        // A click on a tab whose pointer slipped a few px is still a click (./tabClick.ts).
        guardTabClicks(api),
        api.onDidMovePanel(() => light.park()),
      ];

      s.restoring.current = true;
      try {
        const saved = await storage.load();
        if (!alive()) return;
        let restored = false;
        // Narrow, an arrangement made for a wide window is kept for later and Stack shows (see onResize);
        // wide again, the one kept while it was narrow comes back.
        const narrow = pickDefault(window.innerWidth) === "stack";
        let toRestore = saved ? { layout: saved.layout, preset: saved.preset } : null;
        if (saved && narrow) {
          keptRef.current = saved.wide ?? (saved.preset === "custom" ? saved.layout : null);
          if (!saved.wide && saved.preset === "custom") toRestore = null;
        } else if (saved?.wide) toRestore = { layout: saved.wide, preset: "custom" };
        if (toRestore) {
          try {
            api.fromJSON(sanitise(toRestore.layout, { popoutAllowed: capabilities.popout, viewport: { width: window.innerWidth, height: window.innerHeight } }));
            await api.popoutRestorationPromise;
            if (!alive()) return;
            restored = api.totalPanels > 0;
            if (restored) {
              presetRef.current = toRestore.preset;
              shellRef.current.setPresetName(toRestore.preset);
            }
          } catch {
            if (alive()) api.clear();
          }
        }
        if (!restored) {
          const name = pickDefault(window.innerWidth);
          buildPreset(api, name, window.innerWidth);
          sizeWhenLaidOut(api, name);
          presetRef.current = name;
          shellRef.current.setPresetName(name);
        }
        // Open files survive a restore; a pending reveal is carried out now.
        shellRef.current.syncEditors(api);
        settleHidden(api);
        printRef.current = restored && toRestore?.preset === "custom" ? "" : fingerprint(api.toJSON());
      } finally {
        if (alive()) shellRef.current.restoring.current = false;
      }
    },
    [scheduleSave],
  );

  useEffect(() => {
    applyMotion(savedMotion(), false);
    const s = shellRef.current;
    // A sash being dragged moves everything 1:1 (MOTION.md §4.14): no transition
    // anywhere while it is held. A class on <html> for the drag only; a `:has(.dv-sash:active)`
    // rule restyled the whole page each time dockview touched a sash's classes.
    const root = document.documentElement;
    const down = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(".dv-sash")) root.classList.add("sash-drag");
    };
    const up = () => root.classList.remove("sash-drag");
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      up();
      // Unmount (route change, StrictMode): the first StrictMode instance never saves.
      clearTimeout(saveTimer.current);
      subs.current.forEach((d) => d.dispose());
      subs.current = [];
      hostOff.current?.();
      hostOff.current = null;
      try {
        // Belt and braces: dockview's own dispose also closes them.
        s.api.current?.getPopouts().forEach((p) => p.window?.close?.());
      } catch {
        /* already disposed */
      }
      s.api.current = null;
      setDock(null);
    };
  }, []);

  const tabMenu = useCallback((p: GetTabContextMenuItemsParams) => {
    const { panel, group, api } = p;
    const where = group.api.location.type;
    const pinned = !!PANELS[panel.id]?.pinned;
    const items = [
      { label: "Close", action: () => panel.api.close(), disabled: pinned },
      "separator" as const,
      ...(where === "grid" ? [{ label: "Float", action: () => floatGroup(api, group) }] : []),
      ...(capabilities.popout && where !== "popout" ? [{ label: "Pop out into a window", action: () => void popoutGroup(api, group) }] : []),
      ...(where !== "grid" ? [{ label: "Dock back", action: () => void dockGroup(api, group) }] : []),
      ...(where === "grid" ? [{ label: group.api.isMaximized() ? "Restore size" : "Maximise", action: () => maximiseGroup(group) }] : []),
    ];
    return items;
  }, []);

  return (
    <div className="ws-row">
      <ToolStrip side="left" api={dock} dock={dockBox} />
      <div className="ws-dock" ref={dockBox}>
        <DockviewReact
          {...DOCK_OPTIONS}
          theme={lanternTheme}
          components={components}
          defaultTabComponent={LanternTab}
          rightHeaderActionsComponent={GroupActions}
          watermarkComponent={Watermark}
          getTabContextMenuItems={tabMenu}
          onReady={onReady}
        />
      </div>
      <ToolStrip side="right" api={dock} dock={dockBox} />
    </div>
  );
}

/** Preset column sizes, applied on the next frame against the dock's real size. */
function sizeWhenLaidOut(api: DockviewApi, name: PresetName) {
  // Two frames, so a window that is still resizing has handed the dock its new
  // width; then once more a little later in case the resize was still going.
  const apply = () => api.width > 0 && sizePreset(api, name, api.width, api.height);
  requestAnimationFrame(() => requestAnimationFrame(apply));
  setTimeout(apply, 150);
}
