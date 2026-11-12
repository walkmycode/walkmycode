"use client";
// Settings → Motion & look: the motion switch (follow the system's reduced-motion
// setting, or force it on or off; src/lib/motion.ts sets --m on <html>), and the
// map's keyboard shortcuts, which used to sit at the end of the stacked Settings; and text & icon
// size and density (src/lib/look.ts), smallest and compact by default.
import { useState } from "react";
import { applyMotion, currentPref, type MotionPref } from "@/lib/motion";
import { applyLook, currentLook, DEFAULT_DENSITY, DEFAULT_TEXT, DENSITIES, TEXT_STEPS, THEMES, type Density, type TextStep, type Theme } from "@/lib/look";
import { SHORTCUTS } from "@/shell/keys";
import { Box, Cols } from "./parts";

const MOTION: { v: MotionPref; label: string }[] = [
  { v: "system", label: "Follow my system" },
  { v: "on", label: "On" },
  { v: "off", label: "Off" },
];

const DENSITY_LABEL: Record<Density, string> = { compact: "Compact", cozy: "Cozy", roomy: "Roomy" };
const THEME_LABEL: Record<Theme, string> = { dark: "Dark", warm: "Warm" };
const TEXT_LABEL: Record<TextStep, string> = { 1: "Smallest", 2: "Small", 3: "Medium", 4: "Large", 5: "Larger", 6: "Largest" };

export default function MotionPane() {
  const [motion, setMotion] = useState<MotionPref>(() => currentPref());
  const [look, setLook] = useState(() => currentLook());
  const change = (next: Partial<typeof look>) => {
    const l = { ...look, ...next };
    setLook(l);
    applyLook(l);
  };
  return (
    <Cols>
      <div>
        <Box label="Theme">
          <div className="sv-seg" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={look.theme === t} className={look.theme === t ? "on" : undefined} onClick={() => change({ theme: t })}>
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="sv-hint">Dark is neutral graphite, like an IDE. Warm is the wall, wood and green chalkboard WalkMyCode started with.</p>
        </Box>
        <Box label="Text & icon size">
          <div className="sv-size">
            <span className="sv-size-a sm" aria-hidden>
              A
            </span>
            <input
              type="range"
              min={TEXT_STEPS[0]}
              max={TEXT_STEPS[TEXT_STEPS.length - 1]}
              step={1}
              value={look.text}
              aria-label="Text and icon size"
              aria-valuetext={TEXT_LABEL[look.text]}
              onChange={(e) => change({ text: Number(e.currentTarget.value) as TextStep })}
            />
            <span className="sv-size-a lg" aria-hidden>
              A
            </span>
            <span className="sv-size-now">{TEXT_LABEL[look.text]}</span>
          </div>
          <p className="sv-hint">Text, icons and buttons everywhere, from smallest (the default: the most room for the map, code and guide) to largest. The map&apos;s own zoom is separate.</p>
        </Box>
        <Box label="Density">
          <div className="sv-seg" role="radiogroup" aria-label="Density">
            {DENSITIES.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={look.density === d} className={look.density === d ? "on" : undefined} onClick={() => change({ density: d })}>
                {DENSITY_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="sv-hint">The room around things: padding in buttons, rows and panels. Compact fits the most on screen.</p>
          {(look.text !== DEFAULT_TEXT || look.density !== DEFAULT_DENSITY) && (
            <button type="button" className="ctl compact sv-reset" onClick={() => change({ text: DEFAULT_TEXT, density: DEFAULT_DENSITY })}>
              Back to the default (smallest, compact)
            </button>
          )}
        </Box>
        <Box label="Motion">
          <div className="sv-seg" role="radiogroup" aria-label="Motion">
            {MOTION.map((m) => (
              <button
                key={m.v}
                type="button"
                role="radio"
                aria-checked={motion === m.v}
                className={motion === m.v ? "on" : undefined}
                onClick={() => {
                  setMotion(m.v);
                  applyMotion(m.v);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="sv-hint">Off stops every glide, rise and drawn line: things simply appear, and fades stay short. &ldquo;Follow my system&rdquo; uses your computer&apos;s reduced-motion setting.</p>
        </Box>
      </div>
      <div>
        <Box label="Keyboard, in the map">
          <dl className="sv-keys-dl">
            {SHORTCUTS.map((k) => (
              <div key={k.keys}>
                <dt>
                  <kbd>{k.keys}</kbd>
                </dt>
                <dd>{k.what}</dd>
              </div>
            ))}
          </dl>
        </Box>
      </div>
    </Cols>
  );
}
