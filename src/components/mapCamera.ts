// What the map's camera does when its box changes size (MapView). Pure, so the rules can
// be tested without a browser.
//
// The camera is "fitted" while the whole view is framed by a fit of our own: a new size
// fits it again. Once anyone places it (a drag, a wheel, a click on a card, a glide), a new
// size keeps the middle of what the user was looking at where it was, instead of throwing
// their place away; this is what made a first click on a restored map "zoom out and jump".
// A fit asked for while the box had no size (the dock still laying itself out, the frame
// not shown yet) is "pending", and made as soon as the box has one.
export interface CameraState {
  fitted: boolean;
  pending: boolean;
  /** The box's size when it was last seen with one. */
  w: number;
  h: number;
}

export type ResizeAction = { kind: "none" } | { kind: "fit" } | { kind: "shift"; dx: number; dy: number };

export const newCamera = (): CameraState => ({ fitted: true, pending: false, w: 0, h: 0 });

/** The box is now w × h. `flying`: a fly-through drives the camera (it frames the map itself). */
export function afterResize(c: CameraState, w: number, h: number, flying: boolean): ResizeAction {
  if (w <= 0 || h <= 0) return { kind: "none" };
  const before = { w: c.w, h: c.h };
  c.w = w;
  c.h = h;
  if (flying) return { kind: "none" };
  if (c.pending || c.fitted) return { kind: "fit" };
  if (!before.w || !before.h || (before.w === w && before.h === h)) return { kind: "none" };
  return { kind: "shift", dx: (w - before.w) / 2, dy: (h - before.h) / 2 };
}

/** A fit is asked for: made now when the box has a size, else kept for when it has one. */
export function askFit(c: CameraState, sized: boolean): boolean {
  if (!sized) {
    c.pending = true;
    return false;
  }
  c.pending = false;
  c.fitted = true;
  return true;
}

/** The user (or a glide to one card) has placed the camera. */
export function placed(c: CameraState): void {
  c.fitted = false;
}
