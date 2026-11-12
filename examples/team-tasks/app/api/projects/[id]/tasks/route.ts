// GET /api/projects/:id/tasks: the project's tasks. POST: add a task to it.
import { currentUser } from "@/lib/auth";
import { createTask, listTasks } from "@/lib/tasks";
import { newTask } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json(await listTasks(id));
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = newTask.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const task = await createTask(id, parsed.data.title, parsed.data.assigneeId);
  return Response.json(task, { status: 201 });
}
