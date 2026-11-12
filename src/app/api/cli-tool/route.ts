// A tool call from a Claude Code run (scripts/cli-tools-mcp.mjs, src/lib/providers/cli.ts): it waits
// until the page has run the tool and answers with the result. Loopback only, and only with the run's
// own key, so nothing else can feed or read a run.
import { toolCall } from "@/lib/providers/cli";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const host = new URL(req.url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) return Response.json({ error: "Loopback only." }, { status: 403 });
  // The bridge is a local process, never a page: a browser's cross-site request is turned away.
  if (req.headers.get("sec-fetch-site") || req.headers.get("origin")) return Response.json({ error: "Not for pages." }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return Response.json({ error: "Too large." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { job?: unknown; key?: unknown; name?: unknown; input?: unknown } | null;
  if (!body || typeof body.job !== "string" || typeof body.key !== "string" || typeof body.name !== "string") return Response.json({ error: "job, key and name are needed." }, { status: 400 });
  const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};
  const pending = toolCall(body.job, body.key, body.name, input);
  if (!pending) return Response.json({ error: "That run is over, or the key is wrong." }, { status: 404 });
  const { text, isError } = await pending;
  return Response.json({ result: text, ...(isError ? { isError: true } : {}) });
}
