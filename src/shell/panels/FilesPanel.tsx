"use client";
// The workspace's files as folders; a click opens the file in the code group.
// It follows the open file and numbers a trace's files (FileTree). Drawn
// again only when the open file or the trace changes. Above it, when the map's
// folders can be read again, when they were last read and "Refresh files"
// (src/shell/folderWatch.tsx), which takes a new, changed or removed file in now.
import { useEffect, useMemo, useState } from "react";
import FileTree from "@/components/FileTree";
import { TARGET } from "@/lib/adapters/target";
import { canCheck } from "@/lib/folderCheck";
import { timeAgo } from "@/lib/mapCard";
import { useWorkspace } from "@/lib/store";
import { refreshFiles, useFolderSync } from "../folderWatch";
import { useShell } from "../WorkspaceProvider";

/** "read 2 min ago": the last check this page made, else when the folders were read. */
function FilesSync() {
  const w = useWorkspace();
  const { busy, checked } = useFolderSync();
  // The words age by themselves: drawn again every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!w || !canCheck(w, TARGET)) return null;
  const read = Math.max(checked?.id === w.id ? checked.at : 0, ...w.repos.map((r) => Date.parse(r.readAt ?? r.addedAt) || 0));
  const when = read ? `read ${timeAgo(new Date(read).toISOString(), new Date(Math.max(now, read))).replace(/^Y/, "y")}` : "";
  const folders = w.repos.length > 1 ? "the folders" : "the folder";
  return (
    <div className="files-sync">
      <span className="files-sync-when" title={read ? `Files were last read from ${folders} at ${new Date(read).toLocaleTimeString("en-GB")}` : undefined} aria-live="polite">
        {busy === "reading" ? "Reading changes…" : busy === "checking" ? "Checking…" : when}
      </span>
      <button
        type="button"
        className="files-sync-go"
        onClick={() => void refreshFiles({ manual: true })}
        disabled={!!busy}
        aria-busy={!!busy}
        title={`Read ${folders} again now: new, changed and removed files come in where you are (it also checks by itself every minute)`}
      >
        <svg className={busy ? "tool-ico spin" : "tool-ico"} viewBox="0 0 16 16" aria-hidden>
          <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Refresh files
      </button>
    </div>
  );
}

export default function FilesPanel() {
  const { map, activePath, openAt, lit, repo } = useShell();
  // Every file of the workspace, the map's and the rest (README.md, LICENSE, images…).
  const paths = useMemo(() => Object.keys(repo.files), [repo.files]);
  return useMemo(
    () => (
      <div className="dock-panel">
        <FilesSync />
        <FileTree map={map} open={activePath} onOpen={(p) => openAt(p)} lit={lit} paths={paths} />
      </div>
    ),
    [map, activePath, openAt, lit, paths],
  );
}
