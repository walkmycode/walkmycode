"use client";
// The setup sheet's motion vocabulary (docs/MOTION.md, in the opencode-style
// "kinetic terminal" register): words that decode into place, digits that
// roll, a bar of segments that light one after another (or sweep while the
// installer gives no figure), a stamp that lands with one bounce, and a clock.
// Everything follows --m and the motion switch: with motion off, words are
// simply there and nothing rolls, sweeps or lands.
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { motionOff, springs } from "@/lib/motion";

const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789/-_.:·";

/**
 * A word that decodes: when `text` changes, its letters arrive left to right
 * over `ms`, the ones not there yet showing random glyphs (spaces stay spaces).
 */
export function useDecode(text: string, ms = 320): string {
  const [shown, setShown] = useState(text);
  const from = useRef(text);
  useEffect(() => {
    if (motionOff() || from.current === text) {
      from.current = text;
      setShown(text);
      return;
    }
    from.current = text;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const fixed = Math.floor(k * text.length);
      let out = text.slice(0, fixed);
      for (let i = fixed; i < text.length; i++) out += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      setShown(out);
      if (k < 1) raf = requestAnimationFrame(tick);
      else setShown(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return shown;
}

/**
 * A value that only changes once it has held for `ms`: a label fed by output
 * that flips back and forth (npm's "fetching" / "running scripts", line by
 * line) shows one word at a time instead of decoding on every line.
 */
export function useSettled<T>(value: T, ms = 900): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value === shown) return;
    const t = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

export function Decode({ text, ms, className }: { text: string; ms?: number; className?: string }) {
  const shown = useDecode(text, ms);
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

/** A number whose digits roll to their new value (each digit its own column). */
export function Odometer({ value, pad = 1 }: { value: number; pad?: number }) {
  const digits = String(Math.max(0, Math.round(value))).padStart(pad, "0").split("");
  return (
    <span className="odo" aria-label={String(value)}>
      {digits.map((d, i) => (
        <span key={digits.length - i} className="odo-col" aria-hidden>
          <span className="odo-strip" style={{ transform: `translateY(${-Number(d) * 10}%)` }}>
            {"0123456789".split("").map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * The bar: `count` cells that light in order as `fraction` grows (each newly lit
 * cell a beat after the one before), a sweep running over them while the
 * fraction is unknown, and the cells from the failure on turned red.
 */
export function Segments({ fraction, failed = false, count = 32 }: { fraction: number | null; failed?: boolean; count?: number }) {
  const lit = fraction === null ? 0 : Math.round(Math.max(0, Math.min(1, fraction)) * count);
  return (
    <div className={`segs${fraction === null && !failed ? " sweeping" : ""}${failed ? " failed" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i < lit ? "on" : failed && i === lit ? "hit" : undefined} style={{ transitionDelay: `calc(${i * 9}ms * var(--m, 1))` }} />
      ))}
    </div>
  );
}

/** A stamp that lands: large and tilted, then down to size with one bounce. */
export function Stamp({ kind, text }: { kind: "ok" | "fail"; text: string }) {
  const still = motionOff();
  return (
    <motion.div
      className={`stamp ${kind}`}
      role="status"
      initial={still ? false : { scale: 1.9, rotate: -10, opacity: 0 }}
      animate={{ scale: 1, rotate: -3, opacity: 1 }}
      exit={still ? undefined : { scale: 0.6, opacity: 0, transition: { duration: 0.18 } }}
      transition={springs.hop}
    >
      {text}
    </motion.div>
  );
}

const two = (n: number) => String(n).padStart(2, "0");
export const clock = (ms: number) => `${two(Math.floor(ms / 60000))}:${two(Math.floor(ms / 1000) % 60)}`;
export const seconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

/** mm:ss since `since`, ticking while there is no `until`. */
export function Elapsed({ since, until }: { since: number; until?: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return <span className="tnum">{clock((until ?? now) - since)}</span>;
}
