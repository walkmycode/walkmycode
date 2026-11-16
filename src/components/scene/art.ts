/**
 * Which drawing each part of a scene gets (src/lib/drawings). The professor
 * may name one; otherwise the everyday label finds it ("the postman" is the
 * van); for something the set has no drawing of, the professor may have made
 * one (`draw`); and what is left gets the plainest honest default: a holder in
 * the picture is a person, a variable is a drawer, a value is a row of memory.
 * A real-side name with no drawing is shown as its name alone.
 */
import { drawingOf, findDrawing, isTint, LOOKS, TINTS, type Look } from "@/lib/drawings";
import type { Scene, SceneActor, Shape } from "@/lib/scene/model";

export type Art = { name: string | null; tint?: string; look?: Look; shapes?: Shape[] };
export type SceneArt = {
  actor: Record<string, { a: Art; r: Art }>;
  thing: Record<string, { a: Art; r: Art }>;
  watcher: { a: Art; r: Art };
  bin: { a: Art; r: Art };
  words: Art[];
};

const known = (name: string) => (drawingOf(name) ? name : null);

export function sceneArt(scene: Scene): SceneArt {
  const code = !scene.plain;
  let people = 0;
  const tintOf = (x: SceneActor) => (isTint(x.tint) ? TINTS[x.tint] : undefined);
  const pictured = (x: SceneActor, fallback: string | null): Art => {
    const tint = tintOf(x);
    // A name the set has wins; then a drawing made for this very thing; then whatever its label finds.
    if (x.draw && !drawingOf(x.ia)) return { name: null, shapes: x.draw, tint };
    const name = findDrawing(x.ia, x.a) ?? fallback;
    // Each person in a scene looks different from the last, so Emily is not Jack.
    return drawingOf(name)?.person ? { name, look: { ...LOOKS[people++ % LOOKS.length], ...(tint ? { tint } : {}) } } : { name, tint };
  };
  const real = (x: SceneActor, fallback: string | null): Art => ({ name: findDrawing(x.ir, x.r) ?? fallback });
  const actor: SceneArt["actor"] = {};
  for (const x of scene.actors) actor[x.id] = { a: pictured(x, known("person") ?? known("child")), r: real(x, code ? known("drawer") : null) };
  const thing: SceneArt["thing"] = {};
  for (const x of scene.things) thing[x.id] = { a: pictured(x, null), r: real(x, code ? known("memory") : null) };
  const w = scene.watcher;
  const b = scene.bin;
  return {
    actor,
    thing,
    watcher: { a: w?.draw && !drawingOf(w.ia) ? { name: null, shapes: w.draw } : { name: findDrawing(w?.ia, w?.a) ?? known("teacher") }, r: { name: findDrawing(w?.ir, w?.r) ?? known("checker") } },
    bin: { a: b?.draw && !drawingOf(b.ia) ? { name: null, shapes: b.draw } : { name: findDrawing(b?.ia, b?.a) ?? known("box") }, r: { name: findDrawing(b?.ir, b?.r) ?? known("gone") } },
    words: scene.map.map((m) => {
      // A word that names one of the scene's own holders or things is drawn exactly as it is on the stage.
      const own = [...scene.actors, ...scene.things].find((x) => x.a.toLowerCase() === m.a.toLowerCase());
      if (own) return (actor[own.id] ?? thing[own.id]).a;
      return m.draw && !drawingOf(m.icon) ? { name: null, shapes: m.draw } : { name: findDrawing(m.icon, m.a) };
    }),
  };
}
