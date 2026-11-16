"use client";
/**
 * "Watch it happen" in a lesson (docs/LEARNING.md): a board's analogy as a
 * scene with the stage to itself. The scene is drawn by SceneBlock (shared
 * with the answers of the guide and the professor); this adds what the Learn
 * room needs round it: where it is from, the side panels, Close, the
 * professor's voice reading each step, and the arrow keys for the whole
 * window (here they step the scene, not the boards).
 */
import AnyScene from "@/components/scene/AnyScene";
import type { AnyScene as Scene } from "@/lib/scene/any";

type Props = {
  scene: Scene;
  /** Where it is from: "Move · board 4 of 18". */
  where: string;
  /** Whether the outline and the professor are shown beside it. */
  panels: boolean;
  onPanels: (shown: boolean) => void;
  onClose: () => void;
  /** Reads a step aloud, resolving when it has been heard (or read, when the voice is off). */
  speak: (text: string) => Promise<void>;
  stopVoice: () => void;
};

export default function AnalogyScene({ scene, where, panels, onPanels, onClose, speak, stopVoice }: Props) {
  return (
    <AnyScene
      scene={scene}
      where={where}
      keys="window"
      speak={speak}
      stopVoice={stopVoice}
      onClose={onClose}
      controls={
        <>
          <button className="ctl compact" type="button" aria-pressed={panels} onClick={() => onPanels(!panels)} title={panels ? "Give the analogy the full width" : "Show the outline and the professor beside it"}>
            Side panels
          </button>
          <button className="ctl compact" type="button" onClick={onClose} title="Back to the board (Esc)">Close</button>
        </>
      }
    />
  );
}
