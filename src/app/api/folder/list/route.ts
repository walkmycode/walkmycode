// A folder on this computer, listed again by its path: each file's size and time, never its text
// (src/lib/serverFolder.ts listFolderAt), so Explore can notice a file added, changed or removed since
// the folder was read (src/lib/folderSync.ts). With `read`, the text of those files too, and only of
// files the list holds. Loopback + same-origin only (guarded), like every route that touches this
// computer; refused in hosted mode, where the disk is the server's.
import { hostedRefusal } from "@/lib/localrun/hub";
import { guarded } from "@/lib/providers/guard";
import { listFolderAt, readFilesAt } from "@/lib/serverFolder";

export const runtime = "nodejs";

export const POST = guarded(async (req) => {
  const refusal = hostedRefusal();
  if (refusal) return Response.json({ error: refusal }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { path?: unknown; read?: unknown } | null;
  if (typeof body?.path !== "string") return Response.json({ error: "Which folder? Send its path." }, { status: 400 });
  const read = body.read;
  if (read !== undefined && !(Array.isArray(read) && read.every((p) => typeof p === "string"))) return Response.json({ error: "Which files? Send their paths." }, { status: 400 });
  const out = read ? await readFilesAt(body.path, read as string[]) : await listFolderAt(body.path);
  if ("error" in out) return Response.json(out, { status: 400 });
  return Response.json(out);
});
