// What was dropped on the page, taken while the drop event lasts: the browser lets
// go of a drop's items once the event is over, so this runs at once and the reading
// (src/lib/localFolder.ts, loaded only when needed) runs after. Chromium also hands
// over a handle per item, which "refresh" can read again later; elsewhere only the
// entries. No imports, so the home page can take a drop without loading the reader.

export interface Dropped {
  /** One promise per item, where the browser offers handles; else null. */
  handles: Promise<FileSystemHandle | null>[] | null;
  entries: (FileSystemEntry | null)[];
}

type WithHandle = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };

export function takeDrop(dt: DataTransfer): Dropped {
  const items = Array.from(dt.items).filter((i) => i.kind === "file") as WithHandle[];
  const entries = items.map((i) => i.webkitGetAsEntry());
  let handles: Dropped["handles"] = null;
  try {
    if (items.length && items.every((i) => typeof i.getAsFileSystemHandle === "function")) handles = items.map((i) => i.getAsFileSystemHandle!());
  } catch {
    handles = null; // not allowed in this frame: the entries still work
  }
  return { handles, entries };
}

/** Whether a drag carries files (a folder counts), so the page offers to take it. */
export const carriesFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes("Files");
