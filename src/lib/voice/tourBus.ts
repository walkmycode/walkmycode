// Between the tour player and the lecturer: holding Talk during a tour pauses
// the narration, and "carry on" (the button, or the lecturer's continue_tour)
// picks it up again. The tour player registers itself while it is on screen.
// Tiny and dependency-free, so either side can load it without the other.

export interface TourControl {
  /** Pause the narration for a question. True when it was playing (so there is something to carry on). */
  pauseForQuestion(): boolean;
  /** Carry on reading where it paused. False when nothing was paused for a question. */
  carryOn(): boolean;
  /** Whether the narration is reading now. */
  playing(): boolean;
}

let control: TourControl | null = null;
const listeners = new Set<() => void>();

/** The tour player on screen hands over its controls (null when it goes). */
export function registerTour(c: TourControl | null): void {
  control = c;
  for (const l of listeners) l();
}

export function tourControl(): TourControl | null {
  return control;
}

export function onTourChange(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
