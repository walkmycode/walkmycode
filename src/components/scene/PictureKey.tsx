"use client";
/**
 * What stands for what in a diagram, drawn: under a class, state, flow or ER
 * diagram that backs an analogy, each of the analogy's words gets its drawing
 * beside the real name it stands for (src/lib/scene/key.ts reads the pairs).
 * A word with no drawing is left out; with none at all, nothing is shown.
 */
import { memo, useMemo } from "react";
import { drawingOf, findDrawing, LOOKS } from "@/lib/drawings";
import type { KeyPair } from "@/lib/scene/key";
import Drawing from "./Drawing";
import "./scene.css";

function PictureKey({ pairs }: { pairs: KeyPair[] }) {
  const drawn = useMemo(() => {
    let people = 0;
    return pairs.flatMap((p) => {
      const name = findDrawing(undefined, p.picture);
      return name ? [{ ...p, name, look: drawingOf(name)?.person ? LOOKS[people++ % LOOKS.length] : undefined }] : [];
    });
  }, [pairs]);
  if (!drawn.length) return null;
  return (
    <ul className="wkey" aria-label="What stands for what">
      {drawn.map((p) => (
        <li key={p.picture}>
          <Drawing name={p.name} look={p.look} />
          <span><b>{p.picture}</b> = <code>{p.real}</code></span>
        </li>
      ))}
    </ul>
  );
}

export default memo(PictureKey);
