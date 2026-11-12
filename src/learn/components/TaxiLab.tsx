"use client";
/** Lesson 1's experiment: fit a line to six taxi trips by hand, then watch
 *  gradient descent do the same thing. */
import { useCallback, useEffect, useRef, useState } from "react";

const X = [1, 2, 3, 5, 7, 9];
const Y = [8, 11, 14, 19, 25, 31];
const loss = (a: number, b: number) => X.reduce((s, x, i) => s + (a * x + b - Y[i]) ** 2, 0) / X.length;

export default function TaxiLab() {
  const [a, setA] = useState(1);
  const [b, setB] = useState(2);
  const canvas = useRef<HTMLCanvasElement>(null);
  const anim = useRef<number | null>(null);

  const draw = useCallback(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const W = cv.width, H = cv.height, P = 46, xmax = 10, ymax = 40;
    const sx = (x: number) => P + (x / xmax) * (W - P - 16);
    const sy = (y: number) => H - P - (y / ymax) * (H - P - 16);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(241,239,230,.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(P, 12);
    ctx.lineTo(P, H - P);
    ctx.lineTo(W - 10, H - P);
    ctx.stroke();
    ctx.fillStyle = "#bdc9c2";
    // Canvas fonts cannot read CSS variables: resolve the chalk face first.
    ctx.font = `18px ${getComputedStyle(cv).getPropertyValue("--font-hand").trim() || "cursive"}`;
    for (let t = 0; t <= xmax; t += 2) ctx.fillText(String(t), sx(t) - 5, H - P + 24);
    for (let t = 0; t <= ymax; t += 10) ctx.fillText(String(t), P - 30, sy(t) + 6);
    ctx.fillText("distance (km)", W - 150, H - 8);
    ctx.save();
    ctx.translate(14, 150);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("fare (£)", 0, 0);
    ctx.restore();
    X.forEach((x, i) => {
      const g = a * x + b;
      ctx.strokeStyle = "rgba(242,167,160,.8)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(x), sy(Y[i]));
      ctx.lineTo(sx(x), sy(Math.max(-5, Math.min(ymax, g))));
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.strokeStyle = "#f3d77a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(b));
    ctx.lineTo(sx(xmax), sy(a * xmax + b));
    ctx.stroke();
    X.forEach((x, i) => {
      ctx.fillStyle = "#9fd3f0";
      ctx.beginPath();
      ctx.arc(sx(x), sy(Y[i]), 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [a, b]);

  useEffect(() => {
    draw();
    document.fonts?.ready.then(draw);
  }, [draw]);
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);

  const learn = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ca = a, cb = b, step = 0;
    const tick = () => {
      for (let k = 0; k < (reduced ? 400 : 4); k++) {
        let ga = 0, gb = 0;
        X.forEach((x, i) => {
          const e = ca * x + cb - Y[i];
          ga += (2 * e * x) / X.length;
          gb += (2 * e) / X.length;
        });
        ca -= 0.01 * ga;
        cb -= 0.01 * gb;
        step++;
      }
      setA(ca);
      setB(cb);
      if (step < 1600) anim.current = requestAnimationFrame(tick);
    };
    tick();
  };

  return (
    <div className="lab">
      <canvas ref={canvas} width={560} height={420} aria-label="Taxi trips and the model's line" />
      <div className="knobs">
        <label htmlFor="kA">
          knob <b>a</b> (£ per km): {a.toFixed(2)}
          <input id="kA" type="range" min={0} max={6} step={0.05} value={a} onChange={(e) => setA(+e.target.value)} />
        </label>
        <label htmlFor="kB">
          knob <b>b</b> (starting charge £): {b.toFixed(1)}
          <input id="kB" type="range" min={-5} max={15} step={0.1} value={b} onChange={(e) => setB(+e.target.value)} />
        </label>
        <div>
          loss: <span className="loss">{loss(a, b).toFixed(2)}</span>
        </div>
        <div className="row">
          <button className="chalk-btn" type="button" onClick={learn}>Let the machine learn</button>
          <button className="chalk-btn ghost" type="button" onClick={() => { if (anim.current) cancelAnimationFrame(anim.current); setA(1); setB(2); }}>
            Reset
          </button>
        </div>
        <div>
          A 6 km trip → your model says <span className="hl">£{(a * 6 + b).toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}
