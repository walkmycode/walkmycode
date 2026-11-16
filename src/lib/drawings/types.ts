/**
 * A drawing for an analogy scene (docs/LEARNING.md, "Watch it happen"): a small
 * flat picture of an everyday thing, written by hand as plain SVG shapes on a
 * 64 × 64 square. No images, gradients, filters or text, so one is about 1 KB
 * and costs the page almost nothing to draw or to move.
 *
 * A drawing never holds anything a model wrote: the professor only picks one
 * by name. Colours come from the classes in src/components/scene/scene.css
 * (d-t is the drawing's own colour, --t, so one box can be a toy box or a
 * lunch box; d-sk and d-hr are a person's skin and hair).
 */
export type DrawingDef = {
  /** Other everyday words this drawing can stand for: how a label finds it. */
  also: string[];
  /** Its own colour when the scene gives none. */
  tint: string;
  /** A person's hair, when it is not the usual brown. */
  hair?: string;
  /** A person: drawn with a different look for each one in a scene, and with a glad and a sad face. */
  person?: boolean;
  /** The shapes inside the <svg viewBox="0 0 64 64">. */
  svg: string;
};

export type DrawingSet = Record<string, DrawingDef>;
