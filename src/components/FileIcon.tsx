"use client";
/**
 * A file's drawing in Files (src/lib/fileIcon.ts says which). The drawings are the analogy scenes' set, so
 * they load on their own the first time one is wanted, not with the page: until then the row shows the
 * file's kind as before (the outlined page in its kind's colour), in the same space, and nothing moves.
 * Small in the tree and search, without the drawing's ground shadow; whole where there is room.
 */
import { lazy, memo, Suspense } from "react";
import { fileIcon, folderIcon } from "@/lib/fileIcon";
import type { FileKind } from "@/lib/fileTree";

const Drawing = lazy(() => import("@/components/scene/Drawing"));

type Props = {
  path: string;
  /** A folder: its job's drawing, or the folder. */
  dir?: boolean;
  /** The file's kind, drawn until the drawings have loaded. */
  kind?: FileKind;
  /** row (the tree), hit (a search result), big (a file that can't be shown). */
  size?: "row" | "hit" | "big";
};

function FileIcon({ path, dir, kind, size = "row" }: Props) {
  const icon = dir ? folderIcon(path.slice(path.lastIndexOf("/") + 1)) : fileIcon(path);
  return (
    <span className={`fic ${size}`} title={icon.what} aria-hidden="true">
      <Suspense fallback={dir ? null : <span className={`fk ${kind ?? "other"}`} />}>
        <Drawing name={icon.name} tint={icon.tint} />
      </Suspense>
    </span>
  );
}

export default memo(FileIcon);
