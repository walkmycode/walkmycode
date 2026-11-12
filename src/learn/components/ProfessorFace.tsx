"use client";
/**
 * The professor: a softly shaded bust in a disc,
 * with round glasses, a jacket and bow tie, and a white headset whose
 * microphone is chalk yellow. An original character in the manner of the
 * reference video's headset figure.
 *
 * It is drawn sixty times a second, straight onto the SVG (no React state):
 * - speaking: the mouth takes its shape from the voice that is playing
 *   (face.ts), the head nods a little, the disc is lit and ringed;
 * - idle: uneven blinks, small eye movements, a slow breath;
 * - thinking: eyes up and aside, one brow raised, mouth pressed small;
 * - listening: head tilted, brows up, the ring pulsing;
 * - pleased: a smile and narrowed eyes.
 * With motion off (--m: 0) nothing moves: each state holds one clear pose.
 * Colours are the theme's (learn.css). Switched off in Settings → Voice.
 */
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { easeMouth, faceOn, faceSize, mix, mouthFor, soundNow, subscribeFace, VISEMES, type FaceSize, type FaceState, type Mouth } from "@/learn/lib/face";

const LABEL: Record<FaceState, string> = {
  idle: "The professor",
  speaking: "The professor is speaking",
  thinking: "The professor is thinking",
  listening: "The professor is listening",
  pleased: "The professor is pleased",
};

/** Whether the face is shown (Settings → Voice), kept in step when the setting changes. */
export function useFaceOn(): boolean {
  return useSyncExternalStore(subscribeFace, faceOn, () => true);
}

/** How large the professor is drawn (Settings → Voice), kept in step when the setting changes. */
export function useFaceSize(): FaceSize {
  return useSyncExternalStore(subscribeFace, faceSize, () => "medium" as FaceSize);
}

const moves = () => {
  const m = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m"));
  return !Number.isFinite(m) || m > 0;
};

type Pose = { mouth: Mouth; blink: number; gaze: { x: number; y: number }; brow: [number, number]; tilt: number; nod: number; breath: number; lit: number; pulse: number; happy: number };

/** What a state looks like before anything moves. */
function stillPose(state: FaceState): Pose {
  const base: Pose = { mouth: VISEMES.rest, blink: 0, gaze: { x: 0, y: 0 }, brow: [0, 0], tilt: 0, nod: 0, breath: 0, lit: 0.8, pulse: 0, happy: 0 };
  if (state === "speaking") return { ...base, mouth: { ...VISEMES.ah, o: 8 }, brow: [0.25, 0.25], lit: 1 };
  if (state === "thinking") return { ...base, mouth: VISEMES.mm, brow: [1, 0.2], gaze: { x: -4, y: -4 }, tilt: -3, lit: 0.9 };
  if (state === "listening") return { ...base, brow: [0.8, 0.8], tilt: 5, lit: 1, pulse: 0.5 };
  if (state === "pleased") return { ...base, mouth: VISEMES.smile, brow: [0.5, 0.5], lit: 1, happy: 1 };
  return base;
}

export default function ProfessorFace({ state, size = "medium" }: { state: FaceState; size?: FaceSize }) {
  const clip = useId();
  const root = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    // The parts that move, found once by name.
    const r: Record<string, Element> = {};
    root.current?.querySelectorAll("[data-part]").forEach((el) => (r[el.getAttribute("data-part")!] = el));
    const attr = (name: string, key: string, value: string | number) => r[name]?.setAttribute(key, String(value));
    // Filled (an open mouth, an eye) or a drawn line (a closed mouth, a smiling eye): a style, so it wins over the stylesheet.
    const filled = (name: string, on: boolean) => ((r[name] as SVGElement | undefined)?.style.setProperty("fill", on ? "var(--face-ink)" : "none"));
    const draw = (p: Pose) => {
      const cy = 122;
      const hw = p.mouth.w / 2;
      const lift = p.mouth.s * 4.5;
      const o = p.mouth.o;
      if (o < 0.8) {
        attr("mouth", "d", `M${110 - hw} ${cy - lift} Q110 ${cy + lift * 1.7} ${110 + hw} ${cy - lift}`);
        filled("mouth", false);
      } else {
        const k = mix(0.55, 1, p.mouth.r);
        attr("mouth", "d", `M${110 - hw} ${cy} C${110 - hw * k} ${cy - o * 0.55} ${110 + hw * k} ${cy - o * 0.55} ${110 + hw} ${cy} C${110 + hw * k} ${cy + o * 0.9} ${110 - hw * k} ${cy + o * 0.9} ${110 - hw} ${cy} Z`);
        filled("mouth", true);
      }
      attr("tongue", "cy", cy + o * 0.5);
      attr("tongue", "opacity", o > 8 ? Math.min(1, (o - 8) / 4) : 0);
      [95, 125].forEach((x, i) => {
        const open = Math.max(0.08, (1 - p.blink) * (1 - p.happy * 0.85));
        const gx = x + p.gaze.x;
        const gy = 93 + p.gaze.y;
        attr(`eye${i}`, "d", p.happy > 0.5 ? `M${gx - 5} ${gy + 1} Q${gx} ${gy - 5} ${gx + 5} ${gy + 1}` : `M${gx} ${gy - 5.5 * open} a3.6 ${5.5 * open} 0 1 0 .01 0 Z`);
        filled(`eye${i}`, p.happy <= 0.5);
        const b = 74 - p.brow[i] * 5;
        attr(`brow${i}`, "d", `M${x - 9} ${b + (i ? 1 : -1) * p.brow[i] * 1.5 + 2} Q${x} ${b - 2} ${x + 9} ${b + 2}`);
      });
      attr("head", "transform", `translate(0 ${p.nod}) rotate(${p.tilt} 110 150)`);
      attr("body", "transform", `translate(0 ${p.breath})`);
      attr("all", "opacity", mix(0.62, 1, p.lit));
      attr("ring", "opacity", p.lit > 0.95 ? mix(0.9, 0.35, p.pulse) : 0);
      attr("ring", "r", 106 + p.pulse * 5);
    };

    const target = stillPose(state);
    if (!moves()) return draw(target);

    let frame = 0;
    let mouth: Mouth = { ...VISEMES.rest };
    let start = 0;
    let nextBlink = 1200 + Math.random() * 2000;
    let blinkAt = -1000;
    let nextGaze = 600;
    let gaze = { x: 0, y: 0 };
    let gazeTo = { x: 0, y: 0 };
    let tilt = 0;
    let brow: [number, number] = [0, 0];
    const tick = (now: number) => {
      start ||= now;
      const t = now - start;
      let nod = 0;
      let pulse = 0;
      if (state === "speaking") {
        const sound = soundNow(now);
        mouth = easeMouth(mouth, mouthFor(sound));
        nod = Math.sin(t / 130) * 0.6 + sound.level * 1.2;
      } else {
        mouth = easeMouth(mouth, target.mouth);
        if (state === "listening") pulse = (Math.sin(t / 260) + 1) / 2;
      }
      if (t > nextBlink) {
        blinkAt = t;
        nextBlink = t + 1800 + Math.random() * 3600;
      }
      // Thinking looks up and aside; otherwise the eyes drift a little now and then.
      if (state === "thinking") gazeTo = target.gaze;
      else if (t > nextGaze) {
        gazeTo = { x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 2.5 };
        nextGaze = t + 700 + Math.random() * 1900;
      }
      gaze = { x: mix(gaze.x, gazeTo.x, 0.18), y: mix(gaze.y, gazeTo.y, 0.18) };
      tilt = mix(tilt, target.tilt, 0.12);
      brow = [mix(brow[0], target.brow[0], 0.15), mix(brow[1], target.brow[1], 0.15)];
      const since = t - blinkAt;
      draw({ ...target, mouth, blink: since >= 0 && since < 150 ? Math.sin((since / 150) * Math.PI) : 0, gaze, brow, tilt, nod, breath: Math.sin(t / 1300), pulse });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  // Always the whole bust in its disc: the size is how large it is drawn (Settings → Voice).
  const small: boolean = false;
  return (
    // The small one is the head alone; the portrait is the whole bust in its disc.
    <svg ref={root} className={`prof-face portrait ${size} ${state}`} viewBox={small ? "40 32 140 140" : "0 0 220 220"} role="img" aria-label={LABEL[state]}>
      <defs>
        <clipPath id={clip}><circle cx="110" cy="110" r="100" /></clipPath>
      </defs>
      {!small && <circle data-part="ring" className="ring" cx="110" cy="110" r="106" opacity="0" />}
      <g data-part="all">
        {!small && <circle className="disc" cx="110" cy="110" r="100" />}
        <g clipPath={small ? undefined : `url(#${clip})`}>
          <g transform="translate(110 120) scale(1.3) translate(-110 -110)">
            <g data-part="body">
              <path className="jacket" d="M38 220 C38 170 70 152 110 152 C150 152 182 170 182 220 Z" />
              <path className="gear" d="M92 154 L110 178 L128 154 L122 150 L98 150 Z" />
              <path className="lapel" d="M92 154 L104 190 L110 178 Z M128 154 L116 190 L110 178 Z" />
              <path className="accent" d="M110 164 L99 158 L99 171 Z M110 164 L121 158 L121 171 Z" />
            </g>
            <g data-part="head">
              <rect className="shade" x="101" y="132" width="18" height="24" />
              <ellipse className="skin" cx="110" cy="98" rx="39" ry="42" />
              <path className="shade" opacity=".7" d="M110 140 C128 140 143 126 148 106 C142 132 128 146 110 146 C92 146 78 132 72 106 C77 126 92 140 110 140 Z" />
              <path className="band" d="M68 96 C68 44 152 44 152 96" />
              <rect className="gear" x="58" y="84" width="17" height="32" rx="7" />
              <rect className="gear" x="145" y="84" width="17" height="32" rx="7" />
              <path className="boom" d="M66 114 C66 134 78 137 90 134" />
              <rect className="accent" x="87" y="128" width="13" height="9" rx="4.5" />
              <path data-part="brow0" className="ink open" />
              <path data-part="brow1" className="ink open" />
              <path data-part="eye0" className="ink" />
              <path data-part="eye1" className="ink" />
              <path className="glasses" d="M82 93 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0 M112 93 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0 M108 91 q2 -3 4 0" />
              <path data-part="mouth" className="ink mouth" />
              <ellipse data-part="tongue" className="tongue" cx="110" rx="5" ry="2.6" opacity="0" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
