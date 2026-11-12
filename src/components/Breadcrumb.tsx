"use client";
// Where you are on the map: System › users service › GET /users/:id. Each
// crumb goes back up a level. Without a system level (one app) the root is
// the workspace name.
import type { CodeMap } from "@/analyzer/types";
import { nodeById } from "@/lib/store";
import { hasSystem, type MapViewState } from "./mapLayout";

interface Props {
  map: CodeMap;
  view: MapViewState;
  selected: string | null;
  onView: (view: MapViewState) => void;
  onSelect: (id: string | null) => void;
}

interface Crumb {
  key: string;
  label: string;
  mono?: boolean;
  go?: () => void;
}

export default function Breadcrumb({ map, view, selected, onView, onSelect }: Props) {
  const crumbs: Crumb[] = [];
  if (hasSystem(map)) {
    crumbs.push({
      key: "system",
      label: "System",
      go: () => {
        onView({ kind: "system" });
        onSelect(null);
      },
    });
    if (view.kind === "service") {
      const s = map.services.find((x) => x.id === view.id);
      crumbs.push({ key: view.id, label: `${s?.name ?? view.id} service`, go: () => onSelect(null) });
    } else if (view.kind === "all") {
      crumbs.push({ key: "all", label: "everything", go: () => onSelect(null) });
    }
  } else {
    crumbs.push({ key: "root", label: map.name, go: () => onSelect(null) });
  }
  if (selected) {
    const s = map.services.find((x) => x.id === selected);
    const n = s ? undefined : nodeById(map, selected);
    const label = s ? `${s.name} service` : n?.name;
    if (label && crumbs[crumbs.length - 1].label !== label) crumbs.push({ key: `sel:${selected}`, label, mono: n?.kind === "route" });
  }
  return (
    <nav className="crumbs" aria-label="Where you are on the map">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.key} className="crumb">
            {i > 0 && <span className="sep">›</span>}
            {last || !c.go ? (
              <span className={`here${c.mono ? " mono" : ""}`} aria-current="location">
                {c.label}
              </span>
            ) : (
              <button onClick={c.go}>{c.label}</button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
