// GET /api/tasks/:id/comments: the conversation on a task. POST: add to it.
import { currentUser } from "@/lib/auth";
import { addComment, listComments } from "@/lib/comments";
import { newComment } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json(await listComments(id));
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = newComment.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  return Response.json(await addComment(id, user.id, parsed.data.body), { status: 201 });
}
