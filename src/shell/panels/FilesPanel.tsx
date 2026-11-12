"use client";
// The workspace's files as folders; a click opens the file in the code group.
// Drawn again only when the open file changes.
import { useMemo } from "react";
import FileTree from "@/components/FileTree";
import { useShell } from "../WorkspaceProvider";

export default function FilesPanel() {
  const { map, activePath, openAt } = useShell();
  return useMemo(
    () => (
      <div className="dock-panel">
        <FileTree map={map} open={activePath} onOpen={(p) => openAt(p)} />
      </div>
    ),
    [map, activePath, openAt],
  );
}
