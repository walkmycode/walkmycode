"use client";
// The files of the workspace as folders. With several repos open, the top
// level is one entry per repo (every path starts with its label); config
// files carry a gear.
import { useMemo, useState } from "react";
import type { CodeMap } from "@/analyzer/types";

interface Props {
  map: CodeMap;
  open: string | null;
  onOpen: (path: string) => void;
}

interface Dir {
  name: string;
  path: string;
  dirs: Map<string, Dir>;
  files: { name: string; path: string; skipped?: string; config?: boolean }[];
}

export default function FileTree({ map, open, onOpen }: Props) {
  const root = useMemo(() => {
    const r: Dir = { name: "", path: "", dirs: new Map(), files: [] };
    for (const f of map.files) {
      const parts = f.path.split("/");
      let d = r;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts.slice(0, i + 1).join("/");
        let nd = d.dirs.get(parts[i]);
        if (!nd) {
          nd = { name: parts[i], path: p, dirs: new Map(), files: [] };
          d.dirs.set(parts[i], nd);
        }
        d = nd;
      }
      d.files.push({ name: parts[parts.length - 1], path: f.path, skipped: f.skipped, config: f.lang === "config" || f.lang === "proto" || !!f.configKind });
    }
    return r;
  }, [map]);
  const repoLabels = useMemo(() => new Set(map.repos.length > 1 ? map.repos.map((r) => r.label) : []), [map]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(open ? open.split("/").map((_, i, a) => a.slice(0, i + 1).join("/")) : []));

  const render = (d: Dir, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    // Repos first, in the order they were added; then folders by name.
    const repoRank = (x: Dir) => (depth === 0 && repoLabels.has(x.name) ? map.repos.findIndex((r) => r.label === x.name) : Infinity);
    for (const sub of [...d.dirs.values()].sort((a, b) => repoRank(a) - repoRank(b) || a.name.localeCompare(b.name))) {
      const isOpen = expanded.has(sub.path);
      const isRepo = depth === 0 && repoLabels.has(sub.name);
      out.push(
        <button
          key={sub.path}
          className={`${isRepo ? "dir repo" : "dir"}${isOpen ? " open" : ""}`}
          aria-expanded={isOpen}
          style={{ paddingLeft: `calc(${4 + depth * 12}px * var(--fs))` }}
          title={isRepo ? `the ${sub.name} repo` : sub.path}
          onClick={() => setExpanded((s) => (s.has(sub.path) ? new Set([...s].filter((x) => x !== sub.path)) : new Set([...s, sub.path])))}
        >
          {/* One glyph that turns, rather than two that swap. */}
          <span className="glyph" aria-hidden="true">
            ▸
          </span>{" "}
          {sub.name}/{isRepo && <span className="repotag">repo</span>}
        </button>,
      );
      if (isOpen) out.push(...render(sub, depth + 1));
    }
    for (const f of d.files.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(
        <button key={f.path} className={f.path === open ? "on" : ""} style={{ paddingLeft: `calc(${4 + depth * 12}px * var(--fs))`, opacity: f.skipped ? 0.55 : 1 }} title={f.skipped ? `not in the map: ${f.skipped}` : f.config ? `${f.path} (config file: read for services, never run)` : f.path} onClick={() => f.skipped !== "secret" && onOpen(f.path)}>
          {f.skipped === "secret" ? "🔒 " : f.config ? <span className="gear" aria-label="config file">{"⚙︎ "}</span> : ""}
          {f.name}
        </button>,
      );
    }
    return out;
  };
  return <div className="tree fill">{render(root, 0)}</div>;
}
