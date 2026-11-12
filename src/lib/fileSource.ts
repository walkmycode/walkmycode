"use client";
// Writing a file back to where it came from. The shared IDE only calls
// onSave(text); this decides what that means for the source of the file:
// a folder picked in the browser is written through the File System Access
// API (the browser asks once for write permission); a repo indexed from the
// command line or loaded as a demo has no folder here, so the file is offered
// as a download instead; GitHub comes with the GitHub App (a commit or PR on
// a branch, never straight to the default branch). WalkMyCode Lite cannot write
// into a folder at all: the file is offered for download or copied
// (src/lib/adapters/source.ts).
import type { RepoRef } from "@/analyzer/types";
import { pickSource } from "./adapters/select";
import { TARGET } from "./adapters/target";
import type { RepoSource, Workspace } from "./store";

export type SaveResult =
  | { kind: "written"; path: string }
  | { kind: "downloaded"; path: string; why: string }
  | { kind: "copied"; path: string; why: string }
  | { kind: "denied"; path: string; why: string };

type WritableHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
};

/** The repo a path belongs to, and the path inside that repo. */
export function repoOf(ws: Workspace, path: string): { repo: RepoSource | undefined; ref: RepoRef | undefined; inner: string } {
  const ref = ws.map.repos.find((r) => r.prefix && path.startsWith(r.prefix)) ?? ws.map.repos.find((r) => !r.prefix);
  const repo = ref ? ws.repos.find((r) => r.label === ref.label) : ws.repos[0];
  return { repo, ref, inner: ref?.prefix ? path.slice(ref.prefix.length) : path };
}

export async function saveFile(ws: Workspace, path: string, text: string): Promise<SaveResult> {
  // WalkMyCode for Claude: the local server read the folder, so it writes the file back into it
  // (POST /api/files/save, mcp/src/workspace.ts writeWorkspaceFile), rather than handing over a download.
  if (TARGET === "mcp") {
    try {
      const res = await fetch("/api/files/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: ws.id, path, text }) });
      if (res.ok) return { kind: "written", path };
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { kind: "denied", path, why: body?.error || `WalkMyCode's server answered ${res.status}.` };
    } catch (e) {
      const { whyFailed } = await import("./unreachable");
      return { kind: "denied", path, why: whyFailed(e) };
    }
  }
  if (pickSource({ target: TARGET, directoryPicker: false }).save === "offer") {
    const { offerFile } = await import("./adapters/source");
    return { path, ...(await offerFile(path, text)) };
  }
  const { repo, inner } = repoOf(ws, path);
  const handle = repo?.handle as WritableHandle | undefined;
  if (repo?.kind === "local" && handle) {
    try {
      let state = (await handle.queryPermission?.({ mode: "readwrite" })) ?? "prompt";
      if (state !== "granted") state = (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
      if (state !== "granted") return { kind: "denied", path, why: "The browser did not allow writing to that folder." };
      const parts = inner.split("/");
      let dir: FileSystemDirectoryHandle = handle;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      const file = await dir.getFileHandle(parts[parts.length - 1]);
      const w = await file.createWritable();
      await w.write(text);
      await w.close();
      return { kind: "written", path };
    } catch (e) {
      return { kind: "denied", path, why: (e as Error).message };
    }
  }
  download(path, text);
  const why = repo?.kind === "github" ? "Saving to GitHub arrives with the GitHub App; until then the file is downloaded." : "This repo was indexed outside the browser, so WalkMyCode cannot write into its folder; the file is downloaded instead.";
  return { kind: "downloaded", path, why };
}

function download(path: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = path.split("/").pop() ?? "file.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
