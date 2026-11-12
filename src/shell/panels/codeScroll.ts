// Smooth scrolling to a highlighted line (docs/MOTION.md §4.4), without
// touching the shared editor. Editor.tsx jumps to the highlight with
// CodeMirror's scrollIntoView; CodeMirror applies that jump in its next
// animation frame. We note where the scroller was before (a layout effect runs
// before the editor's effect), let CodeMirror work out where it should be,
// then in the same frame, before anything is painted, put it back and glide
// there natively. Wheel or touch interrupts the glide, as native smooth
// scrolling always does.

/** Beyond this, gliding would blur a screenful of code: jump instead. */
export const MAX_GLIDE_PX = 3000;

/** How to move from one scroll position to another: jump, glide, or nothing. */
export function scrollPlan(from: number | null, to: number, reduced: boolean): "none" | "jump" | "glide" {
  if (from === null) return "jump"; // a freshly opened file: nothing to scroll from
  const d = Math.abs(to - from);
  if (d < 2) return "none";
  if (reduced || d > MAX_GLIDE_PX) return "jump";
  return "glide";
}

/** After CodeMirror's own jump: turn it into a glide when the plan says so, then call `done`.
 * Returns a cancel function. */
export function glideAfterJump(scroller: HTMLElement, from: number | null, reduced: boolean, done: () => void): () => void {
  const win = scroller.ownerDocument.defaultView ?? window;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    scroller.removeEventListener("scrollend", finish);
    clearTimeout(timer);
    done();
  };
  // Registered after CodeMirror's measure frame, so this runs once its jump has landed.
  const frame = win.requestAnimationFrame(() => {
    if (cancelled) return;
    const to = scroller.scrollTop;
    const plan = scrollPlan(from, to, reduced);
    if (plan !== "glide" || from === null) return finish();
    scroller.scrollTop = from;
    scroller.addEventListener("scrollend", finish, { once: true });
    // Browsers without scrollend: the glide is about 350 ms.
    timer = setTimeout(finish, 450);
    scroller.scrollTo({ top: to, behavior: "smooth" });
  });
  return () => {
    cancelled = true;
    win.cancelAnimationFrame(frame);
    clearTimeout(timer);
    scroller.removeEventListener("scrollend", finish);
  };
}
