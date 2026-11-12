"use client";
// The workspace's stack: "Laravel · PHP". From what WalkMyCode made it as, the
// setup check's stacks, or the map's frameworks (src/lib/projectStack.ts); empty
// when none of them knows. The top bar shows the first beside the name
// (ProjectChip); its card shows them all.
import { useSyncExternalStore } from "react";
import type { CodeMap } from "@/analyzer/types";
import { setupStore } from "@/ide/localrun/setup/store";
import { madeNote, stackOf } from "@/lib/projectStack";

export function useStack(map: CodeMap, name: string): string[] {
  const s = useSyncExternalStore(setupStore.subscribe, setupStore.get, setupStore.get);
  return stackOf(
    map,
    s.services.filter((x) => x.id !== "+new").map((x) => x.stack),
    madeNote(name),
  );
}

export default function StackChips({ words }: { words: string[] }) {
  if (!words.length) return null;
  return (
    <span className="stack-chips" title={`Built with ${words.join(", ")}`}>
      {words.map((w) => (
        <span key={w} className="stack-chip">
          {w}
        </span>
      ))}
    </span>
  );
}
