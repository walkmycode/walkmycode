// The desktop app's read-only git (POST /api/git/read, src/lib/localrun/gitRead.ts): who changed each
// line of a file, the file's own commits, one line's (or one function's) history, how often each file
// changed (Hotspots), and for "Tour a change", the bases and the change; from the folder the app
// opened, without "run code on this computer". Elsewhere these go through the local-run socket as before.
import type { Span } from "@/lib/hotspots";
import type { GitRead, GitReadOp } from "@/lib/localrun/gitRead";
import type { StoryOf } from "@/lib/localrun/lineStory";

async function post(body: Record<string, unknown>): Promise<GitRead> {
  const res = await fetch("/api/git/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const r = (await res.json().catch(() => null)) as (GitRead & { error?: string }) | null;
  if (!res.ok || !r) throw new Error(r?.error || "git didn't answer.");
  return r;
}

export function readGit(op: Exclude<GitReadOp, "bases" | "change" | "churn">, folder: string, path: string, of?: StoryOf): Promise<GitRead> {
  return post({ op, folder, path, ...of });
}

/** "Tour a change": the bases (`base` left out), or the change against one (null: what isn't committed). */
export function readChange(folder: string, base?: string | null): Promise<GitRead> {
  return post(base === undefined ? { op: "bases", folder } : { op: "change", folder, base });
}

/** Hotspots: how often each file of the folder changed over the span. */
export function readChurn(folder: string, span: Span): Promise<GitRead> {
  return post({ op: "churn", folder, span });
}
