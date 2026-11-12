import type { SourceFile } from "@/analyzer/types";
import type { MapCard } from "@/lib/mapCard";

/** One folder of the workspace being put together (several folders, one map). */
export interface RepoRow {
  label: string;
  kind: "local" | "demo";
  files: SourceFile[];
  handle?: FileSystemDirectoryHandle;
  /** The folder had more files than one repo may hold; only the first ones are in. */
  capped?: boolean;
}

/** A card under "Pick up where you left off": the workspace saved in this browser, or a map
 * indexed on the command line. */
export interface CardView {
  key: string;
  kind: "saved" | "indexed";
  card: MapCard;
  /** "Opened 2 h ago" when this browser opened it, else when it was mapped or indexed. */
  when: { verb: "Opened" | "Mapped" | "Indexed"; iso: string };
  /** Its folders can be changed and mapped again here (the saved workspace, with its code). */
  editable: boolean;
}
