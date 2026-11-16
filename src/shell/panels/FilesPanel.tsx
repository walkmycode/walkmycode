"use client";
// The workspace's files as folders; a click opens the file in the code group.
// It follows the open file and numbers a trace's files (FileTree). Drawn
// again only when the open file or the trace changes.
import { useMemo } from "react";
import FileTree from "@/components/FileTree";
import { useShell } from "../WorkspaceProvider";

export default function FilesPanel() {
  const { map, activePath, openAt, lit, repo } = useShell();
  // Every file of the workspace, the map's and the rest (README.md, LICENSE, images…).
  const paths = useMemo(() => Object.keys(repo.files), [repo.files]);
  return useMemo(
    () => (
      <div className="dock-panel">
        <FileTree map={map} open={activePath} onOpen={(p) => openAt(p)} lit={lit} paths={paths} />
      </div>
    ),
    [map, activePath, openAt, lit, paths],
  );
}
