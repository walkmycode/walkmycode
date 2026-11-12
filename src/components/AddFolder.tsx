"use client";
// A map without its code (WalkMyCode Lite: restored from the viewer's Claude space, its
// code too big to go along, src/lib/adapters/storage.ts): every place that needs the code
// says so in the same plain words and offers the same one click, "Add folder". It opens
// the same folder input as the home page, with the same note first (FolderPromptSheet),
// and the folder's code joins the map that is open (src/lib/workspace.ts attachFolder):
// nothing is mapped again and the room stays where it was.
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { pickSource } from "@/lib/adapters/select";
import { TARGET } from "@/lib/adapters/target";
import { prefStore, showFolderPrompt, turnFolderPromptOff } from "@/lib/folderPrompt";
import type { PickedFolder } from "@/lib/localFolder";
import { getWorkspace, setWorkspace } from "@/lib/store";
import { attachFolder } from "@/lib/workspace";
import { toast } from "@/shell/Toast";

const FolderPromptSheet = dynamic(() => import("@/components/home/FolderPromptSheet"), { ssr: false });

/** The words, everywhere the code is missing. */
export const CODE_MISSING = {
  banner: "This map was saved without its code. Add the folder again to read code and get full answers.",
  file: "This file’s code isn’t here: the map was saved without it. Add the folder again to read it.",
  guide: "This map was saved without its code, so I can only answer from the map. Add the folder again for full answers.",
};

/** The folder picked: its code joins the open map, or why it could not. */
async function attach(folder: PickedFolder): Promise<string> {
  const w = getWorkspace();
  if (!w) return "No map is open.";
  const { redactSource } = await import("@/analyzer/config/files");
  const r = attachFolder(w, folder, redactSource);
  if (!r.ok) return r.why;
  setWorkspace(r.workspace);
  return r.missing.length ? `Added the code of ${r.label}. Still to add: ${r.missing.join(", ")}.` : `Added the code of ${r.label}: you can read every file now.`;
}

export default function AddFolder({ className = "ctl compact primary", label = "Add folder" }: { className?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  const done = async (folder: PickedFolder | null) => {
    if (!folder) return;
    setBusy(true);
    try {
      toast(await attach(folder));
    } catch (e) {
      toast(`That folder could not be read: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (busy) return;
    const plan = pickSource({ target: TARGET, directoryPicker: typeof window !== "undefined" && "showDirectoryPicker" in window });
    if (plan.picker === "directory") {
      const lf = await import("@/lib/localFolder");
      return done(await lf.pickFolder());
    }
    // The browser asks its own "Upload all files?" next: say what it means first.
    if (showFolderPrompt(plan.picker, prefStore())) setSheet(true);
    else input.current?.click();
  };

  return (
    <>
      <button type="button" className={className} onClick={() => void open()} disabled={busy}>
        {busy ? "Reading…" : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        multiple
        onChange={async (e) => {
          const list = e.target.files;
          if (!list?.length) return;
          const lf = await import("@/lib/localFolder");
          const picked = await lf.filesFromInputAsync(list);
          e.target.value = "";
          await done(picked);
        }}
      />
      {sheet && (
        <FolderPromptSheet
          canDrop={false}
          onChoose={(never) => {
            if (never) turnFolderPromptOff(prefStore());
            // Opened from this click, so the browser allows it.
            input.current?.click();
            setSheet(false);
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}

/** The banner over the map while its code is missing. */
export function CodeMissingBanner() {
  return (
    <div className="code-missing" role="status">
      <span>{CODE_MISSING.banner}</span>
      <AddFolder />
    </div>
  );
}
