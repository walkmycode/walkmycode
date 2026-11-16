"use client";
// The files of the workspace as folders (docs/MOTION.md §4.10). With several
// repos open, the top level is one entry per repo; every file wears the drawing for what it is
// (src/lib/fileIcon.ts: the Dockerfile the container, a test the checklist, Rust code orange), and a folder
// with a job wears that job's.
//
// It follows the map: whenever the open file changes (a card, a trace, a
// tour step, the guide, Claude), the folders down to it open one level at a
// time, a rail is drawn from the top folder to the file, the file lights up,
// and the tree scrolls only if the file is out of view. The files a trace
// passes through keep their number. Only the rows in view are drawn, so a
// 12,000-file workspace scrolls like a small one; every motion is opacity,
// transform or one SVG stroke, and none of it plays with motion off.
//
// Every file of the project is listed (owner, 13 Nov; mockup docs/design/files-all.html): the map's, then the
// rest (README.md, LICENSE, images...), a shade quieter, each with its own drawing. Search (Ctrl+P, or / in the
// panel) is fuzzy over every path as you type: the results rise in, the matched letters lit; Up/Down move, Enter
// opens and shows it in the tree, Esc clears. The chips narrow it to code, docs, config or images.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CodeMap } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import { ancestorsOf, buildTree, centreOn, flatten, railPath, rowInView, stepsInside, traceOrder, windowOf, type FileKind, type TreeDir, type TreeFile, type TreeRow } from "@/lib/fileTree";
import { searchFiles, type FileHit } from "@/lib/fileSearch";
import { motionOff } from "@/lib/motion";
import { useDebugAt } from "@/ide/debugAt";
import FileIcon from "@/components/FileIcon";
import { readPref } from "@/lib/prefs";

interface Props {
  map: CodeMap;
  open: string | null;
  onOpen: (path: string) => void;
  /** The trace on the map, if any: its files are numbered in the tree. */
  lit?: Lit | null;
  /** Every file of the workspace (its files' paths): those not on the map are listed too. */
  paths?: readonly string[];
}

const CHIPS: [FileKind | "all", string][] = [
  ["all", "All"],
  ["code", "Code"],
  ["doc", "Docs"],
  ["config", "Config"],
  ["image", "Images"],
];
/** Results drawn at most; the count says how many matched. */
const SHOWN = 200;

/** Every file under a folder, in tree order. */
function filesOf(d: TreeDir, out: TreeFile[] = []): TreeFile[] {
  for (const sub of d.dirs.values()) filesOf(sub, out);
  out.push(...d.files);
  return out;
}

/** `text` with the letters at `at` (indexes into the whole path; `text` starts at `from`) lit. */
function Marked({ text, at, from }: { text: string; at: readonly number[]; from: number }) {
  if (!at.length) return <>{text}</>;
  const marks = new Set(at);
  const out: React.ReactNode[] = [];
  let run = "";
  let on = false;
  const flush = (k: number) => {
    if (run) out.push(on ? <mark key={k}>{run}</mark> : run);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = marks.has(from + i);
    if (m !== on) {
      flush(i);
      on = m;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{out}</>;
}

const FOLLOW_PREF = "walkmycode:files-follow";
/** One folder level opens every this many ms on the way down (--t-step). */
const LEVEL_MS = 70;
/** Unscaled px, multiplied by --fs / --sp as the CSS does. */
const INDENT = 12;
const PAD = 4;
const SIDE = 8;

function readFollow(): boolean {
  try {
    return readPref(localStorage, FOLLOW_PREF) !== "off";
  } catch {
    return true;
  }
}

/** The page's size settings (look.ts), read when the row size changes rather than every render. */
function scales(): { fs: number; sp: number } {
  const css = getComputedStyle(document.documentElement);
  const n = (v: string, d: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  return { fs: n(css.getPropertyValue("--fs"), 1), sp: n(css.getPropertyValue("--sp"), 1) };
}

export default function FileTree({ map, open, onOpen, lit = null, paths }: Props) {
  const root = useMemo(() => buildTree(map, paths), [map, paths]);
  const repoOrder = useMemo(() => (map.repos.length > 1 ? map.repos.map((r) => r.label) : []), [map]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(open ? ancestorsOf(open) : []));
  const rows = useMemo(() => flatten(root, expanded, repoOrder), [root, expanded, repoOrder]);
  const index = useMemo(() => new Map(rows.map((r, i) => [r.path, i])), [rows]);
  const numbers = useMemo(() => traceOrder(map, lit), [map, lit]);
  const inside = useMemo(() => stepsInside(numbers), [numbers]);
  const [follow, setFollow] = useState(readFollow);

  // ── Size and scroll: the row height is measured once and again when the text size changes. ──
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(20);
  const [scale, setScale] = useState({ fs: 1, sp: 1 });
  const [view, setView] = useState({ top: 0, height: 400 });
  useLayoutEffect(() => {
    const p = probe.current;
    const b = box.current;
    if (!p || !b) return;
    const measure = () => {
      const h = p.getBoundingClientRect().height;
      if (h > 0) setRowH(h);
      setScale(scales());
      setView({ top: b.scrollTop, height: b.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback(() => {
    const b = box.current;
    if (b) setView({ top: b.scrollTop, height: b.clientHeight });
  }, []);

  // ── Rows that appear because a folder opened rise in (not rows scrolled into view). ──
  const [justOpened, setJustOpened] = useState<ReadonlySet<string>>(() => new Set());
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opened = useCallback((folders: string[]) => {
    if (motionOff() || !folders.length) return;
    setJustOpened((s) => new Set([...s, ...folders]));
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setJustOpened(new Set()), 500);
  }, []);
  useEffect(() => () => void (settle.current && clearTimeout(settle.current)), []);

  // ── The reveal: folders open level by level, then the scroll, the rail and the light. ──
  const [reveal, setReveal] = useState(0);
  const run = useRef(0);
  const pending = useRef<string | null>(null);
  const shown = useRef(expanded);
  useLayoutEffect(() => {
    shown.current = expanded;
  }, [expanded]);
  const goTo = useCallback((path: string, animate: boolean) => {
    const id = ++run.current;
    const todo = ancestorsOf(path).filter((a) => !shown.current.has(a));
    const land = () => {
      pending.current = path;
      setReveal((n) => n + 1);
    };
    if (!todo.length || !animate) {
      if (todo.length) setExpanded((s) => new Set([...s, ...todo]));
      land();
      return;
    }
    todo.forEach((a, i) =>
      setTimeout(() => {
        if (id !== run.current) return;
        setExpanded((cur) => (cur.has(a) ? cur : new Set([...cur, a])));
        opened([a]);
        if (i === todo.length - 1) land();
      }, i * LEVEL_MS),
    );
  }, [opened]);

  const first = useRef(true);
  useEffect(() => {
    // The file open when the panel appears is shown at once; every later one is revealed.
    const initial = first.current;
    first.current = false;
    if (!open) return;
    if (initial || follow) goTo(open, !initial && !motionOff());
    // Following is read when the file changes, not when it is switched back on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goTo]);

  // Once the folders are open: scroll only if the file is out of view.
  useLayoutEffect(() => {
    const path = pending.current;
    const b = box.current;
    if (!path || !b || !reveal) return;
    const i = index.get(path);
    if (i === undefined) return;
    pending.current = null;
    if (!rowInView(i, rowH, b.scrollTop, b.clientHeight)) b.scrollTo({ top: centreOn(i, rowH, b.clientHeight, rows.length), behavior: motionOff() ? "auto" : "smooth" });
  }, [reveal, index, rowH, rows.length]);

  const toggle = useCallback((path: string) => {
    run.current++; // a hand on the tree stops a reveal on its way down
    const opening = !shown.current.has(path);
    setExpanded((s) => {
      const n = new Set(s);
      if (!n.delete(path)) n.add(path);
      return n;
    });
    if (opening) opened([path]);
  }, [opened]);
  const foldAll = useCallback(() => {
    run.current++;
    setExpanded(new Set());
  }, []);
  const switchFollow = useCallback(() => {
    const next = !follow;
    setFollow(next);
    try {
      localStorage.setItem(FOLLOW_PREF, next ? "on" : "off");
    } catch {
      // Storage blocked: the switch lasts until the page closes.
    }
    if (next && open) goTo(open, !motionOff());
  }, [follow, goTo, open]);
  const locate = useCallback(() => open && goTo(open, !motionOff()), [goTo, open]);

  // The live debugger (src/ide/debugAt.ts): the tree points at the file it stopped in, whatever "follow" says,
  // replaying the reveal each time it stops in another file; the row carries the stopped line.
  const dbgAt = useDebugAt();
  const dbgPath = dbgAt?.path ?? null;
  useEffect(() => {
    if (dbgPath) goTo(dbgPath, !motionOff());
  }, [dbgPath, goTo]);

  // ── Search: every file, fuzzy, as you type ──
  const all = useMemo(() => filesOf(root).filter((f) => f.skipped !== "secret"), [root]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const f of all) c[f.kind] = (c[f.kind] ?? 0) + 1;
    return c;
  }, [all]);
  const byPath = useMemo(() => new Map(all.map((f) => [f.path, f])), [all]);
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<FileKind | "all">("all");
  const [sel, setSel] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const hitsBox = useRef<HTMLDivElement>(null);
  const searching = q.trim() !== "" || chip !== "all";
  const found = useMemo((): { hits: FileHit[]; total: number } | null => {
    if (!searching) return null;
    const pool = (chip === "all" ? all : all.filter((f) => f.kind === chip)).map((f) => f.path);
    if (q.trim()) return searchFiles(pool, q, SHOWN);
    return { hits: pool.slice(0, SHOWN).map((path) => ({ path, score: 0, at: [] })), total: pool.length };
  }, [searching, chip, all, q]);
  const clear = useCallback(() => {
    setQ("");
    setChip("all");
    setSel(0);
  }, []);
  const pick = useCallback(
    (path: string) => {
      onOpen(path);
      clear();
      goTo(path, !motionOff());
    },
    [onOpen, clear, goTo],
  );
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = found?.hits.length ?? 0;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (searching) clear();
      else field.current?.blur();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
      e.preventDefault();
      setSel((s) => (e.key === "ArrowDown" ? Math.min(n - 1, s + 1) : Math.max(0, s - 1)));
    } else if (e.key === "Enter" && found?.hits[sel]) {
      e.preventDefault();
      pick(found.hits[sel].path);
    }
  };
  // The selection stays in view as it moves.
  useEffect(() => {
    hitsBox.current?.querySelector<HTMLElement>(".tree-hit.sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  // Ctrl+P anywhere (while the panel is on show), or / inside the panel: to the search.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = panel.current;
      if (!el || el.offsetParent === null || !field.current) return;
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true'], .cm-content");
      const ctrlP = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p";
      const slash = e.key === "/" && !typing && el.contains(e.target as Node);
      if (!ctrlP && !slash) return;
      e.preventDefault();
      field.current.focus();
      field.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── What to draw ──
  const { start, end } = windowOf(view.top, view.height, rowH, rows.length);
  /** A row whose folder has just opened: its place among the folder's rows, for the stagger. */
  const enterOf = (path: string, i: number): number | undefined => {
    if (!justOpened.size) return undefined;
    const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    const at = justOpened.has(parent) ? index.get(parent) : undefined;
    return at === undefined ? undefined : Math.min(i - at - 1, 12);
  };
  const openAt = open ? index.get(open) : undefined;
  const trail = useMemo(() => new Set(open ? ancestorsOf(open) : []), [open]);
  const rail = open && reveal ? railPath(rows, open, rowH, INDENT * scale.fs, PAD * scale.fs + SIDE * scale.sp) : null;
  const away = !follow && open ? (openAt === undefined ? "hidden" : openAt * rowH < view.top ? "up" : (openAt + 1) * rowH > view.top + view.height ? "down" : null) : null;

  return (
    <div className="tree-panel fill" ref={panel}>
      <div className={`tree-search${searching ? " searching" : ""}`}>
        <label className="tree-field">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={field}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onSearchKey}
            placeholder={`Search ${all.length.toLocaleString("en-GB")} files`}
            aria-label="Search files"
            aria-controls="tree-hits"
            autoComplete="off"
            spellCheck={false}
            data-testid="files-search"
          />
          {searching ? (
            <button
              type="button"
              className="tree-clear"
              onClick={() => {
                clear();
                field.current?.focus();
              }}
              aria-label="Clear the search"
            >
              ✕
            </button>
          ) : (
            <kbd>Ctrl P</kbd>
          )}
        </label>
        <div className="tree-chips" role="group" aria-label="Show">
          {CHIPS.filter(([k]) => k === "all" || counts[k]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={chip === k}
              onClick={() => {
                setChip(chip === k ? "all" : k);
                setSel(0);
              }}
            >
              {label} <b>{(counts[k] ?? 0).toLocaleString("en-GB")}</b>
            </button>
          ))}
        </div>
      </div>
      {found && (
        <div className="tree-hits fill" id="tree-hits" ref={hitsBox} role="listbox" aria-label="Files found">
          <p className="tree-count" aria-live="polite">
            {found.total ? `${found.total.toLocaleString("en-GB")} of ${all.length.toLocaleString("en-GB")}` : ""}
          </p>
          {found.hits.map((h, k) => {
            const cut = h.path.lastIndexOf("/") + 1;
            const f = byPath.get(h.path);
            return (
              <button
                key={h.path}
                type="button"
                role="option"
                aria-selected={k === sel}
                className={`tree-hit${k === sel ? " sel" : ""}${f?.unmapped ? " unmapped" : ""}`}
                style={{ "--k": Math.min(k, 12) } as React.CSSProperties}
                onClick={() => pick(h.path)}
                onMouseMove={() => k !== sel && setSel(k)}
                title={h.path}
              >
                <FileIcon path={h.path} kind={f?.kind} size="hit" />
                <span className="hit-name">
                  <Marked text={h.path.slice(cut)} at={h.at} from={cut} />
                </span>
                <span className="hit-dir">{cut ? <Marked text={h.path.slice(0, cut - 1)} at={h.at} from={0} /> : "the top folder"}</span>
              </button>
            );
          })}
          {!found.total && (
            <p className="tree-none" key={`none-${q}-${chip}`}>
              <b>No file matches “{q.trim()}”</b>
              Try fewer letters{chip !== "all" ? ", or All" : ""}.
            </p>
          )}
          {found.total > found.hits.length && <p className="tree-more">{(found.total - found.hits.length).toLocaleString("en-GB")} more: type a few more letters.</p>}
        </div>
      )}
      <div className="tree-bar" hidden={!!found}>
        <Crumbs path={open} repo={repoOrder.length ? null : map.repos[0]?.label ?? null} />
        <span className="tree-tools">
          <button type="button" onClick={locate} disabled={!open} title="Show the open file in the tree" aria-label="Show the open file in the tree">
            <Ico d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M8 5.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5z" />
          </button>
          <button type="button" onClick={switchFollow} aria-pressed={follow} className={follow ? "on" : undefined} title={follow ? "Following the map: the tree opens to each file it shows. Click to stop." : "Not following the map. Click to follow it."} aria-label="Follow the map">
            <Ico d="M2.5 5.5h8.5l-2.5-2.5M13.5 10.5H5l2.5 2.5" />
          </button>
          <button type="button" onClick={foldAll} title="Fold every folder" aria-label="Fold every folder">
            <Ico d="M2.5 2.5h11v11h-11zM5.5 8h5" />
          </button>
        </span>
      </div>
      <div className="tree fill" ref={box} onScroll={onScroll} role="tree" aria-label="Files" hidden={!!found}>
        <div className="tree-probe" ref={probe} aria-hidden>
          x
        </div>
        <div className="tree-body" style={{ height: rows.length * rowH }}>
          {rail && (
            <svg className="tree-rail" key={reveal} width="100%" height={rows.length * rowH} aria-hidden>
              <path d={rail} pathLength={1} className={motionOff() ? undefined : "draw"} />
            </svg>
          )}
          {rows.slice(start, end).map((r, k) => (
            <Row
              key={r.path === open ? `${r.path}#${reveal}` : r.path}
              row={r}
              top={(start + k) * rowH}
              open={r.kind === "dir" && expanded.has(r.path)}
              on={r.path === open}
              trail={trail.has(r.path)}
              n={numbers.get(r.path)}
              held={r.kind === "dir" && !expanded.has(r.path) ? inside.get(r.path)?.join(" ") : undefined}
              enter={enterOf(r.path, start + k)}
              dbgLine={dbgAt && r.path === dbgAt.path ? dbgAt.line : undefined}
              onToggle={toggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      {away && open && (
        <button type="button" className={`tree-away ${away === "up" ? "up" : "down"}`} onClick={locate}>
          {away === "up" ? "▲" : "▼"} {open.split("/").slice(-2).join("/")}
        </button>
      )}
    </div>
  );
}

const Row = memo(function Row(p: { row: TreeRow; top: number; open: boolean; on: boolean; trail: boolean; n?: number; held?: string; enter?: number; dbgLine?: number; onToggle: (path: string) => void; onOpen: (path: string) => void }) {
  const { row: r } = p;
  const style = { top: p.top, paddingLeft: `calc(${PAD + r.depth * INDENT}px * var(--fs) + ${SIDE}px * var(--sp))`, ...(p.enter !== undefined ? { "--k": p.enter } : {}) } as React.CSSProperties;
  const cls = [r.kind === "dir" ? "dir" : "file", r.repo && "repo", p.open && "open", p.on && "on beacon", p.trail && "trail", p.n && "visited", p.enter !== undefined && "enter", r.skipped && "skipped", r.unmapped && "unmapped", p.dbgLine !== undefined && "debugging"].filter(Boolean).join(" ");
  if (r.kind === "dir") {
    return (
      <button type="button" role="treeitem" aria-selected={false} className={cls} style={style} aria-expanded={p.open} title={r.repo ? `the ${r.name} repo` : r.path} onClick={() => p.onToggle(r.path)}>
        {/* One glyph that turns, rather than two that swap. */}
        <span className="glyph" aria-hidden="true">
          ▸
        </span>{" "}
        {!r.repo && <FileIcon path={r.path} dir />}
        {r.name}/{r.repo && <span className="repotag">repo</span>}
        {p.held && (
          <span className="step held" title="Steps of the trace inside this folder">
            {p.held}
          </span>
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={p.on}
      aria-current={p.on ? "location" : undefined}
      className={cls}
      style={style}
      title={r.skipped ? `not in the map: ${r.skipped}` : r.unmapped ? `${r.path} (not on the map)` : r.config ? `${r.path} (config file: read for services, never run)` : r.path}
      onClick={() => r.skipped !== "secret" && p.onOpen(r.path)}
    >
      <span className="name">
        {/* The file's drawing: a secret is the padlock, never opened (src/lib/fileIcon.ts). */}
        <FileIcon path={r.path} kind={r.fileKind} />
        {r.name}
      </span>
      {p.dbgLine !== undefined && (
        // Keyed by the line: each stop slides the pointer in again.
        <span key={p.dbgLine} className="dbg-ptr" aria-label={`the debugger stopped here, at line ${p.dbgLine}`}>
          <i aria-hidden />:{p.dbgLine}
        </span>
      )}
      {p.n !== undefined && (
        <span className="step" aria-label={`step ${p.n} of the trace`}>
          {p.n}
        </span>
      )}
    </button>
  );
});

/** Where the open file is, one segment per folder. */
function Crumbs({ path, repo }: { path: string | null; repo: string | null }) {
  const parts = path ? [...(repo ? [repo] : []), ...path.split("/")] : repo ? [repo] : [];
  return (
    <span className="tree-crumbs" title={path ?? undefined}>
      <span key={path ?? ""}>
        {parts.map((s, i) => (
          <span key={i} className={i === parts.length - 1 && path ? "last" : undefined} style={{ "--i": i } as React.CSSProperties}>
            {s}
          </span>
        ))}
      </span>
    </span>
  );
}

function Ico({ d }: { d: string }) {
  return (
    <svg className="tool-ico" viewBox="0 0 16 16" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
