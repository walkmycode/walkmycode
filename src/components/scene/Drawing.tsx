"use client";
/**
 * One drawing from the set (src/lib/drawings), as an inline SVG. The shapes
 * are the app's own, written by hand: a scene only ever names a drawing, so
 * nothing a model wrote is put on the page as markup here.
 */
import { memo, type CSSProperties } from "react";
import { drawingOf, type Look } from "@/lib/drawings";
import type { Shape, ShapeColour } from "@/lib/scene/model";
import "@/lib/drawings/drawings.css";

type Props = {
  /** A name from the set; anything else draws nothing. */
  name: string | null | undefined;
  tint?: string;
  /** A person's look: hair style, shirt, skin and hair colour. */
  look?: Look;
  /** "sad" for a face, "stop" for a checker. */
  state?: "sad" | "stop" | false;
  /** A drawing made for this one thing (model.ts, Shape): used when the set has none by that name. */
  shapes?: Shape[];
};

/** A shape's colour, as the stylesheet's class for it. */
const FILL: Record<ShapeColour, string> = { t: "d-t", dark: "d-t2", light: "d-t3", white: "d-w", grey: "d-w2", ink: "d-ink", yellow: "d-y", pink: "d-pk", red: "d-rd", blue: "d-bl", green: "d-gr", purple: "d-pu", orange: "d-or", brown: "d-wood", sky: "d-sky", cream: "d-cream", skin: "d-sk" };

function shape(x: Shape, k: number) {
  if (x.s === "circle") return <circle key={k} className={FILL[x.c]} cx={x.x} cy={x.y} r={x.r} />;
  if (x.s === "rect") return <rect key={k} className={FILL[x.c]} x={x.x} y={x.y} width={x.w} height={x.h} rx={x.rx ?? 1.5} />;
  if (x.s === "ellipse") return <ellipse key={k} className={FILL[x.c]} cx={x.x} cy={x.y} rx={x.rx} ry={x.ry} />;
  if (x.s === "line") return <path key={k} className={`d-ln c-${x.c}`} d={`M${x.x1} ${x.y1}L${x.x2} ${x.y2}`} />;
  return <path key={k} className={FILL[x.c]} d={`M${x.p.map((v, n) => (n % 2 ? `${v}` : `${n ? "L" : ""}${v} `)).join("")}z`} />;
}

function Drawing({ name, tint, look, state, shapes }: Props) {
  const d = drawingOf(name);
  if (!d && shapes?.length) {
    return (
      <svg className="art" viewBox="0 0 64 64" aria-hidden="true" style={{ "--t": tint ?? "#8e929c" } as CSSProperties}>
        {shapes.map(shape)}
      </svg>
    );
  }
  if (!d) return null;
  const vars: Record<string, string> = { "--t": tint ?? look?.tint ?? d.tint };
  if (look) Object.assign(vars, { "--sk": look.skin, "--hr": look.hair });
  else if (d.hair) vars["--hr"] = d.hair;
  const style = vars as CSSProperties;
  return <svg className={`art${look?.v ? ` v-${look.v}` : ""}${state ? ` ${state}` : ""}`} viewBox="0 0 64 64" aria-hidden="true" style={style} dangerouslySetInnerHTML={{ __html: d.svg }} />;
}

export default memo(Drawing);
