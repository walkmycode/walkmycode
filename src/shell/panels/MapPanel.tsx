"use client";
// The map as a dock panel: the breadcrumb over the graph. React Flow listens
// to its own window, so when the panel moves to another window (pop-out) the
// graph is remounted there and fitted again; when a hidden map tab comes
// back, it re-reads its size (docs/SHELL.md §7). Over the graph, "Where does
// this point?" asks about settings with no value (docs/SERVICES.md §13), and
// the fly-through's bar shows where the map is travelling (FlyBar).
import { useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import MapView from "@/components/MapView";
import Breadcrumb from "@/components/Breadcrumb";
import { AskBar } from "@/components/PointsAt";
import FlyBar from "@/components/FlyBar";
import { CodeMissingBanner } from "@/components/AddFolder";
import { useWorkspace } from "@/lib/store";
import { useShell } from "../WorkspaceProvider";

export default function MapPanel({ api }: IDockviewPanelProps) {
  const s = useShell();
  const codeMissing = !!useWorkspace()?.codeElsewhere;
  const [where, setWhere] = useState(api.location.type);
  const [fit, setFit] = useState(0);
  // React Flow marks each measured card `visibility: visible`, which beats the
  // hidden tab's own `visibility: hidden`: a map tab behind another showed through.
  const [shown, setShown] = useState(api.isVisible);

  useEffect(() => {
    const a = api.onDidLocationChange((e) => setWhere(e.location.type));
    const b = api.onDidVisibilityChange((e) => {
      setShown(e.isVisible);
      if (!e.isVisible) return;
      window.dispatchEvent(new Event("resize"));
      setFit((n) => n + 1);
    });
    return () => {
      a.dispose();
      b.dispose();
    };
  }, [api]);

  return (
    <div className={`dock-panel map${shown ? "" : " off"}`}>
      <header className="dock-head">
        <Breadcrumb map={s.map} view={s.view} selected={s.selected} onView={s.changeView} onSelect={s.selectNode} />
        <span className="sp" />
        <span className="note map-hint">{s.view.kind === "system" ? "click a card · double-click to open it" : "click a card · double-click to focus"}</span>
      </header>
      <AskBar map={s.map} />
      {codeMissing && <CodeMissingBanner />}
      <div className="fill" style={{ position: "relative" }}>
        <MapView
          key={where}
          map={s.map}
          view={s.view}
          selected={s.selected}
          lit={s.lit}
          focus={s.focus}
          showImports={s.showImports}
          reveal={s.mapReveal}
          fit={fit}
          onSelect={s.selectNode}
          onEdge={s.onEdge}
          onLinks={s.onLinks}
          onFocus={s.setFocus}
          onToggleImports={s.toggleImports}
          onView={s.changeView}
          onJump={s.jumpTo}
          onPalette={s.openPalette}
        />
        <FlyBar />
        {s.map.nodes.length === 0 && <MapEmpty other={s.map.stats.otherCode} />}
      </div>
    </div>
  );
}

/** An empty map says why: code in a language the map doesn't draw yet (the guide still reads it), or none at all. */
function MapEmpty({ other }: { other?: Record<string, number> }) {
  const langs = Object.entries(other ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="map-empty" role="status">
      {langs.length ? (
        <>
          <b>This project is written in {langs.map(([l, n]) => `${l} (${n} file${n === 1 ? "" : "s"})`).join(", ")}.</b>
          <p>The map doesn’t draw {langs.length === 1 ? langs[0][0] : "these languages"} yet. The guide can still read, search and explain every file: ask it a question, or open a file from Files.</p>
        </>
      ) : (
        <>
          <b>Nothing to map here.</b>
          <p>WalkMyCode found no code in this folder. Check it’s the project’s folder, or ask the guide.</p>
        </>
      )}
    </div>
  );
}
