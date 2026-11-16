"use client";
/**
 * Every kind of scene the professor can draw, one example each across subjects (src/lib/scene/examples.ts),
 * played in the scene player: /learn/scenes. What a student will see when they ask for a timeline, a flow, a
 * stack, a comparison, any diagram, or a sequence diagram.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { cleanKindScene } from "@/lib/scene/kinds";
import { SCENE_EXAMPLES } from "@/lib/scene/examples";

const ScenePlayer = dynamic(() => import("@/components/scene/player/ScenePlayer"), { ssr: false, loading: () => <p className="note">Setting the scene…</p> });

const NAMES: Record<keyof typeof SCENE_EXAMPLES, string> = {
  lifetimes: "Timeline · Rust lifetimes", blood: "Flow · blood and oxygen", callstack: "Containers · the call stack", interest: "Compare · compound interest",
  law: "Flowchart · a bill becomes law", order: "State machine · an online order", zoo: "UML class · inheritance", school: "ER diagram · a school database",
  photosynthesis: "Mind map · photosynthesis", https: "Sequence diagram · HTTPS",
};

export default function ScenesGallery() {
  const keys = Object.keys(SCENE_EXAMPLES) as (keyof typeof SCENE_EXAMPLES)[];
  const [pick, setPick] = useState<keyof typeof SCENE_EXAMPLES>("https");
  const scene = useMemo(() => cleanKindScene(SCENE_EXAMPLES[pick].raw, SCENE_EXAMPLES[pick].language), [pick]);
  return (
    <div className="scenes-gallery">
      <div className="sg-picks" role="group" aria-label="Examples">
        {keys.map((k) => (
          <button key={k} type="button" className="ctl compact" aria-pressed={k === pick} onClick={() => setPick(k)}>
            {NAMES[k]}
          </button>
        ))}
      </div>
      {scene ? <ScenePlayer key={pick} scene={scene} where="An example" keys="window" /> : <p className="note">That example does not clean.</p>}
    </div>
  );
}
