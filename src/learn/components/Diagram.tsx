"use client";
/**
 * A diagram on the board, from Mermaid source the Guide or the Professor wrote
 * (flowchart, sequence, class, state, entity-relationship, mind map…), drawn in
 * the blueprint of docs/design/diagram-blueprint.html (src/lib/diagramStyle.ts):
 * a window with a caption and a legend, cards coloured by the map's layers,
 * links that flow. Mermaid loads only when a board has a diagram. Strict
 * security: no HTML labels, no scripts, no clicks.
 *
 * Like the map, it can be moved about: drag to pan, Ctrl+scroll (or pinch) to
 * zoom, double-click to zoom in, and ⤢ opens it nearly full-window, where the
 * wheel zooms on its own. On a narrow board a wide diagram starts fitted, so
 * it is all there at once; zoom in to read it.
 */
import { textScale } from "@/lib/look";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { frontMatter, INK, kindLabel, LANES, styleSvg, type Lane } from "@/lib/diagramStyle";

type Mermaid = typeof import("mermaid").default;
let ready: Promise<Mermaid> | null = null;

/** The diagrams' font by its real name: Mermaid measures labels in a scratch element outside the
 * page's layout, where `var(--font-sans)` means nothing, and drawn in another font they spill out. */
function displayFont(): string {
  const host = document.querySelector(".root") ?? document.body;
  const v = getComputedStyle(host).getPropertyValue("--font-sans").trim();
  return v ? `${v}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Type in Mermaid's own stylesheet, so it is measured as drawn: bold names, small file lines, pill
 * labels, group titles in capitals. Colours and shapes come after (styleSvg). */
// One size per label: Mermaid spaces a label's lines in em, so a smaller second line would crowd the first.
const typeCss = (k: number) => `
  .node .label text { font-size: ${13 * k}px; }
  .node .label text .text-outer-tspan:first-child, .actor tspan { font-weight: 800; }
  .node .label text .text-outer-tspan + .text-outer-tspan { font-weight: 400; fill: ${INK.dim} !important; }
  .edgeLabel text, .messageText { font-size: ${11 * k}px; font-weight: 700; }
  .cluster-label text, .loopText, .loopText tspan, .labelText { font-size: ${10.5 * k}px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; fill: ${INK.amber} !important; }
`;

function load() {
  ready ??= import("mermaid").then(async ({ default: mermaid }) => {
    const fontFamily = displayFont();
    // Measured in the font it is drawn in, or the boxes come out the wrong size.
    await Promise.all(["400", "700", "800"].map((w) => document.fonts?.load(`${w} 14px ${fontFamily}`).catch(() => {})));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily,
      // SVG text, not HTML: measured in the page's font, and dressed by styleSvg.
      htmlLabels: false,
      themeCSS: typeCss(textScale()),
      themeVariables: {
        darkMode: true,
        background: "transparent",
        primaryColor: INK.card,
        primaryBorderColor: INK.line,
        primaryTextColor: INK.ink,
        secondaryColor: INK.card,
        tertiaryColor: INK.card,
        mainBkg: INK.card,
        lineColor: "rgba(241,239,230,.45)",
        textColor: INK.ink,
        edgeLabelBackground: INK.card,
        clusterBkg: "transparent",
        clusterBorder: INK.amber,
        titleColor: INK.amber,
        actorBkg: INK.card,
        actorBorder: INK.line,
        actorTextColor: INK.ink,
        actorLineColor: INK.line,
        signalColor: INK.dim,
        signalTextColor: INK.dim,
        labelBoxBkgColor: "transparent",
        labelBoxBorderColor: INK.amber,
        labelTextColor: INK.amber,
        loopTextColor: INK.amber,
        noteBkgColor: INK.card,
        noteBorderColor: INK.line,
        noteTextColor: INK.ink,
        fontSize: `${14 * textScale()}px`,
        fontFamily,
      },
      // Wide enough that a file path stays on one line instead of breaking mid-word.
      markdownAutoWrap: false,
      flowchart: { curve: "basis", padding: 26, nodeSpacing: 46, rankSpacing: 70, wrappingWidth: 420 },
      sequence: { width: 170, actorMargin: 46, messageFontWeight: 700, mirrorActors: false },
    });
    return mermaid;
  });
  return ready;
}

/** The drawing's own size, from its viewBox (Mermaid sizes the svg to its box with max-width). */
function sizeOf(svg: string): { w: number; h: number } {
  const m = /viewBox="([\d.\-e]+)[ ,]+([\d.\-e]+)[ ,]+([\d.\-e]+)[ ,]+([\d.\-e]+)"/.exec(svg);
  const w = m ? Number(m[3]) : 0;
  const h = m ? Number(m[4]) : 0;
  return w > 0 && h > 0 ? { w, h } : { w: 800, h: 600 };
}

/** The svg at its own size, so the view's scale is the only scaling. */
function natural(svg: string, { w, h }: { w: number; h: number }): string {
  return svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    const rest = attrs.replace(/\s(width|height)="[^"]*"/g, "").replace(/\sstyle="[^"]*"/, "");
    return `<svg${rest} width="${w}" height="${h}" style="max-width:none">`;
  });
}

/** Diagrams already drawn, by source: Mermaid runs once per diagram however often it is shown (the
 * history restored, ⤢, a panel moved). The newest 40. */
const drawn = new Map<string, string>();
function remember(body: string, svg: string) {
  drawn.set(body, svg);
  if (drawn.size > 40) drawn.delete(drawn.keys().next().value as string);
}

export default function Diagram({ source, label, laneOf }: { source: string; label?: string; laneOf?: (text: string) => Lane | null }) {
  const id = `d${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // The title goes in the window's caption, not inside the drawing.
  const { title, body } = useMemo(() => frontMatter(source), [source]);
  const [svg, setSvg] = useState(() => drawn.get(frontMatter(source).body) ?? "");
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);
  const [lanes, setLanes] = useState<Lane[]>([]);
  // Drawn when it comes near the screen: a long history doesn't draw every diagram at once.
  const spot = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = spot.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return void setTimeout(() => setNear(true));
    const io = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near, svg]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    const hit = drawn.get(body);
    (hit
      ? Promise.resolve(hit)
      : load()
          .then((m) => m.render(id, body))
          .then(({ svg }) => {
            remember(body, svg);
            return svg;
          })
    )
      .then((s) => {
        if (live) setSvg(s);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [near, id, body]);

  if (failed) {
    return (
      <figure className="diagram failed">
        <figcaption>This diagram could not be drawn. Its outline:</figcaption>
        <pre>{source}</pre>
      </figure>
    );
  }
  if (!svg) {
    return (
      <figure ref={spot} className="diagram dg-waiting" aria-label={label || "A diagram"}>
        <p className="note">Drawing…</p>
      </figure>
    );
  }
  const size = sizeOf(svg);
  const html = natural(svg, size);
  const kind = kindLabel(/aria-roledescription="([^"]*)"/.exec(svg)?.[1]);
  const frame: Frame = { kind, title, lanes, laneOf, onLanes: setLanes };
  return (
    <figure className="diagram" role="group" aria-label={title || label || "A diagram"}>
      <PanZoom html={html} size={size} label={title || label} frame={frame} onExpand={() => setBig(true)} />
      {big && <BigDiagram html={html} size={size} label={title || label} frame={frame} onClose={() => setBig(false)} />}
    </figure>
  );
}

/** The window around a diagram: what kind it is, its caption, the lanes it uses. */
interface Frame {
  kind: string;
  title: string | null;
  lanes: Lane[];
  laneOf?: (text: string) => Lane | null;
  onLanes: (lanes: Lane[]) => void;
}

interface View {
  k: number;
  x: number;
  y: number;
}

const MIN_K = 0.1;
const MAX_K = 6;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/** The view that shows all of it in a box this size. */
function fitted(size: { w: number; h: number }, box: { w: number; h: number }, upTo = 1.25): View {
  const k = clampK(Math.min(box.w / size.w, box.h / size.h, upTo));
  return { k, x: (box.w - size.w * k) / 2, y: (box.h - size.h * k) / 2 };
}

/** The view zoomed by `by` about a point in the box (it stays under the pointer). */
function zoomAt(v: View, by: number, px: number, py: number): View {
  const k = clampK(v.k * by);
  const f = k / v.k;
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
}

/** Inline height: the fitted-to-width drawing, between a readable minimum and most of the panel. */
function inlineHeight(size: { w: number; h: number }, width: number): number {
  const atWidth = (size.h * Math.min(width / size.w, 1.25)) | 0;
  return Math.max(160, Math.min(atWidth, Math.round(window.innerHeight * 0.6)));
}

function PanZoom({ html, size, label, frame, onExpand, full = false }: { html: string; size: { w: number; h: number }; label?: string; frame: Frame; onExpand?: () => void; full?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLDivElement>(null);
  // The links flow only while the diagram is on screen: nothing animates out of sight.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((seen) => setOnScreen(seen.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Dressed in the page, where text can be measured (cards, flowing links, pills, groups).
  const { laneOf, onLanes } = frame;
  // In a window not open yet nothing can be measured: it waits for the first frame where it shows.
  useLayoutEffect(() => {
    let frame = 0;
    let tries = 0;
    const dress = () => {
      const svg = ink.current?.querySelector("svg");
      if (!svg) return;
      if (!svg.getBoundingClientRect().width && tries++ < 120) {
        frame = requestAnimationFrame(dress);
        return;
      }
      onLanes(styleSvg(svg, laneOf));
    };
    dress();
    return () => cancelAnimationFrame(frame);
  }, [html, laneOf, onLanes]);
  const [view, setView] = useState<View | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const moved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; v: View; cx: number; cy: number } | null>(null);

  const boxSize = useCallback(() => {
    const r = box.current?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  }, []);
  const fit = useCallback(() => {
    const b = boxSize();
    if (b.w && b.h) setView(fitted(size, b, full ? 2 : 1.25));
  }, [boxSize, size, full]);

  // Inline, the box takes the drawing's height at the board's width; then (and on resize, until the
  // user moves it) the drawing is fitted in it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      if (!full) setHeight(inlineHeight(size, el.getBoundingClientRect().width));
      if (!moved.current) requestAnimationFrame(fit);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size, full, fit]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomBy = (by: number, at?: { x: number; y: number }) => {
    const b = boxSize();
    moved.current = true;
    setView((v) => (v ? zoomAt(v, by, at?.x ?? b.w / 2, at?.y ?? b.h / 2) : v));
  };

  // Full-window, the wheel zooms; on the board it scrolls the board unless Ctrl is held (a trackpad
  // pinch arrives as Ctrl+wheel). Not passive, so the page doesn't scroll as well.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!full && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      moved.current = true;
      setView((v) => (v ? zoomAt(v, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top) : v));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [full]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2 && view) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, v: view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    pointers.current.set(e.pointerId, now);
    moved.current = true;
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      setView(zoomAt(p.v, Math.hypot(a.x - b.x, a.y - b.y) / p.d, p.cx, p.cy));
      return;
    }
    setView((v) => (v ? { ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y } : v));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 40;
    const pan = (dx: number, dy: number) => {
      moved.current = true;
      setView((v) => (v ? { ...v, x: v.x + dx, y: v.y + dy } : v));
    };
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(0.8);
    else if (e.key === "0") {
      moved.current = false;
      fit();
    } else if (e.key === "ArrowLeft") pan(step, 0);
    else if (e.key === "ArrowRight") pan(-step, 0);
    else if (e.key === "ArrowUp") pan(0, step);
    else if (e.key === "ArrowDown") pan(0, -step);
    else return;
    e.preventDefault();
  };

  const pct = view ? Math.round(view.k * 100) : 100;
  return (
    <div className={`dg${full ? " dg-full" : ""}${onScreen ? " dg-live" : ""}`}>
      <div className="dg-head">
        <span className="dg-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="dg-kind">WalkMyCode · {frame.kind}</span>
        <div className="dg-tools" role="toolbar" aria-label="Diagram view">
          <button type="button" className="hdr-act" onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out (−)">
            −
          </button>
          <span className="dg-pct" aria-live="polite">
            {pct}%
          </span>
          <button type="button" className="hdr-act" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)">
            +
          </button>
          <button
            type="button"
            className="hdr-act"
            onClick={() => {
              moved.current = false;
              fit();
            }}
            aria-label="Fit the diagram"
            title="Fit (0)"
          >
            ⤡
          </button>
          {onExpand && (
            <button type="button" className="hdr-act" onClick={onExpand} aria-label="Expand the diagram" title="Expand">
              ⤢
            </button>
          )}
        </div>
      </div>
      {frame.title && <p className="dg-caption">{frame.title}</p>}
      <div
        ref={box}
        className="dg-view"
        style={full ? undefined : { height: height ?? undefined }}
        tabIndex={0}
        role="img"
        aria-label={`${label || "A diagram"}. Drag to move it, Ctrl+scroll or + and − to zoom, 0 to fit.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => zoomBy(1.6, local(e))}
        onKeyDown={onKeyDown}
      >
        <div ref={ink} className="dg-ink" style={view ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` } : { visibility: "hidden" }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div className="dg-foot">
        <span className="dg-legend">
          {frame.lanes.map((l) => (
            <span key={l}>
              <i style={{ background: LANES[l].color }} />
              {LANES[l].label}
            </span>
          ))}
        </span>
        <span className="dg-tip">{full ? "Drag to move · scroll to zoom · Esc to close" : "Drag · Ctrl+scroll to zoom · ⤢ to expand"}</span>
      </div>
    </div>
  );
}

/** The diagram nearly full-window, over everything; Esc or ✕ closes it. */
function BigDiagram({ html, size, label, frame, onClose }: { html: string; size: { w: number; h: number }; label?: string; frame: Frame; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // The view takes the keyboard at once (+, −, 0 and the arrows).
    d.querySelector<HTMLElement>(".dg-view")?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dg-dialog"
      aria-label={label || "A diagram"}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <PanZoom html={html} size={size} label={label} frame={frame} full />
      <button type="button" className="ctl compact dg-close" onClick={onClose} aria-label="Close the diagram">
        ✕ Close
      </button>
    </dialog>
  );
}
