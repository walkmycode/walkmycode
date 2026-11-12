// POST saves a pasted key to .walkmycode/keys.env (or, with use_found, copies the
// one another WalkMyCode on this computer saved); DELETE removes it. The
// value is checked for shape only (a bad key shows up at call time) and is
// never echoed back. Loopback + same-origin only.
import { z } from "zod";
import { guarded, HttpError } from "@/lib/providers/guard";
import { deleteKey, envStatus, copyFoundKey, writeKey } from "@/lib/providers/keys";

export const runtime = "nodejs";

const SetKey = z.union([z.object({ env_var: z.string().min(1), value: z.string() }), z.object({ env_var: z.string().min(1), use_found: z.literal(true) })]);
const DropKey = z.object({ env_var: z.string().min(1) });

function bad(issues: z.ZodError["issues"]): never {
  throw new HttpError(400, issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
}

export const POST = guarded(async (req) => {
  const parsed = SetKey.safeParse(await req.json());
  if (!parsed.success) bad(parsed.error.issues);
  const { env_var } = parsed.data;
  if ("use_found" in parsed.data) {
    if (!copyFoundKey(env_var)) throw new HttpError(404, "That key is no longer saved in your other WalkMyCode. Paste it here instead.");
  } else {
    if (!parsed.data.value.trim()) throw new HttpError(400, "Paste a key first.");
    writeKey(env_var, parsed.data.value);
  }
  return Response.json({ ok: true, has_key: envStatus(env_var).has_key });
});

export const DELETE = guarded(async (req) => {
  const parsed = DropKey.safeParse(await req.json());
  if (!parsed.success) bad(parsed.error.issues);
  deleteKey(parsed.data.env_var);
  return Response.json({ ok: true, has_key: envStatus(parsed.data.env_var).has_key });
});
