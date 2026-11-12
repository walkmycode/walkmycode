// The adapter layer (docs/PLAN.md, "Two versions"): the only places WalkMyCode,
// WalkMyCode Lite and WalkMyCode for Claude (the MCP page, docs/MCP.md) differ. Each
// rule here is pure, so tests can check every case; what it is fed comes from
// the build target (target.ts) and from what Claude's artifact runtime offers
// this page (runtime.ts).
import type { Target } from "./target";

/** Where the guide's answers come from. */
export type AiRoute =
  /** The viewer's own Claude, through the artifact's `sample` with the page's tools. */
  | "sample"
  /** The app's own /api/claude and its provider layer. */
  | "api"
  /** WalkMyCode for Claude: the user's own Claude, through the local MCP server's bridge (the
   * request waits until Claude asks for it with next_request; the answer comes back as a command). */
  | "bridge"
  /** Nowhere: Lite opened outside Claude has no server to ask. */
  | "none";

/** The MCP page always asks the user's Claude over the bridge. Inside Claude the viewer's
 * Claude answers, as in the Learn room; else the app's server, which Lite does not have. */
export function pickAi(o: { target: Target; sample: boolean }): AiRoute {
  if (o.target === "mcp") return "bridge";
  if (o.sample) return "sample";
  return o.target === "lite" ? "none" : "api";
}

/** Where a workspace is kept between visits. */
export type StorageRoute =
  /** The viewer's private space in the artifact's database (data/users/<id>/): the map and
   * the file list, so they follow the viewer to another device. The code itself stays in
   * this browser (IndexedDB); a document holds at most 256 KiB and code runs to megabytes. */
  | "account"
  /** This browser's IndexedDB alone. */
  | "browser"
  /** The MCP page: the local server holds the workspace (GET /api/workspace, /api/files) and
   * keeps the user's answers (POST /api/answers) under ~/.walkmycode; nothing stays in the browser. */
  | "server";

export function pickStorage(o: { target?: Target; db: boolean; userId: string | null }): StorageRoute {
  if (o.target === "mcp") return "server";
  return o.db && o.userId ? "account" : "browser";
}

/** Where code comes from and where a saved file goes. */
export interface SourcePlan {
  /** How a folder is chosen: the File System Access picker, or <input webkitdirectory>. */
  picker: "directory" | "input";
  /** A folder can be dropped on the home page's drop zone. */
  drop: boolean;
  /** Save writes into the picked folder, or offers the file as a download or a copy. */
  save: "folder" | "offer";
  /** Repos indexed on the command line (/api/demo) can be opened. */
  indexed: boolean;
  /** The folders are read by the local MCP server, which Claude points at them (walkmycode_open):
   * the page picks none, and says how to ask Claude instead. */
  server?: boolean;
}

/** Lite runs in a cross-origin frame: no folder picker or write access, and no /api/demo.
 * Both take a dropped folder (the home page is one drop zone). The MCP page picks no folder
 * at all (the server reads the ones Claude opens) and writes none either (WalkMyCode for Claude
 * is read-only), so Save offers the file. */
export function pickSource(o: { target: Target; directoryPicker: boolean }): SourcePlan {
  if (o.target === "lite") return { picker: "input", drop: true, save: "offer", indexed: false };
  if (o.target === "mcp") return { picker: "input", drop: false, save: "offer", indexed: false, server: true };
  return { picker: o.directoryPicker ? "directory" : "input", drop: true, save: "folder", indexed: true };
}

/** What Settings offers. */
export interface SettingsPlan {
  /** The provider, model and key form (/api/config). */
  providers: boolean;
  /** The running cost of the session, from each answer's token usage. */
  costMeter: boolean;
}

/** Lite and the MCP page answer on the user's own Claude: no keys to paste, no meter to read. */
export function pickSettings(target: Target): SettingsPlan {
  return target === "full" ? { providers: true, costMeter: true } : { providers: false, costMeter: false };
}

/** How the guide is heard (docs/VOICE.md). */
export interface VoicePlan {
  /** Who reads tours and answers aloud: the narrator chosen in Settings → Voice (ElevenLabs,
   * Deepgram or the browser), or only the browser's own voice (speechSynthesis). */
  narration: "choice" | "browser";
  /** Spoken questions: the voice lecturer ("Talk"). Artifacts block the microphone and
   * outside network calls, so never in Lite. */
  microphone: boolean;
  /** How a spoken question is answered: by the voice lecturer ("lecturer", the app), or by the
   * user's own Claude over the bridge, in one of the voice modes of MCP.md §4 ("claude"). */
  talk: "lecturer" | "claude" | "none";
}

/** Lite narrates with the browser's voice and never listens; the app reads with the narrator
 * chosen in Settings and has the voice lecturer; the MCP page reads the same way (its local
 * server holds the voice keys) and sends what is said to the user's Claude. */
export function pickVoice(target: Target): VoicePlan {
  if (target === "lite") return { narration: "browser", microphone: false, talk: "none" };
  return { narration: "choice", microphone: true, talk: target === "mcp" ? "claude" : "lecturer" };
}
