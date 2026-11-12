// Shared by the perf scripts (docs/PERFORMANCE.md).

/** A point on the map with nothing on it, nearest the middle: a drag that starts
 * on an arrow or a card does not pan, so a pan measured from there measures nothing. */
export function emptySpot(page) {
  return page.evaluate(() => {
    const pane = document.querySelector(".dock-panel.map .react-flow__pane") ?? document.querySelector(".react-flow__pane");
    const r = pane.getBoundingClientRect();
    let best = null;
    for (let fx = 0.2; fx <= 0.8; fx += 0.04) {
      for (let fy = 0.2; fy <= 0.8; fy += 0.04) {
        const x = r.x + r.width * fx;
        const y = r.y + r.height * fy;
        if (document.elementFromPoint(x, y) !== pane) continue;
        const d = Math.hypot(fx - 0.5, fy - 0.5);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (!best) throw new Error("no empty spot on the map to drag from");
    return best;
  });
}
