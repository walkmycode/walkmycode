// Where WalkMyCode for Claude's page keeps its workspace: on the local MCP server
// that read the folders (docs/MCP.md §2.3). The map and the code come from
// GET /api/workspace and GET /api/files; the user's answers ("Where does this
// point?", "Whose address is this?") go back with POST /api/answers, so the
// server saves them under ~/.walkmycode and Claude's tools see the same arrows.
// Nothing is kept in the browser: the next launch reads the folders afresh.
import type { Assertion, CodeMap } from "@/analyzer/types";
import type { WorkspaceInfo } from "@/lib/bridge/protocol";
import { answersOf, type Workspace } from "@/lib/store";

type FetchLike = typeof globalThis.fetch;

/** The answers last sent (or loaded) for each workspace, so a save that changes no answer sends nothing. */
const sent = new Map<string, string>();

const key = (answers: Assertion[] | undefined) =>
  JSON.stringify(
    [...(answers ?? [])].sort((a, b) => a.setting.localeCompare(b.setting)).map((a) => [a.setting, a.host ?? null, a.service, a.answeredAt]),
  );

/** The page's workspace, from what the server says is open: null when nothing is open yet. */
export function workspaceOf(info: WorkspaceInfo, map: CodeMap, files: Record<string, string>): Workspace {
  const assertions = answersOf(map);
  const fileCount = (label: string) => (info.repos.length > 1 ? Object.keys(files).filter((p) => p.startsWith(`${label}/`)).length : Object.keys(files).length);
  return {
    id: info.id,
    name: info.name,
    repos: info.repos.map((label) => ({ label, kind: "local", fileCount: fileCount(label), addedAt: info.mappedAt })),
    map,
    files,
    ...(assertions.length ? { assertions } : {}),
  };
}

/** Read the open workspace from the server. */
export async function loadServerWorkspace(fetchImpl: FetchLike = fetch): Promise<Workspace | null> {
  const [w, f] = await Promise.all([fetchImpl("/api/workspace"), fetchImpl("/api/files")]);
  if (!w.ok || !f.ok) throw new Error(`WalkMyCode's server answered ${w.ok ? f.status : w.status}.`);
  const { workspace, map } = (await w.json()) as { workspace: WorkspaceInfo | null; map?: CodeMap };
  if (!workspace || !map) return null;
  const files = (await f.json()) as Record<string, string>;
  const out = workspaceOf(workspace, map, files);
  sent.set(out.id, key(out.assertions));
  return out;
}

/** Send the workspace's answers to the server when they changed. */
export async function saveServerAnswers(w: Workspace | null, fetchImpl: FetchLike = fetch): Promise<boolean> {
  if (!w) return false;
  const k = key(w.assertions);
  if (sent.get(w.id) === k) return false;
  const res = await fetchImpl("/api/answers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: w.id, answers: w.assertions ?? [] }),
  });
  if (!res.ok) throw new Error(`WalkMyCode's server did not keep the answer (${res.status}).`);
  sent.set(w.id, k);
  return true;
}
