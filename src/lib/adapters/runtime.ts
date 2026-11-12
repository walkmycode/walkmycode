// What Claude's artifact runtime offers this page. One answer for the whole app:
// the Learn room's own check (src/learn/lib/claude.ts). Its getSample() hands
// back WalkMyCode's /api/learn tutor exactly when there is no runtime, and the
// runtime's `sample` (or null, where Claude does not serve it) when there is.
// Nothing here looks at window.claude on its own account.
import { getDb, getSample, getUserId, type Db, type Sample } from "@/learn/lib/claude";
import { apiTutor } from "@/learn/lib/tutor";
import { pickAi, type AiRoute } from "./select";
import { TARGET } from "./target";

export type { Db };

/** Whether this page runs inside Claude's artifact runtime (in a viewer, or on its host). */
export async function inClaude(): Promise<boolean> {
  return (await getSample()) !== apiTutor;
}

/** The viewer's own Claude, when the page runs inside Claude and Claude serves it; else null. */
export async function claudeSample(): Promise<Sample | null> {
  const s = await getSample();
  return s && s !== apiTutor ? s : null;
}

/** The artifact's database and the viewer's id: both, or null (no private space then). */
export async function claudeSpace(): Promise<{ db: Db; userId: string } | null> {
  const [db, userId] = await Promise.all([getDb(), getUserId()]);
  return db && userId ? { db, userId } : null;
}

/** A capability the Learn helpers do not cover (downloads), asked of the same runtime,
 * and only once the Learn room's check has found one. */
export async function claudeCapability<T>(name: string): Promise<T | null> {
  if (!(await inClaude())) return null;
  try {
    const rt = (globalThis as { claude?: { use(n: string): Promise<unknown> } }).claude;
    return ((await rt?.use(name)) as T | null | undefined) ?? null;
  } catch {
    return null;
  }
}

let route: Promise<AiRoute> | null = null;
/** Where the guide's answers come from on this page (asked once; the runtime's answer is fixed per view). */
export function aiRoute(): Promise<AiRoute> {
  // The MCP page never runs inside Claude's artifact runtime: it asks over the bridge, so there is nothing to probe.
  route ??= TARGET === "mcp" ? Promise.resolve(pickAi({ target: TARGET, sample: false })) : claudeSample().then((s) => pickAi({ target: TARGET, sample: !!s }));
  return route;
}
