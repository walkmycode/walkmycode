"use client";
/**
 * A scene of any kind (src/lib/scene/any.ts): one of the kinds (a timeline, a flow, any diagram, a sequence…)
 * in the scene player, a hand-over in SceneBlock. Wherever a scene is shown: the Learn room's "Watch it
 * happen", and a ```scene block in the professor's or the guide's answers.
 */
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { isKindScene, type AnyScene as Any } from "@/lib/scene/any";

const ScenePlayer = dynamic(() => import("./player/ScenePlayer"), { ssr: false, loading: () => <p className="note">Setting the scene…</p> });
const SceneBlock = dynamic(() => import("./SceneBlock"), { ssr: false, loading: () => <p className="note">Setting the scene…</p> });

type Props = {
  scene: Any;
  where?: string;
  controls?: ReactNode;
  speak?: (text: string) => Promise<void>;
  stopVoice?: () => void;
  keys?: "window" | "focus";
  onClose?: () => void;
};

export default function AnyScene({ scene, ...rest }: Props) {
  return isKindScene(scene) ? <ScenePlayer scene={scene} {...rest} /> : <SceneBlock scene={scene} {...rest} />;
}
