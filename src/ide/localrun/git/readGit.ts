// The desktop app's read-only line history (POST /api/git/read, src/lib/localrun/gitRead.ts): who
// changed each line of a file, and the file's own commits, from the folder the app opened, without
// "run code on this computer". Elsewhere line history goes through the local-run socket as before.
import type { GitRead, GitReadOp } from "@/lib/localrun/gitRead";

export async function readGit(op: GitReadOp, folder: string, path: string): Promise<GitRead> {
  const res = await fetch("/api/git/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, folder, path }),
  });
  const body = (await res.json().catch(() => null)) as (GitRead & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error || "git didn't answer.");
  return body;
}
