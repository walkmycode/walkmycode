"use client";
// A map made before WalkMyCode could draw a language its folder holds (src/analyzer/migrate.ts drawnSince)
// says so on the map in plain words, with the one way to map the folder again (src/lib/remap.ts):
// "Map again" reads it from disk once more (its kept handle, or its path in the desktop app), "Choose the
// folder" picks it like "Add folder" does, "Folders" goes back to the folders it is made of. Over an
// empty map it is the card in the middle; over a map with cards, a banner along the top.
import { useState } from "react";
import type { PickedFolder } from "@/lib/localFolder";
import { RoomLink } from "@/lib/adapters/nav";
import { TARGET } from "@/lib/adapters/target";
import { mapAgain, mapAgainHow, mapAgainWords, type Build, type FolderRead } from "@/lib/remap";
import { getWorkspace, setWorkspace, type Workspace } from "@/lib/store";
import { toast } from "@/shell/Toast";
import AddFolder from "./AddFolder";

/** Mapped again: the new workspace replaces the old, and the room starts afresh on its map. */
async function remap(w: Workspace, folders: FolderRead[], onProgress: (share: number) => void): Promise<void> {
  // The analyzer's worker is only asked for now, as the home page does: most maps never need it here.
  const { buildInWorker } = await import("@/analyzer/buildInWorker");
  const build: Build = (req) => buildInWorker(req, (done, all) => onProgress(all ? done / all : 0));
  setWorkspace(await mapAgain(w, folders, build));
}

/** "Map again": every folder read again from disk, then mapped. */
function MapAgainButton({ label }: { label: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    const w = getWorkspace();
    if (!w || busy) return;
    setBusy("Reading…");
    try {
      const lf = await import("@/lib/localFolder");
      const folders: FolderRead[] = [];
      for (const r of w.repos) {
        const again = r.path ? await lf.readPath(r.path).catch(() => null) : r.handle ? await lf.rereadFolder(r.handle) : null;
        if (!again) {
          setBusy(null);
          return toast(`The browser did not let me read ${r.label} again. Open Folders and add it once more.`);
        }
        folders.push(again);
      }
      await remap(w, folders, (share) => setBusy(`Mapping ${Math.round(share * 100)}%`));
    } catch (e) {
      setBusy(null);
      toast(`That folder could not be mapped again: ${(e as Error).message}`);
    }
  };
  return (
    <button type="button" className="ctl compact primary" onClick={() => void run()} disabled={!!busy}>
      {busy ?? label}
    </button>
  );
}

/** The folder chosen again (the file input's way, or the picker's without a handle kept), then mapped. */
async function chosen(folder: PickedFolder): Promise<string | null> {
  const w = getWorkspace();
  if (!w) return "No map is open.";
  await remap(w, [folder], () => {});
  return null;
}

export default function MapAgain({ langs, empty }: { langs: { name: string; files: number }[]; empty: boolean }) {
  const w = getWorkspace();
  if (!w) return null;
  const how = mapAgainHow(w, TARGET);
  const words = mapAgainWords(langs, how, w.repos.length);
  const action =
    how === "refresh" ? (
      <MapAgainButton label={words.action!} />
    ) : how === "choose" ? (
      <AddFolder label={words.action} onFolder={chosen} />
    ) : how === "folders" ? (
      <RoomLink href="/" className="ctl compact primary" title="Back to the folders this map is made of">
        {words.action}
      </RoomLink>
    ) : null;
  if (empty)
    return (
      <div className="map-empty map-again" role="status">
        <b>{words.title}</b>
        <p>{words.body}</p>
        {action && <div className="map-again-act">{action}</div>}
      </div>
    );
  return (
    <div className="code-missing map-again" role="status">
      <span>
        {words.title} {words.body}
      </span>
      {action}
    </div>
  );
}
