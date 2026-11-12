"use client";
// The cost pill in the top bar (docs/MOTION.md §4.9): "$0.123 · 4 calls". The
// number rolls from the old total to the new one on the glide spring, written
// straight into the DOM (no re-render per frame), and the pill bumps once per
// change. With motion off the number jumps and only the colour flashes. A
// screen reader hears the final value, never the roll.
import { useEffect, useRef, useState } from "react";
import { animate } from "motion";
import { COST_TITLE, formatCost, useCost } from "@/lib/cost";
import { motionOff, springs } from "@/lib/motion";

const money = (usd: number, approx: boolean) => `${approx ? "≈" : ""}$${usd.toFixed(3)}`;

export default function CostMeter() {
  const cost = useCost();
  const pill = useRef<HTMLSpanElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  // What the number shows now; React writes it once and the roll takes it from there.
  const shown = useRef(cost.usd);
  const calls = useRef(cost.calls);
  const [first] = useState(() => money(cost.usd, cost.approx));
  const [, ...rest] = formatCost(cost).split(" · ");

  useEffect(() => {
    const el = num.current;
    const p = pill.current;
    if (!el || !p) return;
    const from = shown.current;
    const to = cost.usd;
    const approx = cost.approx;
    if (from === to && calls.current === cost.calls) return; // nothing new (first paint)
    calls.current = cost.calls;
    let roll: { stop(): void } | undefined;
    if (from !== to) {
      if (motionOff()) {
        shown.current = to;
        el.textContent = money(to, approx);
      } else {
        roll = animate(from, to, {
          ...springs.glide,
          onUpdate: (v) => {
            shown.current = v;
            el.textContent = money(v, approx);
          },
          onComplete: () => {
            shown.current = to;
            el.textContent = money(to, approx);
          },
        });
      }
    }
    // One bump per change, restarted if the last one is still going.
    p.classList.remove("bump");
    void p.offsetWidth;
    p.classList.add("bump");
    const t = setTimeout(() => p.classList.remove("bump"), 320);
    return () => {
      roll?.stop();
      clearTimeout(t);
    };
  }, [cost.usd, cost.calls, cost.approx]);

  return (
    <span ref={pill} className="cost" title={`${COST_TITLE} ${formatCost(cost)}`}>
      <span ref={num} aria-hidden>
        {first}
      </span>
      {rest.length > 0 && (
        <span className="cost-calls" aria-hidden>
          {" "}· {rest.join(" · ")}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {formatCost(cost)}
      </span>
    </span>
  );
}
