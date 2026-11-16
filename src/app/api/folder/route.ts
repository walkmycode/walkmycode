// A folder on this computer, read by its path (src/lib/serverFolder.ts): the desktop
// app's folder picker gives the page a path, and the page asks for the folder here
// (docs/DESKTOP.md, "Folders"). Loopback + same-origin only (guarded), like every route
// that touches this computer; refused in hosted mode, where the disk is the server's.
import { hostedRefusal } from "@/lib/localrun/hub";
import { guarded } from "@/lib/providers/guard";
import { readFolderAt } from "@/lib/serverFolder";

export const runtime = "nodejs";

export const POST = guarded(async (req) => {
  const refusal = hostedRefusal();
  if (refusal) return Response.json({ error: refusal }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
  if (typeof body?.path !== "string") return Response.json({ error: "Which folder? Send its path." }, { status: 400 });
  const read = await readFolderAt(body.path);
  if ("error" in read) return Response.json(read, { status: 400 });
  return Response.json(read);
});
