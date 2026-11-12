// GET /api/tasks/:id: one task. PATCH: tick it off, rename or reassign it. DELETE: remove it.
import { currentUser } from "@/lib/auth";
import { deleteTask, getTask, updateTask } from "@/lib/tasks";
import { taskChange } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const task = await getTask(id);
  if (!task) return Response.json({ error: "No such task" }, { status: 404 });
  return Response.json(task);
}

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await currentUser())) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = taskChange.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  return Response.json(await updateTask(id, parsed.data));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!(await currentUser())) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  await deleteTask(id);
  return Response.json({ ok: true });
}
